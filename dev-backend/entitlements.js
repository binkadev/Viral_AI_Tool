const PLAN_DEFINITIONS = Object.freeze({
  free: Object.freeze({
    id: "free",
    displayName: "Free",
    monthlyMinutes: 60,
    maxConcurrentCloudJobs: 1,
    features: Object.freeze({
      cloudSpeech: true,
      cloudTranslation: true,
      cloudVoice: false,
      voicePreview: false,
      localProcessing: true
    }),
    models: Object.freeze({
      speech: Object.freeze(["standard"]),
      translation: Object.freeze(["standard"]),
      voice: Object.freeze([])
    })
  }),
  creator: Object.freeze({
    id: "creator",
    displayName: "Creator",
    monthlyMinutes: 500,
    maxConcurrentCloudJobs: 2,
    features: Object.freeze({
      cloudSpeech: true,
      cloudTranslation: true,
      cloudVoice: true,
      voicePreview: true,
      localProcessing: true
    }),
    models: Object.freeze({
      speech: Object.freeze(["standard"]),
      translation: Object.freeze(["standard"]),
      voice: Object.freeze(["standard"])
    })
  }),
  creator_pro: Object.freeze({
    id: "creator_pro",
    displayName: "Creator Pro",
    monthlyMinutes: 2000,
    maxConcurrentCloudJobs: 4,
    features: Object.freeze({
      cloudSpeech: true,
      cloudTranslation: true,
      cloudVoice: true,
      voicePreview: true,
      localProcessing: true
    }),
    models: Object.freeze({
      speech: Object.freeze(["standard", "premium"]),
      translation: Object.freeze(["standard", "premium"]),
      voice: Object.freeze(["standard", "premium"])
    })
  }),
  business: Object.freeze({
    id: "business",
    displayName: "Business",
    monthlyMinutes: 10000,
    maxConcurrentCloudJobs: 10,
    features: Object.freeze({
      cloudSpeech: true,
      cloudTranslation: true,
      cloudVoice: true,
      voicePreview: true,
      localProcessing: true
    }),
    models: Object.freeze({
      speech: Object.freeze(["standard", "premium"]),
      translation: Object.freeze(["standard", "premium"]),
      voice: Object.freeze(["standard", "premium"])
    })
  })
});

const PLAN_ALIASES = Object.freeze({
  free: "free",
  creator: "creator",
  "creator pro": "creator_pro",
  creator_pro: "creator_pro",
  creatorpro: "creator_pro",
  business: "business"
});

function normalizePlanId(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-]+/g, "_")
    .replace(/\s+/g, " ");

  return PLAN_ALIASES[key] || PLAN_ALIASES[key.replace(/\s+/g, "_")] || "free";
}

function resolvePlan(value) {
  const id = normalizePlanId(value);
  return PLAN_DEFINITIONS[id] || PLAN_DEFINITIONS.free;
}

function publicEntitlements(value) {
  const plan = resolvePlan(value);
  return {
    planId: plan.id,
    planName: plan.displayName,
    monthlyMinutes: plan.monthlyMinutes,
    maxConcurrentCloudJobs: plan.maxConcurrentCloudJobs,
    features: { ...plan.features },
    models: {
      speech: [...plan.models.speech],
      translation: [...plan.models.translation],
      voice: [...plan.models.voice]
    }
  };
}

function featureForService(service) {
  if (service === "speech") return "cloudSpeech";
  if (service === "translation") return "cloudTranslation";
  if (service === "voice") return "cloudVoice";
  return null;
}

function planError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertFeature(value, feature) {
  const plan = resolvePlan(value);
  if (!feature || plan.features[feature] === true) return plan;

  throw planError(
    "PLAN_REQUIRED",
    "This feature is not included in the current plan.",
    {
      planId: plan.id,
      feature
    }
  );
}

function assertService(value, service) {
  return assertFeature(value, featureForService(service));
}

function assertConcurrentJobs(value, activeJobs) {
  const plan = resolvePlan(value);
  const active = Math.max(0, Number(activeJobs || 0));

  if (active < plan.maxConcurrentCloudJobs) return plan;

  throw planError(
    "CONCURRENCY_LIMIT",
    "The current plan has reached its active Cloud job limit.",
    {
      planId: plan.id,
      maxConcurrentCloudJobs: plan.maxConcurrentCloudJobs,
      activeJobs: active
    }
  );
}

module.exports = {
  PLAN_DEFINITIONS,
  normalizePlanId,
  resolvePlan,
  publicEntitlements,
  featureForService,
  assertFeature,
  assertService,
  assertConcurrentJobs
};
