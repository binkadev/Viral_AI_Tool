const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const speechProvider = require("./providers");
const translationProvider = require("./providers/translation");
const translationJobs = require("./translation-jobs");
const voiceProvider = require("./providers/voice");
const voiceJobs = require("./voice-jobs");
const billing = require("./billing");
const { createDurableStateStore } = require("./state-store");
const { createSqliteStateStore } = require("./state-store-sqlite");
const { createAuditLog } = require("./audit-log");
const {
  resolvePlan,
  publicEntitlements,
  assertFeature,
  assertService,
  assertConcurrentJobs,
  PLAN_DEFINITIONS,
  normalizePlanId,
  isKnownPlan
} = require("./entitlements");
const {
  createSubscription,
  publicSubscription,
  hasCloudAccess,
  reconcileSubscription,
  markPaymentFailed,
  markPaymentRecovered,
  requestPlanChange,
  requestCancellation,
  resumeCancellation,
  assertSubscriptionAccess
} = require("./subscriptions");

const HOST = "127.0.0.1";
const PORT = Number(process.env.VIRAL_AI_DEV_PORT || 3000);
const IS_PRODUCTION = String(process.env.VIRAL_AI_ENV || "development").toLowerCase() === "production";
const STATE_DRIVER = String(
  process.env.VIRAL_AI_STATE_DRIVER || (IS_PRODUCTION ? "sqlite" : "json")
).toLowerCase();
const TRUST_PROXY = String(process.env.VIRAL_AI_TRUST_PROXY || "false").toLowerCase() === "true";
const OPERATIONS_TOKEN = String(process.env.VIRAL_AI_OPERATIONS_TOKEN || "");

if (IS_PRODUCTION && STATE_DRIVER !== "sqlite") {
  throw new Error("Production mode requires VIRAL_AI_STATE_DRIVER=sqlite.");
}

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REFRESH_SESSIONS_PER_USER = 10;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LOGIN_ATTEMPTS = 8;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const GENERAL_RATE_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 240;
const MAX_SENSITIVE_REQUESTS_PER_WINDOW = 60;
const STALE_UPLOAD_JOB_MS = 24 * 60 * 60 * 1000;
const JOB_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = Math.max(
  1024 * 1024,
  Math.min(100 * 1024 * 1024, Number(process.env.VIRAL_AI_PROVIDER_MAX_AUDIO_BYTES || 24 * 1024 * 1024))
);
let shuttingDown = false;

const MAX_DURATION_SECONDS = Math.max(
  60,
  Math.min(4 * 60 * 60, Number(process.env.VIRAL_AI_MAX_AUDIO_SECONDS || 7200))
);

const DATA_DIR = process.env.VIRAL_AI_DEV_DATA_DIR
  ? path.resolve(process.env.VIRAL_AI_DEV_DATA_DIR)
  : path.join(__dirname, "data");
const BACKUP_DIR = path.resolve(
  process.env.VIRAL_AI_BACKUP_DIR || path.join(DATA_DIR, "backups")
);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(
  DATA_DIR,
  STATE_DRIVER === "sqlite" ? "state.sqlite" : "state.json"
);
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const durableState = STATE_DRIVER === "sqlite"
  ? createSqliteStateStore(STATE_FILE)
  : createDurableStateStore(STATE_FILE);
const auditLog = createAuditLog(AUDIT_FILE);

const users = new Map(
  Object.entries(durableState.get("users", {}))
);
const accessTokens = new Map();
const refreshTokens = new Map(
  Object.entries(durableState.get("refreshSessions", {}))
);
const loginAttempts = new Map();
const requestBuckets = new Map();
const jobs = new Map();
const idempotency = new Map();
const uploadTokens = new Map();
const serviceQuotaReservations = new Map();

function serializeSpeechJob(job) {
  if (!job) return null;
  const {
    controller,
    uploadToken,
    uploadExpiresAt,
    result,
    ...rest
  } = job;

  return {
    ...rest,
    controller: null,
    uploadToken: null,
    uploadExpiresAt: null,
    result: null,
    processStarted: false,
    cancelRequested: false
  };
}

function persistSpeechJobs() {
  const currentJobs = durableState.get("jobs", {});
  durableState.set("jobs", {
    ...currentJobs,
    speech: {
      jobs: Object.fromEntries(
        [...jobs.entries()].map(([id, job]) => [id, serializeSpeechJob(job)])
      ),
      idempotency: Object.fromEntries(idempotency.entries())
    }
  });
}

function restoreSpeechJobs() {
  const persisted = durableState.get("jobs", {})?.speech || {};
  jobs.clear();
  idempotency.clear();

  for (const [id, raw] of Object.entries(persisted.jobs || {})) {
    if (!raw || typeof raw !== "object") continue;

    const job = {
      ...raw,
      id,
      controller: null,
      uploadToken: null,
      uploadExpiresAt: null,
      processStarted: false,
      cancelRequested: false,
      result: null
    };

    if (
      ["settling", "settled"].includes(job.billingState) ||
      Number(job.chargedMinutes || 0) > 0 ||
      job.state === "completed"
    ) {
      job.state = "failed";
      job.errorCode = "RESULT_NOT_RETAINED";
      job.progress = 100;
      job.reservedMinutes = 0;
      job.recoveredAt = new Date().toISOString();
    } else if (["queued", "processing", "cancelling"].includes(job.state)) {
      const hasUpload = fs.existsSync(jobFilePath(id));
      if (hasUpload) {
        job.state = "uploaded";
        job.progress = 0;
      } else {
        job.state = "failed";
        job.errorCode = "SERVICE_RESTARTED";
        job.progress = 0;
        job.reservedMinutes = 0;
      }
      job.recoveredAt = new Date().toISOString();
    }

    jobs.set(id, job);
  }

  for (const [key, jobId] of Object.entries(persisted.idempotency || {})) {
    if (jobs.has(String(jobId))) idempotency.set(key, String(jobId));
  }

  persistSpeechJobs();
}

const processedBillingEvents = new Map(
  Object.entries(durableState.get("processedBillingEvents", {}))
    .map(([eventId, createdAt]) => [eventId, Number(createdAt || 0)])
);

function objectFromMap(map) {
  return Object.fromEntries(map.entries());
}

function persistUsers() {
  durableState.set("users", objectFromMap(users));
}

function persistRefreshSessions() {
  durableState.set("refreshSessions", objectFromMap(refreshTokens));
}

function persistBillingEvents() {
  durableState.set("processedBillingEvents", objectFromMap(processedBillingEvents));
}

function hashSessionToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + stableJson(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function gatewayJobFingerprint(service, body) {
  return crypto
    .createHash("sha256")
    .update(String(service || "") + ":" + stableJson(body || {}))
    .digest("hex");
}

function gatewayReceiptKey(userId, clientJobId) {
  return String(userId || "") + ":" + String(clientJobId || "");
}

function jobServiceState(service) {
  const all = durableState.get("jobs", {});
  return all?.[service] && typeof all[service] === "object"
    ? all[service]
    : { jobs: {}, idempotency: {} };
}

function getGatewayReceipt(service, userId, clientJobId) {
  const section = jobServiceState(service);
  return section.gatewayReceipts?.[gatewayReceiptKey(userId, clientJobId)] || null;
}

function saveGatewayReceipt(service, userId, clientJobId, receipt) {
  const all = durableState.get("jobs", {});
  const section = all?.[service] && typeof all[service] === "object"
    ? all[service]
    : { jobs: {}, idempotency: {} };
  const receipts = {
    ...(section.gatewayReceipts || {}),
    [gatewayReceiptKey(userId, clientJobId)]: {
      ...receipt,
      userId,
      clientJobId,
      updatedAt: new Date().toISOString()
    }
  };

  durableState.set("jobs", {
    ...all,
    [service]: {
      ...section,
      gatewayReceipts: receipts
    }
  });
}

function updateGatewayReceiptByJobId(service, jobId, patch = {}) {
  const all = durableState.get("jobs", {});
  const section = all?.[service];
  if (!section?.gatewayReceipts) return false;

  let changed = false;
  const receipts = { ...section.gatewayReceipts };

  for (const [key, receipt] of Object.entries(receipts)) {
    if (receipt?.jobId !== jobId) continue;
    receipts[key] = {
      ...receipt,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    changed = true;
  }

  if (changed) {
    durableState.set("jobs", {
      ...all,
      [service]: {
        ...section,
        gatewayReceipts: receipts
      }
    });
  }

  return changed;
}

function checkGatewayReceipt(service, userId, clientJobId, body) {
  const fingerprint = gatewayJobFingerprint(service, body);
  const receipt = getGatewayReceipt(service, userId, clientJobId);

  if (receipt && receipt.fingerprint !== fingerprint) {
    const err = new Error("Idempotency key was reused with different input.");
    err.code = "JOB_CONFLICT";
    throw err;
  }

  if (
    ["settling", "completed"].includes(receipt?.state) ||
    Number(receipt?.chargedMinutes || 0) > 0
  ) {
    const err = new Error("Completed job result was not retained by the gateway.");
    err.code = "JOB_RESULT_NOT_RETAINED";
    throw err;
  }

  return { fingerprint, receipt };
}

function operationsConfigured() {
  return OPERATIONS_TOKEN.length >= 32;
}

function operationsAuthorized(req) {
  if (!operationsConfigured()) return false;
  const candidate = String(req.headers?.["x-viral-ai-ops-token"] || "");
  return safeEqualText(candidate, OPERATIONS_TOKEN);
}

function speechOperationalSnapshot() {
  const states = {};
  for (const job of jobs.values()) {
    const state = String(job?.state || "unknown");
    states[state] = Number(states[state] || 0) + 1;
  }

  const active = [...jobs.values()].filter(job =>
    !["completed", "failed", "cancelled"].includes(job?.state)
  ).length;

  return {
    active,
    totalInMemory: jobs.size,
    states
  };
}

function latestBackupSummary(now = Date.now()) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return { configured: true, available: false, latest: null };
    }

    const candidates = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^state-backup-.*\.sqlite\.json$/.test(entry.name))
      .map(entry => {
        const manifestPath = path.join(BACKUP_DIR, entry.name);
        let manifest = null;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch {}
        const createdAt = Date.parse(manifest?.createdAt || "") || 0;
        return { entry, manifest, createdAt };
      })
      .filter(item => item.createdAt > 0)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (!candidates.length) {
      return { configured: true, available: false, latest: null };
    }

    const latest = candidates[0];
    return {
      configured: true,
      available: true,
      latest: {
        file: path.basename(String(latest.manifest?.file || latest.entry.name.replace(/\.json$/, ""))),
        createdAt: new Date(latest.createdAt).toISOString(),
        ageHours: Math.max(0, Number(((now - latest.createdAt) / 3600000).toFixed(2))),
        sizeBytes: Number(latest.manifest?.sizeBytes || 0),
        integrity: latest.manifest?.integrity === "ok" ? "ok" : "unknown"
      }
    };
  } catch {
    return { configured: true, available: false, latest: null, error: "BACKUP_STATUS_UNAVAILABLE" };
  }
}

function requestIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();

    if (/^[A-Fa-f0-9:.]{2,80}$/.test(forwarded)) {
      return forwarded;
    }
  }

  return String(req.socket?.remoteAddress || "unknown").slice(0, 120);
}

function audit(event, req, details = {}) {
  try {
    auditLog.write(event, {
      ip: req ? requestIp(req) : undefined,
      ...details
    });
  } catch (error) {
    console.error("[AuditLog]", error?.code || error?.message || String(error));
  }
}

billing.configurePersistence({
  load: () => durableState.get("billing", {}),
  save: value => durableState.set("billing", value)
});

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function seedUser() {
  if (IS_PRODUCTION) {
    if (users.size > 0) {
      return { email: null, password: null, production: true, created: false };
    }

    const email = String(process.env.VIRAL_AI_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
    const password = String(process.env.VIRAL_AI_BOOTSTRAP_PASSWORD || "");
    const requestedPlan = String(process.env.VIRAL_AI_BOOTSTRAP_PLAN || "free").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("Production bootstrap requires VIRAL_AI_BOOTSTRAP_EMAIL.");
    }
    if (password.length < 12) {
      throw new Error("Production bootstrap password must contain at least 12 characters.");
    }
    if (!isKnownPlan(requestedPlan)) {
      throw new Error("VIRAL_AI_BOOTSTRAP_PLAN is invalid.");
    }

    const plan = resolvePlan(requestedPlan);
    const salt = crypto.randomBytes(16).toString("hex");

    users.set(email, {
      id: "usr_" + newToken(12),
      email,
      name: String(process.env.VIRAL_AI_BOOTSTRAP_NAME || "Account Owner").trim().slice(0, 120),
      planId: plan.id,
      plan: plan.displayName,
      subscription: createSubscription({
        planId: plan.id,
        status: "active",
        now: Date.now(),
        periodDays: 30,
        graceDays: 3
      }),
      salt,
      passwordHash: hashPassword(password, salt),
      quota: {
        totalMinutes: plan.monthlyMinutes,
        usedMinutes: 0,
        remainingMinutes: plan.monthlyMinutes,
        resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      usage: {
        speechMinutes: 0,
        translationMinutes: 0,
        voiceMinutes: 0,
        exportMinutes: 0
      }
    });

    persistUsers();
    auditLog.write("auth.bootstrap.created", {
      userId: users.get(email).id,
      email,
      planId: plan.id
    });

    return { email, password: null, production: true, created: true };
  }

  const email = "demo@viral-ai.local";
  const password = "ViralAI123!";
  const salt = crypto.randomBytes(16).toString("hex");

  const plan = resolvePlan("creator_pro");
  const usedMinutes = 1500;

  const created = !users.has(email);
  if (created) users.set(email, {
    id: "dev-user-1",
    email,
    name: "Viral AI Dev",
    planId: plan.id,
    plan: plan.displayName,
    subscription: createSubscription({
      planId: plan.id,
      status: "active",
      now: Date.now(),
      periodDays: 30,
      graceDays: 3
    }),
    salt,
    passwordHash: hashPassword(password, salt),
    quota: {
      totalMinutes: plan.monthlyMinutes,
      usedMinutes,
      remainingMinutes: Math.max(0, plan.monthlyMinutes - usedMinutes),
      resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    usage: {
      speechMinutes: 720,
      translationMinutes: 390,
      voiceMinutes: 390,
      exportMinutes: 0
    }
  });

  persistUsers();
  return { email, password, production: false, created };
}

const demo = seedUser();
pruneRefreshSessions();
pruneBillingEvents();
billing.pruneExpiredSessions();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function html(res, status, body) {
  const value = String(body || "");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(value),
    "cache-control": "no-store"
  });
  res.end(value);
}

function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function binary(res, status, buffer, contentType = "application/octet-stream") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buffer.length,
    "cache-control": "no-store"
  });
  res.end(buffer);
}

function error(res, status, code) {
  return json(res, status, { error: { code } });
}

function billingSecret() {
  return String(process.env.VIRAL_AI_BILLING_WEBHOOK_SECRET || "").trim();
}

function pruneBillingEvents() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [eventId, createdAt] of processedBillingEvents.entries()) {
    if (createdAt < cutoff) {
      processedBillingEvents.delete(eventId);
      changed = true;
    }
  }
  if (changed) persistBillingEvents();
}

function safeEqualText(left, right) {
  try {
    const a = Buffer.from(String(left || ""), "utf8");
    const b = Buffer.from(String(right || ""), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function verifyBillingWebhook(req, rawBody) {
  const secret = billingSecret();
  if (!secret) {
    const error = new Error("Billing webhook is not configured.");
    error.code = "BILLING_NOT_CONFIGURED";
    throw error;
  }

  const timestamp = Number(req.headers["x-viral-ai-billing-timestamp"] || 0);
  const signature = String(req.headers["x-viral-ai-billing-signature"] || "").trim().toLowerCase();
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    const error = new Error("Billing webhook timestamp is invalid.");
    error.code = "BILLING_SIGNATURE_INVALID";
    throw error;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(rawBody)
    .digest("hex");

  if (!/^[a-f0-9]{64}$/.test(signature) || !safeEqualText(signature, expected)) {
    const error = new Error("Billing webhook signature is invalid.");
    error.code = "BILLING_SIGNATURE_INVALID";
    throw error;
  }
}

function requireKnownPlanId(value) {
  if (!isKnownPlan(value)) {
    const error = new Error("Billing plan is invalid.");
    error.code = "PLAN_INVALID";
    throw error;
  }
  return normalizePlanId(value);
}

function resetUserAllowance(user) {
  const plan = resolvePlan(effectivePlanId(user));
  user.quota = {
    totalMinutes: plan.monthlyMinutes,
    usedMinutes: 0,
    remainingMinutes: plan.monthlyMinutes,
    resetAt: user.subscription?.currentPeriodEnd || user.quota?.resetAt || null
  };
  user.usage = {
    speechMinutes: 0,
    translationMinutes: 0,
    voiceMinutes: 0,
    exportMinutes: 0
  };
  persistUsers();
}

function applyBillingEvent(event) {
  const eventId = String(event?.eventId || "").trim();
  const type = String(event?.type || "").trim();
  const userId = String(event?.userId || "").trim();

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(eventId) || !type || !userId) {
    const error = new Error("Billing event is invalid.");
    error.code = "BILLING_EVENT_INVALID";
    throw error;
  }

  pruneBillingEvents();
  if (processedBillingEvents.has(eventId)) {
    return { duplicate: true, eventId };
  }

  const user = findUserById(userId);
  if (!user) {
    const error = new Error("Billing user was not found.");
    error.code = "BILLING_USER_NOT_FOUND";
    throw error;
  }

  syncUserCommercialState(user);
  const now = Number.isFinite(Number(event.occurredAt))
    ? Number(event.occurredAt)
    : Date.now();

  if (type === "subscription.trial_started") {
    const planId = requireKnownPlanId(event.planId);
    user.subscription = createSubscription({
      planId,
      status: "trialing",
      now,
      trialDays: Math.max(1, Number(event.trialDays || 7)),
      periodDays: Math.max(1, Number(event.periodDays || 30))
    });
    user.planId = planId;
    user.plan = resolvePlan(planId).displayName;
    resetUserAllowance(user);
  } else if (type === "subscription.activated") {
    const planId = requireKnownPlanId(event.planId || effectivePlanId(user));
    user.subscription = createSubscription({
      planId,
      status: "active",
      now,
      periodDays: Math.max(1, Number(event.periodDays || 30))
    });
    user.planId = planId;
    user.plan = resolvePlan(planId).displayName;
    resetUserAllowance(user);
  } else if (type === "payment.failed") {
    markPaymentFailed(user.subscription, { now });
  } else if (type === "payment.recovered") {
    markPaymentRecovered(user.subscription, { now });
  } else if (type === "subscription.plan_changed") {
    const planId = requireKnownPlanId(event.planId);
    const direction = event.effective === "period_end" ? "downgrade" : "upgrade";
    requestPlanChange(user.subscription, planId, { direction, now });
    syncUserCommercialState(user, now);
  } else if (type === "subscription.cancel_requested") {
    requestCancellation(user.subscription, { now, immediately: false });
  } else if (type === "subscription.cancelled") {
    requestCancellation(user.subscription, { now, immediately: true });
  } else {
    const error = new Error("Billing event type is unsupported.");
    error.code = "BILLING_EVENT_UNSUPPORTED";
    throw error;
  }

  syncUserCommercialState(user, now);
  processedBillingEvents.set(eventId, Date.now());
  persistBillingEvents();
  persistUsers();

  return {
    duplicate: false,
    eventId,
    userId: user.id,
    subscription: publicSubscription(user.subscription),
    planId: user.planId
  };
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

function trimRefreshSessionsForUser(userId) {
  const sessions = [...refreshTokens.entries()]
    .filter(([, record]) => record?.userId === userId)
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));

  let changed = false;
  for (const [key] of sessions.slice(MAX_REFRESH_SESSIONS_PER_USER - 1)) {
    refreshTokens.delete(key);
    changed = true;
  }
  if (changed) persistRefreshSessions();
}

function issueSession(user, { req = null, sessionId = null, createdAt = null } = {}) {
  syncUserCommercialState(user);
  pruneRefreshSessions();
  trimRefreshSessionsForUser(user.id);

  const accessToken = newToken();
  const refreshToken = newToken();
  const accessExpiresAt = tokenExpiry(ACCESS_TTL_MS);
  const refreshExpiresAt = tokenExpiry(REFRESH_TTL_MS);
  const resolvedSessionId = sessionId || ("ses_" + newToken(12));
  const now = Date.now();

  const clientName = String(req?.headers?.["x-viral-ai-client"] || "unknown").slice(0, 80);
  const clientVersion = String(req?.headers?.["x-viral-ai-version"] || "unknown").slice(0, 80);

  accessTokens.set(accessToken, {
    userId: user.id,
    sessionId: resolvedSessionId,
    expiresAt: Date.parse(accessExpiresAt)
  });
  refreshTokens.set(hashSessionToken(refreshToken), {
    userId: user.id,
    sessionId: resolvedSessionId,
    expiresAt: Date.parse(refreshExpiresAt),
    createdAt: Number(createdAt || now),
    lastUsedAt: now,
    clientName,
    clientVersion
  });
  persistRefreshSessions();

  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      planId: user.planId || resolvePlan(user.plan).id,
      plan: user.plan
    }
  };
}

function findUserById(userId) {
  return [...users.values()].find(user => user.id === userId) || null;
}

function effectivePlanId(user) {
  return String(user?.subscription?.planId || user?.planId || resolvePlan(user?.plan).id);
}

function syncUserCommercialState(user, now = Date.now()) {
  if (!user) return null;

  if (!user.subscription) {
    user.subscription = createSubscription({
      planId: user.planId || resolvePlan(user.plan).id,
      status: "active",
      now
    });
  }

  const previousPlanId = String(user.planId || resolvePlan(user.plan).id);
  const previousPeriodEnd = user.subscription.currentPeriodEnd || null;
  const result = reconcileSubscription(user.subscription, { now });
  const plan = resolvePlan(effectivePlanId(user));

  user.planId = plan.id;
  user.plan = plan.displayName;

  const periodChanged =
    result.periodRolled === true ||
    previousPeriodEnd !== user.subscription.currentPeriodEnd;

  if (periodChanged) {
    user.quota = {
      totalMinutes: plan.monthlyMinutes,
      usedMinutes: 0,
      remainingMinutes: plan.monthlyMinutes,
      resetAt: user.subscription.currentPeriodEnd
    };
    user.usage = {
      speechMinutes: 0,
      translationMinutes: 0,
      voiceMinutes: 0,
      exportMinutes: 0
    };
  } else if (previousPlanId !== plan.id) {
    const used = Math.max(0, Number(user.quota?.usedMinutes || 0));
    user.quota.totalMinutes = plan.monthlyMinutes;
    user.quota.remainingMinutes = Math.max(0, plan.monthlyMinutes - used);
    user.quota.resetAt = user.subscription.currentPeriodEnd || user.quota.resetAt;
  } else if (user.quota) {
    user.quota.totalMinutes = plan.monthlyMinutes;
    user.quota.remainingMinutes = Math.max(
      0,
      Number(user.quota.totalMinutes || 0) - Number(user.quota.usedMinutes || 0)
    );
    user.quota.resetAt = user.subscription.currentPeriodEnd || user.quota.resetAt;
  }

  persistUsers();

  return {
    plan,
    subscription: user.subscription,
    hasCloudAccess: hasCloudAccess(user.subscription, now)
  };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function currentAccessRecord(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const record = accessTokens.get(token);
  if (!record || Date.now() >= Number(record.expiresAt || 0)) return null;
  return record;
}

function publicSessionsForUser(userId, currentSessionId = null) {
  pruneRefreshSessions();

  const byId = new Map();
  for (const record of refreshTokens.values()) {
    if (record?.userId !== userId || !record.sessionId) continue;

    const existing = byId.get(record.sessionId);
    if (!existing || Number(record.lastUsedAt || 0) > Number(existing.lastUsedAt || 0)) {
      byId.set(record.sessionId, record);
    }
  }

  return [...byId.values()]
    .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0))
    .map(record => ({
      id: record.sessionId,
      clientName: record.clientName || "unknown",
      clientVersion: record.clientVersion || "unknown",
      createdAt: new Date(Number(record.createdAt || 0)).toISOString(),
      lastUsedAt: new Date(Number(record.lastUsedAt || record.createdAt || 0)).toISOString(),
      expiresAt: new Date(Number(record.expiresAt || 0)).toISOString(),
      current: record.sessionId === currentSessionId
    }));
}

function revokeSession(userId, sessionId) {
  const target = String(sessionId || "");
  let removed = false;

  for (const [key, record] of refreshTokens.entries()) {
    if (record?.userId === userId && record?.sessionId === target) {
      refreshTokens.delete(key);
      removed = true;
    }
  }

  for (const [token, record] of accessTokens.entries()) {
    if (record?.userId === userId && record?.sessionId === target) {
      accessTokens.delete(token);
      removed = true;
    }
  }

  if (removed) persistRefreshSessions();
  return removed;
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

function pruneRefreshSessions(now = Date.now()) {
  let changed = false;

  for (const [key, record] of refreshTokens.entries()) {
    if (!record || Number(record.expiresAt || 0) <= now) {
      refreshTokens.delete(key);
      changed = true;
    }
  }

  if (changed) persistRefreshSessions();
}

function requestRateLimited(req, scope = "general", limit = MAX_REQUESTS_PER_WINDOW, windowMs = GENERAL_RATE_WINDOW_MS) {
  const now = Date.now();
  const key = scope + ":" + requestIp(req);
  const bucket = (requestBuckets.get(key) || []).filter(timestamp => now - timestamp < windowMs);

  if (bucket.length >= limit) {
    requestBuckets.set(key, bucket);
    return true;
  }

  bucket.push(now);
  requestBuckets.set(key, bucket);
  return false;
}

function pruneRequestBuckets(now = Date.now()) {
  for (const [key, bucket] of requestBuckets.entries()) {
    const active = (bucket || []).filter(timestamp => now - timestamp < RATE_WINDOW_MS);
    if (active.length) requestBuckets.set(key, active);
    else requestBuckets.delete(key);
  }
}

function pruneSpeechJobHistory(now = Date.now()) {
  let changed = false;
  const removedIds = new Set();

  for (const [jobId, job] of jobs.entries()) {
    const createdAt = Date.parse(job?.createdAt || "") || 0;
    const completedAt = Date.parse(job?.completedAt || "") || createdAt;
    const terminal = ["completed", "failed", "cancelled"].includes(job?.state);

    if (
      job?.state === "awaiting_upload" &&
      createdAt > 0 &&
      now - createdAt > STALE_UPLOAD_JOB_MS
    ) {
      job.reservedMinutes = 0;
      cleanupUpload(job);
      jobs.delete(jobId);
      removedIds.add(jobId);
      changed = true;
      continue;
    }

    if (terminal && completedAt > 0 && now - completedAt > JOB_RECEIPT_TTL_MS) {
      cleanupUpload(job);
      jobs.delete(jobId);
      removedIds.add(jobId);
      changed = true;
    }
  }

  if (removedIds.size) {
    for (const [key, jobId] of idempotency.entries()) {
      if (removedIds.has(jobId)) {
        idempotency.delete(key);
        changed = true;
      }
    }
  }

  if (changed) persistSpeechJobs();
}

function pruneGatewayReceipts(now = Date.now()) {
  const all = durableState.get("jobs", {});
  let changed = false;
  const next = { ...all };

  for (const service of ["translation", "voice"]) {
    const section = all?.[service];
    if (!section?.gatewayReceipts) continue;

    const receipts = {};
    for (const [key, receipt] of Object.entries(section.gatewayReceipts)) {
      const updatedAt = Date.parse(receipt?.updatedAt || receipt?.createdAt || "") || 0;
      if (updatedAt > 0 && now - updatedAt <= JOB_RECEIPT_TTL_MS) {
        receipts[key] = receipt;
      } else {
        changed = true;
      }
    }

    next[service] = {
      ...section,
      gatewayReceipts: receipts
    };
  }

  if (changed) durableState.set("jobs", next);
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

function activeCloudJobsForUser(userId) {
  let total = 0;

  for (const job of jobs.values()) {
    if (job.userId === userId && activeJobState(job.state)) total++;
  }

  for (const reservation of serviceQuotaReservations.values()) {
    if (reservation.userId === userId) total++;
  }

  return total;
}

function assertCloudJobAllowed(user, service) {
  if (!user) {
    const error = new Error("Authentication is required.");
    error.code = "AUTH_REQUIRED";
    throw error;
  }

  syncUserCommercialState(user);
  assertSubscriptionAccess(user.subscription);
  const planRef = effectivePlanId(user);
  assertService(planRef, service);
  assertConcurrentJobs(planRef, activeCloudJobsForUser(user.id));
  return publicEntitlements(planRef);
}

function allowedVoiceCatalog(user) {
  const entitlements = publicEntitlements(user?.planId || user?.plan);
  const allowedTiers = new Set(entitlements.models?.voice || []);

  return voiceProvider.publicCatalog().filter(voice =>
    allowedTiers.has(String(voice?.tier || "standard"))
  );
}

function assertVoiceSelectionAllowed(user, voiceId) {
  const requested = String(voiceId || "").trim();
  if (!requested) return true;

  const voice = voiceProvider.publicCatalog().find(item => String(item.id) === requested);
  if (!voice) {
    const error = new Error("Voice is not available.");
    error.code = "VOICE_NOT_FOUND";
    throw error;
  }

  const entitlements = publicEntitlements(user?.planId || user?.plan);
  const allowedTiers = new Set(entitlements.models?.voice || []);
  const tier = String(voice.tier || "standard");

  if (!allowedTiers.has(tier)) {
    const error = new Error("This voice tier is not included in the current plan.");
    error.code = "MODEL_NOT_INCLUDED";
    error.details = {
      voiceId: requested,
      tier,
      planId: entitlements.planId
    };
    throw error;
  }

  return true;
}

function belongsToCurrentBillingPeriod(user, billingPeriodEnd) {
  if (!billingPeriodEnd || !user?.subscription?.currentPeriodEnd) return true;
  return String(billingPeriodEnd) === String(user.subscription.currentPeriodEnd);
}

function reservedMinutesForUser(userId) {
  let total = 0;
  const user = findUserById(userId);

  for (const job of jobs.values()) {
    if (
      job.userId === userId &&
      activeJobState(job.state) &&
      belongsToCurrentBillingPeriod(user, job.billingPeriodEnd)
    ) {
      total += Number(job.reservedMinutes || 0);
    }
  }

  for (const reservation of serviceQuotaReservations.values()) {
    if (
      reservation.userId === userId &&
      belongsToCurrentBillingPeriod(user, reservation.billingPeriodEnd)
    ) {
      total += Number(reservation.minutes || 0);
    }
  }

  return total;
}

function quotaUsageKey(service) {
  if (service === "speech") return "speechMinutes";
  if (service === "translation") return "translationMinutes";
  if (service === "voice") return "voiceMinutes";
  return null;
}

function chargeUserQuota(user, service, minutes) {
  if (!user) return 0;
  const requested = Math.max(0, Number(minutes || 0));
  const available = Math.max(0, Number(user.quota?.remainingMinutes || 0));
  const charge = Math.min(requested, available);

  user.quota.remainingMinutes = Math.max(0, available - charge);
  user.quota.usedMinutes = Math.max(0, Number(user.quota?.usedMinutes || 0) + charge);

  const usageKey = quotaUsageKey(service);
  if (usageKey) {
    user.usage = user.usage || {};
    user.usage[usageKey] = Math.max(0, Number(user.usage[usageKey] || 0) + charge);
  }

  persistUsers();
  return charge;
}

function quotaSnapshot(user) {
  if (!user) return null;
  const reservedMinutes = reservedMinutesForUser(user.id);

  return {
    ...user.quota,
    remainingMinutes: Math.max(0, Number(user.quota?.remainingMinutes || 0) - reservedMinutes),
    reservedMinutes
  };
}

function quotaReservationKey(service, jobId) {
  return String(service || "cloud") + ":" + String(jobId || "");
}

function reserveCloudQuota({ userId, service, jobId, minutes }) {
  const user = findUserById(userId);
  if (!user) {
    const err = new Error("User was not found.");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  syncUserCommercialState(user);

  const key = quotaReservationKey(service, jobId);
  const existing = serviceQuotaReservations.get(key);
  if (existing) return { minutes: existing.minutes };

  assertCloudJobAllowed(user, service);

  const requested = Math.max(1, Math.ceil(Number(minutes || 0)));
  const available = Math.max(
    0,
    Number(user.quota?.remainingMinutes || 0) - reservedMinutesForUser(userId)
  );

  if (available < requested) {
    const err = new Error("Cloud allowance is insufficient.");
    err.code = "QUOTA_EXCEEDED";
    err.details = { requiredMinutes: requested, availableMinutes: available };
    throw err;
  }

  serviceQuotaReservations.set(key, {
    userId,
    service,
    jobId,
    minutes: requested,
    billingPeriodEnd: user.subscription?.currentPeriodEnd || user.quota?.resetAt || null,
    createdAt: Date.now()
  });

  return { minutes: requested };
}

function settleCloudQuota({ userId, service, jobId, outcome }) {
  const key = quotaReservationKey(service, jobId);
  const reservation = serviceQuotaReservations.get(key);
  if (!reservation) return { chargedMinutes: 0 };

  serviceQuotaReservations.delete(key);

  if (outcome !== "completed") {
    return { chargedMinutes: 0 };
  }

  const user = findUserById(userId);
  if (!user) return { chargedMinutes: 0 };

  syncUserCommercialState(user);

  if (!belongsToCurrentBillingPeriod(user, reservation.billingPeriodEnd)) {
    return {
      chargedMinutes: reservation.minutes,
      chargedToCurrentPeriod: false
    };
  }

  const chargedMinutes = chargeUserQuota(user, service, reservation.minutes);
  return { chargedMinutes, chargedToCurrentPeriod: true };
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
  persistSpeechJobs();
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
  persistSpeechJobs();

  setImmediate(async () => {
    if (job.cancelRequested) {
      job.state = "cancelled";
      releaseReservation(job);
      cleanupUpload(job);
      persistSpeechJobs();
      return;
    }

    job.state = "processing";
    job.progress = null;
    job.controller = new AbortController();
    persistSpeechJobs();

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

      syncUserCommercialState(user);
      const requestedCharge = Math.max(1, Number(job.reservedMinutes || job.estimatedMinutes || 1));

      job.billingState = "settling";
      persistSpeechJobs();

      const charge = belongsToCurrentBillingPeriod(user, job.billingPeriodEnd)
        ? chargeUserQuota(user, "speech", requestedCharge)
        : requestedCharge;

      job.chargedMinutes = charge;
      job.reservedMinutes = 0;
      job.billingState = "settled";
      job.result = result;
      job.state = "completed";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      persistSpeechJobs();
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
      persistSpeechJobs();
    } finally {
      job.controller = null;
      cleanupUpload(job);
      persistSpeechJobs();
    }
  });
}

translationJobs.configureQuotaHooks({
  reserve: reserveCloudQuota,
  settle: payload => {
    if (payload.outcome === "completed") {
      updateGatewayReceiptByJobId("translation", payload.jobId, {
        state: "settling"
      });
    }

    const result = settleCloudQuota(payload);
    updateGatewayReceiptByJobId("translation", payload.jobId, {
      state: payload.outcome,
      chargedMinutes: Number(result?.chargedMinutes || 0)
    });
    return result;
  }
});

voiceJobs.configureQuotaHooks({
  reserve: reserveCloudQuota,
  settle: payload => {
    if (payload.outcome === "completed") {
      updateGatewayReceiptByJobId("voice", payload.jobId, {
        state: "settling"
      });
    }

    const result = settleCloudQuota(payload);
    updateGatewayReceiptByJobId("voice", payload.jobId, {
      state: payload.outcome,
      chargedMinutes: Number(result?.chargedMinutes || 0)
    });
    return result;
  }
});

restoreSpeechJobs();
for (const job of jobs.values()) {
  if (job.state === "uploaded" && fs.existsSync(jobFilePath(job.id))) {
    setImmediate(() => processSpeechJob(job));
  }
}

async function handle(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || HOST));
  const method = req.method || "GET";

  if (shuttingDown && url.pathname !== "/health") {
    return error(res, 503, "SERVER_SHUTTING_DOWN");
  }

  if (method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "viral-ai-dev-backend",
      speechProviderConfigured: speechProvider.isConfigured(),
      translationProviderConfigured: translationProvider.isConfigured(),
      voiceProviderConfigured: voiceProvider.isConfigured(),
      durableState: true,
      stateDriver: STATE_DRIVER,
      environment: IS_PRODUCTION ? "production" : "development",
      trustProxy: TRUST_PROXY,
      stateRecovered: Boolean(durableState.recovery?.()),
      shuttingDown
    });
  }

  if (requestRateLimited(req, "general")) {
    audit("rate_limit.general", req, { method, path: url.pathname });
    return error(res, 429, "RATE_LIMITED");
  }

  if (IS_PRODUCTION && url.pathname.startsWith("/v1/billing/")) {
    return error(res, 503, "BILLING_PROVIDER_NOT_CONFIGURED");
  }

  const devCheckoutMatch = url.pathname.match(/^\/v1\/dev-billing\/checkout\/([^/]+)$/);
  if (!IS_PRODUCTION && method === "GET" && devCheckoutMatch) {
    try {
      const session = billing.consumeCheckoutSession(decodeURIComponent(devCheckoutMatch[1]));
      const user = findUserById(session.userId);
      if (!user) return html(res, 404, "<h1>Billing account not found</h1>");

      syncUserCommercialState(user);
      const targetPlanId = requireKnownPlanId(session.targetPlanId);
      const targetPlan = resolvePlan(targetPlanId);

      if (user.subscription?.status === "canceled") {
        user.subscription = createSubscription({
          planId: targetPlanId,
          status: "active",
          now: Date.now(),
          periodDays: 30,
          graceDays: 3
        });
        user.planId = targetPlan.id;
        user.plan = targetPlan.displayName;
        resetUserAllowance(user);
      } else {
        requestPlanChange(user.subscription, targetPlanId, {
          direction: "upgrade",
          now: Date.now()
        });
        syncUserCommercialState(user);
      }

      const price = billing.checkoutAmount(targetPlanId);
      billing.recordInvoice({
        userId: user.id,
        planId: targetPlanId,
        amount: price.monthlyAmount,
        currency: price.currency,
        status: "paid",
        description: "Development checkout"
      });
      persistUsers();
      audit("billing.checkout.completed", req, {
        userId: user.id,
        planId: targetPlanId,
        amount: price.monthlyAmount,
        currency: price.currency
      });

      return html(res, 200,
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Viral AI Tool Billing</title>" +
        "<style>body{font-family:system-ui;background:#f5f7fb;color:#182033;padding:48px}main{max-width:640px;margin:auto;background:white;padding:32px;border-radius:20px;box-shadow:0 16px 50px #1d2a4420}h1{margin-top:0}.ok{font-size:42px}p{line-height:1.6;color:#5a6578}</style></head><body><main>" +
        "<div class=\"ok\">✓</div><h1>Development checkout completed</h1><p>Your plan is now <b>" +
        escapeHtmlText(targetPlan.displayName) +
        "</b>.</p><p>Return to Viral AI Tool and refresh Billing or Usage. This page is part of the local development billing adapter and is not a production payment screen.</p>" +
        "</main></body></html>"
      );
    } catch (err) {
      return html(res, 400,
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Billing error</title></head><body><h1>Checkout could not be completed</h1><p>" +
        escapeHtmlText(err?.code || "BILLING_REQUEST_FAILED") +
        "</p></body></html>"
      );
    }
  }

  const devPortalMatch = url.pathname.match(/^\/v1\/dev-billing\/portal\/([^/]+)$/);
  if (!IS_PRODUCTION && method === "GET" && devPortalMatch) {
    try {
      const session = billing.consumePortalSession(decodeURIComponent(devPortalMatch[1]));
      const user = findUserById(session.userId);
      if (!user) return html(res, 404, "<h1>Billing account not found</h1>");

      syncUserCommercialState(user);
      const records = billing.listInvoices(user).invoices;
      const rows = records.length
        ? records.map(item =>
            "<tr><td>" + escapeHtmlText(new Date(item.createdAt).toLocaleDateString()) +
            "</td><td>" + escapeHtmlText(item.planName) +
            "</td><td>" + escapeHtmlText((item.amount / 100).toFixed(2) + " " + item.currency) +
            "</td><td>" + escapeHtmlText(item.status) + "</td></tr>"
          ).join("")
        : "<tr><td colspan=\"4\">No invoices yet.</td></tr>";

      return html(res, 200,
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Viral AI Tool Billing Portal</title>" +
        "<style>body{font-family:system-ui;background:#f5f7fb;color:#182033;padding:48px}main{max-width:800px;margin:auto;background:white;padding:32px;border-radius:20px;box-shadow:0 16px 50px #1d2a4420}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e9edf5}p{color:#5a6578}</style></head><body><main>" +
        "<h1>Development billing portal</h1><p>Current plan: <b>" + escapeHtmlText(user.plan) +
        "</b> · Subscription: <b>" + escapeHtmlText(user.subscription?.status || "unknown") +
        "</b></p><p>This is the provider-neutral development portal. A production provider adapter will replace this page.</p>" +
        "<h2>Invoices</h2><table><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody>" +
        rows + "</tbody></table></main></body></html>"
      );
    } catch (err) {
      return html(res, 400, "<h1>Billing portal unavailable</h1><p>" + escapeHtmlText(err?.code || "BILLING_REQUEST_FAILED") + "</p>");
    }
  }

  if (method === "GET" && url.pathname === "/v1/billing/catalog") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);
    return json(res, 200, {
      ...billing.publicCatalog(),
      currentPlanId: effectivePlanId(user),
      subscription: {
        ...publicSubscription(user.subscription),
        planName: user.plan,
        pendingPlanName: user.subscription?.pendingPlanId
          ? resolvePlan(user.subscription.pendingPlanId).displayName
          : null
      }
    });
  }

  if (method === "POST" && url.pathname === "/v1/billing/checkout-session") {
    if (requestRateLimited(req, "billing-action", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_action", req, { action: "checkout" });
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      syncUserCommercialState(user);
      const body = await readJson(req);
      const targetPlanId = requireKnownPlanId(body.planId);
      const baseUrl = "http://" + (req.headers.host || (HOST + ":" + PORT));
      const session = billing.createCheckoutSession({
        userId: user.id,
        currentPlanId: effectivePlanId(user),
        targetPlanId,
        baseUrl
      });
      audit("billing.checkout.created", req, {
        userId: user.id,
        fromPlanId: effectivePlanId(user),
        targetPlanId
      });
      return json(res, 201, session);
    } catch (err) {
      const code = err?.code || "BILLING_REQUEST_FAILED";
      const status =
        code === "BILLING_PLAN_ALREADY_ACTIVE" ? 409 :
        ["PLAN_INVALID", "BILLING_USE_PLAN_CHANGE"].includes(code) ? 400 :
        400;
      return error(res, status, code);
    }
  }

  if (method === "POST" && url.pathname === "/v1/billing/plan-change") {
    if (requestRateLimited(req, "billing-action", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_action", req, { action: "plan_change" });
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      syncUserCommercialState(user);
      const body = await readJson(req);
      const targetPlanId = requireKnownPlanId(body.planId);
      const currentPlanId = effectivePlanId(user);

      if (targetPlanId === currentPlanId) return error(res, 409, "BILLING_PLAN_ALREADY_ACTIVE");
      if (billing.rank(targetPlanId) >= billing.rank(currentPlanId)) {
        return error(res, 400, "BILLING_CHECKOUT_REQUIRED");
      }

      requestPlanChange(user.subscription, targetPlanId, {
        direction: "downgrade",
        now: Date.now()
      });
      syncUserCommercialState(user);
      persistUsers();
      audit("billing.plan_change.scheduled", req, {
        userId: user.id,
        fromPlanId: currentPlanId,
        targetPlanId
      });

      return json(res, 200, {
        scheduled: true,
        subscription: {
          ...publicSubscription(user.subscription),
          planName: user.plan,
          pendingPlanName: resolvePlan(targetPlanId).displayName
        }
      });
    } catch (err) {
      return error(res, 400, err?.code || "BILLING_REQUEST_FAILED");
    }
  }

  if (method === "POST" && url.pathname === "/v1/billing/cancel") {
    if (requestRateLimited(req, "billing-action", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_action", req, { action: "cancel" });
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      syncUserCommercialState(user);
      requestCancellation(user.subscription, { now: Date.now(), immediately: false });
      persistUsers();
      audit("billing.cancel.scheduled", req, { userId: user.id, planId: effectivePlanId(user) });
      return json(res, 200, {
        scheduled: true,
        subscription: publicSubscription(user.subscription)
      });
    } catch (err) {
      return error(res, 400, err?.code || "BILLING_REQUEST_FAILED");
    }
  }

  if (method === "POST" && url.pathname === "/v1/billing/resume") {
    if (requestRateLimited(req, "billing-action", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_action", req, { action: "resume" });
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      syncUserCommercialState(user);
      resumeCancellation(user.subscription, { now: Date.now() });
      persistUsers();
      audit("billing.cancel.resumed", req, { userId: user.id, planId: effectivePlanId(user) });
      return json(res, 200, {
        resumed: true,
        subscription: publicSubscription(user.subscription)
      });
    } catch (err) {
      return error(
        res,
        err?.code === "SUBSCRIPTION_INACTIVE" ? 409 : 400,
        err?.code || "BILLING_REQUEST_FAILED"
      );
    }
  }

  if (method === "POST" && url.pathname === "/v1/billing/portal-session") {
    if (requestRateLimited(req, "billing-action", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_action", req, { action: "portal" });
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const baseUrl = "http://" + (req.headers.host || (HOST + ":" + PORT));
    const session = billing.createPortalSession({
      userId: user.id,
      baseUrl
    });
    audit("billing.portal.created", req, { userId: user.id });
    return json(res, 201, session);
  }

  if (method === "GET" && url.pathname === "/v1/billing/invoices") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);
    return json(res, 200, billing.listInvoices(user));
  }

  if (method === "POST" && url.pathname === "/v1/internal/billing/events") {
    if (requestRateLimited(req, "billing-webhook", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.billing_webhook", req, {});
      return error(res, 429, "RATE_LIMITED");
    }

    try {
      const rawBody = await readRawBody(req);
      verifyBillingWebhook(req, rawBody);

      let event;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return error(res, 400, "BILLING_EVENT_INVALID");
      }

      const result = applyBillingEvent(event);
      audit("billing.webhook.accepted", req, {
        eventId: result.eventId,
        userId: result.userId || null,
        duplicate: result.duplicate === true,
        type: event?.type || null
      });
      return json(res, 200, result);
    } catch (err) {
      audit("billing.webhook.rejected", req, { code: err?.code || "BILLING_EVENT_INVALID" });
      const code = err?.code || "BILLING_EVENT_INVALID";
      const status =
        code === "BILLING_NOT_CONFIGURED" ? 503 :
        code === "BILLING_SIGNATURE_INVALID" ? 401 :
        code === "BILLING_USER_NOT_FOUND" ? 404 :
        code === "BILLING_EVENT_UNSUPPORTED" ? 422 :
        400;
      return error(res, status, code);
    }
  }

  if (method === "POST" && url.pathname === "/v1/auth/login") {
    const clientKey = requestIp(req);
    if (
      requestRateLimited(req, "auth-login", MAX_SENSITIVE_REQUESTS_PER_WINDOW) ||
      rateLimited(clientKey)
    ) {
      audit("auth.login.rate_limited", req, {});
      return error(res, 429, "RATE_LIMITED");
    }

    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = users.get(email);

    const candidateHash = user
      ? hashPassword(password, user.salt)
      : hashPassword(password || "invalid", "00000000000000000000000000000000");

    if (!user || !safeEqualHex(candidateHash, user.passwordHash)) {
      recordFailedAttempt(clientKey);
      audit("auth.login.failed", req, { email });
      return error(res, 401, "INVALID_CREDENTIALS");
    }

    clearAttempts(clientKey);
    const session = issueSession(user, { req });
    audit("auth.login.succeeded", req, { userId: user.id, email: user.email });
    return json(res, 200, session);
  }

  if (method === "POST" && url.pathname === "/v1/auth/refresh") {
    if (requestRateLimited(req, "auth-refresh", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("auth.refresh.rate_limited", req, {});
      return error(res, 429, "RATE_LIMITED");
    }

    const body = await readJson(req);
    const token = String(body.refreshToken || "");
    const tokenKey = hashSessionToken(token);
    pruneRefreshSessions();

    const record = refreshTokens.get(tokenKey);

    if (!record || Date.now() >= record.expiresAt) {
      if (record) {
        refreshTokens.delete(tokenKey);
        persistRefreshSessions();
      }
      audit("auth.refresh.failed", req, { code: "AUTH_EXPIRED" });
      return error(res, 401, "AUTH_EXPIRED");
    }

    const user = findUserById(record.userId);
    if (!user) {
      refreshTokens.delete(tokenKey);
      persistRefreshSessions();
      audit("auth.refresh.failed", req, { code: "AUTH_EXPIRED" });
      return error(res, 401, "AUTH_EXPIRED");
    }

    refreshTokens.delete(tokenKey);
    persistRefreshSessions();
    const session = issueSession(user, {
      req,
      sessionId: record.sessionId || null,
      createdAt: record.createdAt || Date.now()
    });
    audit("auth.refresh.succeeded", req, {
      userId: user.id,
      sessionId: record.sessionId || null
    });
    return json(res, 200, session);
  }

  if (method === "POST" && url.pathname === "/v1/auth/logout") {
    const user = authenticate(req);
    const body = await readJson(req);
    const refreshToken = String(body.refreshToken || "");

    if (refreshToken) refreshTokens.delete(hashSessionToken(refreshToken));
    persistRefreshSessions();

    const accessToken = bearerToken(req);
    if (accessToken) accessTokens.delete(accessToken);

    audit("auth.logout", req, { userId: user?.id || null });
    return json(res, 200, { loggedOut: true });
  }

  if (method === "GET" && url.pathname === "/v1/account/sessions") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const current = currentAccessRecord(req);
    return json(res, 200, {
      sessions: publicSessionsForUser(user.id, current?.sessionId || null)
    });
  }

  const sessionDeleteMatch = url.pathname.match(/^\/v1\/account\/sessions\/([A-Za-z0-9._-]{8,160})$/);
  if (method === "DELETE" && sessionDeleteMatch) {
    if (requestRateLimited(req, "session-revoke", MAX_SENSITIVE_REQUESTS_PER_WINDOW)) {
      audit("rate_limit.session_revoke", req, {});
      return error(res, 429, "RATE_LIMITED");
    }

    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const sessionId = sessionDeleteMatch[1];
    const current = currentAccessRecord(req);
    const removed = revokeSession(user.id, sessionId);

    audit("auth.session.revoked", req, {
      userId: user.id,
      sessionId,
      current: current?.sessionId === sessionId
    });

    return json(res, 200, {
      revoked: removed,
      currentSessionRevoked: current?.sessionId === sessionId
    });
  }

  if (method === "GET" && url.pathname === "/v1/account/me") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);

    return json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        planId: user.planId || resolvePlan(user.plan).id,
        plan: user.plan
      },
      subscription: {
        ...publicSubscription(user.subscription),
        planName: resolvePlan(user.subscription?.planId || effectivePlanId(user)).displayName,
        pendingPlanName: user.subscription?.pendingPlanId
          ? resolvePlan(user.subscription.pendingPlanId).displayName
          : null
      },
      entitlements: publicEntitlements(effectivePlanId(user)),
      cloudActivity: {
        activeJobs: activeCloudJobsForUser(user.id),
        maxConcurrentJobs: publicEntitlements(effectivePlanId(user)).maxConcurrentCloudJobs
      },
      quota: quotaSnapshot(user),
      usage: user.usage || null
    });
  }

  if (method === "GET" && url.pathname === "/v1/voice/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);

    const base = voiceJobs.status();
    const entitlements = publicEntitlements(effectivePlanId(user));
    const subscriptionReady = hasCloudAccess(user.subscription);
    const allowed = subscriptionReady && entitlements.features.cloudVoice === true;

    return json(res, 200, {
      ...base,
      ready: allowed && base.ready === true,
      code: !subscriptionReady ? "SUBSCRIPTION_INACTIVE" : allowed ? base.code : "PLAN_REQUIRED",
      catalog: allowed ? allowedVoiceCatalog(user) : [],
      entitlements,
      quota: {
        ...quotaSnapshot(user),
        plan: user.plan
      }
    });
  }

  if (method === "GET" && url.pathname === "/v1/voice/catalog") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      syncUserCommercialState(user);
      assertSubscriptionAccess(user.subscription);
      assertService(effectivePlanId(user), "voice");
      const catalog = voiceJobs.catalog();
      return json(res, 200, {
        ...catalog,
        voices: allowedVoiceCatalog(user)
      });
    } catch (err) {
      return error(
        res,
        ["PLAN_REQUIRED", "SUBSCRIPTION_INACTIVE"].includes(err?.code) ? 403 : 400,
        err?.code || "VOICE_FAILED"
      );
    }
  }

  if (method === "POST" && url.pathname === "/v1/voice/preview") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const body = await readJson(req);
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());

    try {
      syncUserCommercialState(user);
      assertSubscriptionAccess(user.subscription);
      assertFeature(effectivePlanId(user), "voicePreview");
      assertVoiceSelectionAllowed(user, body?.voiceId);
      const preview = await voiceJobs.preview(user.id, body, controller.signal);
      return binary(res, 200, preview.buffer, preview.contentType);
    } catch (err) {
      const code = err?.code || "VOICE_FAILED";
      const status =
        code === "PLAN_REQUIRED" || code === "MODEL_NOT_INCLUDED" || code === "SUBSCRIPTION_INACTIVE" ? 403 :
        code === "VOICE_PREVIEW_RATE_LIMITED" ? 429 :
        code === "VOICE_PREVIEW_INVALID" || code === "VOICE_NOT_FOUND" ? 400 :
        code === "SERVICE_UNAVAILABLE" ? 503 :
        400;
      return error(res, status, code);
    }
  }

  if (method === "POST" && url.pathname === "/v1/voice/jobs") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const key = idempotencyKey(req);
    if (!key) return error(res, 400, "BAD_REQUEST");

    const body = await readJson(req);

    try {
      const receiptCheck = checkGatewayReceipt("voice", user.id, key, body);
      assertService(effectivePlanId(user), "voice");

      const assignments = body?.assignments && typeof body.assignments === "object"
        ? body.assignments
        : {};
      const requestedVoiceIds = new Set([
        assignments.defaultVoiceId,
        ...Object.values(assignments.bySpeaker && typeof assignments.bySpeaker === "object"
          ? assignments.bySpeaker
          : {})
      ].filter(Boolean));

      for (const voiceId of requestedVoiceIds) {
        assertVoiceSelectionAllowed(user, voiceId);
      }

      const result = voiceJobs.create(user.id, key, body);

      saveGatewayReceipt("voice", user.id, key, {
        fingerprint: receiptCheck.fingerprint,
        jobId: result.job?.jobId || null,
        state: result.job?.state || "queued",
        chargedMinutes: Number(result.job?.chargedMinutes || 0),
        createdAt: receiptCheck.receipt?.createdAt || new Date().toISOString()
      });

      return json(res, result.created ? 201 : 200, result.job);
    } catch (err) {
      const code = err?.code || "VOICE_FAILED";
      const status =
        code === "VOICE_TOO_LARGE" ? 413 :
        code === "PLAN_REQUIRED" || code === "MODEL_NOT_INCLUDED" || code === "SUBSCRIPTION_INACTIVE" ? 403 :
        code === "CONCURRENCY_LIMIT" ? 429 :
        code === "QUOTA_EXCEEDED" ? 402 :
        code === "JOB_CONFLICT" || code === "JOB_RESULT_NOT_RETAINED" ? 409 :
        code === "SERVICE_UNAVAILABLE" ? 503 :
        code === "JOB_NOT_FOUND" ? 404 :
        400;
      return error(res, status, code);
    }
  }

  const voiceAudioMatch = url.pathname.match(/^\/v1\/voice\/jobs\/([^/]+)\/segments\/([^/]+)\/audio$/);
  if (method === "GET" && voiceAudioMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      const audio = voiceJobs.getAudio(
        user.id,
        decodeURIComponent(voiceAudioMatch[1]),
        decodeURIComponent(voiceAudioMatch[2])
      );
      const buffer = await fsp.readFile(audio.filePath);
      return binary(res, 200, buffer, audio.contentType);
    } catch (err) {
      const code = err?.code || "VOICE_AUDIO_NOT_FOUND";
      return error(res, code === "JOB_NOT_FOUND" ? 404 : 410, code);
    }
  }

  const voiceCancelMatch = url.pathname.match(/^\/v1\/voice\/jobs\/([^/]+)\/cancel$/);
  if (method === "POST" && voiceCancelMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      const jobId = decodeURIComponent(voiceCancelMatch[1]);
      const result = voiceJobs.cancel(user.id, jobId);
      if (result?.cancelled) {
        updateGatewayReceiptByJobId("voice", jobId, { state: "cancelled" });
      }
      return json(res, 200, result);
    } catch (err) {
      return error(res, err?.code === "JOB_NOT_FOUND" ? 404 : 400, err?.code || "VOICE_FAILED");
    }
  }

  const voiceJobMatch = url.pathname.match(/^\/v1\/voice\/jobs\/([^/]+)$/);
  if (method === "GET" && voiceJobMatch) {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    try {
      const jobId = decodeURIComponent(voiceJobMatch[1]);
      const result = voiceJobs.get(user.id, jobId);
      updateGatewayReceiptByJobId("voice", jobId, {
        state: result?.state || "unknown",
        chargedMinutes: Number(result?.chargedMinutes || 0)
      });
      return json(res, 200, result);
    } catch (err) {
      return error(res, err?.code === "JOB_NOT_FOUND" ? 404 : 400, err?.code || "VOICE_FAILED");
    }
  }

  if (method === "GET" && url.pathname === "/v1/translation/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);

    const base = translationJobs.status();
    const entitlements = publicEntitlements(effectivePlanId(user));
    const subscriptionReady = hasCloudAccess(user.subscription);
    const allowed = subscriptionReady && entitlements.features.cloudTranslation === true;

    return json(res, 200, {
      ...base,
      ready: allowed && base.ready === true,
      code: !subscriptionReady ? "SUBSCRIPTION_INACTIVE" : allowed ? base.code : "PLAN_REQUIRED",
      entitlements,
      quota: {
        ...quotaSnapshot(user),
        plan: user.plan
      }
    });
  }

  if (method === "POST" && url.pathname === "/v1/translation/jobs") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    const key = idempotencyKey(req);
    if (!key) return error(res, 400, "BAD_REQUEST");

    const body = await readJson(req);

    try {
      const receiptCheck = checkGatewayReceipt("translation", user.id, key, body);
      const result = translationJobs.create(user.id, key, body);

      saveGatewayReceipt("translation", user.id, key, {
        fingerprint: receiptCheck.fingerprint,
        jobId: result.job?.jobId || null,
        state: result.job?.state || "queued",
        chargedMinutes: Number(result.job?.chargedMinutes || 0),
        createdAt: receiptCheck.receipt?.createdAt || new Date().toISOString()
      });

      return json(res, result.created ? 201 : 200, result.job);
    } catch (err) {
      const code = err?.code || "TRANSLATION_FAILED";
      const status =
        code === "TRANSLATION_TOO_LARGE" ? 413 :
        code === "PLAN_REQUIRED" || code === "SUBSCRIPTION_INACTIVE" ? 403 :
        code === "CONCURRENCY_LIMIT" ? 429 :
        code === "QUOTA_EXCEEDED" ? 402 :
        code === "JOB_CONFLICT" || code === "JOB_RESULT_NOT_RETAINED" ? 409 :
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
      const jobId = decodeURIComponent(translationCancelMatch[1]);
      const result = translationJobs.cancel(user.id, jobId);
      if (result?.cancelled) {
        updateGatewayReceiptByJobId("translation", jobId, { state: "cancelled" });
      }
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
      const jobId = decodeURIComponent(translationJobMatch[1]);
      const result = translationJobs.get(user.id, jobId);
      updateGatewayReceiptByJobId("translation", jobId, {
        state: result?.state || "unknown",
        chargedMinutes: Number(result?.chargedMinutes || 0)
      });
      return json(res, 200, result);
    } catch (err) {
      return error(res, err?.code === "JOB_NOT_FOUND" ? 404 : 400, err?.code || "TRANSLATION_FAILED");
    }
  }

  if (method === "GET" && url.pathname === "/v1/speech/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    syncUserCommercialState(user);
    const providerReady = speechProvider.isConfigured();
    const entitlements = publicEntitlements(effectivePlanId(user));
    const subscriptionReady = hasCloudAccess(user.subscription);
    const allowed = subscriptionReady && entitlements.features.cloudSpeech === true;

    return json(res, 200, {
      ready: allowed && providerReady,
      code: !subscriptionReady ? "SUBSCRIPTION_INACTIVE" : !allowed ? "PLAN_REQUIRED" : providerReady ? "READY" : "CLOUD_PROVIDER_NOT_CONFIGURED",
      entitlements,
      quota: {
        ...quotaSnapshot(user),
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
        persistSpeechJobs();
      } else {
        if (existing.fingerprint !== jobFingerprint(input)) {
          return error(res, 409, "JOB_CONFLICT");
        }
        return json(res, 200, publicJob(existing, { createResponse: true }));
      }
    }

    try {
      assertCloudJobAllowed(user, "speech");
    } catch (err) {
      const status =
        ["PLAN_REQUIRED", "SUBSCRIPTION_INACTIVE"].includes(err?.code) ? 403 :
        err?.code === "CONCURRENCY_LIMIT" ? 429 :
        400;
      return error(res, status, err?.code || "BAD_REQUEST");
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
      billingPeriodEnd: user.subscription?.currentPeriodEnd || user.quota?.resetAt || null,
      chargedMinutes: 0,
      billingState: "pending",
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
    persistSpeechJobs();

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
      persistSpeechJobs();
      try { job.controller?.abort(); } catch {}
    } else {
      job.state = "cancelled";
      job.progress = 0;
      releaseReservation(job);
      cleanupUpload(job);
      persistSpeechJobs();
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

const maintenanceTimer = setInterval(() => {
  pruneRefreshSessions();
  pruneBillingEvents();
  pruneRequestBuckets();
  pruneSpeechJobHistory();
  pruneGatewayReceipts();
  billing.pruneExpiredSessions();
}, 60 * 1000);
maintenanceTimer.unref?.();

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

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  audit("server.shutdown.started", null, { signal });
  clearInterval(maintenanceTimer);

  for (const job of jobs.values()) {
    if (["completed", "failed", "cancelled"].includes(job.state)) continue;

    job.cancelRequested = true;
    if (job.controller) {
      try { job.controller.abort(); } catch {}
    } else {
      job.state = "cancelled";
      job.progress = 0;
      releaseReservation(job);
      cleanupUpload(job);
    }
  }

  translationJobs.cancelAllForShutdown?.();
  voiceJobs.cancelAllForShutdown?.();
  persistSpeechJobs();

  await Promise.race([
    new Promise(resolve => server.close(resolve)),
    new Promise(resolve => setTimeout(resolve, 1200))
  ]);

  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    persistUsers();
    persistRefreshSessions();
    persistBillingEvents();
    persistSpeechJobs();
    billing.pruneExpiredSessions();
    audit("server.shutdown.completed", null, { signal });
  } catch (error) {
    console.error("[ShutdownPersist]", error?.code || error?.message || String(error));
  }

  try { durableState.close?.(); } catch {}
  process.exit(0);
}

process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(error => {
    console.error("[Shutdown]", error?.message || String(error));
    process.exit(1);
  });
});

process.once("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(error => {
    console.error("[Shutdown]", error?.message || String(error));
    process.exit(1);
  });
});

server.listen(PORT, HOST, () => {
  const provider = speechProvider.config();

  console.log("");
  console.log("Viral AI Tool backend");
  console.log("Environment: " + (IS_PRODUCTION ? "production" : "development"));
  console.log("State driver: " + STATE_DRIVER);
  console.log("Listening: http://" + HOST + ":" + PORT);

  if (!IS_PRODUCTION) {
    console.log("Dev account:");
    console.log("  Email:    " + demo.email);
    console.log("  Password: " + demo.password);
  } else if (demo.created) {
    console.log("Production owner account bootstrapped: " + demo.email);
    console.log("Remove VIRAL_AI_BOOTSTRAP_PASSWORD from the environment after verifying access.");
  }
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

  const voice = voiceProvider.config();
  console.log("Cloud voice: " + (voiceProvider.isConfigured() ? "READY" : "NOT CONFIGURED"));
  if (voiceProvider.isConfigured()) {
    console.log("Voice model: " + voice.model);
  }
  console.log("");
  if (!IS_PRODUCTION) {
    console.log("Development mode. Do not expose this server directly to the public Internet.");
  } else {
    console.log("Production mode expects HTTPS termination and a real billing provider in front of billing management.");
  }
});
