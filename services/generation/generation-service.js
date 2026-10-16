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

const ACTIVE = new Set(["queued", "processing", "cancelling"]);
const BLOCKING = new Set(["queued", "processing", "cancelling", "recovery_required"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fingerprint = request => createHash("sha256")
  .update(JSON.stringify({ ...request, idempotencyKey: null }))
  .digest("hex");

function updateAttempt(job, patch) {
  const attempts = Array.isArray(job.attempts) && job.attempts.length
    ? job.attempts.map(attempt => ({ ...attempt }))
    : [{ number: 1, status: "created", createdAt: job.createdAt, startedAt: null, completedAt: null }];
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

    const recovered = this.jobs.map(job => ["idle", "validating"].includes(job.status)
      ? { ...job, status: "failed", errorCode: "GENERATION_FAILED", completedAt: new Date().toISOString() }
      : ACTIVE.has(job.status)
        ? { ...job, status: "recovery_required", errorCode: "RECOVERY_REQUIRED" }
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
    return this.jobs.filter(job => ACTIVE.has(job.status)).length;
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
      const adapter = this.registry.getProvider(route.model.provider);
      if (!adapter) throw failure("PROVIDER_UNAVAILABLE");

      let job = createJob(request, route, retryOf);
      const context = this.context(job);
      fs.mkdirSync(context.outputDirectory, { recursive: true });
      fs.accessSync(context.outputDirectory, fs.constants.W_OK);
      const fsStats = fs.statfsSync(context.outputDirectory);
      if (fsStats.bavail * fsStats.bsize < 64 * 1024 * 1024) throw failure("RESOURCE_UNAVAILABLE");

      try {
        if ((await adapter.preflight(context))?.ready !== true) throw failure("PROVIDER_UNAVAILABLE");
      } catch {
        throw failure("PROVIDER_UNAVAILABLE");
      }

      job = transition(transition(job, "validating"), "queued", {
        attempts: updateAttempt(job, { status: "queued" })
      });
      this.commit(job);
      setImmediate(() => this.execute(job.id).catch(() => {}));
      return clone(job);
    });
  }

  async execute(id) {
    const job = await this.serial(() => {
      const current = this.get(id);
      if (this.stopping || current.status !== "queued") return null;
      const startedAt = new Date().toISOString();
      return this.commit(transition(current, "processing", {
        progress: Math.max(1, Number(current.progress || 0)),
        startedAt: current.startedAt || startedAt,
        attempts: updateAttempt(current, { status: "processing", startedAt })
      }));
    });
    if (!job) return;

    let result;
    let uncertain = false;
    try {
      result = await this.registry.getProvider(job.provider).start(this.context(job));
    } catch {
      uncertain = true;
    }
    await this.serial(() => this.finish(id, result, { uncertain }));
  }

  finish(id, result, options = {}) {
    const job = this.get(id);
    if (!["processing", "recovery_required"].includes(job.status)) return job;

    if (options.uncertain === true) {
      if (job.status === "recovery_required") return job;
      return this.commit(transition(job, "recovery_required", {
        errorCode: "RECOVERY_REQUIRED",
        error: { code: "RECOVERY_REQUIRED" },
        attempts: updateAttempt(job, { status: "recovery_required" })
      }));
    }

    if (result?.status === "completed") {
      const fileName = job.id + ".mp4";
      const outputPath = path.join(this.context(job).outputDirectory, fileName);
      try {
        if (
          result.fileName !== fileName ||
          fs.lstatSync(outputPath).isSymbolicLink() ||
          !fs.statSync(outputPath).isFile() ||
          fs.statSync(outputPath).size < 12 ||
          fs.realpathSync(path.dirname(outputPath)) !== path.resolve(this.context(job).outputDirectory)
        ) {
          throw failure("ASSET_UNAVAILABLE");
        }
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
      const cancelling = job.status === "processing" ? transition(job, "cancelling") : job;
      const cancelledAt = new Date().toISOString();
      return this.commit(transition(cancelling, "cancelled", {
        errorCode: null,
        error: null,
        cancelledAt,
        attempts: updateAttempt(job, { status: "cancelled", completedAt: cancelledAt })
      }));
    }

    // A provider reporting pending/running is normal while the desktop session is alive.
    // Only restart/unknown submission outcomes use recovery_required.
    return job;
  }

  async cancel(id) {
    const job = await this.serial(() => {
      const current = this.get(id);
      if (!BLOCKING.has(current.status) || current.status === "cancelling") return current;
      if (current.status === "queued") {
        const cancelledAt = new Date().toISOString();
        return this.commit(transition(transition(current, "cancelling"), "cancelled", {
          cancelledAt,
          attempts: updateAttempt(current, { status: "cancelled", completedAt: cancelledAt })
        }));
      }
      return this.commit(transition(current, "cancelling"));
    });
    if (job.status !== "cancelling") return job;

    let confirmed = false;
    try {
      confirmed = (await this.registry.getProvider(job.provider)?.cancel(this.context(job)))?.confirmed === true;
    } catch {}

    return this.serial(() => {
      const current = this.get(id);
      if (current.status !== "cancelling") return current;
      if (!confirmed) {
        return this.commit(transition(current, "recovery_required", {
          errorCode: "RECOVERY_REQUIRED",
          error: { code: "RECOVERY_REQUIRED" },
          attempts: updateAttempt(current, { status: "recovery_required" })
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
    return this.serial(async () => {
      const job = this.get(id);
      if (!["processing", "recovery_required"].includes(job.status)) return job;
      let result;
      try {
        result = await this.registry.getProvider(job.provider)?.reconcile(this.context(job));
      } catch {
        if (job.status === "processing") {
          return this.commit(transition(job, "recovery_required", {
            errorCode: "RECOVERY_REQUIRED",
            error: { code: "RECOVERY_REQUIRED" },
            attempts: updateAttempt(job, { status: "recovery_required" })
          }));
        }
        return job;
      }
      return this.finish(id, result);
    });
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
    await Promise.all(this.jobs
      .filter(job => ACTIVE.has(job.status))
      .map(job => this.cancel(job.id).catch(() => {})));
  }
}

module.exports = { GenerationService, ACTIVE, BLOCKING };
