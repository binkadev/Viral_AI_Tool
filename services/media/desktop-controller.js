"use strict";

const { CloudMediaClient } = require("./cloud-client");

function mediaError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(id)) {
    throw mediaError("MEDIA_SEARCH_INVALID", "A valid media request id is required.", { field: "requestId" });
  }
  return id;
}

function publicDesktopMediaError(error) {
  const allowed = new Set([
    "MEDIA_NOT_CONFIGURED",
    "MEDIA_CONFIG_INVALID",
    "MEDIA_HTTPS_REQUIRED",
    "MEDIA_AUTH_REQUIRED",
    "MEDIA_PLAN_REQUIRED",
    "MEDIA_SUBSCRIPTION_INACTIVE",
    "MEDIA_SEARCH_INVALID",
    "MEDIA_SEARCH_UNAVAILABLE",
    "MEDIA_SEARCH_TIMEOUT",
    "MEDIA_PROVIDER_UNAVAILABLE",
    "MEDIA_QUOTA_EXCEEDED",
    "MEDIA_NETWORK",
    "MEDIA_CANCELLED",
    "MEDIA_SEARCH_CONFLICT",
    "MEDIA_REQUEST_FAILED"
  ]);
  return {
    code: allowed.has(error?.code) ? error.code : "MEDIA_SEARCH_UNAVAILABLE",
    details: error?.details?.field ? { field: String(error.details.field).slice(0, 80) } : {}
  };
}

function createMediaDesktopController({
  getBackendUrl,
  getAccessToken,
  refreshSession,
  appVersion = "dev",
  clientFactory
} = {}) {
  const active = new Map();

  if (typeof getBackendUrl !== "function" || typeof getAccessToken !== "function") {
    throw new TypeError("Media desktop controller requires backend and access-token readers.");
  }

  const makeClient = typeof clientFactory === "function"
    ? clientFactory
    : options => new CloudMediaClient(options);

  function client() {
    return makeClient({
      backendUrl: getBackendUrl() || "",
      getAccessToken,
      appVersion
    });
  }

  async function ensureSession() {
    if (typeof refreshSession !== "function") return Boolean(getAccessToken());
    const ready = await refreshSession();
    return ready === true && Boolean(getAccessToken());
  }

  async function status() {
    const authenticated = await ensureSession();
    if (!authenticated) throw mediaError("MEDIA_AUTH_REQUIRED", "Authentication is required.");
    return client().status();
  }

  async function search(payload = {}) {
    const id = requestId(payload.requestId);
    if (active.has(id)) {
      throw mediaError("MEDIA_SEARCH_CONFLICT", "This media search request is already active.");
    }

    const authenticated = await ensureSession();
    if (!authenticated) throw mediaError("MEDIA_AUTH_REQUIRED", "Authentication is required.");

    const controller = new AbortController();
    active.set(id, controller);

    try {
      return await client().search({
        query: payload.query,
        kind: payload.kind,
        orientation: payload.orientation,
        page: payload.page,
        perPage: payload.perPage,
        provider: payload.provider,
        signal: controller.signal
      });
    } finally {
      if (active.get(id) === controller) active.delete(id);
    }
  }

  function cancel(rawRequestId) {
    let id;
    try { id = requestId(rawRequestId); }
    catch { return { cancelled: false }; }

    const controller = active.get(id);
    if (!controller) return { cancelled: false };
    active.delete(id);
    try { controller.abort(); } catch {}
    return { cancelled: true };
  }

  function cancelAll() {
    const count = active.size;
    for (const controller of active.values()) {
      try { controller.abort(); } catch {}
    }
    active.clear();
    return count;
  }

  return {
    status,
    search,
    cancel,
    cancelAll,
    activeCount: () => active.size,
    publicError: publicDesktopMediaError
  };
}

module.exports = {
  createMediaDesktopController,
  publicDesktopMediaError,
  requestId
};
