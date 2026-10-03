"use strict";

const { getModel, PRICING_SNAPSHOT } = require("./model-catalog");

const RUNWAY_USD_PER_CREDIT = 0.01;

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function estimateProviderCredits(model, options = {}) {
  if (!model) {
    const error = new Error("Generation model is unknown.");
    error.code = "MODEL_NOT_FOUND";
    throw error;
  }

  const seconds = positiveNumber(options.durationSeconds, 5);
  const resolution = String(options.resolution || model.resolutions?.[0] || "720p");
  const inputVideoSeconds = Math.max(0, Number(options.inputVideoSeconds || 0));
  const withAudio = Boolean(options.withAudio);
  const pricing = model.pricing || {};

  if (pricing.kind === "local") {
    return { known: true, providerCredits: 0, estimatedUsd: 0, pricingKind: "local" };
  }

  let credits = null;

  if (pricing.kind === "perSecond") {
    credits = seconds * Number(pricing.creditsPerSecond || 0);
  } else if (pricing.kind === "audioAware") {
    const rate = withAudio
      ? Number(pricing.creditsPerSecondWithAudio || 0)
      : Number(pricing.creditsPerSecond || 0);
    credits = seconds * rate;
  } else if (pricing.kind === "resolutionPerSecond") {
    const rate = Number(pricing.creditsPerSecond?.[resolution]);
    if (Number.isFinite(rate)) credits = seconds * rate;
  } else if (pricing.kind === "seedance25") {
    const outputRate = Number(pricing.outputCreditsPerSecond?.[resolution]);
    const inputRate = Number(pricing.inputVideoCreditsPerSecond?.[resolution]);
    if (Number.isFinite(outputRate) && Number.isFinite(inputRate)) {
      credits = seconds * outputRate + Math.min(30, inputVideoSeconds) * inputRate;
    }
  }

  if (!Number.isFinite(credits)) {
    return {
      known: false,
      providerCredits: null,
      estimatedUsd: null,
      pricingKind: pricing.kind || "unknown",
      pricingSnapshot: PRICING_SNAPSHOT
    };
  }

  credits = Math.max(Number(pricing.minimumCredits || 0), Math.ceil(credits));

  return {
    known: true,
    providerCredits: credits,
    estimatedUsd: model.provider === "runway"
      ? Number((credits * RUNWAY_USD_PER_CREDIT).toFixed(2))
      : null,
    pricingKind: pricing.kind,
    pricingSnapshot: PRICING_SNAPSHOT
  };
}

function estimateGenerationCost(modelId, options = {}) {
  const model = getModel(modelId);
  const estimate = estimateProviderCredits(model, options);

  return {
    modelId: model.id,
    provider: model.provider,
    durationSeconds: positiveNumber(options.durationSeconds, 5),
    resolution: String(options.resolution || model.resolutions?.[0] || "720p"),
    ...estimate
  };
}

module.exports = {
  RUNWAY_USD_PER_CREDIT,
  estimateProviderCredits,
  estimateGenerationCost
};
