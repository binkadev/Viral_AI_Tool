(function attachCoreScenePlanModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreScenePlanModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreScenePlanModel() {
  "use strict";

  const SCENE_PLAN_SCHEMA_VERSION = 1;
  const MAX_SCENES = 2000;
  const MAX_SOURCE_SEGMENTS = 5000;
  const MAX_SEARCH_QUERIES = 8;
  const MAX_QUERY_LENGTH = 180;
  const MAX_PROMPT_LENGTH = 1600;
  const PLANNER_STATES = Object.freeze([
    "idle",
    "validating",
    "queued",
    "planning",
    "completed",
    "cancelling",
    "cancelled",
    "failed",
    "interrupted"
  ]);
  const ACTIVE_PLANNER_STATES = new Set(["validating", "queued", "planning", "cancelling"]);
  const SCENE_STATES = Object.freeze(["draft", "suggested", "edited", "locked"]);
  const TARGET_KINDS = Object.freeze(["video", "image"]);
  const ORIENTATIONS = Object.freeze(["any", "portrait", "landscape", "square"]);
  const LOCKABLE_FIELDS = Object.freeze([
    "timing",
    "visualIntent",
    "searchQueries",
    "generationPrompt",
    "targetKinds",
    "orientation",
    "shotType",
    "motion",
    "mood"
  ]);

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function text(value, max = 500) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback = min) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function iso(value, fallback = null) {
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
    return fallback;
  }

  function uniqueStrings(values, maxItems, maxLength) {
    const seen = new Set();
    const output = [];
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = text(value, maxLength);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
      if (output.length >= maxItems) break;
    }
    return output;
  }

  function plannerState(value) {
    const raw = text(value, 40).toLowerCase();
    return PLANNER_STATES.includes(raw) ? raw : "idle";
  }

  function sceneState(value) {
    const raw = text(value, 40).toLowerCase();
    return SCENE_STATES.includes(raw) ? raw : "draft";
  }

  function sourceSignature(input) {
    const source = Array.isArray(input) ? input : input?.segments;
    let hash = 2166136261;
    for (const segment of Array.isArray(source) ? source : []) {
      const stable = [
        text(segment?.id, 240),
        finite(segment?.start, 0).toFixed(3),
        finite(segment?.end, 0).toFixed(3),
        text(segment?.sourceText ?? segment?.text, 4000)
      ].join("\u001f");
      for (let index = 0; index < stable.length; index += 1) {
        hash ^= stable.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return "scene-source-v1:" + hash.toString(16).padStart(8, "0");
  }

  function normalizeTranscriptSegments(input) {
    const source = Array.isArray(input) ? input : input?.segments;
    return (Array.isArray(source) ? source : [])
      .slice(0, MAX_SOURCE_SEGMENTS)
      .map((segment, index) => {
        if (!segment || typeof segment !== "object") return null;
        const start = Math.max(0, finite(segment.start, 0));
        const end = Math.max(start, finite(segment.end, start));
        const sourceText = text(segment.sourceText ?? segment.text, 4000);
        if (!sourceText && end <= start) return null;
        return {
          id: text(segment.id, 240) || "segment-" + index,
          start,
          end,
          sourceText,
          index
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  }

  function stableSceneId(group, index) {
    const first = group[0];
    const last = group[group.length - 1];
    const owned = first && last ? first.id + ":" + last.id : String(index);
    return "scene:" + owned;
  }

  function normalizeLockedFields(value) {
    const allowed = new Set(LOCKABLE_FIELDS);
    return uniqueStrings(value, LOCKABLE_FIELDS.length, 80).filter(field => allowed.has(field));
  }

  function normalizeTargetKinds(value) {
    const allowed = new Set(TARGET_KINDS);
    const seen = new Set();
    const output = [];
    for (const candidate of Array.isArray(value) ? value : []) {
      const kind = text(candidate, 20).toLowerCase();
      if (!allowed.has(kind) || seen.has(kind)) continue;
      seen.add(kind);
      output.push(kind);
      if (output.length >= TARGET_KINDS.length) break;
    }
    return output;
  }

  function normalizeProvenance(value, now) {
    const source = value && typeof value === "object" ? value : {};
    const origin = ["deterministic", "ai", "manual"].includes(text(source.origin, 40).toLowerCase())
      ? text(source.origin, 40).toLowerCase()
      : "deterministic";
    return {
      origin,
      model: text(source.model, 160) || null,
      generatedAt: iso(source.generatedAt, origin === "deterministic" ? null : new Date(now).toISOString())
    };
  }

  function normalizeScene(input, index = 0, now = Date.now()) {
    if (!input || typeof input !== "object") return null;
    const start = Math.max(0, finite(input.start, 0));
    const end = Math.max(start, finite(input.end, start));
    const lockedFields = normalizeLockedFields(input.lockedFields);
    const targetKinds = normalizeTargetKinds(input.targetKinds);
    const orientationRaw = text(input.orientation, 20).toLowerCase();
    const orientation = ORIENTATIONS.includes(orientationRaw) ? orientationRaw : "any";
    const sourceSegmentIds = uniqueStrings(input.sourceSegmentIds, 500, 240);
    const id = text(input.id, 512) || "scene-" + index;
    const createdAt = iso(input.createdAt, new Date(now).toISOString());
    const updatedAt = iso(input.updatedAt, createdAt);
    const currentSceneState = lockedFields.length ? "locked" : sceneState(input.sceneState);

    return {
      id,
      order: Math.max(0, Math.round(finite(input.order, index))),
      start,
      end,
      duration: Math.max(0, end - start),
      sourceSegmentIds,
      sourceText: text(input.sourceText, 12000),
      title: text(input.title, 240) || null,
      visualIntent: text(input.visualIntent, 1200) || null,
      searchQueries: uniqueStrings(input.searchQueries, MAX_SEARCH_QUERIES, MAX_QUERY_LENGTH),
      generationPrompt: text(input.generationPrompt, MAX_PROMPT_LENGTH) || null,
      targetKinds: targetKinds.length ? targetKinds : ["video"],
      orientation,
      shotType: text(input.shotType, 120) || null,
      motion: text(input.motion, 120) || null,
      mood: text(input.mood, 120) || null,
      confidence: clamp(input.confidence, 0, 1, 0),
      sceneState: currentSceneState,
      lockedFields,
      provenance: normalizeProvenance(input.provenance, now),
      createdAt,
      updatedAt
    };
  }

  function normalizePlannerJob(value, { restartSafe = false } = {}) {
    const source = value && typeof value === "object" ? value : {};
    let status = plannerState(source.status);
    if (restartSafe && ACTIVE_PLANNER_STATES.has(status)) status = "interrupted";
    return {
      id: text(source.id, 240) || null,
      status,
      progress: clamp(source.progress, 0, 100, status === "completed" ? 100 : 0),
      errorCode: text(source.errorCode, 120) || null,
      startedAt: iso(source.startedAt, null),
      updatedAt: iso(source.updatedAt, null)
    };
  }

  function normalizePlan(input, { restartSafe = false } = {}) {
    const source = input && typeof input === "object" ? input : {};
    const seen = new Set();
    const scenes = [];
    for (const candidate of Array.isArray(source.scenes) ? source.scenes : []) {
      if (scenes.length >= MAX_SCENES) break;
      const scene = normalizeScene(candidate, scenes.length);
      if (!scene || seen.has(scene.id)) continue;
      seen.add(scene.id);
      scenes.push(scene);
    }
    scenes.sort((a, b) => a.order - b.order || a.start - b.start || a.id.localeCompare(b.id));
    scenes.forEach((scene, index) => { scene.order = index; });
    const selectedSceneId = text(source.selectedSceneId, 512) || null;
    const nowIso = new Date().toISOString();
    return {
      schemaVersion: SCENE_PLAN_SCHEMA_VERSION,
      sourceType: text(source.sourceType, 20).toLowerCase() === "script" ? "script" : "transcript",
      sourceIdentity: text(source.sourceIdentity, 512) || null,
      sourceSignature: text(source.sourceSignature, 120) || null,
      status: scenes.length ? "ready" : "empty",
      plannerJob: normalizePlannerJob(source.plannerJob, { restartSafe }),
      scenes,
      selectedSceneId: selectedSceneId && scenes.some(scene => scene.id === selectedSceneId)
        ? selectedSceneId
        : (scenes[0]?.id || null),
      createdAt: iso(source.createdAt, nowIso),
      updatedAt: iso(source.updatedAt, nowIso)
    };
  }

  function sceneFromGroup(group, index, now) {
    const first = group[0];
    const last = group[group.length - 1];
    return normalizeScene({
      id: stableSceneId(group, index),
      order: index,
      start: first.start,
      end: last.end,
      sourceSegmentIds: group.map(segment => segment.id),
      sourceText: group.map(segment => segment.sourceText).filter(Boolean).join(" "),
      sceneState: "draft",
      targetKinds: ["video"],
      orientation: "any",
      confidence: 0,
      provenance: { origin: "deterministic" }
    }, index, now);
  }

  function segmentTranscript(input, options = {}) {
    const segments = normalizeTranscriptSegments(input);
    if (!segments.length) return [];
    const minDuration = clamp(options.minDuration, 0.8, 12, 2.5);
    const targetDuration = clamp(options.targetDuration, minDuration, 20, 5.5);
    const maxDuration = clamp(options.maxDuration, targetDuration, 30, 9);
    const maxGap = clamp(options.maxGap, 0, 5, 1.25);
    const now = finite(options.now, Date.now());
    const groups = [];
    let current = [];

    function durationWith(segment) {
      if (!current.length) return Math.max(0, segment.end - segment.start);
      return Math.max(0, segment.end - current[0].start);
    }

    function flush() {
      if (!current.length) return;
      groups.push(current);
      current = [];
    }

    for (const segment of segments) {
      if (!current.length) {
        current.push(segment);
        continue;
      }
      const previous = current[current.length - 1];
      const gap = Math.max(0, segment.start - previous.end);
      const currentDuration = Math.max(0, previous.end - current[0].start);
      const combinedDuration = durationWith(segment);
      const shouldSplitForGap = gap > maxGap;
      const shouldSplitForMax = combinedDuration > maxDuration && currentDuration >= minDuration;
      const shouldSplitAtTarget = currentDuration >= targetDuration && combinedDuration > targetDuration * 1.35;
      if (shouldSplitForGap || shouldSplitForMax || shouldSplitAtTarget) flush();
      current.push(segment);
    }
    flush();

    return groups.slice(0, MAX_SCENES).map((group, index) => sceneFromGroup(group, index, now));
  }

  function createPlanFromTranscript(input, options = {}) {
    const segments = normalizeTranscriptSegments(input);
    const now = finite(options.now, Date.now());
    return normalizePlan({
      sourceType: "transcript",
      sourceIdentity: text(options.sourceIdentity || input?.sourcePath, 512) || null,
      sourceSignature: sourceSignature(segments),
      scenes: segmentTranscript(segments, { ...options, now }),
      plannerJob: { status: "idle", progress: 0 },
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    });
  }

  function isStale(plan, source) {
    const normalized = normalizePlan(plan);
    return Boolean(normalized.sourceSignature && normalized.sourceSignature !== sourceSignature(normalizeTranscriptSegments(source)));
  }

  function updateScene(plan, sceneIdValue, patch, now = Date.now()) {
    const current = normalizePlan(plan);
    const sceneId = text(sceneIdValue, 512);
    const nextPatch = patch && typeof patch === "object" ? clone(patch, {}) : {};
    const scenes = current.scenes.map((scene, index) => {
      if (scene.id !== sceneId) return scene;
      const protectedId = scene.id;
      const protectedCreatedAt = scene.createdAt;
      const requestedLocks = Object.prototype.hasOwnProperty.call(nextPatch, "lockedFields")
        ? normalizeLockedFields(nextPatch.lockedFields)
        : scene.lockedFields;
      const updated = normalizeScene({
        ...scene,
        ...nextPatch,
        id: protectedId,
        createdAt: protectedCreatedAt,
        updatedAt: new Date(now).toISOString(),
        lockedFields: requestedLocks,
        sceneState: requestedLocks.length ? "locked" : "edited",
        provenance: { ...scene.provenance, origin: "manual" }
      }, index, now);
      return updated || scene;
    });
    return normalizePlan({
      ...current,
      scenes,
      selectedSceneId: current.selectedSceneId,
      createdAt: current.createdAt,
      updatedAt: new Date(now).toISOString()
    });
  }

  function restartSafePlan(plan) {
    return normalizePlan(plan, { restartSafe: true });
  }

  return {
    SCENE_PLAN_SCHEMA_VERSION,
    MAX_SCENES,
    MAX_SOURCE_SEGMENTS,
    MAX_SEARCH_QUERIES,
    MAX_QUERY_LENGTH,
    MAX_PROMPT_LENGTH,
    PLANNER_STATES,
    ACTIVE_PLANNER_STATES,
    SCENE_STATES,
    TARGET_KINDS,
    ORIENTATIONS,
    LOCKABLE_FIELDS,
    clone,
    sourceSignature,
    normalizeTranscriptSegments,
    normalizeScene,
    normalizePlannerJob,
    normalizePlan,
    segmentTranscript,
    createPlanFromTranscript,
    isStale,
    updateScene,
    restartSafePlan
  };
});
