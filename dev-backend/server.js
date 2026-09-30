const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const speechProvider = require("./providers");
const translationProvider = require("./providers/translation");
const translationJobs = require("./translation-jobs");

const HOST = "127.0.0.1";
const PORT = Number(process.env.VIRAL_AI_DEV_PORT || 3000);

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LOGIN_ATTEMPTS = 8;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_AUDIO_BYTES = Math.max(
  1024 * 1024,
  Math.min(100 * 1024 * 1024, Number(process.env.VIRAL_AI_PROVIDER_MAX_AUDIO_BYTES || 24 * 1024 * 1024))
);
const MAX_DURATION_SECONDS = Math.max(
  60,
  Math.min(4 * 60 * 60, Number(process.env.VIRAL_AI_MAX_AUDIO_SECONDS || 7200))
);

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const users = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const loginAttempts = new Map();
const jobs = new Map();
const idempotency = new Map();
const uploadTokens = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function seedUser() {
  const email = "demo@viral-ai.local";
  const password = "ViralAI123!";
  const salt = crypto.randomBytes(16).toString("hex");

  users.set(email, {
    id: "dev-user-1",
    email,
    name: "Viral AI Dev",
    plan: "Creator Pro",
    salt,
    passwordHash: hashPassword(password, salt),
    quota: {
      remainingMinutes: 500,
      resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  return { email, password };
}

const demo = seedUser();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function error(res, status, code) {
  return json(res, status, { error: { code } });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("body too large");
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("invalid json");
    err.code = "INVALID_JSON";
    throw err;
  }
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function tokenExpiry(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function issueSession(user) {
  const accessToken = newToken();
  const refreshToken = newToken();
  const accessExpiresAt = tokenExpiry(ACCESS_TTL_MS);
  const refreshExpiresAt = tokenExpiry(REFRESH_TTL_MS);

  accessTokens.set(accessToken, {
    userId: user.id,
    expiresAt: Date.parse(accessExpiresAt)
  });
  refreshTokens.set(refreshToken, {
    userId: user.id,
    expiresAt: Date.parse(refreshExpiresAt)
  });

  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan
    }
  };
}

function findUserById(userId) {
  return [...users.values()].find(user => user.id === userId) || null;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const record = accessTokens.get(token);
  if (!record) return null;

  if (Date.now() >= record.expiresAt) {
    accessTokens.delete(token);
    return null;
  }

  return findUserById(record.userId);
}

function pruneAttempts(key) {
  const now = Date.now();
  const values = (loginAttempts.get(key) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  loginAttempts.set(key, values);
  return values;
}

function rateLimited(key) {
  return pruneAttempts(key).length >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const values = pruneAttempts(key);
  values.push(Date.now());
  loginAttempts.set(key, values);
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function idempotencyKey(req) {
  const key = String(req.headers["idempotency-key"] || "").trim();
  return /^[A-Za-z0-9._-]{8,160}$/.test(key) ? key : null;
}

function serverJobId() {
  return "sp_" + crypto.randomBytes(12).toString("hex");
}

function jobFilePath(jobId) {
  return path.join(UPLOAD_DIR, jobId + ".flac");
}

function partialJobFilePath(jobId) {
  return path.join(UPLOAD_DIR, jobId + ".flac.part");
}

function activeJobState(state) {
  return ["awaiting_upload", "uploaded", "queued", "processing", "cancelling"].includes(state);
}

function reservedMinutesForUser(userId) {
  let total = 0;
  for (const job of jobs.values()) {
    if (job.userId === userId && activeJobState(job.state)) {
      total += Number(job.reservedMinutes || 0);
    }
  }
  return total;
}

function cleanupUpload(job) {
  if (!job) return;
  for (const target of [jobFilePath(job.id), partialJobFilePath(job.id)]) {
    try { fs.rmSync(target, { force: true }); } catch {}
  }

  if (job.uploadToken) {
    uploadTokens.delete(job.uploadToken);
    job.uploadToken = null;
    job.uploadExpiresAt = null;
  }
}

function releaseReservation(job) {
  if (!job) return;
  job.reservedMinutes = 0;
}

function providerPublicCode(errorValue) {
  const code = errorValue?.code || "";
  if (code === "PROVIDER_FILE_TOO_LARGE") return "FILE_TOO_LARGE";
  if (code === "PROVIDER_CANCELLED") return "CANCELLED";
  if (["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "PROVIDER_NETWORK", "PROVIDER_AUTH_FAILED", "PROVIDER_CONFIG_INVALID"].includes(code)) {
    return "SERVICE_UNAVAILABLE";
  }
  return "PROCESSING_FAILED";
}

function ensureUploadTarget(job) {
  if (!job || job.state !== "awaiting_upload") return null;

  const existingValid = job.uploadToken &&
    Number(job.uploadExpiresAt || 0) > Date.now() &&
    uploadTokens.get(job.uploadToken)?.jobId === job.id;

  if (!existingValid) {
    if (job.uploadToken) uploadTokens.delete(job.uploadToken);

    const token = newToken(24);
    const expiresAt = Date.now() + UPLOAD_TTL_MS;
    job.uploadToken = token;
    job.uploadExpiresAt = expiresAt;
    uploadTokens.set(token, {
      jobId: job.id,
      expiresAt
    });
  }

  return {
    url: "http://" + HOST + ":" + PORT + "/v1/dev-upload/" + job.uploadToken,
    method: "PUT",
    headers: {
      "content-type": "audio/flac"
    },
    expiresAt: new Date(job.uploadExpiresAt).toISOString()
  };
}

function publicJob(job, { createResponse = false } = {}) {
  const payload = {
    jobId: job.id,
    state: job.state,
    estimate: {
      minutes: job.estimatedMinutes,
      units: job.estimatedMinutes
    }
  };

  if (Number.isFinite(job.progress)) payload.progress = Number(job.progress);
  if (job.chargedMinutes > 0) payload.chargedMinutes = job.chargedMinutes;
  if (job.result) payload.result = job.result;
  if (job.errorCode) payload.error = { code: job.errorCode };

  if (createResponse && job.state === "awaiting_upload") {
    payload.upload = ensureUploadTarget(job);
  }

  return payload;
}

function findOwnedJob(user, jobId) {
  const job = jobs.get(jobId);
  if (!job || job.userId !== user.id) return null;
  return job;
}

function validateCreateSpeechBody(body) {
  const audio = body?.audio || {};
  const language = String(body?.language || "auto");
  const clientJobId = String(body?.clientJobId || "");
  const sizeBytes = Number(audio.sizeBytes || 0);
  const durationSeconds = Number(audio.durationSeconds || 0);
  const sha256 = String(audio.sha256 || "").toLowerCase();
  const contentType = String(audio.contentType || "");

  if (!/^[A-Za-z0-9._-]{8,160}$/.test(clientJobId)) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  if (contentType !== "audio/flac") {
    return { ok: false, code: "UNSUPPORTED_AUDIO" };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, code: durationSeconds > MAX_DURATION_SECONDS ? "FILE_TOO_LARGE" : "BAD_REQUEST" };
  }
  if (language !== "auto" && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    return { ok: false, code: "BAD_REQUEST" };
  }

  return {
    ok: true,
    clientJobId,
    language,
    audio: {
      sizeBytes,
      durationSeconds,
      sha256,
      contentType
    }
  };
}

function jobFingerprint(input) {
  return [
    input.language,
    input.audio.sha256,
    input.audio.sizeBytes,
    Math.round(input.audio.durationSeconds * 1000)
  ].join(":");
}

async function receiveUpload(req, res, token) {
  const tokenRecord = uploadTokens.get(token);
  if (!tokenRecord || Date.now() >= tokenRecord.expiresAt) {
    uploadTokens.delete(token);
    return error(res, 404, "UPLOAD_NOT_FOUND");
  }

  const job = jobs.get(tokenRecord.jobId);
  if (!job || job.state !== "awaiting_upload") {
    uploadTokens.delete(token);
    return error(res, 409, "JOB_CONFLICT");
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength !== job.audio.sizeBytes) {
    return error(res, 400, "UPLOAD_SIZE_MISMATCH");
  }

  if (contentLength > MAX_AUDIO_BYTES) {
    return error(res, 413, "FILE_TOO_LARGE");
  }

  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType && contentType !== "audio/flac") {
    return error(res, 415, "UNSUPPORTED_AUDIO");
  }

  const partial = partialJobFilePath(job.id);
  const finalPath = jobFilePath(job.id);
  try { fs.rmSync(partial, { force: true }); } catch {}

  const hash = crypto.createHash("sha256");
  let received = 0;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(partial, { flags: "wx" });
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    req.on("data", chunk => {
      received += chunk.length;
      if (received > job.audio.sizeBytes || received > MAX_AUDIO_BYTES) {
        req.destroy();
        output.destroy();
        finish(reject, Object.assign(new Error("upload too large"), { code: "FILE_TOO_LARGE" }));
        return;
      }
      hash.update(chunk);
    });

    req.on("aborted", () => {
      output.destroy();
      finish(reject, Object.assign(new Error("upload aborted"), { code: "UPLOAD_ABORTED" }));
    });

    req.on("error", err => {
      output.destroy();
      finish(reject, err);
    });

    output.on("error", err => finish(reject, err));
    output.on("finish", () => finish(resolve));

    req.pipe(output);
  }).catch(async err => {
    try { await fsp.rm(partial, { force: true }); } catch {}
    throw err;
  });

  if (received !== job.audio.sizeBytes) {
    try { await fsp.rm(partial, { force: true }); } catch {}
    return error(res, 400, "UPLOAD_SIZE_MISMATCH");
  }

  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== job.audio.sha256) {
    try { await fsp.rm(partial, { force: true }); } catch {}
    return error(res, 400, "UPLOAD_CHECKSUM_MISMATCH");
  }

  try { await fsp.rm(finalPath, { force: true }); } catch {}
  await fsp.rename(partial, finalPath);

  job.state = "uploaded";
  job.progress = 0;
  job.uploadedAt = new Date().toISOString();
  uploadTokens.delete(token);
  job.uploadToken = null;
  job.uploadExpiresAt = null;

  return json(res, 200, { uploaded: true });
}

async function processSpeechJob(job) {
  if (!job || job.processStarted || job.state !== "uploaded") return;

  job.processStarted = true;
  job.state = "queued";
  job.progress = 0;

  setImmediate(async () => {
    if (job.cancelRequested) {
      job.state = "cancelled";
      releaseReservation(job);
      cleanupUpload(job);
      return;
    }

    job.state = "processing";
    job.progress = null;
    job.controller = new AbortController();

    try {
      const result = await speechProvider.transcribe({
        filePath: jobFilePath(job.id),
        language: job.language,
        duration: job.audio.durationSeconds,
        signal: job.controller.signal
      });

      if (job.cancelRequested || job.controller.signal.aborted) {
        job.state = "cancelled";
        job.progress = 0;
        releaseReservation(job);
        return;
      }

      const user = findUserById(job.userId);
      if (!user) throw Object.assign(new Error("user missing"), { code: "USER_MISSING" });

      const charge = Math.max(1, Number(job.reservedMinutes || job.estimatedMinutes || 1));
      user.quota.remainingMinutes = Math.max(0, Number(user.quota.remainingMinutes || 0) - charge);

      job.chargedMinutes = charge;
      job.reservedMinutes = 0;
      job.result = result;
      job.state = "completed";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
    } catch (err) {
      if (job.cancelRequested || err?.code === "PROVIDER_CANCELLED") {
        job.state = "cancelled";
        job.progress = 0;
        releaseReservation(job);
      } else {
        job.state = "failed";
        job.progress = 0;
        job.errorCode = providerPublicCode(err);
        releaseReservation(job);
        console.error("[SpeechProvider]", err?.code || "ERROR", err?.message || String(err));
      }
    } finally {
      job.controller = null;
      cleanupUpload(job);
    }
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || HOST));
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "viral-ai-dev-backend",
      speechProviderConfigured: speechProvider.isConfigured(),
      translationProviderConfigured: translationProvider.isConfigured()
    });
  }

  if (method === "POST" && url.pathname === "/v1/auth/login") {
    const clientKey = String(req.socket.remoteAddress || "unknown");
    if (rateLimited(clientKey)) return error(res, 429, "RATE_LIMITED");

    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = users.get(email);

    const candidateHash = user
      ? hashPassword(password, user.salt)
      : hashPassword(password || "invalid", "00000000000000000000000000000000");

    if (!user || !safeEqualHex(candidateHash, user.passwordHash)) {
      recordFailedAttempt(clientKey);
      return error(res, 401, "INVALID_CREDENTIALS");
    }

    clearAttempts(clientKey);
    return json(res, 200, issueSession(user));
  }

  if (method === "POST" && url.pathname === "/v1/auth/refresh") {
    const body = await readJson(req);
    const token = String(body.refreshToken || "");
    const record = refreshTokens.get(token);

    if (!record || Date.now() >= record.expiresAt) {
      if (record) refreshTokens.delete(token);
      return error(res, 401, "AUTH_EXPIRED");
    }

    const user = findUserById(record.userId);
    if (!user) return error(res, 401, "AUTH_EXPIRED");

    refreshTokens.delete(token);
    return json(res, 200, issueSession(user));
  }

  if (method === "POST" && url.pathname === "/v1/auth/logout") {
    const body = await readJson(req);
    const refreshToken = String(body.refreshToken || "");
    refreshTokens.delete(refreshToken);

    const accessToken = bearerToken(req);
    if (accessToken) accessTokens.delete(accessToken);

    return json(res, 200, { loggedOut: true });
  }

  if (method === "GET" && url.pathname === "/v1/account/me") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    return json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan
      },
      quota: user.quota
    });
  }

  if (method === "GET" && url.pathname === "/v1/translation/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    return json(res, 200, translationJobs.status());
  }

  if (method === "POST" && url.pathname === "/v1/translation/jobs") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const key = idempotencyKey(req);
    if (!key) return error(res, 400, "BAD_REQUEST");

    const body = await readJson(req);

    try {
      const result = translationJobs.create(user.id, key, body);
      return json(res, result.created ? 201 : 200, result.job);
    } catch (err) {
      const code = err?.code || "TRANSLATION_FAILED";
      const status =
        code === "TRANSLATION_TOO_LARGE" ? 413 :
        code === "JOB_CONFLICT" ? 409 :
        code === "SERVICE_UNAVAILABLE" ? 503 :
        code === "JOB_NOT_FOUND" ? 404 :
        400;
      return error(res, status, code);
    }
  }

  const translationCancelMatch = url.pathname.match(/^\/v1\/translation\/jobs\/([^/]+)\/cancel$/);
  if (method === "POST" && translationCancelMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      const result = translationJobs.cancel(user.id, decodeURIComponent(translationCancelMatch[1]));
      return json(res, 200, result);
    } catch (err) {
      return error(res, err?.code === "JOB_NOT_FOUND" ? 404 : 400, err?.code || "TRANSLATION_FAILED");
    }
  }

  const translationJobMatch = url.pathname.match(/^\/v1\/translation\/jobs\/([^/]+)$/);
  if (method === "GET" && translationJobMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      return json(res, 200, translationJobs.get(user.id, decodeURIComponent(translationJobMatch[1])));
    } catch (err) {
      return error(res, err?.code === "JOB_NOT_FOUND" ? 404 : 400, err?.code || "TRANSLATION_FAILED");
    }
  }

  if (method === "GET" && url.pathname === "/v1/speech/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const providerReady = speechProvider.isConfigured();

    return json(res, 200, {
      ready: providerReady,
      code: providerReady ? "READY" : "CLOUD_PROVIDER_NOT_CONFIGURED",
      quota: {
        remainingMinutes: Math.max(0, user.quota.remainingMinutes - reservedMinutesForUser(user.id)),
        resetAt: user.quota.resetAt,
        plan: user.plan
      },
      limits: {
        maxAudioBytes: MAX_AUDIO_BYTES,
        maxDurationSeconds: MAX_DURATION_SECONDS
      },
      retention: {
        temporaryAudioHours: 1,
        transcriptDays: 0
      }
    });
  }

  if (method === "POST" && url.pathname === "/v1/speech/jobs") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const key = idempotencyKey(req);
    if (!key) return error(res, 400, "BAD_REQUEST");

    const body = await readJson(req);
    const input = validateCreateSpeechBody(body);

    if (!input.ok) {
      const status = input.code === "FILE_TOO_LARGE" ? 413 : input.code === "UNSUPPORTED_AUDIO" ? 415 : 400;
      return error(res, status, input.code);
    }

    if (input.clientJobId !== key) return error(res, 400, "BAD_REQUEST");

    const idemKey = user.id + ":" + key;
    const existingId = idempotency.get(idemKey);

    if (existingId) {
      const existing = jobs.get(existingId);
      if (!existing) {
        idempotency.delete(idemKey);
      } else {
        if (existing.fingerprint !== jobFingerprint(input)) {
          return error(res, 409, "JOB_CONFLICT");
        }
        return json(res, 200, publicJob(existing, { createResponse: true }));
      }
    }

    if (!speechProvider.isConfigured()) return error(res, 503, "SERVICE_UNAVAILABLE");

    const estimatedMinutes = Math.max(1, Math.ceil(input.audio.durationSeconds / 60));
    const available = Math.max(0, user.quota.remainingMinutes - reservedMinutesForUser(user.id));

    if (available < estimatedMinutes) {
      return error(res, 402, "QUOTA_EXCEEDED");
    }

    const job = {
      id: serverJobId(),
      userId: user.id,
      clientJobId: input.clientJobId,
      fingerprint: jobFingerprint(input),
      language: input.language,
      audio: input.audio,
      estimatedMinutes,
      reservedMinutes: estimatedMinutes,
      chargedMinutes: 0,
      state: "awaiting_upload",
      progress: 0,
      result: null,
      errorCode: null,
      uploadToken: null,
      uploadExpiresAt: null,
      processStarted: false,
      cancelRequested: false,
      controller: null,
      createdAt: new Date().toISOString()
    };

    jobs.set(job.id, job);
    idempotency.set(idemKey, job.id);

    return json(res, 201, publicJob(job, { createResponse: true }));
  }

  const uploadMatch = url.pathname.match(/^\/v1\/dev-upload\/([A-Za-z0-9_-]+)$/);
  if (method === "PUT" && uploadMatch) {
    return receiveUpload(req, res, uploadMatch[1]);
  }

  const commitMatch = url.pathname.match(/^\/v1\/speech\/jobs\/([^/]+)\/commit$/);
  if (method === "POST" && commitMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const job = findOwnedJob(user, decodeURIComponent(commitMatch[1]));
    if (!job) return error(res, 404, "JOB_NOT_FOUND");

    if (job.state === "awaiting_upload") return error(res, 409, "UPLOAD_INCOMPLETE");

    if (job.state === "uploaded") {
      await processSpeechJob(job);
    }

    return json(res, 200, publicJob(job));
  }

  const cancelMatch = url.pathname.match(/^\/v1\/speech\/jobs\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const job = findOwnedJob(user, decodeURIComponent(cancelMatch[1]));
    if (!job) return error(res, 404, "JOB_NOT_FOUND");

    if (["completed", "failed", "cancelled"].includes(job.state)) {
      return json(res, 200, { cancelled: job.state === "cancelled" });
    }

    job.cancelRequested = true;

    if (job.state === "processing" || job.state === "cancelling") {
      job.state = "cancelling";
      try { job.controller?.abort(); } catch {}
    } else {
      job.state = "cancelled";
      job.progress = 0;
      releaseReservation(job);
      cleanupUpload(job);
    }

    return json(res, 200, { cancelled: true });
  }

  const jobMatch = url.pathname.match(/^\/v1\/speech\/jobs\/([^/]+)$/);
  if (method === "GET" && jobMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const job = findOwnedJob(user, decodeURIComponent(jobMatch[1]));
    if (!job) return error(res, 404, "JOB_NOT_FOUND");

    return json(res, 200, publicJob(job));
  }

  return error(res, 404, "NOT_FOUND");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error("[DevBackend]", err?.code || err?.message || String(err));

    if (!res.headersSent) {
      const code = err?.code || "BAD_REQUEST";
      const status =
        code === "BODY_TOO_LARGE" || code === "FILE_TOO_LARGE" ? 413 :
        code === "UPLOAD_ABORTED" ? 400 :
        400;
      error(res, status, code);
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  const provider = speechProvider.config();

  console.log("");
  console.log("Viral AI Tool dev backend");
  console.log("Listening: http://" + HOST + ":" + PORT);
  console.log("Dev account:");
  console.log("  Email:    " + demo.email);
  console.log("  Password: " + demo.password);
  console.log("");
  console.log("Cloud speech: " + (speechProvider.isConfigured() ? "READY" : "NOT CONFIGURED"));
  if (speechProvider.isConfigured()) {
    console.log("Speech model: " + provider.model);
  } else {
    console.log("Set OPENAI_API_KEY before starting the backend to enable Cloud Speech.");
  }

  const translation = translationProvider.config();
  console.log("Cloud translation: " + (translationProvider.isConfigured() ? "READY" : "NOT CONFIGURED"));
  if (translationProvider.isConfigured()) {
    console.log("Translation model: " + translation.model);
  }
  console.log("");
  console.log("Development only. Do not expose this server to the public Internet.");
});
