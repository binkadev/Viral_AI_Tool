(function attachAutomationCompositionModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationCompositionModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationCompositionModel() {
  "use strict";

  const VERSION = 1;

  function text(value, max = 4000) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value) {
    return Number(Math.max(0, number(value, 0)).toFixed(3));
  }

  function hashString(value) {
    let hash = 0x811c9dc5;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function compositionInputSignature({ brief = {}, scenePlan = {}, resolvedAssets = [], voiceResult = null } = {}) {
    const assets = (Array.isArray(resolvedAssets) ? resolvedAssets : [])
      .map(asset => ({
        sceneId: text(asset?.sceneId, 160),
        id: text(asset?.id, 180),
        requestSignature: text(asset?.requestSignature, 240),
        checksum: text(asset?.checksum, 300),
        localPath: text(asset?.localPath, 4000),
        durationSec: round(asset?.durationSec)
      }))
      .sort((a, b) => a.sceneId.localeCompare(b.sceneId));
    const stable = {
      aspectRatio: text(brief?.aspectRatio || "9:16", 16),
      targetDurationSec: round(brief?.targetDurationSec),
      scenePlanSignature: text(scenePlan?.outputSignature, 240),
      scenes: (Array.isArray(scenePlan?.scenes) ? scenePlan.scenes : []).map(scene => ({
        id: text(scene?.id, 160),
        order: Math.max(1, Math.round(number(scene?.order, 1))),
        durationHintSec: round(scene?.durationHintSec),
        narration: text(scene?.narration, 4000),
        subtitleText: text(scene?.subtitleText || scene?.narration, 4000)
      })),
      assets,
      voiceResultId: text(voiceResult?.id || voiceResult?.jobId, 180)
    };
    return "composition-input-v" + VERSION + ":" + hashString(JSON.stringify(stable));
  }

  function assetByScene(resolvedAssets = [], staleAssetIds = []) {
    const stale = new Set((Array.isArray(staleAssetIds) ? staleAssetIds : []).map(String));
    const map = new Map();
    for (const asset of Array.isArray(resolvedAssets) ? resolvedAssets : []) {
      const sceneId = text(asset?.sceneId, 160);
      const id = text(asset?.id, 180);
      if (!sceneId || !id || stale.has(id) || !asset?.localPath) continue;
      map.set(sceneId, asset);
    }
    return map;
  }

  function buildCompositionPlan({
    brief = {},
    scenePlan = {},
    resolvedAssets = [],
    staleAssetIds = [],
    voiceResult = null,
    now = Date.now()
  } = {}) {
    const scenes = Array.isArray(scenePlan?.scenes) ? [...scenePlan.scenes] : [];
    if (!scenes.length || !scenePlan?.outputSignature) {
      return { ok: false, errors: [{ code: "COMPOSITION_SCENE_PLAN_REQUIRED", field: "scenePlan" }], value: null };
    }

    scenes.sort((a, b) => number(a?.order, 0) - number(b?.order, 0));
    const assets = assetByScene(resolvedAssets, staleAssetIds);
    const missing = scenes.filter(scene => !assets.has(String(scene?.id || ""))).map(scene => String(scene?.id || "")).filter(Boolean);
    if (missing.length) {
      return { ok: false, errors: [{ code: "COMPOSITION_ASSETS_REQUIRED", field: "resolvedAssets", sceneIds: missing }], value: null };
    }

    let cursor = 0;
    const video = [];
    const subtitle = [];
    const sourceAssets = [];

    for (const scene of scenes) {
      const sceneId = text(scene?.id, 160);
      const asset = assets.get(sceneId);
      const desired = Math.max(0.25, number(scene?.durationHintSec, 4));
      const available = Math.max(0, number(asset?.durationSec, desired));
      const duration = round(available > 0 ? Math.min(desired, available) : desired);
      const start = round(cursor);
      const end = round(start + duration);
      const clipId = "composition-video-" + hashString(sceneId + ":" + String(asset?.id || "") + ":" + start + ":" + end);
      video.push({
        id: clipId,
        sceneId,
        track: "V1",
        assetId: text(asset?.id, 180),
        sourcePath: text(asset?.localPath, 4000),
        startSec: start,
        endSec: end,
        durationSec: duration,
        sourceInSec: 0,
        sourceOutSec: duration,
        fit: "cover",
        transitionIn: null,
        transitionOut: null
      });
      const subtitleText = text(scene?.subtitleText || scene?.narration, 4000);
      if (subtitleText) {
        subtitle.push({
          id: "composition-subtitle-" + hashString(sceneId + ":" + subtitleText),
          sceneId,
          track: "SUB",
          startSec: start,
          endSec: end,
          durationSec: duration,
          text: subtitleText
        });
      }
      sourceAssets.push({
        assetId: text(asset?.id, 180),
        sceneId,
        localPath: text(asset?.localPath, 4000),
        checksum: text(asset?.checksum, 300),
        provider: text(asset?.provider, 80),
        providerAssetId: text(asset?.providerAssetId, 220)
      });
      cursor = end;
    }

    const audio = [];
    const voiceSegments = Array.isArray(voiceResult?.segments) ? voiceResult.segments : [];
    for (const segment of voiceSegments) {
      const sceneId = text(segment?.sceneId || segment?.id, 160);
      const sceneClip = video.find(item => item.sceneId === sceneId);
      const audioPath = text(segment?.audioPath, 4000);
      if (!sceneClip || !audioPath) continue;
      audio.push({
        id: "composition-audio-" + hashString(sceneId + ":" + audioPath),
        sceneId,
        track: "A1",
        sourcePath: audioPath,
        startSec: sceneClip.startSec,
        endSec: sceneClip.endSec,
        durationSec: sceneClip.durationSec,
        sourceInSec: 0,
        sourceOutSec: sceneClip.durationSec
      });
    }

    const inputSignature = compositionInputSignature({ brief, scenePlan, resolvedAssets, voiceResult });
    const stableOutput = {
      inputSignature,
      durationSec: round(cursor),
      video: video.map(item => ({ sceneId: item.sceneId, assetId: item.assetId, startSec: item.startSec, endSec: item.endSec, sourcePath: item.sourcePath })),
      audio: audio.map(item => ({ sceneId: item.sceneId, sourcePath: item.sourcePath, startSec: item.startSec, endSec: item.endSec })),
      subtitle: subtitle.map(item => ({ sceneId: item.sceneId, startSec: item.startSec, endSec: item.endSec, text: item.text }))
    };
    const outputSignature = "composition-plan-v" + VERSION + ":" + hashString(JSON.stringify(stableOutput));
    const createdAt = new Date(now).toISOString();

    return {
      ok: true,
      errors: [],
      value: {
        version: VERSION,
        id: "composition-" + outputSignature.split(":").pop(),
        scenePlanId: text(scenePlan?.id, 180),
        scenePlanSignature: text(scenePlan?.outputSignature, 240),
        aspectRatio: text(brief?.aspectRatio || "9:16", 16),
        durationSec: round(cursor),
        tracks: { video, audio, subtitle },
        sourceAssets,
        voiceResultId: text(voiceResult?.id || voiceResult?.jobId, 180) || null,
        subtitleResultId: null,
        inputSignature,
        outputSignature,
        versionNumber: 1,
        createdAt,
        updatedAt: createdAt
      }
    };
  }

  function normalizeCompositionPlan(input) {
    if (!input || typeof input !== "object") return null;
    const tracks = input.tracks && typeof input.tracks === "object" ? input.tracks : {};
    return {
      version: VERSION,
      id: text(input.id, 180),
      scenePlanId: text(input.scenePlanId, 180),
      scenePlanSignature: text(input.scenePlanSignature, 240),
      aspectRatio: text(input.aspectRatio || "9:16", 16),
      durationSec: round(input.durationSec),
      tracks: {
        video: Array.isArray(tracks.video) ? tracks.video.map(item => ({ ...item })) : [],
        audio: Array.isArray(tracks.audio) ? tracks.audio.map(item => ({ ...item })) : [],
        subtitle: Array.isArray(tracks.subtitle) ? tracks.subtitle.map(item => ({ ...item })) : []
      },
      sourceAssets: Array.isArray(input.sourceAssets) ? input.sourceAssets.map(item => ({ ...item })) : [],
      voiceResultId: input.voiceResultId ? text(input.voiceResultId, 180) : null,
      subtitleResultId: input.subtitleResultId ? text(input.subtitleResultId, 180) : null,
      inputSignature: text(input.inputSignature, 240),
      outputSignature: text(input.outputSignature, 240),
      versionNumber: Math.max(1, Math.round(number(input.versionNumber, 1))),
      createdAt: input.createdAt ? String(input.createdAt) : null,
      updatedAt: input.updatedAt ? String(input.updatedAt) : null
    };
  }

  return {
    VERSION,
    hashString,
    compositionInputSignature,
    assetByScene,
    buildCompositionPlan,
    normalizeCompositionPlan
  };
});
