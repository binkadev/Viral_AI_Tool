"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { createHash } = require("crypto");
const { createJob, transition, failure } = require("./generation-job");
const { normalizeRequest, identifier } = require("./generation-request");
const { chooseModel } = require("./model-router");
const { ProviderRegistry } = require("./provider-registry");
const { GenerationStore } = require("./generation-store");

const ACTIVE = new Set(["queued", "preparing", "submitting", "running", "verifying", "cancelling"]);
const BLOCKING = new Set([...ACTIVE, "interrupted"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RESTART_INTERRUPTED = new Set(["preparing", "submitting", "running", "verifying", "cancelling"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fingerprint = request => createHash("sha256")
  .update(JSON.stringify({ ...request, idempotencyKey: null }))
  .digest("hex");

function updateAttempt(job, patch) {
  const attempts = Array.isArray(job.attempts) && job.attempts.length
    ? job.attempts.map(attempt => ({ ...attempt }))
    : [{ number: 1, status: "queued", createdAt: job.createdAt, startedAt: null, completedAt: null }];
  const last = attempts[attempts.length - 1];
  attempts[attempts.length - 1] = { ...last, ...patch };
  return attempts;
}

class GenerationService extends EventEmitter {
  constructor({ root, registry = new ProviderRegistry(), store = new GenerationStore(root) }) {
    super();
    this.root = root;
    this.registry = registry;
    this.store = store;
    this.jobs = store.load();
    this.tail = Promise.resolve();
    this.stopping = false;
    this.runtimeActive = new Set();

    const recovered = this.jobs.map(job => RESTART_INTERRUPTED.has(job.status)
      ? {
          ...job,
          status: "interrupted",
          errorCode: "RECOVERY_REQUIRED",
          error: { code: "RECOVERY_REQUIRED" },
          attempts: updateAttempt(job, { status: "interrupted" })
        }
      : job);
    if (JSON.stringify(recovered) !== JSON.stringify(this.jobs)) {
      store.save(recovered);
      this.jobs = recovered;
    }
  }

  serial(fn) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }

  commit(job) {
    const jobs = this.jobs.filter(item => item.id !== job.id).concat(job);
    this.store.save(jobs);
    this.jobs = jobs;
    if (TERMINAL.has(job.status) || job.status === "interrupted") this.runtimeActive.delete(job.id);
    try { this.emit("changed", { id: job.id, status: job.status }); } catch {}
    return clone(job);
  }

  get(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw failure("JOB_NOT_FOUND");
    return clone(job);
  }

  list(projectId) {
    if (!identifier(projectId)) throw failure("INVALID_REQUEST");
    return this.jobs.filter(job => job.projectId === projectId).map(clone);
  }

  activeCount() {
    return this.jobs.filter(job => this.runtimeActive.has(job.id) && ACTIVE.has(job.status)).length;
  }

  async readiness() {
    if (this.stopping) return { ready: false, state: "unavailable", modelIds: [], availability: {}, providers: [] };
    return this.registry.readiness();
  }

  context(job) {
    return {
      jobId: job.id,
      requestId: job.requestId,
      projectId: job.projectId,
      sceneId: job.sceneId,
      request: clone(job.request),
      modelId: job.modelId,
      outputDirectory: path.join(this.root, "outputs", job.id)
    };
  }

  async submit(input, retryOf = null) {
    const request = normalizeRequest(input);
    return this.serial(async () => {
      if (this.stopping) throw failure("UNAVAILABLE");

      const prior = this.jobs.find(job => job.projectId === request.projectId && job.idempotencyKey === request.idempotencyKey);
      if (prior) {
        if (fingerprint(prior.request) !== fingerprint(request)) throw failure("IDEMPOTENCY_CONFLICT");
        return clone(prior);
      }
      if (this.jobs.some(job => BLOCKING.has(job.status) && fingerprint(job.request) === fingerprint(request))) {
        throw failure("DUPLICATE_JOB");
      }

      const ready = await this.readiness();
      const allow = request.modelId
        ? ready.modelIds.filter(id => id === request.modelId)
        : ready.modelIds;
      const route = chooseModel(request, { availability: ready.availability, allow });
      if (!this.registry.getProvider(route.model.provider)) throw failure("PROVIDER_UNAVAILABLE");

      const job = createJob(request, route, retryOf);
      this.commit(job);
      this.runtimeActive.add(job.id);
      setImmediate(() => this.execute(job.id).catch(() => {}));
      return clone(job);
    });
  }

  async execute(id) {
    this.runtimeActive.add(id);
    const preparing = await this.serial(() => {
      const current = this.get(id);
      if (this.stopping || current.status !== "queued") return null;
      const startedAt = current.startedAt || new Date().toISOString();
      return this.commit(transition(current, "preparing", {
        progress: Math.max(1, Number(current.progress || 0)),
        startedAt,
        attempts: updateAttempt(current, { status: "preparing", startedAt })
      }));
    });
    if (!preparing) return;

    const context = this.context(preparing);
    try {
      fs.mkdirSync(context.outputDirectory, { recursive: true });
      fs.accessSync(context.outputDirectory, fs.constants.W_OK);
      const fsStats = fs.statfsSync(context.outputDirectory);
      if (fsStats.bavail * fsStats.bsize < 64 * 1024 * 1024) throw failure("RESOURCE_UNAVAILABLE");
      const adapter = this.registry.getProvider(preparing.provider);
      if (!adapter || (await adapter.preflight(context))?.ready !== true) throw failure("PROVIDER_UNAVAILABLE");
    } catch (error) {
      await this.serial(() => {
        const current = this.get(id);
        if (current.status !== "preparing") return current;
        const completedAt = new Date().toISOString();
        const code = error?.code === "RESOURCE_UNAVAILABLE" ? "RESOURCE_UNAVAILABLE" : "GENERATION_FAILED";
        return this.commit(transition(current, "failed", {
          errorCode: code,
          error: { code },
          completedAt,
          attempts: updateAttempt(current, { status: "failed", completedAt })
        }));
      });
      return;
    }

    const submitting = await this.serial(() => {
      const current = this.get(id);
      if (current.status !== "preparing") return null;
      return this.commit(transition(current, "submitting", {
        progress: Math.max(2, Number(current.progress || 0)),
        attempts: updateAttempt(current, { status: "submitting" })
      }));
    });
    if (!submitting) return;

    let result;
    let uncertain = false;
    try {
      result = await this.registry.getProvider(submitting.provider).start(this.context(submitting));
    } catch {
      uncertain = true;
    }
    await this.serial(() => this.finish(id, result, { uncertain }));
  }

  finish(id, result, options = {}) {
    let job = this.get(id);
    if (!["submitting", "running", "verifying", "interrupted"].includes(job.status)) return job;

    if (options.uncertain === true) {
      if (job.status === "interrupted") return job;
      return this.commit(transition(job, "interrupted", {
        errorCode: "RECOVERY_REQUIRED",
        error: { code: "RECOVERY_REQUIRED" },
        attempts: updateAttempt(job, { status: "interrupted" })
      }));
    }

    if (result?.status === "pending" || result?.status === "running") {
      if (job.status === "running") return job;
      if (job.status === "verifying") return job;
      this.runtimeActive.add(job.id);
      return this.commit(transition(job, "running", {
        progress: Math.max(5, Number(job.progress || 0)),
        errorCode: null,
        error: null,
        attempts: updateAttempt(job, { status: "running" })
      }));
    }

    if (result?.status === "completed") {
      if (job.status !== "verifying") {
        job = transition(job, "verifying", {
          progress: Math.max(95, Number(job.progress || 0)),
          errorCode: null,
          error: null,
          attempts: updateAttempt(job, { status: "verifying" })
        });
        this.commit(job);
      }

      const fileName = job.id + ".mp4";
      const outputPath = path.join(this.context(job).outputDirectory, fileName);
      try {
        if (
          result.fileName !== fileName ||
          fs.lstatSync(outputPath).isSymbolicLink() ||
          !fs.statSync(outputPath).isFile() ||
          fs.statSync(outputPath).size < 12 ||
          fs.realpathSync(path.dirname(outputPath)) !== path.resolve(this.context(job).outputDirectory)
        ) throw failure("ASSET_UNAVAILABLE");
        const fd = fs.openSync(outputPath, "r");
        const header = Buffer.alloc(12);
        try { fs.readSync(fd, header, 0, 12, 0); } finally { fs.closeSync(fd); }
        if (header.toString("ascii", 4, 8) !== "ftyp") throw failure("ASSET_UNAVAILABLE");

        const completedAt = new Date().toISOString();
        return this.commit(transition(job, "completed", {
          progress: 100,
          asset: { fileName },
          output: { fileName },
          errorCode: null,
          error: null,
          completedAt,
          attempts: updateAttempt(job, { status: "completed", completedAt })
        }));
      } catch {
        const completedAt = new Date().toISOString();
        return this.commit(transition(job, "failed", {
          errorCode: "ASSET_UNAVAILABLE",
          error: { code: "ASSET_UNAVAILABLE" },
          completedAt,
          attempts: updateAttempt(job, { status: "failed", completedAt })
        }));
      }
    }

    if (result?.status === "failed") {
      const completedAt = new Date().toISOString();
      return this.commit(transition(job, "failed", {
        errorCode: "GENERATION_FAILED",
        error: { code: "GENERATION_FAILED" },
        completedAt,
        attempts: updateAttempt(job, { status: "failed", completedAt })
      }));
    }

    if (result?.status === "cancelled") {
      const cancelling = job.status === "interrupted" ? job : transition(job, "cancelling");
      const cancelledAt = new Date().toISOString();
      return this.commit(transition(cancelling, "cancelled", {
        errorCode: null,
        error: null,
        cancelledAt,
        attempts: updateAttempt(job, { status: "cancelled", completedAt: cancelledAt })
      }));
    }

    return job;
  }

  async cancel(id) {
    const state = await this.serial(() => {
      const current = this.get(id);
      if (TERMINAL.has(current.status) || current.status === "cancelling") {
        return { job: current, remoteRequired: false };
      }
      if (![...BLOCKING].includes(current.status)) return { job: current, remoteRequired: false };

      const remoteRequired = ["submitting", "running", "verifying", "interrupted"].includes(current.status);
      const cancelling = this.commit(transition(current, "cancelling"));
      if (remoteRequired) return { job: cancelling, remoteRequired: true };

      const cancelledAt = new Date().toISOString();
      return {
        job: this.commit(transition(cancelling, "cancelled", {
          errorCode: null,
          error: null,
          cancelledAt,
          attempts: updateAttempt(current, { status: "cancelled", completedAt: cancelledAt })
        })),
        remoteRequired: false
      };
    });

    if (!state.remoteRequired || state.job.status !== "cancelling") return state.job;

    let confirmed = false;
    try {
      confirmed = (await this.registry.getProvider(state.job.provider)?.cancel(this.context(state.job)))?.confirmed === true;
    } catch {}

    return this.serial(() => {
      const current = this.get(id);
      if (current.status !== "cancelling") return current;
      if (!confirmed) {
        return this.commit(transition(current, "interrupted", {
          errorCode: "RECOVERY_REQUIRED",
          error: { code: "RECOVERY_REQUIRED" },
          attempts: updateAttempt(current, { status: "interrupted" })
        }));
      }
      const cancelledAt = new Date().toISOString();
      return this.commit(transition(current, "cancelled", {
        errorCode: null,
        error: null,
        cancelledAt,
        attempts: updateAttempt(current, { status: "cancelled", completedAt: cancelledAt })
      }));
    });
  }

  async recover(id) {
    const initial = this.get(id);
    if (initial.status === "queued") {
      if (this.stopping) return initial;
      this.runtimeActive.add(id);
      setImmediate(() => this.execute(id).catch(() => {}));
      return initial;
    }
    if (!["running", "interrupted"].includes(initial.status)) return initial;

    if (initial.status === "running") this.runtimeActive.add(id);
    let result;
    try {
      result = await this.registry.getProvider(initial.provider)?.reconcile(this.context(initial));
    } catch {
      if (initial.status === "running") {
        return this.serial(() => {
          const current = this.get(id);
          if (current.status !== "running") return current;
          return this.commit(transition(current, "interrupted", {
            errorCode: "RECOVERY_REQUIRED",
            error: { code: "RECOVERY_REQUIRED" },
            attempts: updateAttempt(current, { status: "interrupted" })
          }));
        });
      }
      return initial;
    }

    if (initial.status === "interrupted" && (result?.status === "pending" || result?.status === "running")) {
      this.runtimeActive.add(id);
    }
    return this.serial(() => this.finish(id, result));
  }

  async retry(id, idempotencyKey) {
    const job = this.get(id);
    if (!["failed", "cancelled"].includes(job.status) || idempotencyKey === job.idempotencyKey) {
      throw failure("RETRY_UNSAFE");
    }
    return this.submit({ ...job.request, idempotencyKey }, job.id);
  }

  async shutdown() {
    this.stopping = true;
    const ids = Array.from(this.runtimeActive);
    await Promise.all(ids.map(id => this.cancel(id).catch(() => {})));
  }
}

module.exports = { GenerationService, ACTIVE, BLOCKING };
