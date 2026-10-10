(function attachAutomationVoiceModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationVoiceModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationVoiceModel() {
  "use strict";

  const VERSION = 1;

  function text(value, max = 4000) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function hashString(value) {
    let hash = 0x811c9dc5;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function segmentsFromScenePlan(scenePlan = {}) {
    const scenes = Array.isArray(scenePlan?.scenes) ? [...scenePlan.scenes] : [];
    scenes.sort((a, b) => number(a?.order, 0) - number(b?.order, 0));
    return scenes.map((scene, index) => ({
      id: text(scene?.id, 180) || `scene-${index + 1}`,
      sceneId: text(scene?.id, 180) || `scene-${index + 1}`,
      text: text(scene?.narration, 4096),
      durationSec: Math.max(0.35, number(scene?.durationHintSec, 1)),
      order: Math.max(1, Math.round(number(scene?.order, index + 1)))
    })).filter(segment => segment.text);
  }

  function inputSignature({ brief = {}, scenePlan = {}, voiceId = "default" } = {}) {
    const stable = {
      version: VERSION,
      language: text(brief?.language || "vi", 32),
      voiceId: text(voiceId || "default", 120),
      segments: segmentsFromScenePlan(scenePlan).map(segment => ({
        sceneId: segment.sceneId,
        text: segment.text,
        durationSec: Number(segment.durationSec.toFixed(3)),
        order: segment.order
      }))
    };
    return "automation-voice-input-v" + VERSION + ":" + hashString(JSON.stringify(stable));
  }

  function normalizeResult(input) {
    if (!input || typeof input !== "object") return null;
    const segments = Array.isArray(input.segments) ? input.segments : [];
    const normalized = segments.map((segment, index) => ({
      id: text(segment?.id || segment?.sceneId, 180) || `scene-${index + 1}`,
      sceneId: text(segment?.sceneId || segment?.id, 180) || `scene-${index + 1}`,
      text: text(segment?.text, 4096),
      audioPath: text(segment?.audioPath, 4000),
      duration: Math.max(0, number(segment?.duration, 0)),
      provider: text(segment?.provider || input?.provider, 80),
      developmentPreview: segment?.developmentPreview === true || input?.developmentPreview === true,
      aiGenerated: segment?.aiGenerated === true || input?.aiGenerated === true
    })).filter(segment => segment.sceneId && segment.audioPath);
    if (!normalized.length) return null;
    return {
      version: VERSION,
      id: text(input.id || input.jobId, 180) || "automation-voice-" + hashString(JSON.stringify(normalized)),
      jobId: text(input.jobId, 180) || null,
      provider: text(input.provider, 80),
      developmentPreview: input.developmentPreview === true,
      aiGenerated: input.aiGenerated === true,
      inputSignature: text(input.inputSignature, 240),
      segments: normalized,
      createdAt: input.createdAt ? String(input.createdAt) : null
    };
  }

  function isCurrent(result, options = {}) {
    const normalized = normalizeResult(result);
    if (!normalized) return false;
    const expected = inputSignature(options);
    return Boolean(expected && normalized.inputSignature === expected);
  }

  return {
    VERSION,
    hashString,
    segmentsFromScenePlan,
    inputSignature,
    normalizeResult,
    isCurrent
  };
});
