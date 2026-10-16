"use strict";

const { failure } = require("./generation-job");

const PROVIDER_STATES = new Set(["ready", "not_configured", "unavailable", "error"]);

function validateProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw failure("INVALID_PROVIDER");
  if (typeof adapter.id !== "string" || !adapter.id.trim()) throw failure("INVALID_PROVIDER");
  if (!Array.isArray(adapter.modelIds) || adapter.modelIds.length === 0) throw failure("INVALID_PROVIDER");
  for (const method of ["readiness", "preflight", "start", "reconcile", "cancel"]) {
    if (typeof adapter[method] !== "function") throw failure("INVALID_PROVIDER");
  }
  return adapter;
}

function normalizeProviderStatus(input, fallbackId = null) {
  const state = PROVIDER_STATES.has(input?.state)
    ? input.state
    : input?.ready === true
      ? "ready"
      : input?.configured === false
        ? "not_configured"
        : "unavailable";
  return {
    id: typeof input?.id === "string" && input.id ? input.id : fallbackId,
    state,
    ready: state === "ready"
  };
}

function normalizeProviderError(error) {
  const safeCodes = new Set([
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_NOT_CONFIGURED",
    "PROVIDER_REJECTED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_CANCELLED"
  ]);
  return {
    code: safeCodes.has(error?.code) ? error.code : "PROVIDER_UNAVAILABLE"
  };
}

module.exports = {
  PROVIDER_STATES,
  validateProviderAdapter,
  normalizeProviderStatus,
  normalizeProviderError
};
