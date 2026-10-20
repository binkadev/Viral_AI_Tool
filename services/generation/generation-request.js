"use strict";

const { failure } = require("./generation-job");
const { listModels, getModel } = require("./model-catalog");
const { supports } = require("./model-router");

const FIELDS = new Set([
  "projectId",
  "providerId",
  "sceneId",
  "idempotencyKey",
  "kind",
  "mode",
  "prompt",
  "goal",
  "modelId",
  "resolution",
  "durationSeconds",
  "aspectRatio",
  "withAudio",
  "sourceAssetId",
  "referenceAssetIds"
]);

const ASPECT_RATIOS = new Set(["9:16", "16:9", "1:1"]);

function identifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function optionalIdentifier(value) {
  return value == null || identifier(value);
}

function normalizeRequest(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !FIELDS.has(key))) {
    throw failure("INVALID_REQUEST");
  }
  if (!identifier(input.projectId) || !identifier(input.idempotencyKey) || !optionalIdentifier(input.sceneId)) {
    throw failure("INVALID_REQUEST");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 8000 || /[\x00-\x08]/.test(input.prompt)) {
    throw failure("INVALID_REQUEST");
  }

  const referenceAssetIds = input.referenceAssetIds == null ? [] : input.referenceAssetIds;
  if (!Array.isArray(referenceAssetIds) || referenceAssetIds.length > 16 || referenceAssetIds.some(id => !identifier(id))) {
    throw failure("INVALID_REQUEST");
  }

  const request = {
    projectId: input.projectId,
    sceneId: input.sceneId || null,
    idempotencyKey: input.idempotencyKey,
    kind: input.kind ?? "video",
    mode: input.mode ?? "text-to-video",
    prompt: input.prompt,
    goal: input.goal ?? "balanced",
    modelId: input.modelId || null,
    resolution: input.resolution ?? "720p",
    durationSeconds: input.durationSeconds ?? 5,
    aspectRatio: input.aspectRatio ?? "9:16",
    withAudio: input.withAudio ?? false,
    sourceAssetId: input.sourceAssetId || null,
    referenceAssetIds: [...referenceAssetIds]
  };
  if(input.providerId!==undefined) {
    if(input.providerId!=='muse' || !identifier(input.sceneId) || input.modelId || input.sourceAssetId || referenceAssetIds.length || ['resolution','durationSeconds','aspectRatio','withAudio'].some(key=>input[key]!=null))throw failure('INVALID_REQUEST');
    request.providerId='muse';
    // The selected Muse tab owns these settings. No invented model or specs.
    request.resolution=null;request.durationSeconds=null;request.aspectRatio=null;request.withAudio=null;
  }

  if (
    request.kind !== "video" ||
    request.mode !== "text-to-video" ||
    !["economy", "balanced", "quality"].includes(request.goal) ||
    (!request.providerId && (!ASPECT_RATIOS.has(request.aspectRatio) ||
    typeof request.durationSeconds !== "number" ||
    !Number.isFinite(request.durationSeconds) ||
    request.durationSeconds <= 0 ||
    typeof request.withAudio !== "boolean")) ||
    !optionalIdentifier(request.sourceAssetId)
  ) {
    throw failure("INVALID_REQUEST");
  }

  if (request.modelId) {
    const model = getModel(request.modelId);
    if (!model || !supports(model, request)) throw failure("INVALID_REQUEST");
  } else if (!listModels().some(model => supports(model, request))) {
    throw failure("INVALID_REQUEST");
  }

  return Object.freeze({
    ...request,
    referenceAssetIds: Object.freeze([...request.referenceAssetIds])
  });
}

module.exports = { normalizeRequest, identifier };
