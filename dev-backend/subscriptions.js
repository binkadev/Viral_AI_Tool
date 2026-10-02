const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_MS = 3 * DAY_MS;

const ACCESS_STATUSES = new Set(["trialing", "active", "past_due", "grace_period"]);

function iso(value) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  return new Date(time).toISOString();
}

function parseTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function subscriptionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function createSubscription({
  planId,
  status = "active",
  now = Date.now(),
  periodDays = 30,
  trialDays = 0,
  graceDays = 3
} = {}) {
  const current = Number(now);
  const periodMs = Math.max(1, Number(periodDays || 30)) * DAY_MS;
  const graceMs = Math.max(0, Number(graceDays || 3)) * DAY_MS;
  const trialMs = Math.max(0, Number(trialDays || 0)) * DAY_MS;
  const trialing = status === "trialing" || trialMs > 0;
  const trialEndsAt = trialing ? current + (trialMs || 7 * DAY_MS) : null;
  const currentPeriodEnd = trialing ? trialEndsAt : current + periodMs;

  return {
    status: trialing ? "trialing" : status,
    planId: String(planId || "free"),
    pendingPlanId: null,
    currentPeriodStart: iso(current),
    currentPeriodEnd: iso(currentPeriodEnd),
    trialEndsAt: trialEndsAt ? iso(trialEndsAt) : null,
    pastDueAt: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    periodDays: Math.max(1, Number(periodDays || 30)),
    graceDays: Math.max(0, Number(graceDays || 3)),
    pastDueHours: 24,
    updatedAt: iso(current)
  };
}

function publicSubscription(subscription = {}) {
  return {
    status: subscription.status || "canceled",
    planId: subscription.planId || "free",
    pendingPlanId: subscription.pendingPlanId || null,
    currentPeriodStart: subscription.currentPeriodStart || null,
    currentPeriodEnd: subscription.currentPeriodEnd || null,
    trialEndsAt: subscription.trialEndsAt || null,
    pastDueAt: subscription.pastDueAt || null,
    graceEndsAt: subscription.graceEndsAt || null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
    canceledAt: subscription.canceledAt || null,
    endedAt: subscription.endedAt || null,
    updatedAt: subscription.updatedAt || null
  };
}

function hasCloudAccess(subscription, now = Date.now()) {
  if (!subscription || !ACCESS_STATUSES.has(subscription.status)) return false;

  const current = Number(now);

  if (subscription.status === "trialing") {
    const trialEnd = parseTime(subscription.trialEndsAt || subscription.currentPeriodEnd);
    return trialEnd === null || current < trialEnd;
  }

  if (subscription.status === "grace_period") {
    const graceEnd = parseTime(subscription.graceEndsAt);
    return graceEnd !== null && current < graceEnd;
  }

  return true;
}

function reconcileSubscription(subscription, {
  now = Date.now(),
  trialConvertsToPaid = true
} = {}) {
  if (!subscription) return { subscription: null, periodRolled: false, planChanged: false };

  const current = Number(now);
  let periodRolled = false;
  let planChanged = false;

  const trialEnd = parseTime(subscription.trialEndsAt);
  if (subscription.status === "trialing" && trialEnd !== null && current >= trialEnd) {
    if (trialConvertsToPaid) {
      subscription.status = "active";
      subscription.currentPeriodStart = iso(trialEnd);
      subscription.currentPeriodEnd = iso(trialEnd + Math.max(1, Number(subscription.periodDays || 30)) * DAY_MS);
      subscription.trialEndsAt = null;
      periodRolled = true;
    } else {
      subscription.status = "canceled";
      subscription.canceledAt = iso(current);
      subscription.endedAt = iso(current);
    }
  }

  const periodEnd = parseTime(subscription.currentPeriodEnd);
  if (["active", "past_due"].includes(subscription.status) && periodEnd !== null && current >= periodEnd) {
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = "canceled";
      subscription.canceledAt = subscription.canceledAt || iso(current);
      subscription.endedAt = iso(periodEnd);
    } else if (subscription.status === "active") {
      if (subscription.pendingPlanId) {
        subscription.planId = subscription.pendingPlanId;
        subscription.pendingPlanId = null;
        planChanged = true;
      }

      const periodMs = Math.max(1, Number(subscription.periodDays || 30)) * DAY_MS;
      let start = periodEnd;
      while (start + periodMs <= current) start += periodMs;
      subscription.currentPeriodStart = iso(start);
      subscription.currentPeriodEnd = iso(start + periodMs);
      periodRolled = true;
    }
  }

  if (subscription.status === "past_due") {
    const graceEnd = parseTime(subscription.graceEndsAt);
    const pastDueAt = parseTime(subscription.pastDueAt);
    const graceStartsAt = pastDueAt === null
      ? current
      : pastDueAt + Math.max(0, Number(subscription.pastDueHours || 24)) * 60 * 60 * 1000;

    if (graceEnd !== null && current >= graceEnd) {
      subscription.status = "canceled";
      subscription.canceledAt = subscription.canceledAt || iso(current);
      subscription.endedAt = subscription.endedAt || iso(graceEnd);
    } else if (current >= graceStartsAt) {
      subscription.status = "grace_period";
    }
  } else if (subscription.status === "grace_period") {
    const graceEnd = parseTime(subscription.graceEndsAt);
    if (graceEnd !== null && current >= graceEnd) {
      subscription.status = "canceled";
      subscription.canceledAt = subscription.canceledAt || iso(current);
      subscription.endedAt = subscription.endedAt || iso(graceEnd);
    }
  }

  subscription.updatedAt = iso(current);
  return { subscription, periodRolled, planChanged };
}

function markPaymentFailed(subscription, { now = Date.now(), graceMs } = {}) {
  if (!subscription) throw subscriptionError("SUBSCRIPTION_REQUIRED", "Subscription is missing.");
  const current = Number(now);
  const duration = Number.isFinite(Number(graceMs))
    ? Math.max(0, Number(graceMs))
    : Math.max(0, Number(subscription.graceDays || 3)) * DAY_MS || DEFAULT_GRACE_MS;

  subscription.status = "past_due";
  subscription.pastDueAt = iso(current);
  subscription.graceEndsAt = iso(current + duration);
  subscription.updatedAt = iso(current);
  return subscription;
}

function markPaymentRecovered(subscription, { now = Date.now() } = {}) {
  if (!subscription) throw subscriptionError("SUBSCRIPTION_REQUIRED", "Subscription is missing.");
  subscription.status = "active";
  subscription.pastDueAt = null;
  subscription.graceEndsAt = null;
  subscription.updatedAt = iso(now);
  return subscription;
}

function requestPlanChange(subscription, nextPlanId, {
  direction = "upgrade",
  now = Date.now()
} = {}) {
  if (!subscription) throw subscriptionError("SUBSCRIPTION_REQUIRED", "Subscription is missing.");

  const next = String(nextPlanId || "").trim();
  if (!next) throw subscriptionError("PLAN_INVALID", "Target plan is invalid.");

  if (direction === "downgrade") {
    subscription.pendingPlanId = next;
  } else {
    subscription.planId = next;
    subscription.pendingPlanId = null;
  }

  subscription.updatedAt = iso(now);
  return subscription;
}

function requestCancellation(subscription, { now = Date.now(), immediately = false } = {}) {
  if (!subscription) throw subscriptionError("SUBSCRIPTION_REQUIRED", "Subscription is missing.");

  if (immediately) {
    subscription.status = "canceled";
    subscription.cancelAtPeriodEnd = false;
    subscription.canceledAt = iso(now);
    subscription.endedAt = iso(now);
  } else {
    subscription.cancelAtPeriodEnd = true;
    subscription.canceledAt = iso(now);
  }

  subscription.updatedAt = iso(now);
  return subscription;
}

function assertSubscriptionAccess(subscription, now = Date.now()) {
  reconcileSubscription(subscription, { now });

  if (hasCloudAccess(subscription, now)) return subscription;

  throw subscriptionError(
    "SUBSCRIPTION_INACTIVE",
    "The subscription is not active for Cloud processing.",
    {
      status: subscription?.status || "missing",
      endedAt: subscription?.endedAt || null
    }
  );
}

module.exports = {
  DAY_MS,
  ACCESS_STATUSES,
  createSubscription,
  publicSubscription,
  hasCloudAccess,
  reconcileSubscription,
  markPaymentFailed,
  markPaymentRecovered,
  requestPlanChange,
  requestCancellation,
  assertSubscriptionAccess
};
