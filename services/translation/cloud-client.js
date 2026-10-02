const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class TranslationClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TranslationClientError";
    this.code = code;
    this.details = details;
  }
}

function clientError(code, message, details) {
  return new TranslationClientError(code, message, details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("TRANSLATION_NOT_CONFIGURED", "Cloud backend URL is not configured.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw clientError("TRANSLATION_CONFIG_INVALID", "Cloud backend URL is invalid.");
  }

  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw clientError("TRANSLATION_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function stableApiError(status, payload = {}) {
  const backendCode = payload?.error?.code || payload?.code || "";
  const mapped = {
    AUTH_REQUIRED: "TRANSLATION_AUTH_REQUIRED",
    AUTH_EXPIRED: "TRANSLATION_AUTH_REQUIRED",
    TRANSLATION_INPUT_INVALID: "TRANSLATION_INPUT_INVALID",
    TRANSLATION_LANGUAGE_INVALID: "TRANSLATION_LANGUAGE_INVALID",
    TRANSLATION_TOO_LARGE: "TRANSLATION_TOO_LARGE",
    TRANSLATION_RESULT_INVALID: "TRANSLATION_RESULT_INVALID",
    QUOTA_EXCEEDED: "TRANSLATION_QUOTA_EXCEEDED",
    PLAN_REQUIRED: "TRANSLATION_PLAN_REQUIRED",
    SUBSCRIPTION_INACTIVE: "TRANSLATION_SUBSCRIPTION_INACTIVE",
    CONCURRENCY_LIMIT: "TRANSLATION_CONCURRENCY_LIMIT",
    JOB_CONFLICT: "TRANSLATION_JOB_CONFLICT",
    JOB_RESULT_NOT_RETAINED: "TRANSLATION_RESULT_NOT_RETAINED",
    JOB_NOT_FOUND: "TRANSLATION_JOB_NOT_FOUND",
    SERVICE_UNAVAILABLE: "TRANSLATION_UNAVAILABLE"
  };

  if (mapped[backendCode]) {
    return clientError(mapped[backendCode], "Translation backend rejected the request.", {
      status,
      backendCode
    });
  }

  if (status === 401) {
    return clientError("TRANSLATION_AUTH_REQUIRED", "Authentication is required.", { status });
  }
  if (status === 403) {
    return clientError("TRANSLATION_PLAN_REQUIRED", "The current plan does not include this feature.", { status });
  }
  if (status === 429) {
    return clientError("TRANSLATION_CONCURRENCY_LIMIT", "The active Cloud job limit has been reached.", { status });
  }
  if (status === 402) {
    return clientError("TRANSLATION_QUOTA_EXCEEDED", "Cloud allowance is insufficient.", { status });
  }
  if (status === 413) {
    return clientError("TRANSLATION_TOO_LARGE", "Translation input is too large.", { status });
  }
  if (status === 404) {
    return clientError("TRANSLATION_JOB_NOT_FOUND", "Translation job was not found.", { status });
  }
  if (status >= 500) {
    return clientError("TRANSLATION_UNAVAILABLE", "Translation service is unavailable.", { status });
  }

  return clientError("TRANSLATION_REQUEST_FAILED", "Translation request failed.", {
    status,
    backendCode: backendCode || null
  });
}

function retryable(error) {
  return ["TRANSLATION_NETWORK", "TRANSLATION_TIMEOUT", "TRANSLATION_UNAVAILABLE"].includes(error?.code);
}

class CloudTranslationClient {
  constructor({ backendUrl, getAccessToken, appVersion = "dev", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw clientError("TRANSLATION_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  async request(pathname, {
    method = "GET",
    body,
    idempotencyKey,
    retries = DEFAULT_RETRIES,
    timeoutMs = this.timeoutMs,
    signal
  } = {}) {
    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");

    const headers = {
      accept: "application/json",
      "x-viral-ai-client": "desktop",
      "x-viral-ai-version": this.appVersion,
      authorization: "Bearer " + this.accessToken()
    };

    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = String(idempotencyKey);

    const canRetry = method === "GET" || Boolean(idempotencyKey);
    const attempts = canRetry ? Math.max(1, retries + 1) : 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      let externalAbort;

      if (signal) {
        externalAbort = () => controller.abort(signal.reason);
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", externalAbort, { once: true });
      }

      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });

        const text = await response.text();
        const payload = safeJson(text) || {};

        if (!response.ok) {
          const error = stableApiError(response.status, payload);
          if (attempt < attempts && RETRY_STATUS.has(response.status)) {
            lastError = error;
            await sleep(Math.min(2500, 300 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        return payload;
      } catch (error) {
        if (signal?.aborted) {
          throw clientError("TRANSLATION_CANCELLED", "Translation request was cancelled.");
        }

        if (error instanceof TranslationClientError) {
          if (attempt < attempts && retryable(error)) {
            lastError = error;
            await sleep(Math.min(2500, 300 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        const timeout = controller.signal.aborted;
        const wrapped = clientError(
          timeout ? "TRANSLATION_TIMEOUT" : "TRANSLATION_NETWORK",
          timeout ? "Translation request timed out." : "Translation backend could not be reached.",
          { technicalMessage: error?.message || String(error) }
        );

        if (attempt < attempts) {
          lastError = wrapped;
          await sleep(Math.min(2500, 300 * Math.pow(2, attempt - 1)));
          continue;
        }

        throw wrapped;
      } finally {
        clearTimeout(timer);
        if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
      }
    }

    throw lastError || clientError("TRANSLATION_REQUEST_FAILED", "Translation request failed.");
  }

  status({ signal } = {}) {
    return this.request("/v1/translation/status", {
      method: "GET",
      retries: 1,
      timeoutMs: 8000,
      signal
    });
  }

  createJob({ jobId, sourceLanguage, targetLanguage, preserveTone, segments, signal }) {
    return this.request("/v1/translation/jobs", {
      method: "POST",
      idempotencyKey: jobId,
      signal,
      body: {
        clientJobId: jobId,
        sourceLanguage,
        targetLanguage,
        preserveTone,
        segments
      }
    });
  }

  getJob(serverJobId, { signal } = {}) {
    return this.request("/v1/translation/jobs/" + encodeURIComponent(serverJobId), {
      method: "GET",
      retries: 2,
      signal
    });
  }

  async cancelJob(serverJobId) {
    try {
      return await this.request("/v1/translation/jobs/" + encodeURIComponent(serverJobId) + "/cancel", {
        method: "POST",
        idempotencyKey: "cancel-" + serverJobId,
        retries: 1,
        body: {}
      });
    } catch (error) {
      if (error?.code === "TRANSLATION_JOB_NOT_FOUND") return { cancelled: true };
      throw error;
    }
  }
}

module.exports = {
  CloudTranslationClient,
  TranslationClientError,
  normalizeBaseUrl
};
