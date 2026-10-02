const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class TtsClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TtsClientError";
    this.code = code;
    this.details = details;
  }
}

function clientError(code, message, details) {
  return new TtsClientError(code, message, details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("TTS_NOT_CONFIGURED", "Cloud backend URL is not configured.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw clientError("TTS_CONFIG_INVALID", "Cloud backend URL is invalid.");
  }

  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw clientError("TTS_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
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
    AUTH_REQUIRED: "TTS_AUTH_REQUIRED",
    AUTH_EXPIRED: "TTS_AUTH_REQUIRED",
    TTS_INPUT_INVALID: "TTS_INPUT_INVALID",
    TTS_VOICE_INVALID: "TTS_VOICE_INVALID",
    TTS_SPEED_INVALID: "TTS_SPEED_INVALID",
    TTS_TOO_LARGE: "TTS_TOO_LARGE",
    JOB_CONFLICT: "TTS_JOB_CONFLICT",
    JOB_NOT_FOUND: "TTS_JOB_NOT_FOUND",
    ASSET_NOT_FOUND: "TTS_ASSET_NOT_FOUND",
    SERVICE_UNAVAILABLE: "TTS_UNAVAILABLE"
  };

  if (mapped[backendCode]) {
    return clientError(mapped[backendCode], "TTS backend rejected the request.", {
      status,
      backendCode
    });
  }

  if (status === 401 || status === 403) return clientError("TTS_AUTH_REQUIRED", "Authentication is required.", { status });
  if (status === 413) return clientError("TTS_TOO_LARGE", "TTS input is too large.", { status });
  if (status === 404) return clientError("TTS_JOB_NOT_FOUND", "TTS job was not found.", { status });
  if (status >= 500) return clientError("TTS_UNAVAILABLE", "TTS service is unavailable.", { status });

  return clientError("TTS_REQUEST_FAILED", "TTS request failed.", { status, backendCode: backendCode || null });
}

class CloudTtsClient {
  constructor({ backendUrl, getAccessToken, appVersion = "dev", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw clientError("TTS_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  buildUrl(pathname) {
    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");
    return url;
  }

  async request(pathname, {
    method = "GET",
    body,
    idempotencyKey,
    retries = 2,
    timeoutMs = this.timeoutMs,
    signal
  } = {}) {
    const url = this.buildUrl(pathname);
    const headers = {
      accept: "application/json",
      "x-viral-ai-client": "desktop",
      "x-viral-ai-version": this.appVersion,
      authorization: "Bearer " + this.accessToken()
    };

    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = String(idempotencyKey);

    const attempts = Math.max(1, retries + 1);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const externalAbort = () => controller.abort();

      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", externalAbort, { once: true });
      }

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
        if (signal?.aborted) throw clientError("TTS_CANCELLED", "TTS request was cancelled.");
        if (error instanceof TtsClientError) {
          if (attempt < attempts && ["TTS_UNAVAILABLE", "TTS_NETWORK", "TTS_TIMEOUT"].includes(error.code)) {
            lastError = error;
            await sleep(Math.min(2500, 300 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        const wrapped = clientError(
          controller.signal.aborted ? "TTS_TIMEOUT" : "TTS_NETWORK",
          controller.signal.aborted ? "TTS request timed out." : "TTS backend could not be reached.",
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
        if (signal) signal.removeEventListener("abort", externalAbort);
      }
    }

    throw lastError || clientError("TTS_REQUEST_FAILED", "TTS request failed.");
  }

  status() {
    return this.request("/v1/tts/status", { method: "GET", retries: 1, timeoutMs: 8000 });
  }

  createJob({ jobId, defaultVoiceId, voiceMap, speed, style, segments, signal }) {
    return this.request("/v1/tts/jobs", {
      method: "POST",
      idempotencyKey: jobId,
      signal,
      body: {
        clientJobId: jobId,
        defaultVoiceId,
        voiceMap,
        speed,
        style,
        segments
      }
    });
  }

  getJob(serverJobId, { signal } = {}) {
    return this.request("/v1/tts/jobs/" + encodeURIComponent(serverJobId), {
      method: "GET",
      signal,
      retries: 2
    });
  }

  cancelJob(serverJobId) {
    return this.request("/v1/tts/jobs/" + encodeURIComponent(serverJobId) + "/cancel", {
      method: "POST",
      idempotencyKey: "cancel-" + serverJobId,
      body: {},
      retries: 1
    });
  }

  async downloadAsset(serverJobId, assetId, { signal } = {}) {
    const url = this.buildUrl(
      "/v1/tts/jobs/" + encodeURIComponent(serverJobId) + "/assets/" + encodeURIComponent(assetId)
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const externalAbort = () => controller.abort();

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", externalAbort, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "audio/wav",
          authorization: "Bearer " + this.accessToken(),
          "x-viral-ai-client": "desktop",
          "x-viral-ai-version": this.appVersion
        },
        signal: controller.signal
      });

      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch {}
        throw stableApiError(response.status, payload || {});
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (signal?.aborted) throw clientError("TTS_CANCELLED", "TTS asset download was cancelled.");
      if (error instanceof TtsClientError) throw error;
      throw clientError(controller.signal.aborted ? "TTS_TIMEOUT" : "TTS_NETWORK", "Could not download TTS audio.");
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", externalAbort);
    }
  }
}

module.exports = {
  CloudTtsClient,
  TtsClientError,
  normalizeBaseUrl
};
