"use strict";

const { randomUUID } = require("crypto");

const TRANSITIONS = Object.freeze({
  queued: ["preparing", "cancelling", "interrupted"],
  preparing: ["submitting", "failed", "cancelling", "interrupted"],
  submitting: ["running", "verifying", "failed", "cancelling", "interrupted"],
  running: ["verifying", "failed", "cancelling", "interrupted"],
  verifying: ["completed", "failed", "cancelling", "interrupted"],
  cancelling: ["cancelled", "interrupted"],
  interrupted: ["running", "verifying", "failed", "cancelling", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
});

const IMMUTABLE_FIELDS = Object.freeze([
  "id",
  "requestId",
  "projectId",
  "sceneId",
  "idempotencyKey",
  "kind",
  "mode",
  "createdAt"
]);

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validProgress(value) {
  return value===null || Number.isFinite(value) && value >= 0 && value <= 100;
}

function transition(job, status, patch = {}) {
  if (!TRANSITIONS[job.status]?.includes(status)) throw failure("INVALID_TRANSITION");
  if (Object.prototype.hasOwnProperty.call(patch, "progress") && !validProgress(patch.progress)) {
    throw failure("INVALID_PROGRESS");
  }

  const next = {
    ...job,
    ...patch,
    status,
    updatedAt: new Date().toISOString()
  };

  for (const field of IMMUTABLE_FIELDS) next[field] = job[field];
  return next;
}

function createJob(request, route, retryOf = null) {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    version: 1,
    id,
    requestId: randomUUID(),
    projectId: request.projectId,
    sceneId: request.sceneId || null,
    idempotencyKey: request.idempotencyKey,
    kind: request.kind || "video",
    mode: request.mode,
    status: "queued",
    progress: route.model.provider==='muse'?null:0,
    request,
    modelId: route.model.id,
    provider: route.model.provider,
    providerJobId: null,
    estimate: route.estimate,
    usage: null,
    output: null,
    error: null,
    retryOf,
    attempts: [{ number: 1, status: "queued", createdAt: now, startedAt: null, completedAt: null }],
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    errorCode: null,
    asset: null
  };
}

module.exports = { TRANSITIONS, transition, createJob, failure, validProgress };
