"use strict";

const { listModels, getModel } = require("./model-catalog");
const { estimateGenerationCost } = require("./cost-estimator");

const ROUTE_ORDER = Object.freeze({
  economy: Object.freeze([
    "local:wan",
    "runway:wan3",
    "runway:seedance2_mini"
  ]),
  balanced: Object.freeze([
    "runway:veo3.1_fast",
    "runway:gen4.5",
    "runway:seedance2_fast",
    "runway:wan3"
  ]),
  quality: Object.freeze([
    "runway:seedance2_5",
    "runway:veo3.1",
    "runway:gen4.5"
  ])
});

function normalizeGoal(value) {
  const goal = String(value || "balanced").trim().toLowerCase();
  return ROUTE_ORDER[goal] ? goal : "balanced";
}

function supports(model, request = {}) {
  if (!model) return false;

  const mode = String(request.mode || "text-to-video");
  const resolution = String(request.resolution || "720p");
  const duration = Math.max(1, Number(request.durationSeconds || 5));

  if (!model.modes.includes(mode)) return false;
  if (!model.resolutions.includes(resolution)) return false;
  if (duration > Number(model.maxDurationSeconds || 0)) return false;
  if (request.withAudio && model.audio !== true) return false;

  return true;
}

function providerAvailable(model, availability = {}) {
  if (model.provider === "local") return Boolean(availability.local);
  if (Object.prototype.hasOwnProperty.call(availability, model.provider)) {
    return Boolean(availability[model.provider]);
  }
  return true;
}

function chooseModel(request = {}, options = {}) {
  const goal = normalizeGoal(request.goal);
  const availability = options.availability || {};
  const allow = Array.isArray(options.allow) ? new Set(options.allow) : null;
  const deny = new Set(Array.isArray(options.deny) ? options.deny : []);
  const ceiling = Number(options.maxEstimatedUsd);
  const candidates = ROUTE_ORDER[goal] || ROUTE_ORDER.balanced;

  for (const id of candidates) {
    if (allow && !allow.has(id)) continue;
    if (deny.has(id)) continue;

    const model = getModel(id);
    if (!supports(model, request)) continue;
    if (!providerAvailable(model, availability)) continue;

    const estimate = estimateGenerationCost(id, request);
    if (
      Number.isFinite(ceiling) &&
      estimate.known &&
      Number.isFinite(estimate.estimatedUsd) &&
      estimate.estimatedUsd > ceiling
    ) {
      continue;
    }

    return {
      goal,
      model,
      estimate,
      reason: model.provider === "local"
        ? "local-first"
        : goal + "-priority"
    };
  }

  const error = new Error("No generation model matches the current constraints.");
  error.code = "NO_GENERATION_ROUTE";
  error.details = {
    goal,
    mode: request.mode || "text-to-video",
    resolution: request.resolution || "720p",
    durationSeconds: Number(request.durationSeconds || 5)
  };
  throw error;
}

function publicCatalog() {
  return listModels().map(model => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    tier: model.tier,
    modes: [...model.modes],
    resolutions: [...model.resolutions],
    maxDurationSeconds: model.maxDurationSeconds,
    audio: model.audio
  }));
}

module.exports = {
  ROUTE_ORDER,
  normalizeGoal,
  supports,
  chooseModel,
  publicCatalog
};
