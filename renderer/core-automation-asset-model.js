(function attachAutomationAssetModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationAssetModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationAssetModel() {
  "use strict";

  const VERSION = 1;
  const ALLOWED_ASPECTS = new Set(["16:9", "9:16", "1:1"]);
  const ALLOWED_MEDIA_TYPES = new Set(["video", "image"]);
  const ALLOWED_STRATEGIES = new Set(["stock"]);

  function text(value, maxLength = 2000) {
    return String(value == null ? "" : value).trim().slice(0, maxLength);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function hashString(value) {
    let hash = 0x811c9dc5;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function uniqueStrings(items, max = 16, itemMax = 240) {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(items) ? items : []) {
      const value = text(item, itemMax);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length >= max) break;
    }
    return result;
  }

  function normalizedQuery(scene = {}) {
    const terms = uniqueStrings(scene.searchTerms, 10, 120);
    const fallback = text(scene.visualIntent || scene.narration, 700);
    return text(terms.join(" ") || fallback, 700);
  }

  function requestSignature(input = {}) {
    const stable = {
      sceneId: text(input.sceneId, 160),
      mediaType: text(input.mediaType, 24),
      query: text(input.query, 700).toLowerCase(),
      aspectRatio: text(input.aspectRatio, 16),
      minDurationSec: Number(number(input.minDurationSec, 0).toFixed(2)),
      desiredDurationSec: Number(number(input.desiredDurationSec, 0).toFixed(2)),
      style: uniqueStrings(input.style, 12, 120),
      motion: text(input.motion, 160),
      negativeConstraints: uniqueStrings(input.negativeConstraints, 16, 160),
      strategy: text(input.strategy, 40)
    };
    return "asset-request-v" + VERSION + ":" + hashString(JSON.stringify(stable));
  }

  function validateAssetRequest(input = {}) {
    const errors = [];
    const mediaType = text(input.mediaType || "video", 24).toLowerCase();
    const aspectRatio = text(input.aspectRatio || "9:16", 16);
    const strategy = text(input.strategy || "stock", 40).toLowerCase();
    const query = text(input.query, 700);
    const sceneId = text(input.sceneId, 160);
    const minDurationSec = Math.max(0, number(input.minDurationSec, 0));
    const desiredDurationSec = Math.max(minDurationSec, number(input.desiredDurationSec, minDurationSec));

    if (!sceneId) errors.push({ code: "ASSET_SCENE_REQUIRED", field: "sceneId" });
    if (!query) errors.push({ code: "ASSET_QUERY_REQUIRED", field: "query" });
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) errors.push({ code: "ASSET_MEDIA_TYPE_UNSUPPORTED", field: "mediaType" });
    if (!ALLOWED_ASPECTS.has(aspectRatio)) errors.push({ code: "ASSET_ASPECT_UNSUPPORTED", field: "aspectRatio" });
    if (!ALLOWED_STRATEGIES.has(strategy)) errors.push({ code: "ASSET_STRATEGY_UNSUPPORTED", field: "strategy" });
    if (mediaType === "video" && desiredDurationSec <= 0) errors.push({ code: "ASSET_DURATION_INVALID", field: "desiredDurationSec" });

    const value = {
      version: VERSION,
      id: text(input.id, 180),
      sceneId,
      sceneOrder: Math.max(1, Math.round(number(input.sceneOrder, 1))),
      mediaType,
      query,
      aspectRatio,
      minDurationSec: Number(minDurationSec.toFixed(2)),
      desiredDurationSec: Number(desiredDurationSec.toFixed(2)),
      style: uniqueStrings(input.style, 12, 120),
      motion: text(input.motion, 160),
      negativeConstraints: uniqueStrings(input.negativeConstraints, 16, 160),
      strategy,
      inputSignature: text(input.inputSignature, 240),
      createdAt: input.createdAt ? String(input.createdAt) : null
    };
    value.requestSignature = requestSignature(value);
    if (!value.id) value.id = "asset-request-" + value.requestSignature.split(":").pop();

    return { ok: errors.length === 0, errors, value };
  }

  function requestForScene(scene, brief = {}, scenePlan = {}, now = Date.now()) {
    const desired = Math.max(1, number(scene?.durationHintSec, 4));
    return validateAssetRequest({
      sceneId: scene?.id,
      sceneOrder: scene?.order,
      mediaType: "video",
      query: normalizedQuery(scene),
      aspectRatio: ALLOWED_ASPECTS.has(String(brief?.aspectRatio || "")) ? brief.aspectRatio : "9:16",
      minDurationSec: Math.max(1, Math.min(desired, desired * 0.7)),
      desiredDurationSec: desired,
      style: [],
      motion: "",
      negativeConstraints: ["watermark"],
      strategy: text(scene?.assetStrategy, 40) || "stock",
      inputSignature: text(scenePlan?.outputSignature, 240),
      createdAt: new Date(now).toISOString()
    });
  }

  function buildAssetRequests({ brief = {}, scenePlan = {}, now = Date.now() } = {}) {
    const scenes = Array.isArray(scenePlan?.scenes) ? scenePlan.scenes : [];
    const planSignature = text(scenePlan?.outputSignature, 240);
    if (!scenes.length || !planSignature) {
      return { ok: false, errors: [{ code: "ASSET_SCENE_PLAN_REQUIRED", field: "scenePlan" }], value: [] };
    }

    const requests = [];
    const errors = [];
    for (const scene of scenes) {
      const result = requestForScene(scene, brief, scenePlan, now);
      if (result.ok) requests.push(result.value);
      else errors.push(...result.errors.map(error => ({ ...error, sceneId: scene?.id || null })));
    }
    return { ok: errors.length === 0, errors, value: requests };
  }

  function orientationFor(width, height) {
    const w = number(width, 0);
    const h = number(height, 0);
    if (w <= 0 || h <= 0) return "unknown";
    const ratio = w / h;
    if (ratio > 1.18) return "landscape";
    if (ratio < 0.84) return "portrait";
    return "square";
  }

  function aspectOrientation(aspectRatio) {
    if (aspectRatio === "16:9") return "landscape";
    if (aspectRatio === "9:16") return "portrait";
    return "square";
  }

  function normalizeCandidate(input = {}, providerId = "") {
    const type = text(input.type || input.mediaType || "video", 24).toLowerCase();
    const width = Math.max(0, Math.round(number(input.width, 0)));
    const height = Math.max(0, Math.round(number(input.height, 0)));
    const durationSec = Math.max(0, number(input.durationSec ?? input.duration, 0));
    const provider = text(input.provider || providerId, 80);
    const providerAssetId = text(input.providerAssetId || input.id, 220);
    if (!provider || !providerAssetId || !ALLOWED_MEDIA_TYPES.has(type)) return null;
    return {
      id: "asset-candidate-" + hashString(provider + ":" + providerAssetId + ":" + type),
      provider,
      providerAssetId,
      type,
      width,
      height,
      durationSec: Number(durationSec.toFixed(2)),
      orientation: orientationFor(width, height),
      previewUrl: text(input.previewUrl, 3000),
      sourcePage: text(input.sourcePage, 3000),
      license: text(input.license, 500),
      attribution: text(input.attribution, 500),
      score: number(input.score, 0),
      raw: clone(input.raw, null)
    };
  }

  function candidateMatchesRequest(candidate, request) {
    if (!candidate || !request) return false;
    if (candidate.type !== request.mediaType) return false;
    if (candidate.orientation !== "unknown" && candidate.orientation !== aspectOrientation(request.aspectRatio)) return false;
    if (request.mediaType === "video" && candidate.durationSec > 0 && candidate.durationSec < request.minDurationSec) return false;
    return true;
  }

  function normalizeAssetRef(input = {}, request = {}) {
    const provider = text(input.provider, 80);
    const providerAssetId = text(input.providerAssetId, 220);
    const localPath = text(input.localPath, 4000);
    const type = text(input.type || request.mediaType, 24).toLowerCase();
    if (!provider || !providerAssetId || !localPath || !ALLOWED_MEDIA_TYPES.has(type)) return null;
    return {
      version: VERSION,
      id: text(input.id, 180) || "asset-ref-" + hashString(provider + ":" + providerAssetId + ":" + localPath),
      requestId: text(request.id || input.requestId, 180),
      requestSignature: text(request.requestSignature || input.requestSignature, 240),
      sceneId: text(request.sceneId || input.sceneId, 160),
      provider,
      providerAssetId,
      type,
      localPath,
      previewPath: text(input.previewPath, 4000),
      sourcePage: text(input.sourcePage, 3000),
      width: Math.max(0, Math.round(number(input.width, 0))),
      height: Math.max(0, Math.round(number(input.height, 0))),
      durationSec: Number(Math.max(0, number(input.durationSec, 0)).toFixed(2)),
      license: text(input.license, 500),
      attribution: text(input.attribution, 500),
      checksum: text(input.checksum, 300),
      cacheKey: text(input.cacheKey, 300),
      createdAt: input.createdAt ? String(input.createdAt) : new Date().toISOString()
    };
  }

  return {
    VERSION,
    ALLOWED_ASPECTS,
    ALLOWED_MEDIA_TYPES,
    ALLOWED_STRATEGIES,
    hashString,
    requestSignature,
    validateAssetRequest,
    requestForScene,
    buildAssetRequests,
    normalizeCandidate,
    candidateMatchesRequest,
    normalizeAssetRef,
    orientationFor,
    aspectOrientation
  };
});