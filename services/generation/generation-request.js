"use strict";
const { failure } = require("./generation-job");
const { listModels } = require("./model-catalog");
const { supports } = require("./model-router");
const FIELDS = new Set(["projectId", "idempotencyKey", "prompt", "goal", "mode", "resolution", "durationSeconds", "withAudio"]);
function identifier(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
function normalizeRequest(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !FIELDS.has(k))) throw failure("INVALID_REQUEST");
  if (!identifier(input.projectId) || !identifier(input.idempotencyKey)) throw failure("INVALID_REQUEST");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 8000 || /[\x00-\x08]/.test(input.prompt)) throw failure("INVALID_REQUEST");
  const request = { projectId: input.projectId, idempotencyKey: input.idempotencyKey, prompt: input.prompt.trim(),
    goal: input.goal ?? "balanced", mode: input.mode ?? "text-to-video", resolution: input.resolution ?? "720p",
    durationSeconds: input.durationSeconds ?? 5, withAudio: input.withAudio ?? false };
  // Reference inputs require a future trusted media resolver; arbitrary paths/URLs are not accepted.
  if (!["economy", "balanced", "quality"].includes(request.goal) || request.mode !== "text-to-video" ||
      typeof request.durationSeconds !== "number" || !Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0 ||
      typeof request.withAudio !== "boolean" || !listModels().some(model => supports(model, request))) throw failure("INVALID_REQUEST");
  return Object.freeze(request);
}
module.exports = { normalizeRequest, identifier };
