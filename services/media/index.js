"use strict";

const { CloudMediaClient, MediaClientError } = require("./cloud-client");
const {
  normalizeSearchRequest,
  publicSearchError,
  mediaProviderError
} = require("./provider-contract");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,160}$/;
const PROVIDER_PATTERN = /^(auto|[a-z0-9][a-z0-9-]{0,39})$/;

class MediaServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MediaServiceError";
    this.code = code;
    this.details = details;
  }
}

function mediaServiceError(code, message, details = {}) {
  return new MediaServiceError(code, message, details);
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw mediaServiceError("MEDIA_REQUEST_INVALID", "Media request ID is invalid.");
  }
  return requestId;
}

function normalizeProvider(value) {
  const provider = String(value || "auto").trim().toLowerCase() || "auto";
  if (!PROVIDER_PATTERN.test(provider)) {
    throw mediaServiceError("MEDIA_SEARCH_INVALID", "Media provider is invalid.", { field: "provider" });
  }
  return provider;
}

function createService({
  getBackendUrl,
  getAccessToken,
  appVersion = "dev",
  fetchImpl = global.fetch
} = {}) {
  const activeSearches = new Map();
  const backendUrl = typeof getBackendUrl === "function" ? getBackendUrl : () => "";
  const accessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;

  function client() {
    return new CloudMediaClient({
      backendUrl: backendUrl() || "",
      getAccessToken: accessToken,
      appVersion,
      fetchImpl
    });
  }

  async function status() {
    return client().status();
  }

  async function search(input = {}) {
    const requestId = normalizeRequestId(input.requestId);
    const request = normalizeSearchRequest(input);
    const provider = normalizeProvider(input.provider);

    if (activeSearches.has(requestId)) {
      throw mediaServiceError("MEDIA_SEARCH_ACTIVE", "Media search request is already active.");
    }

    const controller = new AbortController();
    activeSearches.set(requestId, controller);

    try {
      return await client().search({
        ...request,
        provider,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || error?.code === "MEDIA_CANCELLED") {
        throw mediaServiceError("MEDIA_CANCELLED", "Media search was cancelled.");
      }
      if (error instanceof MediaServiceError || error instanceof MediaClientError) throw error;
      if (error?.code) throw error;
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Media search is unavailable.");
    } finally {
      activeSearches.delete(requestId);
    }
  }

  function cancel(requestIdValue) {
    let requestId;
    try { requestId = normalizeRequestId(requestIdValue); }
    catch { return false; }

    const controller = activeSearches.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  function activeCount() {
    return activeSearches.size;
  }

  function dispose() {
    for (const controller of activeSearches.values()) {
      try { controller.abort(); } catch {}
    }
    activeSearches.clear();
  }

  return { status, search, cancel, activeCount, dispose };
}

function serializeMediaError(error) {
  if (error?.code === "MEDIA_REQUEST_INVALID") {
    return { code: "MEDIA_REQUEST_INVALID", details: {} };
  }
  if (error?.code === "MEDIA_SEARCH_ACTIVE") {
    return { code: "MEDIA_SEARCH_ACTIVE", details: {} };
  }
  if (error?.code === "MEDIA_CANCELLED") {
    return { code: "MEDIA_CANCELLED", details: {} };
  }
  if (error?.code === "MEDIA_NOT_CONFIGURED" || error?.code === "MEDIA_CONFIG_INVALID" || error?.code === "MEDIA_HTTPS_REQUIRED") {
    return { code: error.code, details: {} };
  }
  if (error?.code === "MEDIA_NETWORK") {
    return { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} };
  }
  if (error?.code === "MEDIA_REQUEST_FAILED") {
    return { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} };
  }
  return publicSearchError(error);
}

module.exports = {
  REQUEST_ID_PATTERN,
  PROVIDER_PATTERN,
  MediaServiceError,
  normalizeRequestId,
  normalizeProvider,
  createService,
  serializeMediaError
};
