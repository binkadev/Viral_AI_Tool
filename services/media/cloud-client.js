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
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw clientError("MEDIA_NOT_CONFIGURED", "Cloud backend URL is not configured.");

  let url;
  try { url = new URL(raw); }
  catch { throw clientError("MEDIA_CONFIG_INVALID", "Cloud backend URL is invalid."); }

  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw clientError("MEDIA_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function stableApiError(status, payload = {}) {
  const backendCode = String(payload?.error?.code || payload?.code || "");
  const mapped = {
    AUTH_REQUIRED: "MEDIA_AUTH_REQUIRED",
    AUTH_EXPIRED: "MEDIA_AUTH_REQUIRED",
    MEDIA_SEARCH_INVALID: "MEDIA_SEARCH_INVALID",
    MEDIA_SEARCH_UNAVAILABLE: "MEDIA_SEARCH_UNAVAILABLE",
    MEDIA_SEARCH_TIMEOUT: "MEDIA_SEARCH_TIMEOUT",
    MEDIA_PROVIDER_UNAVAILABLE: "MEDIA_PROVIDER_UNAVAILABLE",
    MEDIA_AUTH_REQUIRED: "MEDIA_AUTH_REQUIRED",
    MEDIA_QUOTA_EXCEEDED: "MEDIA_QUOTA_EXCEEDED",
    QUOTA_EXCEEDED: "MEDIA_QUOTA_EXCEEDED",
    PLAN_REQUIRED: "MEDIA_PLAN_REQUIRED",
    SUBSCRIPTION_INACTIVE: "MEDIA_SUBSCRIPTION_INACTIVE",
    SERVICE_UNAVAILABLE: "MEDIA_SEARCH_UNAVAILABLE"
  };

  const code = mapped[backendCode];
  if (code) return clientError(code, "Media service rejected the request.", { status, backendCode });
  if (status === 401) return clientError("MEDIA_AUTH_REQUIRED", "Authentication is required.", { status });
  if (status === 403) return clientError("MEDIA_PLAN_REQUIRED", "The current plan does not include this feature.", { status });
  if (status === 402 || status === 429) return clientError("MEDIA_QUOTA_EXCEEDED", "Media search allowance is unavailable.", { status });
  if (status >= 500) return clientError("MEDIA_SEARCH_UNAVAILABLE", "Media search is unavailable.", { status });
  return clientError("MEDIA_REQUEST_FAILED", "Media request failed.", { status, backendCode: backendCode || null });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CloudMediaClient {
  constructor({ backendUrl, getAccessToken, appVersion = "dev", timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = global.fetch }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
    this.fetchImpl = fetchImpl;
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw clientError("MEDIA_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  async request(pathname, { searchParams, retries = 1, timeoutMs = this.timeoutMs, signal } = {}) {
    if (typeof this.fetchImpl !== "function") {
      throw clientError("MEDIA_SEARCH_UNAVAILABLE", "Media network client is unavailable.");
    }

    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");
    for (const [key, value] of Object.entries(searchParams || {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const headers = {
      accept: "application/json",
      authorization: "Bearer " + this.accessToken(),
      "x-viral-ai-client": "desktop",
      "x-viral-ai-version": this.appVersion
    };

    const attempts = Math.max(1, Number(retries || 0) + 1);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      let externalAbort = null;
      if (signal) {
        externalAbort = () => controller.abort(signal.reason);
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", externalAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

      try {
        const response = await this.fetchImpl(url, { method: "GET", headers, signal: controller.signal });
        const text = await response.text();
        const payload = safeJson(text) || {};
        if (!response.ok) {
          const error = stableApiError(response.status, payload);
          if (attempt < attempts && RETRY_STATUS.has(response.status)) {
            lastError = error;
            await sleep(Math.min(1200, 200 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }
        return payload;
      } catch (error) {
        if (signal?.aborted) throw clientError("MEDIA_CANCELLED", "Media request was cancelled.");
        if (error instanceof MediaClientError) throw error;

        const wrapped = clientError(
          controller.signal.aborted ? "MEDIA_SEARCH_TIMEOUT" : "MEDIA_NETWORK",
          controller.signal.aborted ? "Media search timed out." : "Media service could not be reached.",
          { technicalMessage: error?.message || String(error) }
        );
        if (attempt < attempts) {
          lastError = wrapped;
          await sleep(Math.min(1200, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
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
      retries: 1,
      signal,
      searchParams: { query, kind, orientation, page, perPage, provider }
    });
  }
}

module.exports = {
  CloudMediaClient,
  MediaClientError,
  normalizeBaseUrl,
  stableApiError
};
