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
  constructor({ root, registry = new ProviderRegistry(), store = new GenerationStore(root), providerConfigStore = null }) {
    super();
    this.root = root;
    this.registry = registry;
    this.providerConfigStore = providerConfigStore;
    this.store = store;
    this.jobs = store.load();
    this.tail = Promise.resolve();
    this.stopping = false;
    this.runtimeActive = new Set();
    this.monitors=new Map();
    this.recovering=new Map();
    this.epochs=new Map();

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
    if (TERMINAL.has(job.status) || job.status === "interrupted") {
      this.runtimeActive.delete(job.id);clearTimeout(this.monitors.get(job.id));this.monitors.delete(job.id);
    }
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

  publicJob(job) {
    const result=clone(job);
    if(job.provider==='muse' && job.status==='interrupted' &&
      this.registry.getProvider('muse')?.recoveryState?.(this.context(job))==='acceptance_unproven') {
      result.recoveryState='acceptance_unproven';
    }
    return result;
  }

  output(id) {
    const job=this.get(id),fileName=job.id+'.mp4';
    if(job.status!=='completed' || job.output?.fileName!==fileName || job.asset?.fileName!==fileName)throw failure('ASSET_UNAVAILABLE');
    const directory=this.context(job).outputDirectory,filePath=path.join(directory,fileName);
    if(fs.lstatSync(filePath).isSymbolicLink() || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size<12 || fs.realpathSync(directory)!==path.resolve(directory))throw failure('ASSET_UNAVAILABLE');
    return {jobId:job.id,projectId:job.projectId,sceneId:job.sceneId,fileName,path:filePath};
  }

  activeCount() {
    return this.jobs.filter(job => this.runtimeActive.has(job.id) && ACTIVE.has(job.status)).length;
  }

  hasActiveMuseJob(exceptId = null) {
    // Interrupted history remains reconcilable, but does not occupy an active
    // execution slot. Use the existing lifecycle set, not a second state list.
    return this.jobs.some(job => job.id !== exceptId && job.provider === 'muse' && ACTIVE.has(job.status));
  }

  async museAdmission() {
    // Read-only advisory check; submit rechecks atomically before persisting.
    return this.serial(async () => ({
      admissible: !this.stopping && !this.hasActiveMuseJob() &&
        (await this.readiness()).providers.some(provider => provider.id === 'muse' && provider.ready)
    }));
  }

  async readiness() {
    if (this.stopping) return { ready: false, state: "unavailable", modelIds: [], availability: {}, providers: [] };
    return this.registry.readiness();
  }

  async checkProvider(id) {
    if (this.stopping) throw failure("UNAVAILABLE");
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    return this.registry.getProviderStatus(id);
  }

  async providerRuntimeDiagnosis(id) {
    if(this.stopping)throw failure('UNAVAILABLE');
    if(!identifier(id))throw failure('INVALID_REQUEST');
    const adapter=this.registry.getProvider(id);
    if(typeof adapter?.runtimeDiagnosis!=='function')throw failure('UNAVAILABLE');
    const {sanitizeReport}=require('./bridge/runtime-preflight');
    return sanitizeReport(await adapter.runtimeDiagnosis());
  }

  async diagnoseMuseOwnership(id) {
    if(this.stopping)throw failure('UNAVAILABLE');
    if(!identifier(id))throw failure('INVALID_REQUEST');
    const job=this.get(id),adapter=this.registry.getProvider(job.request.providerId);
    if(!['interrupted','running'].includes(job.status) || job.provider!=='muse' || job.request.providerId!=='muse' || typeof adapter?.diagnoseOwnership!=='function')throw failure('UNAVAILABLE');
    const report=await adapter.diagnoseOwnership(this.context(job));
    const {validAnchoredOwnershipDiagnostic}=require('./bridge/execution-contract');
    if(report?.operationId!==id || !validAnchoredOwnershipDiagnostic(report.diagnostic,report.userStableIdHash))throw failure('UNAVAILABLE');
    return clone({operationId:id,userStableIdHash:report.userStableIdHash,diagnostic:report.diagnostic});
  }

  async acceptanceTrace(id) {
    if(this.stopping)throw failure('UNAVAILABLE');
    if(!identifier(id))throw failure('INVALID_REQUEST');
    const job=this.get(id),adapter=this.registry.getProvider(job.request.providerId);
    if(job.status!=='interrupted' || job.request.providerId!=='muse' || typeof adapter?.acceptanceTrace!=='function')throw failure('UNAVAILABLE');
    const report=await adapter.acceptanceTrace(this.context(job));
    const receipt=require('../../extensions/meta-muse-bridge/receipt-v2');
    if(report?.operationId!==id || !receipt.validAcceptanceTrace(report.trace) || report.diagnostic!==null && !receipt.validAcceptanceDiagnostic(report.diagnostic))throw failure('UNAVAILABLE');
    return {operationId:id,diagnostic:report.diagnostic,trace:report.trace};
  }

  async providerSession(id, open = false) {
    if (this.stopping) throw failure("UNAVAILABLE");
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    const adapter = this.registry.getProvider(id);
    const method = open ? "openSession" : "checkSession";
    if (!adapter || typeof adapter[method] !== "function") throw failure("INVALID_REQUEST");
    const { sanitizeSession } = require("./bridge/session-status");
    return sanitizeSession(await adapter[method](), id);
  }

  async selectProviderSession(id, selection) {
    if (this.stopping) throw failure("UNAVAILABLE");
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    const adapter = this.registry.getProvider(id);
    if (typeof adapter?.selectSession !== "function") throw failure("INVALID_REQUEST");
    const { sanitizeSession } = require("./bridge/session-status");
    return this.serial(async () => {
      if (this.stopping) throw failure("UNAVAILABLE");
      return sanitizeSession(await adapter.selectSession(selection), id);
    });
  }

  async openProviderExtensionStore(id) {
    if (this.stopping) throw failure("UNAVAILABLE");
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    const adapter = this.registry.getProvider(id);
    if (typeof adapter?.openExtensionStore !== "function") throw failure("INVALID_REQUEST");
    await adapter.openExtensionStore();
    return {id, opened:true};
  }

  async revealProviderExtension(id) {
    if (this.stopping) throw failure("UNAVAILABLE");
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    const adapter = this.registry.getProvider(id);
    if (typeof adapter?.revealExtension !== "function") throw failure("INVALID_REQUEST");
    await adapter.revealExtension();
    return {id, folderRevealed:true};
  }

  async configureProvider(id, config) {
    if (!identifier(id) || !this.registry.hasProvider(id) || !this.providerConfigStore) throw failure("INVALID_REQUEST");
    return this.serial(async () => {
      if (this.stopping) throw failure("UNAVAILABLE");
      this.providerConfigStore.write(id, config);
      return this.registry.getProviderStatus(id);
    });
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
      if (this.jobs.some(job => (request.providerId === 'muse' ? ACTIVE : BLOCKING).has(job.status) && fingerprint(job.request) === fingerprint(request))) {
        throw failure("DUPLICATE_JOB");
      }

      const ready = await this.readiness();
      const allow = request.modelId
        ? ready.modelIds.filter(id => id === request.modelId)
        : ready.modelIds;
      let route;
      if(request.providerId==='muse') {
        if(!ready.providers.some(p=>p.id==='muse' && p.ready))throw failure('PROVIDER_UNAVAILABLE');
        if(this.hasActiveMuseJob())throw failure('DUPLICATE_JOB');
        route={model:{id:null,provider:'muse'},estimate:{modelId:null,provider:'muse',known:false,providerCredits:null,estimatedUsd:null,pricingKind:'unknown',durationSeconds:null,resolution:null}};
      } else route = chooseModel(request, { availability: ready.availability, allow });
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
        progress: current.provider==='muse'?null:Math.max(1, Number(current.progress || 0)),
        startedAt,
        attempts: updateAttempt(current, { status: "preparing", startedAt })
      }));
    });
    if (!preparing) return;

    const context = this.context(preparing);
    try {
      fs.mkdirSync(context.outputDirectory, { recursive: true });
      fs.accessSync(context.outputDirectory, fs.constants.W_OK);
      if(fs.realpathSync(context.outputDirectory)!==path.resolve(context.outputDirectory))throw failure('RESOURCE_UNAVAILABLE');
      const fsStats = fs.statfsSync(context.outputDirectory);
      if (fsStats.bavail * fsStats.bsize < (preparing.provider==='muse'?512:64) * 1024 * 1024) throw failure("RESOURCE_UNAVAILABLE");
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
        progress: current.provider==='muse'?null:Math.max(2, Number(current.progress || 0)),
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
    this.monitor(id);
  }

  monitor(id) {
    if(this.stopping || this.monitors.has(id) || this.get(id).status!=='running')return;
    const interval=this.registry.getProvider(this.get(id).provider)?.pollIntervalMs;
    if(!Number.isFinite(interval) || interval<500)return;
    const timer=setTimeout(async()=>{
      this.monitors.delete(id);
      try{await this.recover(id);}catch{}
      this.monitor(id);
    },interval);
    timer.unref?.();this.monitors.set(id,timer);
  }

  finish(id, result, options = {}) {
    let job = this.get(id);
    if (!["submitting", "running", "verifying", "interrupted"].includes(job.status)) return job;

    // Once a job is interrupted, an old in-flight submit callback must not revive
    // it. Only explicit provider reconciliation is authoritative after interruption.
    if (job.status === "interrupted" && options.reconciled !== true) return job;

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
        progress: job.provider==='muse'?null:Math.max(5, Number(job.progress || 0)),
        errorCode: null,
        error: null,
        attempts: updateAttempt(job, { status: "running" })
      }));
    }

    if (result?.status === "completed") {
      if (job.status !== "verifying") {
        job = transition(job, "verifying", {
          progress: job.provider==='muse'?null:Math.max(95, Number(job.progress || 0)),
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
    this.epochs.set(id,(this.epochs.get(id)||0)+1);
    const state = await this.serial(() => {
      const current = this.get(id);
      if (TERMINAL.has(current.status) || current.status === "cancelling") {
        return { job: current, remoteRequired: false };
      }
      if (!BLOCKING.has(current.status)) return { job: current, remoteRequired: false };

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
    if(this.recovering.has(id))return this.recovering.get(id);
    const task=this.recoverOnce(id).finally(()=>this.recovering.delete(id));
    this.recovering.set(id,task);return task;
  }

  async recoverOnce(id) {
    const epoch=this.epochs.get(id)||0;
    const initial = this.get(id);
    if (initial.status === "queued") {
      if (this.stopping) return initial;
      this.runtimeActive.add(id);
      setImmediate(() => this.execute(id).catch(() => {}));
      return initial;
    }
    if (!["running", "interrupted"].includes(initial.status)) return initial;
    if(initial.provider==='muse' && initial.status==='interrupted' && this.hasActiveMuseJob(id))return initial;

    if (initial.status === "running") this.runtimeActive.add(id);
    let result;
    try {
      const context=this.context(initial);
      if(initial.provider==='muse')context.onVerifying=()=>this.serial(()=>{
        const current=this.get(id);
        if(this.stopping || (this.epochs.get(id)||0)!==epoch || !['running','interrupted'].includes(current.status) || this.hasActiveMuseJob(id))throw failure('RECOVERY_REQUIRED');
        this.runtimeActive.add(id);
        this.commit(transition(current,'verifying',{progress:null,errorCode:null,error:null,attempts:updateAttempt(current,{status:'verifying'})}));
      });
      result = await this.registry.getProvider(initial.provider)?.reconcile(context);
    } catch {
      if (initial.status === "running" || this.get(id).status==='verifying') {
        return this.serial(() => {
          const current = this.get(id);
          if (!['running','verifying'].includes(current.status) || (this.epochs.get(id)||0)!==epoch) return current;
          return this.commit(transition(current, "interrupted", {
            errorCode: "RECOVERY_REQUIRED",
            error: { code: "RECOVERY_REQUIRED" },
            attempts: updateAttempt(current, { status: "interrupted" })
          }));
        });
      }
      return initial;
    }

    const job=await this.serial(() => {
      if((this.epochs.get(id)||0)!==epoch)return this.get(id);
      // A read-only reconciliation may finish after another request acquired
      // the slot. Do not revive historical Muse work alongside that job.
      if(initial.provider==='muse' && initial.status==='interrupted' && this.hasActiveMuseJob(id))return this.get(id);
      return this.finish(id, result, { reconciled: true });
    });
    this.monitor(id);return job;
  }

  async retry(id, idempotencyKey) {
    const job = this.get(id);
    if(job.provider==='muse' && fs.existsSync(path.join(this.context(job).outputDirectory,'muse-operation.json')))throw failure('RETRY_UNSAFE');
    if (!["failed", "cancelled"].includes(job.status) || idempotencyKey === job.idempotencyKey) {
      throw failure("RETRY_UNSAFE");
    }
    return this.submit({ ...job.request, idempotencyKey }, job.id);
  }

  async shutdown() {
    this.stopping = true;
    for(const timer of this.monitors.values())clearTimeout(timer);this.monitors.clear();
    const ids = Array.from(this.runtimeActive);
    await Promise.all(ids.map(id => this.cancel(id).catch(() => {})));
  }
}

module.exports = { GenerationService, ACTIVE, BLOCKING };
