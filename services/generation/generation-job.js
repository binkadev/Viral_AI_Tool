"use strict";

const { randomUUID } = require("crypto");

const TRANSITIONS = Object.freeze({
  idle: ["validating"],
  validating: ["queued", "failed"],
  queued: ["processing", "cancelling", "recovery_required"],
  processing: ["completed", "failed", "cancelling", "recovery_required"],
  cancelling: ["cancelled", "recovery_required"],
  recovery_required: ["completed", "failed", "cancelling", "cancelled"],
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
  return Number.isFinite(value) && value >= 0 && value <= 100;
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
    status: "idle",
    progress: 0,
    request,
    modelId: route.model.id,
    provider: route.model.provider,
    providerJobId: null,
    estimate: route.estimate,
    usage: null,
    output: null,
    error: null,
    retryOf,
    attempts: [{ number: 1, status: "created", createdAt: now, startedAt: null, completedAt: null }],
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
