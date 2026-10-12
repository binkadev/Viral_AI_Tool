"use strict";

const { CloudMediaClient } = require("./cloud-client");
const { createMediaAcquisitionManager } = require("./acquisition-manager");

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
    "MEDIA_REQUEST_FAILED",
    "MEDIA_SOURCE_UNAVAILABLE",
    "MEDIA_DESTINATION_UNAVAILABLE",
    "MEDIA_DISK_SPACE_LOW",
    "MEDIA_DOWNLOAD_DUPLICATE",
    "MEDIA_DOWNLOAD_FAILED",
    "MEDIA_VERIFY_FAILED"
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
  clientFactory,
  cacheRoot,
  acquisitionManager,
  onAcquisitionProgress = () => {}
} = {}) {
  const activeSearches = new Map();
  const acquisitionResolvers = new Map();

  if (typeof getBackendUrl !== "function" || typeof getAccessToken !== "function") {
    throw new TypeError("Media desktop controller requires backend and access-token readers.");
  }

  const makeClient = typeof clientFactory === "function"
    ? clientFactory
    : options => new CloudMediaClient(options);
  const downloads = acquisitionManager || (cacheRoot
    ? createMediaAcquisitionManager({ cacheRoot, onProgress: onAcquisitionProgress })
    : null);

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
    if (activeSearches.has(id)) {
      throw mediaError("MEDIA_SEARCH_CONFLICT", "This media search request is already active.");
    }

    const authenticated = await ensureSession();
    if (!authenticated) throw mediaError("MEDIA_AUTH_REQUIRED", "Authentication is required.");

    const controller = new AbortController();
    activeSearches.set(id, controller);

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
      if (activeSearches.get(id) === controller) activeSearches.delete(id);
    }
  }

  function cancel(rawRequestId) {
    let id;
    try { id = requestId(rawRequestId); }
    catch { return { cancelled: false }; }

    const controller = activeSearches.get(id);
    if (!controller) return { cancelled: false };
    activeSearches.delete(id);
    try { controller.abort(); } catch {}
    return { cancelled: true };
  }

  async function acquire(payload = {}) {
    if (!downloads) throw mediaError("MEDIA_DESTINATION_UNAVAILABLE", "Media cache is not configured.");
    const jobId = requestId(payload.jobId);
    if (acquisitionResolvers.has(jobId)) {
      throw mediaError("MEDIA_DOWNLOAD_DUPLICATE", "This media acquisition is already resolving.");
    }

    const projectId = String(payload.projectId || "").trim();
    const ticket = String(payload.ticket || "").trim();
    if (!projectId) throw mediaError("MEDIA_DESTINATION_UNAVAILABLE", "Project identity is required.", { field: "projectId" });
    if (!ticket || ticket.length > 8192 || /[\r\n]/.test(ticket)) {
      throw mediaError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket is invalid.", { field: "ticket" });
    }

    const authenticated = await ensureSession();
    if (!authenticated) throw mediaError("MEDIA_AUTH_REQUIRED", "Authentication is required.");

    const resolver = new AbortController();
    acquisitionResolvers.set(jobId, resolver);
    let descriptor;
    try {
      descriptor = await client().resolveAcquisition(ticket, { signal: resolver.signal });
      if (resolver.signal.aborted) throw mediaError("MEDIA_CANCELLED", "Media acquisition was cancelled.");
    } finally {
      if (acquisitionResolvers.get(jobId) === resolver) acquisitionResolvers.delete(jobId);
    }

    return downloads.acquire({ jobId, projectId, descriptor });
  }

  function cancelAcquisition(rawJobId) {
    let jobId;
    try { jobId = requestId(rawJobId); }
    catch { return { cancelled: false }; }

    let cancelled = false;
    const resolver = acquisitionResolvers.get(jobId);
    if (resolver) {
      acquisitionResolvers.delete(jobId);
      try { resolver.abort(); } catch {}
      cancelled = true;
    }
    const downloadResult = downloads?.cancel?.(jobId);
    if (downloadResult?.cancelled) cancelled = true;
    return { cancelled };
  }

  function cancelAll() {
    let count = activeSearches.size + acquisitionResolvers.size;
    for (const controller of activeSearches.values()) {
      try { controller.abort(); } catch {}
    }
    activeSearches.clear();
    for (const controller of acquisitionResolvers.values()) {
      try { controller.abort(); } catch {}
    }
    acquisitionResolvers.clear();
    count += Number(downloads?.cancelAll?.() || 0);
    return count;
  }

  return {
    status,
    search,
    cancel,
    acquire,
    cancelAcquisition,
    cancelAll,
    activeCount: () => activeSearches.size + acquisitionResolvers.size + Number(downloads?.activeCount?.() || 0),
    publicError: publicDesktopMediaError
  };
}

module.exports = {
  createMediaDesktopController,
  publicDesktopMediaError,
  requestId
};
