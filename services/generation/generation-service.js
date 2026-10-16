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
const ACTIVE = new Set(["queued", "processing", "cancelling", "recovery_required"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fingerprint = request => createHash("sha256").update(JSON.stringify({ ...request, idempotencyKey: null })).digest("hex");
class GenerationService extends EventEmitter {
  constructor({ root, registry = new ProviderRegistry(), store = new GenerationStore(root) }) {
    super(); this.root = root; this.registry = registry; this.store = store; this.jobs = store.load();
    this.tail = Promise.resolve(); this.stopping = false;
    const recovered = this.jobs.map(j => ["idle", "validating"].includes(j.status)
      ? { ...j, status: "failed", errorCode: "GENERATION_FAILED" }
      : ACTIVE.has(j.status) ? { ...j, status: "recovery_required", errorCode: "RECOVERY_REQUIRED" } : j);
    if (JSON.stringify(recovered) !== JSON.stringify(this.jobs)) { store.save(recovered); this.jobs = recovered; }
  }
  serial(fn) { const task = this.tail.then(fn); this.tail = task.catch(() => {}); return task; }
  commit(job) {
    const jobs = this.jobs.filter(j => j.id !== job.id).concat(job);
    this.store.save(jobs); this.jobs = jobs;
    // Events contain only identifiers/status, never prompts, auth or adapter payloads.
    try { this.emit("changed", { id: job.id, status: job.status }); } catch {}
    return clone(job);
  }
  get(id) { const job = this.jobs.find(j => j.id === id); if (!job) throw failure("JOB_NOT_FOUND"); return clone(job); }
  list(projectId) { if (!identifier(projectId)) throw failure("INVALID_REQUEST"); return this.jobs.filter(j => j.request.projectId === projectId).map(clone); }
  activeCount() { return this.jobs.filter(j => ACTIVE.has(j.status)).length; }
  async readiness() { if (this.stopping) return { ready: false, modelIds: [], availability: {} }; return this.registry.readiness(); }
  context(job) { return { jobId: job.id, request: clone(job.request), modelId: job.modelId, outputDirectory: path.join(this.root, "outputs", job.id) }; }
  async submit(input, retryOf = null) {
    const request = normalizeRequest(input);
    return this.serial(async () => {
      if (this.stopping) throw failure("UNAVAILABLE");
      const prior = this.jobs.find(j => j.request.projectId === request.projectId && j.request.idempotencyKey === request.idempotencyKey);
      if (prior) { if (fingerprint(prior.request) !== fingerprint(request)) throw failure("IDEMPOTENCY_CONFLICT"); return clone(prior); }
      if (this.jobs.some(j => ACTIVE.has(j.status) && fingerprint(j.request) === fingerprint(request))) throw failure("DUPLICATE_JOB");
      const ready = await this.readiness();
      const route = chooseModel(request, { availability: ready.availability, allow: ready.modelIds });
      const adapter = this.registry.get(route.model.provider);
      let job = createJob(request, route, retryOf);
      const context = this.context(job);
      fs.mkdirSync(context.outputDirectory, { recursive: true });
      fs.accessSync(context.outputDirectory, fs.constants.W_OK);
      if (fs.statfsSync(context.outputDirectory).bavail * fs.statfsSync(context.outputDirectory).bsize < 64 * 1024 * 1024) throw failure("RESOURCE_UNAVAILABLE");
      try { if ((await adapter.preflight(context))?.ready !== true) throw failure("PROVIDER_UNAVAILABLE"); }
      catch { throw failure("PROVIDER_UNAVAILABLE"); }
      job = transition(transition(job, "validating"), "queued");
      this.commit(job); // Durable reservation BEFORE any provider side effect.
      setImmediate(() => this.execute(job.id).catch(() => {}));
      return clone(job);
    });
  }
  async execute(id) {
    const job = await this.serial(() => {
      const current = this.get(id);
      if (this.stopping || current.status !== "queued") return null;
      return this.commit(transition(current, "processing"));
    });
    if (!job) return;
    let result;
    try { result = await this.registry.get(job.provider).start(this.context(job)); }
    catch { result = { status: "pending" }; }
    await this.serial(() => this.finish(id, result));
  }
  finish(id, result) {
    const job = this.get(id);
    if (!["processing", "recovery_required"].includes(job.status)) return job;
    if (result?.status === "completed") {
      // Adapters must place verified video bytes at the assigned unique filename.
      const fileName = job.id + ".mp4";
      const output = path.join(this.context(job).outputDirectory, fileName);
      try {
        if (result.fileName !== fileName || fs.lstatSync(output).isSymbolicLink() || !fs.statSync(output).isFile() || fs.statSync(output).size < 12 ||
            fs.realpathSync(path.dirname(output)) !== path.resolve(this.context(job).outputDirectory)) throw failure("ASSET_UNAVAILABLE");
        const fd = fs.openSync(output, "r"); const header = Buffer.alloc(12);
        try { fs.readSync(fd, header, 0, 12, 0); } finally { fs.closeSync(fd); }
        if (header.toString("ascii", 4, 8) !== "ftyp") throw failure("ASSET_UNAVAILABLE");
        return this.commit(transition(job, "completed", { asset: { fileName }, errorCode: null }));
      } catch { result = { status: "pending" }; }
    }
    if (result?.status === "failed") return this.commit(transition(job, "failed", { errorCode: "GENERATION_FAILED" }));
    if (result?.status === "cancelled") {
      const cancelling = job.status === "processing" ? transition(job, "cancelling") : job;
      return this.commit(transition(cancelling, "cancelled", { errorCode: null }));
    }
    if (job.status === "recovery_required") return job;
    return this.commit(transition(job, "recovery_required", { errorCode: "RECOVERY_REQUIRED" }));
  }
  async cancel(id) {
    const job = await this.serial(() => {
      const j = this.get(id);
      if (!ACTIVE.has(j.status) || j.status === "cancelling") return j;
      if (j.status === "queued") return this.commit(transition(transition(j, "cancelling"), "cancelled"));
      return this.commit(transition(j, "cancelling"));
    });
    if (job.status !== "cancelling") return job;
    let confirmed = false;
    try { confirmed = (await this.registry.get(job.provider)?.cancel(this.context(job)))?.confirmed === true; } catch {}
    return this.serial(() => {
      const current = this.get(id);
      if (current.status !== "cancelling") return current;
      return this.commit(transition(current, confirmed ? "cancelled" : "recovery_required", { errorCode: confirmed ? null : "RECOVERY_REQUIRED" }));
    });
  }
  async recover(id) {
    return this.serial(async () => {
      const job = this.get(id);
      if (job.status !== "recovery_required") return job;
      let result;
      try { result = await this.registry.get(job.provider)?.reconcile(this.context(job)); } catch {}
      return this.finish(id, result);
    });
  }
  async retry(id, idempotencyKey) {
    const job = this.get(id);
    if (!["failed", "cancelled"].includes(job.status) || idempotencyKey === job.request.idempotencyKey) throw failure("RETRY_UNSAFE");
    return this.submit({ ...job.request, idempotencyKey }, job.id);
  }
  async shutdown() { this.stopping = true; await Promise.all(this.jobs.filter(j => ACTIVE.has(j.status)).map(j => this.cancel(j.id).catch(() => {}))); }
}
module.exports = { GenerationService };
