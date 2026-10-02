const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 2;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class VoiceClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VoiceClientError";
    this.code = code;
    this.details = details;
  }
}

function clientError(code, message, details) {
  return new VoiceClientError(code, message, details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("VOICE_NOT_CONFIGURED", "Cloud backend URL is not configured.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw clientError("VOICE_CONFIG_INVALID", "Cloud backend URL is invalid.");
  }

  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw clientError("VOICE_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
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
    AUTH_REQUIRED: "VOICE_AUTH_REQUIRED",
    AUTH_EXPIRED: "VOICE_AUTH_REQUIRED",
    VOICE_INPUT_INVALID: "VOICE_INPUT_INVALID",
    VOICE_LANGUAGE_INVALID: "VOICE_LANGUAGE_INVALID",
    VOICE_TOO_LARGE: "VOICE_TOO_LARGE",
    VOICE_NOT_FOUND: "VOICE_NOT_FOUND",
    VOICE_AUDIO_INVALID: "VOICE_AUDIO_INVALID",
    VOICE_AUDIO_EXPIRED: "VOICE_AUDIO_EXPIRED",
    VOICE_AUDIO_NOT_FOUND: "VOICE_AUDIO_NOT_FOUND",
    VOICE_PREVIEW_INVALID: "VOICE_PREVIEW_INVALID",
    VOICE_PREVIEW_RATE_LIMITED: "VOICE_PREVIEW_RATE_LIMITED",
    QUOTA_EXCEEDED: "VOICE_QUOTA_EXCEEDED",
    PLAN_REQUIRED: "VOICE_PLAN_REQUIRED",
    SUBSCRIPTION_INACTIVE: "VOICE_SUBSCRIPTION_INACTIVE",
    MODEL_NOT_INCLUDED: "VOICE_MODEL_NOT_INCLUDED",
    CONCURRENCY_LIMIT: "VOICE_CONCURRENCY_LIMIT",
    JOB_CONFLICT: "VOICE_JOB_CONFLICT",
    JOB_RESULT_NOT_RETAINED: "VOICE_RESULT_NOT_RETAINED",
    JOB_NOT_FOUND: "VOICE_JOB_NOT_FOUND",
    SERVICE_UNAVAILABLE: "VOICE_UNAVAILABLE"
  };

  if (mapped[backendCode]) {
    return clientError(mapped[backendCode], "Voice backend rejected the request.", {
      status,
      backendCode
    });
  }

  if (status === 401) {
    return clientError("VOICE_AUTH_REQUIRED", "Authentication is required.", { status });
  }
  if (status === 403) {
    return clientError("VOICE_PLAN_REQUIRED", "The current plan does not include this feature.", { status });
  }
  if (status === 402) {
    return clientError("VOICE_QUOTA_EXCEEDED", "Cloud allowance is insufficient.", { status });
  }
  if (status === 413) {
    return clientError("VOICE_TOO_LARGE", "Voice input is too large.", { status });
  }
  if (status === 429) {
    return clientError("VOICE_CONCURRENCY_LIMIT", "The active Cloud job limit has been reached.", { status });
  }
  if (status >= 500) {
    return clientError("VOICE_UNAVAILABLE", "Voice service is unavailable.", { status });
  }

  return clientError("VOICE_REQUEST_FAILED", "Voice request failed.", {
    status,
    backendCode: backendCode || null
  });
}

function retryable(error) {
  return ["VOICE_NETWORK", "VOICE_TIMEOUT", "VOICE_UNAVAILABLE"].includes(error?.code);
}

class CloudVoiceClient {
  constructor({ backendUrl, getAccessToken, appVersion = "dev", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw clientError("VOICE_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  url(pathname) {
    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");
    return url;
  }

  headers({ json = false, idempotencyKey } = {}) {
    const headers = {
      accept: "application/json",
      "x-viral-ai-client": "desktop",
      "x-viral-ai-version": this.appVersion,
      authorization: "Bearer " + this.accessToken()
    };
    if (json) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = String(idempotencyKey);
    return headers;
  }

  async request(pathname, {
    method = "GET",
    body,
    idempotencyKey,
    retries = DEFAULT_RETRIES,
    timeoutMs = this.timeoutMs,
    signal
  } = {}) {
    const url = this.url(pathname);
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
          headers: this.headers({
            json: body !== undefined,
            idempotencyKey
          }),
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
          throw clientError("VOICE_CANCELLED", "Voice request was cancelled.");
        }

        if (error instanceof VoiceClientError) {
          if (attempt < attempts && retryable(error)) {
            lastError = error;
            await sleep(Math.min(2500, 300 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        const timeout = controller.signal.aborted;
        const wrapped = clientError(
          timeout ? "VOICE_TIMEOUT" : "VOICE_NETWORK",
          timeout ? "Voice request timed out." : "Voice backend could not be reached.",
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

    throw lastError || clientError("VOICE_REQUEST_FAILED", "Voice request failed.");
  }

  status() {
    return this.request("/v1/voice/status", {
      method: "GET",
      retries: 1,
      timeoutMs: 8000
    });
  }

  catalog() {
    return this.request("/v1/voice/catalog", {
      method: "GET",
      retries: 1,
      timeoutMs: 8000
    });
  }

  createJob({ jobId, language, assignments, segments, signal }) {
    return this.request("/v1/voice/jobs", {
      method: "POST",
      idempotencyKey: jobId,
      signal,
      body: {
        clientJobId: jobId,
        language,
        assignments,
        segments
      }
    });
  }

  getJob(serverJobId, { signal } = {}) {
    return this.request("/v1/voice/jobs/" + encodeURIComponent(serverJobId), {
      method: "GET",
      retries: 2,
      signal
    });
  }

  async cancelJob(serverJobId) {
    try {
      return await this.request("/v1/voice/jobs/" + encodeURIComponent(serverJobId) + "/cancel", {
        method: "POST",
        idempotencyKey: "cancel-" + serverJobId,
        retries: 1,
        body: {}
      });
    } catch (error) {
      if (error?.code === "VOICE_JOB_NOT_FOUND") return { cancelled: true };
      throw error;
    }
  }

  async binaryRequest(pathname, {
    method = "GET",
    body,
    timeoutMs = this.timeoutMs,
    signal
  } = {}) {
    const controller = new AbortController();
    let externalAbort;

    if (signal) {
      externalAbort = () => controller.abort(signal.reason);
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", externalAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      const response = await fetch(this.url(pathname), {
        method,
        headers: this.headers({ json: body !== undefined }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch {}
        throw stableApiError(response.status, payload);
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "application/octet-stream"
      };
    } catch (error) {
      if (signal?.aborted) throw clientError("VOICE_CANCELLED", "Voice request was cancelled.");
      if (error instanceof VoiceClientError) throw error;

      const timeout = controller.signal.aborted;
      throw clientError(
        timeout ? "VOICE_TIMEOUT" : "VOICE_NETWORK",
        timeout ? "Voice request timed out." : "Voice backend could not be reached."
      );
    } finally {
      clearTimeout(timer);
      if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
    }
  }

  preview({ voiceId, text, language, signal }) {
    return this.binaryRequest("/v1/voice/preview", {
      method: "POST",
      body: { voiceId, text, language },
      timeoutMs: 30000,
      signal
    });
  }

  downloadAudio(audioUrl, { signal } = {}) {
    const pathname = String(audioUrl || "");
    if (!pathname.startsWith("/v1/voice/jobs/")) {
      throw clientError("VOICE_AUDIO_INVALID", "Voice audio URL is invalid.");
    }

    return this.binaryRequest(pathname, {
      method: "GET",
      timeoutMs: 30000,
      signal
    });
  }
}

module.exports = {
  CloudVoiceClient,
  VoiceClientError,
  normalizeBaseUrl
};
