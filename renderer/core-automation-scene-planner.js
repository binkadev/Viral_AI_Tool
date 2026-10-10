(function attachAutomationScenePlanner(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationScenePlanner = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationScenePlanner() {
  "use strict";

  const VERSION = 1;
  const MIN_SCENE_SEC = 2.5;
  const TARGET_SCENE_SEC = 4.5;
  const MAX_SCENES = 16;

  const STOPWORDS = new Set([
    "và","là","của","cho","một","những","các","với","trong","khi","để","được","này","đó","thì","về","từ","trên","bạn","mình","chúng","tôi","anh","em","hãy","sẽ","có","không","nhưng","hoặc","the","and","for","with","from","that","this","your","you","are","was","will","into","about","how","what","why"
  ]);

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function text(value, maxLength = 24000) {
    return String(value == null ? "" : value).trim().slice(0, maxLength);
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

  function splitSentences(value) {
    const source = text(value);
    if (!source) return [];
    return source
      .replace(/\r/g, "\n")
      .split(/(?<=[.!?…])\s+|\n{2,}/g)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function mergeToCount(sentences, desiredCount) {
    if (sentences.length <= desiredCount) return sentences.slice();
    const groups = [];
    const totalChars = sentences.reduce((sum, item) => sum + item.length, 0) || 1;
    const targetChars = totalChars / desiredCount;
    let current = "";
    let currentChars = 0;

    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      const remainingSentences = sentences.length - index;
      const remainingGroups = desiredCount - groups.length;
      const shouldFlush = current && currentChars >= targetChars && remainingSentences >= remainingGroups;
      if (shouldFlush) {
        groups.push(current.trim());
        current = "";
        currentChars = 0;
      }
      current += (current ? " " : "") + sentence;
      currentChars += sentence.length;
    }
    if (current.trim()) groups.push(current.trim());

    while (groups.length > desiredCount) {
      const last = groups.pop();
      groups[groups.length - 1] = (groups[groups.length - 1] + " " + last).trim();
    }
    return groups;
  }

  function keywords(value, limit = 5) {
    const words = text(value, 4000)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/g)
      .map(word => word.trim())
      .filter(word => word.length > 2 && !STOPWORDS.has(word));

    const counts = new Map();
    words.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word]) => word);
  }

  function visualIntentFor(narration, index, total, brief = {}) {
    const terms = keywords([brief.topic, brief.product, narration].filter(Boolean).join(" "), 4);
    const phase = index === 0 ? "hook" : index === total - 1 ? "cta" : "body";
    const subject = terms.join(" ") || text(brief.topic || brief.product || "main subject", 120);
    if (phase === "hook") return "Opening visual with immediate attention on " + subject + ".";
    if (phase === "cta") return "Closing visual that reinforces " + subject + " and leaves space for the call to action.";
    return "Supporting visual that clearly illustrates " + subject + " for this narration beat.";
  }

  function searchTermsFor(narration, brief = {}) {
    const base = keywords([brief.topic, brief.product, narration].filter(Boolean).join(" "), 6);
    const platformHint = brief.aspectRatio === "9:16" ? "vertical" : brief.aspectRatio === "1:1" ? "square" : "cinematic";
    return [...base, platformHint].filter(Boolean).slice(0, 7);
  }

  function validateInputs({ brief, script } = {}) {
    const errors = [];
    if (!script || typeof script !== "object") errors.push({ code: "SCENE_SCRIPT_REQUIRED", field: "script" });
    const narration = text(script?.narrationText || [script?.hook, script?.body, script?.callToAction].filter(Boolean).join(" "));
    if (!narration) errors.push({ code: "SCENE_NARRATION_REQUIRED", field: "narrationText" });
    const scriptSignature = text(script?.outputSignature, 240);
    if (!scriptSignature) errors.push({ code: "SCENE_SCRIPT_SIGNATURE_REQUIRED", field: "outputSignature" });
    const duration = Number(brief?.targetDurationSec || 30);
    if (!Number.isFinite(duration) || duration <= 0) errors.push({ code: "SCENE_DURATION_INVALID", field: "targetDurationSec" });
    return { ok: errors.length === 0, errors, narration, scriptSignature, duration: Math.max(5, Math.min(1800, duration || 30)) };
  }

  function planScenes({ brief = {}, script = {}, now = Date.now() } = {}) {
    const validated = validateInputs({ brief, script });
    if (!validated.ok) return { ok: false, errors: validated.errors, value: null };

    const sentences = splitSentences(validated.narration);
    const fallback = sentences.length ? sentences : [validated.narration];
    const desiredCount = Math.max(1, Math.min(MAX_SCENES, Math.round(validated.duration / TARGET_SCENE_SEC)));
    const chunks = mergeToCount(fallback, desiredCount);
    const totalChars = chunks.reduce((sum, item) => sum + item.length, 0) || chunks.length;

    let cursor = 0;
    const scenes = chunks.map((narration, index) => {
      const share = narration.length / totalChars;
      const remainingScenes = chunks.length - index;
      const remainingTime = Math.max(0, validated.duration - cursor);
      let duration = index === chunks.length - 1
        ? remainingTime
        : Math.max(MIN_SCENE_SEC, validated.duration * share);
      const maxForCurrent = Math.max(MIN_SCENE_SEC, remainingTime - Math.max(0, remainingScenes - 1) * MIN_SCENE_SEC);
      duration = Math.min(duration, maxForCurrent);
      duration = Math.max(MIN_SCENE_SEC, duration);
      if (index === chunks.length - 1) duration = Math.max(MIN_SCENE_SEC, remainingTime || MIN_SCENE_SEC);
      duration = Number(duration.toFixed(2));

      const sceneSeed = validated.scriptSignature + ":" + index + ":" + narration;
      const scene = {
        id: "scene-" + hashString(sceneSeed),
        order: index + 1,
        narration,
        startHintSec: Number(cursor.toFixed(2)),
        durationHintSec: duration,
        visualIntent: visualIntentFor(narration, index, chunks.length, brief),
        searchTerms: searchTermsFor(narration, brief),
        assetStrategy: "stock",
        transitionHint: index === 0 ? "cut" : "clean-cut",
        subtitleText: narration
      };
      cursor += duration;
      return scene;
    });

    if (scenes.length) {
      const last = scenes[scenes.length - 1];
      last.durationHintSec = Number(Math.max(MIN_SCENE_SEC, validated.duration - last.startHintSec).toFixed(2));
    }

    const createdAt = new Date(now).toISOString();
    const outputSignature = "scene-plan-v" + VERSION + ":" + hashString(JSON.stringify({
      script: validated.scriptSignature,
      duration: validated.duration,
      scenes: scenes.map(scene => ({ narration: scene.narration, durationHintSec: scene.durationHintSec, visualIntent: scene.visualIntent, searchTerms: scene.searchTerms }))
    }));

    return {
      ok: true,
      errors: [],
      value: {
        version: VERSION,
        id: "scene-plan-" + outputSignature.split(":").pop(),
        scriptId: script.id ? String(script.id) : null,
        inputSignature: validated.scriptSignature,
        outputSignature,
        targetDurationSec: validated.duration,
        scenes,
        createdAt,
        updatedAt: createdAt,
        meta: {
          planner: "deterministic-v1",
          providerRequired: false
        }
      }
    };
  }

  function normalizeScenePlan(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.scenes) || !input.scenes.length) return null;
    const scenes = input.scenes.map((scene, index) => ({
      id: text(scene?.id, 160) || "scene-" + hashString(String(index) + ":" + text(scene?.narration)),
      order: index + 1,
      narration: text(scene?.narration, 6000),
      startHintSec: Math.max(0, Number(scene?.startHintSec || 0)),
      durationHintSec: Math.max(MIN_SCENE_SEC, Number(scene?.durationHintSec || MIN_SCENE_SEC)),
      visualIntent: text(scene?.visualIntent, 2000),
      searchTerms: Array.isArray(scene?.searchTerms) ? scene.searchTerms.map(item => text(item, 120)).filter(Boolean).slice(0, 12) : [],
      assetStrategy: text(scene?.assetStrategy, 40) || "stock",
      transitionHint: text(scene?.transitionHint, 80) || "clean-cut",
      subtitleText: text(scene?.subtitleText || scene?.narration, 6000)
    })).filter(scene => scene.narration);
    if (!scenes.length) return null;
    return {
      version: Number(input.version || VERSION),
      id: text(input.id, 160) || null,
      scriptId: input.scriptId ? String(input.scriptId) : null,
      inputSignature: text(input.inputSignature, 240),
      outputSignature: text(input.outputSignature, 240),
      targetDurationSec: Math.max(5, Number(input.targetDurationSec || scenes.reduce((sum, scene) => sum + scene.durationHintSec, 0))),
      scenes,
      createdAt: input.createdAt ? String(input.createdAt) : null,
      updatedAt: input.updatedAt ? String(input.updatedAt) : null,
      meta: clone(input.meta, null)
    };
  }

  return {
    VERSION,
    MIN_SCENE_SEC,
    TARGET_SCENE_SEC,
    MAX_SCENES,
    splitSentences,
    keywords,
    validateInputs,
    planScenes,
    normalizeScenePlan
  };
});
