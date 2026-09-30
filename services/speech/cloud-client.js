const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class CloudClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CloudClientError";
    this.code = code;
    this.details = details;
  }
}

function cloudError(code, message, details) {
  return new CloudClientError(code, message, details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw cloudError("CLOUD_NOT_CONFIGURED", "Cloud backend URL is not configured.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw cloudError("CLOUD_CONFIG_INVALID", "Cloud backend URL is invalid.");
  }

  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw cloudError("CLOUD_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function stableApiError(status, payload = {}) {
  const backendCode = typeof payload?.error?.code === "string"
    ? payload.error.code
    : typeof payload?.code === "string"
      ? payload.code
      : "";

  const mapped = {
    AUTH_REQUIRED: "CLOUD_AUTH_REQUIRED",
    AUTH_EXPIRED: "CLOUD_AUTH_REQUIRED",
    UNAUTHORIZED: "CLOUD_AUTH_REQUIRED",
    QUOTA_EXCEEDED: "CLOUD_QUOTA_EXCEEDED",
    PLAN_REQUIRED: "CLOUD_PLAN_REQUIRED",
    FILE_TOO_LARGE: "CLOUD_FILE_TOO_LARGE",
    UNSUPPORTED_AUDIO: "CLOUD_AUDIO_UNSUPPORTED",
    JOB_NOT_FOUND: "CLOUD_JOB_NOT_FOUND",
    JOB_CONFLICT: "DUPLICATE_ACTIVE",
    SERVICE_UNAVAILABLE: "CLOUD_UNAVAILABLE"
  };

  if (mapped[backendCode]) {
    return cloudError(mapped[backendCode], "Cloud backend rejected the request.", {
      status,
      backendCode
    });
  }

  if (status === 401) return cloudError("CLOUD_AUTH_REQUIRED", "Authentication is required.", { status });
  if (status === 403) return cloudError("CLOUD_FORBIDDEN", "Cloud request is not allowed.", { status });
  if (status === 402 || status === 429) return cloudError("CLOUD_QUOTA_EXCEEDED", "Cloud allowance is unavailable.", { status });
  if (status === 404) return cloudError("CLOUD_JOB_NOT_FOUND", "Cloud job was not found.", { status });
  if (status >= 500) return cloudError("CLOUD_UNAVAILABLE", "Cloud service is unavailable.", { status });

  return cloudError("CLOUD_REQUEST_FAILED", "Cloud request failed.", {
    status,
    backendCode: backendCode || null
  });
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRetryableError(error) {
  return [
    "CLOUD_NETWORK",
    "CLOUD_TIMEOUT",
    "CLOUD_UNAVAILABLE"
  ].includes(error?.code);
}

class CloudSpeechClient {
  constructor({
    backendUrl,
    getAccessToken,
    appVersion = "dev",
    timeoutMs = DEFAULT_TIMEOUT_MS
  }) {
    this.backendUrl = backendUrl;
    this.getAccessToken = typeof getAccessToken === "function" ? getAccessToken : () => null;
    this.appVersion = String(appVersion || "dev");
    this.timeoutMs = Math.max(3000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  baseUrl() {
    return normalizeBaseUrl(this.backendUrl);
  }

  accessToken() {
    const token = this.getAccessToken();
    if (typeof token !== "string" || !token.trim()) {
      throw cloudError("CLOUD_AUTH_REQUIRED", "Cloud authentication is required.");
    }
    return token.trim();
  }

  async request(pathname, {
    method = "GET",
    body,
    idempotencyKey,
    timeoutMs = this.timeoutMs,
    retries = DEFAULT_RETRIES,
    signal,
    auth = true
  } = {}) {
    const base = this.baseUrl();
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");

    const headers = {
      "accept": "application/json",
      "x-viral-ai-client": "desktop",
      "x-viral-ai-version": this.appVersion
    };

    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = String(idempotencyKey);
    if (auth) headers.authorization = "Bearer " + this.accessToken();

    const allowRetry = method === "GET" || method === "HEAD" || Boolean(idempotencyKey);
    const maxAttempts = allowRetry ? Math.max(1, retries + 1) : 1;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        const payload = safeJson(text);

        if (!response.ok) {
          const error = stableApiError(response.status, payload || {});
          if (attempt < maxAttempts && RETRY_STATUS.has(response.status)) {
            lastError = error;
            await sleep(Math.min(3000, 350 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        return payload || {};
      } catch (error) {
        if (signal?.aborted) {
          throw cloudError("CLOUD_CANCELLED", "Cloud request was cancelled.");
        }

        if (error instanceof CloudClientError) {
          if (attempt < maxAttempts && isRetryableError(error)) {
            lastError = error;
            await sleep(Math.min(3000, 350 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw error;
        }

        const timeout = controller.signal.aborted;
        const wrapped = cloudError(
          timeout ? "CLOUD_TIMEOUT" : "CLOUD_NETWORK",
          timeout ? "Cloud request timed out." : "Cloud request could not connect.",
          { technicalMessage: error?.message || String(error) }
        );

        if (attempt < maxAttempts) {
          lastError = wrapped;
          await sleep(Math.min(3000, 350 * Math.pow(2, attempt - 1)));
          continue;
        }
        throw wrapped;
      } finally {
        clearTimeout(timer);
        if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
      }
    }

    throw lastError || cloudError("CLOUD_REQUEST_FAILED", "Cloud request failed.");
  }

  async status({ signal } = {}) {
    return this.request("/v1/speech/status", {
      method: "GET",
      retries: 1,
      timeoutMs: 8000,
      signal
    });
  }

  async createJob({
    clientJobId,
    language,
    duration,
    audioSizeBytes,
    audioSha256,
    contentType,
    signal
  }) {
    return this.request("/v1/speech/jobs", {
      method: "POST",
      idempotencyKey: clientJobId,
      signal,
      body: {
        clientJobId,
        language,
        audio: {
          durationSeconds: duration,
          sizeBytes: audioSizeBytes,
          sha256: audioSha256,
          contentType
        }
      }
    });
  }

  async commitJob(serverJobId, { signal } = {}) {
    return this.request(`/v1/speech/jobs/${encodeURIComponent(serverJobId)}/commit`, {
      method: "POST",
      idempotencyKey: `commit-${serverJobId}`,
      signal,
      body: {}
    });
  }

  async getJob(serverJobId, { signal } = {}) {
    return this.request(`/v1/speech/jobs/${encodeURIComponent(serverJobId)}`, {
      method: "GET",
      retries: 2,
      signal
    });
  }

  async cancelJob(serverJobId) {
    try {
      return await this.request(`/v1/speech/jobs/${encodeURIComponent(serverJobId)}/cancel`, {
        method: "POST",
        idempotencyKey: `cancel-${serverJobId}`,
        retries: 1,
        body: {}
      });
    } catch (error) {
      if (error?.code === "CLOUD_JOB_NOT_FOUND") return { cancelled: true };
      throw error;
    }
  }

  async uploadFile({
    upload,
    filePath,
    signal,
    onProgress
  }) {
    if (!upload?.url) {
      throw cloudError("CLOUD_UPLOAD_INVALID", "Backend did not provide an upload target.");
    }

    let url;
    try {
      url = new URL(upload.url);
    } catch {
      throw cloudError("CLOUD_UPLOAD_INVALID", "Upload URL is invalid.");
    }

    const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
      throw cloudError("CLOUD_UPLOAD_INSECURE", "Upload target must use HTTPS.");
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw cloudError("CLOUD_UPLOAD_INVALID", "Prepared audio is unavailable.");
    }

    const method = String(upload.method || "PUT").toUpperCase();
    if (!["PUT", "POST"].includes(method)) {
      throw cloudError("CLOUD_UPLOAD_INVALID", "Unsupported upload method.");
    }

    const suppliedHeaders = upload.headers && typeof upload.headers === "object"
      ? upload.headers
      : {};
    const headers = {};
    for (const [key, value] of Object.entries(suppliedHeaders)) {
      if (typeof value === "string" && key.length <= 128 && value.length <= 4096) {
        headers[key] = value;
      }
    }
    headers["content-length"] = String(stat.size);

    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      let settled = false;
      let sent = 0;
      const stream = fs.createReadStream(filePath);

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        fn(value);
      };

      const request = transport.request(url, {
        method,
        headers,
        timeout: 60000
      }, response => {
        let responseBody = "";
        response.on("data", chunk => {
          if (responseBody.length < 8192) responseBody += chunk.toString();
        });
        response.on("end", () => {
          const status = Number(response.statusCode || 0);
          if (status >= 200 && status < 300) {
            onProgress?.({ sentBytes: stat.size, totalBytes: stat.size, percent: 100 });
            finish(resolve, { uploaded: true });
            return;
          }
          finish(reject, cloudError("CLOUD_UPLOAD_FAILED", "Audio upload failed.", { status }));
        });
      });

      const abortHandler = () => {
        stream.destroy();
        request.destroy();
        finish(reject, cloudError("CLOUD_CANCELLED", "Audio upload was cancelled."));
      };

      if (signal) {
        if (signal.aborted) return abortHandler();
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      request.on("timeout", () => {
        request.destroy(cloudError("CLOUD_TIMEOUT", "Audio upload timed out."));
      });

      request.on("error", error => {
        if (signal?.aborted) {
          finish(reject, cloudError("CLOUD_CANCELLED", "Audio upload was cancelled."));
          return;
        }
        if (error instanceof CloudClientError) {
          finish(reject, error);
          return;
        }
        finish(reject, cloudError("CLOUD_UPLOAD_FAILED", "Audio upload failed.", {
          technicalMessage: error?.message || String(error)
        }));
      });

      stream.on("data", chunk => {
        sent += chunk.length;
        const percent = stat.size > 0 ? Math.min(99, Math.floor((sent / stat.size) * 100)) : 0;
        onProgress?.({ sentBytes: sent, totalBytes: stat.size, percent });
      });

      stream.on("error", error => {
        request.destroy();
        finish(reject, cloudError("CLOUD_UPLOAD_FAILED", "Prepared audio could not be read.", {
          technicalMessage: error?.message || String(error)
        }));
      });

      stream.pipe(request);
    });
  }

  async sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }
}

module.exports = {
  CloudSpeechClient,
  CloudClientError,
  normalizeBaseUrl
};
