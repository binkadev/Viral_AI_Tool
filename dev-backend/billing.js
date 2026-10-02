const crypto = require("crypto");
const { isKnownPlan, normalizePlanId, resolvePlan, publicEntitlements } = require("./entitlements");

const PLAN_ORDER = ["free", "creator", "creator_pro", "business"];
const DEV_PRICING = Object.freeze({
  free: { monthlyAmount: 0, currency: "USD" },
  creator: { monthlyAmount: 1200, currency: "USD" },
  creator_pro: { monthlyAmount: 2400, currency: "USD" },
  business: { monthlyAmount: 7900, currency: "USD" }
});

const checkoutSessions = new Map();
const portalSessions = new Map();
const invoices = new Map();

let persistence = {
  load: null,
  save: null
};

function sessionKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function mapFromObject(value) {
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
}

function objectFromMap(map) {
  return Object.fromEntries(map.entries());
}

function persistState() {
  if (!persistence.save) return;
  persistence.save({
    checkoutSessions: objectFromMap(checkoutSessions),
    portalSessions: objectFromMap(portalSessions),
    invoices: Object.fromEntries(
      [...invoices.entries()].map(([userId, items]) => [userId, Array.isArray(items) ? items : []])
    )
  });
}

function configurePersistence(adapter = {}) {
  persistence = {
    load: typeof adapter.load === "function" ? adapter.load : null,
    save: typeof adapter.save === "function" ? adapter.save : null
  };

  const restored = persistence.load?.() || {};

  checkoutSessions.clear();
  for (const [key, value] of mapFromObject(restored.checkoutSessions)) {
    checkoutSessions.set(key, value);
  }

  portalSessions.clear();
  for (const [key, value] of mapFromObject(restored.portalSessions)) {
    portalSessions.set(key, value);
  }

  invoices.clear();
  for (const [userId, items] of Object.entries(restored.invoices || {})) {
    invoices.set(userId, Array.isArray(items) ? items : []);
  }

  pruneExpiredSessions();
}

function pruneExpiredSessions(now = Date.now()) {
  let changed = false;

  for (const [key, session] of checkoutSessions.entries()) {
    if (!session || Number(session.expiresAt || 0) <= now || session.consumedAt) {
      checkoutSessions.delete(key);
      changed = true;
    }
  }

  for (const [key, session] of portalSessions.entries()) {
    if (!session || Number(session.expiresAt || 0) <= now) {
      portalSessions.delete(key);
      changed = true;
    }
  }

  if (changed) persistState();
}

function billingError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function token(prefix) {
  return prefix + "_" + crypto.randomBytes(18).toString("base64url");
}

function rank(planId) {
  return PLAN_ORDER.indexOf(normalizePlanId(planId));
}

function priceFor(planId) {
  return DEV_PRICING[normalizePlanId(planId)] || DEV_PRICING.free;
}

function publicCatalog() {
  return {
    provider: "development",
    pricingEnvironment: "development",
    developmentOnly: true,
    plans: PLAN_ORDER.map(planId => {
      const plan = resolvePlan(planId);
      const price = priceFor(planId);
      const entitlements = publicEntitlements(planId);

      return {
        id: plan.id,
        name: plan.displayName,
        monthlyAmount: price.monthlyAmount,
        currency: price.currency,
        monthlyMinutes: plan.monthlyMinutes,
        maxConcurrentCloudJobs: plan.maxConcurrentCloudJobs,
        features: entitlements.features,
        models: entitlements.models
      };
    })
  };
}

function createCheckoutSession({ userId, currentPlanId, targetPlanId, baseUrl }) {
  if (!isKnownPlan(targetPlanId)) {
    throw billingError("PLAN_INVALID", "Target billing plan is invalid.");
  }

  const current = normalizePlanId(currentPlanId);
  const target = normalizePlanId(targetPlanId);

  if (target === current) {
    throw billingError("BILLING_PLAN_ALREADY_ACTIVE", "The target plan is already active.");
  }

  if (rank(target) <= rank(current)) {
    throw billingError("BILLING_USE_PLAN_CHANGE", "Downgrades do not require checkout.");
  }

  const id = token("chk");
  const createdAt = Date.now();
  const expiresAt = createdAt + 15 * 60 * 1000;

  pruneExpiredSessions(createdAt);
  checkoutSessions.set(sessionKey(id), {
    userId,
    currentPlanId: current,
    targetPlanId: target,
    createdAt,
    expiresAt,
    consumedAt: null
  });
  persistState();

  return {
    id,
    provider: "development",
    checkoutUrl: String(baseUrl || "").replace(/\/+$/, "") + "/v1/dev-billing/checkout/" + encodeURIComponent(id),
    expiresAt: new Date(expiresAt).toISOString(),
    targetPlanId: target
  };
}

function consumeCheckoutSession(id) {
  pruneExpiredSessions();
  const key = sessionKey(id);
  const session = checkoutSessions.get(key);
  if (!session) throw billingError("BILLING_SESSION_NOT_FOUND", "Checkout session was not found.");
  if (session.consumedAt) throw billingError("BILLING_SESSION_USED", "Checkout session was already used.");
  if (Date.now() >= session.expiresAt) {
    checkoutSessions.delete(key);
    persistState();
    throw billingError("BILLING_SESSION_EXPIRED", "Checkout session expired.");
  }

  session.consumedAt = Date.now();
  checkoutSessions.delete(key);
  persistState();
  portalSessions.delete(key);
  persistState();
  return { ...session };
}

function createPortalSession({ userId, baseUrl }) {
  const id = token("portal");
  const createdAt = Date.now();
  const expiresAt = createdAt + 15 * 60 * 1000;

  pruneExpiredSessions(createdAt);
  portalSessions.set(sessionKey(id), {
    userId,
    createdAt,
    expiresAt
  });
  persistState();

  return {
    id,
    provider: "development",
    portalUrl: String(baseUrl || "").replace(/\/+$/, "") + "/v1/dev-billing/portal/" + encodeURIComponent(id),
    expiresAt: new Date(expiresAt).toISOString()
  };
}

function consumePortalSession(id) {
  pruneExpiredSessions();
  const key = sessionKey(id);
  const session = portalSessions.get(key);
  if (!session) throw billingError("BILLING_SESSION_NOT_FOUND", "Portal session was not found.");
  if (Date.now() >= session.expiresAt) {
    portalSessions.delete(key);
    persistState();
    throw billingError("BILLING_SESSION_EXPIRED", "Portal session expired.");
  }
  return { ...session };
}

function invoiceBucket(userId) {
  const key = String(userId || "");
  if (!invoices.has(key)) invoices.set(key, []);
  return invoices.get(key);
}

function recordInvoice({ userId, planId, amount, currency = "USD", status = "paid", description }) {
  const item = {
    id: token("inv"),
    createdAt: new Date().toISOString(),
    status,
    planId: normalizePlanId(planId),
    planName: resolvePlan(planId).displayName,
    amount: Math.max(0, Number(amount || 0)),
    currency: String(currency || "USD"),
    description: description || (resolvePlan(planId).displayName + " subscription")
  };

  invoiceBucket(userId).unshift(item);
  persistState();
  return item;
}

function ensureDevelopmentInvoice(user) {
  const bucket = invoiceBucket(user.id);
  if (bucket.length) return;

  const price = priceFor(user.planId || user.plan);
  if (price.monthlyAmount <= 0) return;

  recordInvoice({
    userId: user.id,
    planId: user.planId || user.plan,
    amount: price.monthlyAmount,
    currency: price.currency,
    status: "paid",
    description: "Development billing record"
  });
}

function listInvoices(user) {
  ensureDevelopmentInvoice(user);
  return {
    provider: "development",
    invoices: invoiceBucket(user.id).map(item => ({ ...item }))
  };
}

function checkoutAmount(planId) {
  return { ...priceFor(planId) };
}

module.exports = {
  PLAN_ORDER,
  rank,
  publicCatalog,
  createCheckoutSession,
  consumeCheckoutSession,
  createPortalSession,
  consumePortalSession,
  recordInvoice,
  listInvoices,
  checkoutAmount,
  configurePersistence,
  pruneExpiredSessions,
  BillingError: Error
};
