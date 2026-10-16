"use strict";
const { randomUUID } = require("crypto");
const TRANSITIONS = Object.freeze({
  idle: ["validating"], validating: ["queued", "failed"],
  queued: ["processing", "cancelling", "recovery_required"],
  processing: ["completed", "failed", "cancelling", "recovery_required"],
  cancelling: ["cancelled", "recovery_required"],
  recovery_required: ["completed", "failed", "cancelling", "cancelled"],
  completed: [], failed: [], cancelled: []
});
function failure(code) { const e = new Error(code); e.code = code; return e; }
function transition(job, status, patch = {}) {
  if (!TRANSITIONS[job.status]?.includes(status)) throw failure("INVALID_TRANSITION");
  return { ...job, ...patch, id: job.id, status, updatedAt: new Date().toISOString() };
}
function createJob(request, route, retryOf = null) {
  const now = new Date().toISOString();
  return { version: 1, id: randomUUID(), status: "idle", request, modelId: route.model.id,
    provider: route.model.provider, estimate: route.estimate, retryOf, createdAt: now,
    updatedAt: now, errorCode: null, asset: null };
}
module.exports = { TRANSITIONS, transition, createJob, failure };
