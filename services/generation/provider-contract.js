"use strict";

const { failure } = require("./generation-job");

const PROVIDER_STATES = new Set(["ready", "not_configured", "unconfigured", "checking", "authentication_required", "unavailable", "error"]);

function validateProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw failure("INVALID_PROVIDER");
  if (typeof adapter.id !== "string" || !adapter.id.trim()) throw failure("INVALID_PROVIDER");
  if (!Array.isArray(adapter.modelIds)) throw failure("INVALID_PROVIDER");
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
  const safeState = (input?.enabled === false || input?.ready !== true) && state === "ready" ? "unavailable" : state;
  const metadata = {};
  if (typeof input?.enabled === "boolean") metadata.enabled = input.enabled;
  if (Array.isArray(input?.capabilities)) metadata.capabilities = [...new Set(input.capabilities.filter(value => ["text-to-video", "image-to-video"].includes(value)))];
  if (["NOT_CONFIGURED", "DISABLED", "AUTHENTICATION_NOT_CONNECTED", "CONFIG_ERROR", "CONNECTION_UNAVAILABLE", "GENERATION_NOT_IMPLEMENTED"].includes(input?.messageCode)) metadata.messageCode = input.messageCode;
  if (typeof input?.checkedAt === "string" && Number.isFinite(Date.parse(input.checkedAt))) metadata.checkedAt = new Date(input.checkedAt).toISOString();
  return {
    ...metadata,
    id: typeof input?.id === "string" && input.id ? input.id : fallbackId,
    state: safeState,
    ready: safeState === "ready"
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
