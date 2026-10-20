"use strict";

const fs = require("fs");
const path = require("path");
const { failure, TRANSITIONS, validProgress } = require("./generation-job");
const { normalizeRequest } = require("./generation-request");
const { getModel } = require("./model-catalog");
const { estimateGenerationCost } = require("./cost-estimator");

const SAFE_ERROR_CODES = new Set([
  "GENERATION_FAILED",
  "RECOVERY_REQUIRED",
  "ASSET_UNAVAILABLE",
  "RESOURCE_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE"
]);

function validUuid(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function safeEstimate(value, modelId, request) {
  if(request.providerId==='muse')return {modelId:null,provider:'muse',known:false,providerCredits:null,estimatedUsd:null,pricingKind:'unknown',durationSeconds:null,resolution:null};
  if (!value || typeof value !== "object") return estimateGenerationCost(modelId, request);
  const estimate = {
    modelId,
    provider: typeof value.provider === "string" ? value.provider : getModel(modelId)?.provider,
    durationSeconds: Number(value.durationSeconds ?? request.durationSeconds),
    resolution: String(value.resolution ?? request.resolution),
    known: value.known === true,
    providerCredits: value.providerCredits == null ? null : Number(value.providerCredits),
    estimatedUsd: value.estimatedUsd == null ? null : Number(value.estimatedUsd),
    pricingKind: typeof value.pricingKind === "string" ? value.pricingKind : "unknown",
    pricingSnapshot: typeof value.pricingSnapshot === "string" ? value.pricingSnapshot : null
  };
  if (!Number.isFinite(estimate.durationSeconds) || !estimate.resolution) return estimateGenerationCost(modelId, request);
  if (estimate.providerCredits != null && !Number.isFinite(estimate.providerCredits)) estimate.providerCredits = null;
  if (estimate.estimatedUsd != null && !Number.isFinite(estimate.estimatedUsd)) estimate.estimatedUsd = null;
  return estimate;
}

function safeAttempts(value, createdAt) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ number: 1, status: "queued", createdAt, startedAt: null, completedAt: null }];
  }
  return value.slice(0, 32).map((attempt, index) => ({
    number: Number.isInteger(attempt?.number) && attempt.number > 0 ? attempt.number : index + 1,
    status: typeof attempt?.status === "string" ? attempt.status.slice(0, 40) : "unknown",
    createdAt: Number.isFinite(Date.parse(attempt?.createdAt)) ? attempt.createdAt : createdAt,
    startedAt: Number.isFinite(Date.parse(attempt?.startedAt)) ? attempt.startedAt : null,
    completedAt: Number.isFinite(Date.parse(attempt?.completedAt)) ? attempt.completedAt : null
  }));
}

function safeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const providerCredits = value.providerCredits == null ? null : Number(value.providerCredits);
  const estimatedUsd = value.estimatedUsd == null ? null : Number(value.estimatedUsd);
  if (providerCredits != null && !Number.isFinite(providerCredits)) return null;
  if (estimatedUsd != null && !Number.isFinite(estimatedUsd)) return null;
  return { providerCredits, estimatedUsd };
}

function safeAsset(value) {
  return value && /^[a-f0-9-]{36}\.mp4$/i.test(value.fileName) ? { fileName: value.fileName } : null;
}

class GenerationStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "jobs.json");
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.jobs)) throw failure("STORE_UNAVAILABLE");
      const ids = new Set();
      return data.jobs.map(job => {
        const model = job.modelId===null && job.provider==='muse' && job.request?.providerId==='muse' ? {id:null,provider:'muse'} : getModel(job.modelId);
        if (
          !validUuid(job.id) ||
          ids.has(job.id) ||
          !Object.hasOwn(TRANSITIONS, job.status) ||
          !model ||
          !Number.isFinite(Date.parse(job.createdAt)) ||
          !Number.isFinite(Date.parse(job.updatedAt))
        ) {
          throw failure("STORE_UNAVAILABLE");
        }
        ids.add(job.id);
        const request = normalizeRequest(job.request);
        const progress = validProgress(job.progress) ? job.progress : 0;
        const estimate = safeEstimate(job.estimate, model.id, request);
        const asset = safeAsset(job.asset || job.output);
        const errorCode = SAFE_ERROR_CODES.has(job.errorCode) ? job.errorCode : null;
        return {
          version: 1,
          id: job.id,
          requestId: validUuid(job.requestId) ? job.requestId : job.id,
          projectId: request.projectId,
          sceneId: request.sceneId || null,
          idempotencyKey: request.idempotencyKey,
          kind: request.kind,
          mode: request.mode,
          status: job.status,
          progress,
          request,
          modelId: model.id,
          provider: model.provider,
          providerJobId: typeof job.providerJobId === "string" && job.providerJobId.length <= 200 ? job.providerJobId : null,
          estimate,
          usage: safeUsage(job.usage),
          output: asset ? { fileName: asset.fileName } : null,
          error: errorCode ? { code: errorCode } : null,
          retryOf: validUuid(job.retryOf) ? job.retryOf : null,
          attempts: safeAttempts(job.attempts, job.createdAt),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          startedAt: Number.isFinite(Date.parse(job.startedAt)) ? job.startedAt : null,
          completedAt: Number.isFinite(Date.parse(job.completedAt)) ? job.completedAt : null,
          cancelledAt: Number.isFinite(Date.parse(job.cancelledAt)) ? job.cancelledAt : null,
          errorCode,
          asset
        };
      });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw failure("STORE_UNAVAILABLE");
    }
  }

  save(jobs) {
    let fd;
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fd = fs.openSync(this.file + ".tmp", "w", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, jobs }));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(this.file + ".tmp", this.file);
    } catch {
      throw failure("STORE_UNAVAILABLE");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}

module.exports = { GenerationStore };
