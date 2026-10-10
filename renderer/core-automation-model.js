(function attachAutomationModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationModel() {
  "use strict";

  const AUTOMATION_SCHEMA_VERSION = 1;
  const CONTENT_BRIEF_VERSION = 1;
  const ALLOWED_ASPECTS = new Set(["16:9", "9:16", "1:1"]);
  const DEFAULT_ASPECT = "9:16";
  const DEFAULT_DURATION_SEC = 30;
  const MIN_DURATION_SEC = 5;
  const MAX_DURATION_SEC = 1800;

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function text(value, maxLength = 2000) {
    return String(value == null ? "" : value).trim().slice(0, maxLength);
  }

  function normalizeLanguage(value) {
    const normalized = text(value, 32).toLowerCase();
    return normalized || "vi";
  }

  function normalizeAspect(value) {
    const normalized = text(value, 16);
    return ALLOWED_ASPECTS.has(normalized) ? normalized : DEFAULT_ASPECT;
  }

  function normalizeDuration(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_DURATION_SEC;
    return Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(number)));
  }

  function normalizeConstraints(value) {
    const items = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\r?\n|;/g)
        : [];
    const seen = new Set();
    const normalized = [];
    for (const item of items) {
      const current = text(item, 500);
      if (!current || seen.has(current)) continue;
      seen.add(current);
      normalized.push(current);
      if (normalized.length >= 20) break;
    }
    return normalized;
  }

  function normalizeContentBriefInput(input = {}) {
    return {
      topic: text(input.topic, 1000),
      product: text(input.product, 1000),
      objective: text(input.objective, 2000),
      audience: text(input.audience, 1000),
      platform: text(input.platform, 64) || "generic",
      aspectRatio: normalizeAspect(input.aspectRatio),
      targetDurationSec: normalizeDuration(input.targetDurationSec),
      language: normalizeLanguage(input.language),
      tone: text(input.tone, 500),
      callToAction: text(input.callToAction, 1000),
      constraints: normalizeConstraints(input.constraints)
    };
  }

  function validateContentBrief(input = {}) {
    const value = normalizeContentBriefInput(input);
    const errors = [];
    if (!value.topic && !value.product) {
      errors.push({ code: "BRIEF_SUBJECT_REQUIRED", field: "topic", message: "Topic or product is required." });
    }

    const rawAspect = text(input.aspectRatio, 16);
    if (rawAspect && !ALLOWED_ASPECTS.has(rawAspect)) {
      errors.push({ code: "BRIEF_ASPECT_INVALID", field: "aspectRatio", message: "Aspect ratio is invalid." });
    }

    if (input.targetDurationSec != null && input.targetDurationSec !== "") {
      const rawDuration = Number(input.targetDurationSec);
      if (!Number.isFinite(rawDuration) || rawDuration < MIN_DURATION_SEC || rawDuration > MAX_DURATION_SEC) {
        errors.push({ code: "BRIEF_DURATION_INVALID", field: "targetDurationSec", message: "Target duration is invalid." });
      }
    }

    return { ok: errors.length === 0, value, errors };
  }

  function semanticBriefPayload(input = {}) {
    const value = normalizeContentBriefInput(input);
    return {
      topic: value.topic,
      product: value.product,
      objective: value.objective,
      audience: value.audience,
      platform: value.platform,
      aspectRatio: value.aspectRatio,
      targetDurationSec: value.targetDurationSec,
      language: value.language,
      tone: value.tone,
      callToAction: value.callToAction,
      constraints: value.constraints
    };
  }

  function hashString(value) {
    let hash = 0x811c9dc5;
    const source = String(value || "");
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function contentBriefSignature(input = {}) {
    return "brief-v" + CONTENT_BRIEF_VERSION + ":" + hashString(JSON.stringify(semanticBriefPayload(input)));
  }

  function normalizePersistedBrief(input) {
    if (!input || typeof input !== "object") return null;
    const validated = validateContentBrief(input);
    if (!validated.ok) return null;
    const signature = contentBriefSignature(validated.value);
    return {
      version: CONTENT_BRIEF_VERSION,
      id: text(input.id, 160) || "brief-" + signature.split(":").pop(),
      ...validated.value,
      inputSignature: signature,
      createdAt: input.createdAt ? String(input.createdAt) : null,
      updatedAt: input.updatedAt ? String(input.updatedAt) : null
    };
  }

  function createContentBrief(input = {}, options = {}) {
    const validated = validateContentBrief(input);
    if (!validated.ok) return validated;
    const nowValue = options.now == null ? Date.now() : options.now;
    const now = new Date(nowValue).toISOString();
    const signature = contentBriefSignature(validated.value);
    const value = {
      version: CONTENT_BRIEF_VERSION,
      id: text(options.id, 160) || "brief-" + signature.split(":").pop(),
      ...validated.value,
      inputSignature: signature,
      createdAt: options.createdAt ? String(options.createdAt) : now,
      updatedAt: now
    };
    return { ok: true, value, errors: [], signature };
  }

  function emptyAutomationState() {
    return {
      version: AUTOMATION_SCHEMA_VERSION,
      brief: null,
      script: null,
      scenePlan: null,
      assetRequests: [],
      resolvedAssets: [],
      composition: null,
      variations: [],
      jobs: {},
      stale: {
        script: false,
        scenes: false,
        assets: [],
        composition: false
      }
    };
  }

  function normalizeAutomationState(input) {
    if (!input || typeof input !== "object") return null;
    const normalized = emptyAutomationState();
    normalized.brief = normalizePersistedBrief(input.brief);
    normalized.script = clone(input.script, null);
    normalized.scenePlan = clone(input.scenePlan, null);
    normalized.assetRequests = Array.isArray(input.assetRequests) ? clone(input.assetRequests, []) : [];
    normalized.resolvedAssets = Array.isArray(input.resolvedAssets) ? clone(input.resolvedAssets, []) : [];
    normalized.composition = clone(input.composition, null);
    normalized.variations = Array.isArray(input.variations) ? clone(input.variations, []) : [];
    normalized.jobs = input.jobs && typeof input.jobs === "object" && !Array.isArray(input.jobs)
      ? clone(input.jobs, {})
      : {};
    normalized.stale = {
      script: input.stale?.script === true,
      scenes: input.stale?.scenes === true,
      assets: Array.isArray(input.stale?.assets) ? clone(input.stale.assets, []) : [],
      composition: input.stale?.composition === true
    };
    return normalized;
  }

  function withContentBrief(current, briefInput, options = {}) {
    const automation = normalizeAutomationState(current) || emptyAutomationState();
    const existingBrief = automation.brief;
    const created = createContentBrief(briefInput, {
      ...options,
      id: options.id || existingBrief?.id || undefined,
      createdAt: options.createdAt || existingBrief?.createdAt || undefined
    });
    if (!created.ok) return { ...created, automation };
    const previousSignature = existingBrief?.inputSignature || null;
    automation.brief = created.value;
    if (previousSignature && previousSignature !== created.signature) {
      automation.stale.script = Boolean(automation.script);
      automation.stale.scenes = Boolean(automation.scenePlan);
      automation.stale.assets = automation.resolvedAssets.map(asset => String(asset?.id || asset?.requestId || "")).filter(Boolean);
      automation.stale.composition = Boolean(automation.composition);
    }
    return { ok: true, value: created.value, automation, errors: [], signature: created.signature };
  }

  return {
    AUTOMATION_SCHEMA_VERSION,
    CONTENT_BRIEF_VERSION,
    DEFAULT_ASPECT,
    DEFAULT_DURATION_SEC,
    MIN_DURATION_SEC,
    MAX_DURATION_SEC,
    normalizeContentBriefInput,
    validateContentBrief,
    semanticBriefPayload,
    contentBriefSignature,
    normalizePersistedBrief,
    createContentBrief,
    emptyAutomationState,
    normalizeAutomationState,
    withContentBrief
  };
});
