"use strict";

const DEFAULT_TIMEOUT_MS = 12000;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class MediaClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MediaClientError";
    this.code = code;
    this.details = details;
  }
}

function clientError(code, message, details = {}) {
  return new MediaClientError(code, message, details);
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("MEDIA_NOT_CONFIGURED", "Cloud backend URL is not configured.");
  }
  let url;
  try { url = new URL(value.trim()); }
  catch { throw clientError("MEDIA_CONFIG_INVALID", "Cloud backend URL is invalid."); }
  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw clientError("MEDIA_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function safeJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function stableApiError(status, payload = {}) {
  const backendCode = payload?.error?.code || payload?.code || "";
  const mapped = {
    AUTH_REQUIRED: "MEDIA_AUTH_REQUIRED",
    AUTH_EXPIRED: "MEDIA_AUTH_REQUIRED",
    MEDIA_SEARCH_INVALID: "MEDIA_SEARCH_INVALID",
    MEDIA_PROVIDER_UNAVAILABLE: "MEDIA_PROVIDER_UNAVAILABLE",
    MEDIA_SEARCH_UNAVAILABLE: "MEDIA_SEARCH_UNAVAILABLE",
    MEDIA_SEARCH_TIMEOUT: "MEDIA_SEARCH_TIMEOUT",
    MEDIA_QUOTA_EXCEEDED: "MEDIA_QUOTA_EXCEEDED",
    RATE_LIMITED: "MEDIA_QUOTA_EXCEEDED"
  };
  if (mapped[backendCode]) return clientError(mapped[backendCode], "Media backend rejected the request.", { status, backendCode });
  if (status === 401) return clientError("MEDIA_AUTH_REQUIRED", "Authentication is required.", { status });
  if (status === 429) return clientError("MEDIA_QUOTA_EXCEEDED", "Media search allowance was exceeded.", { status });
  if (status >= 500) return clientError("MEDIA_SEARCH_UNAVAILABLE", "Media search service is unavailable.", { status });
  return clientError("MEDIA_REQUEST_FAILED", "Media request failed.", { status, backendCode: backendCode || null });
}

class CloudMediaClient {
  constructor({ backendUrl, getAccessToken, appVersion = "dev", fetchImpl = global.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw clientError("MEDIA_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  async request(pathname, { query, retries = 1, timeoutMs = this.timeoutMs, signal } = {}) {
    if (typeof this.fetchImpl !== "function") throw clientError("MEDIA_SEARCH_UNAVAILABLE", "Network client is unavailable.");
    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    let lastError;
    const attempts = Math.max(1, Number(retries || 0) + 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      let externalAbort;
      if (signal) {
        externalAbort = () => controller.abort(signal.reason);
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", externalAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: "Bearer " + this.accessToken(),
            "x-viral-ai-client": "desktop",
            "x-viral-ai-version": this.appVersion
          },
          signal: controller.signal
        });
        const payload = safeJson(await response.text());
        if (!response.ok) {
          const error = stableApiError(response.status, payload);
          if (attempt < attempts && RETRY_STATUS.has(response.status)) { lastError = error; continue; }
          throw error;
        }
        return payload;
      } catch (error) {
        if (signal?.aborted) throw clientError("MEDIA_CANCELLED", "Media request was cancelled.");
        if (error instanceof MediaClientError) {
          if (attempt < attempts && ["MEDIA_SEARCH_UNAVAILABLE", "MEDIA_SEARCH_TIMEOUT"].includes(error.code)) { lastError = error; continue; }
          throw error;
        }
        const timedOut = controller.signal.aborted;
        const wrapped = clientError(timedOut ? "MEDIA_SEARCH_TIMEOUT" : "MEDIA_NETWORK", timedOut ? "Media search timed out." : "Media backend could not be reached.", { technicalMessage: error?.message || String(error) });
        if (attempt < attempts) { lastError = wrapped; continue; }
        throw wrapped;
      } finally {
        clearTimeout(timer);
        if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
      }
    }
    throw lastError || clientError("MEDIA_REQUEST_FAILED", "Media request failed.");
  }

  status({ signal } = {}) {
    return this.request("/v1/media/status", { retries: 1, timeoutMs: 8000, signal });
  }

  search({ query, kind = "video", orientation = "any", page = 1, perPage = 18, provider = "auto", signal } = {}) {
    return this.request("/v1/media/search", {
      query: { query, kind, orientation, page, perPage, provider },
      retries: 1,
      signal
    });
  }
}

module.exports = {
  CloudMediaClient,
  MediaClientError,
  normalizeBaseUrl,
  stableApiError
};
