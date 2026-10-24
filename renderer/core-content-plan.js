(function attachContentPlan(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralContentPlan = api;
})(typeof window !== "undefined" ? window : globalThis, function contentPlan() {
  "use strict";
  const MAX_IDEA = 8000, MAX_BEATS = 12;
  const fail = code => { throw Object.assign(Error(code), { code }); };
  const clone = value => JSON.parse(JSON.stringify(value));
  function text(value, max, code = "PLAN_INVALID_RESULT") {
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(code);
    return value.trim();
  }
  function createBrief(idea, options = {}) {
    text(idea, MAX_IDEA, "PLAN_INVALID_IDEA");
    const duration = options.duration === undefined ? 30 : options.duration;
    if (!Number.isFinite(duration) || duration < 3 || duration > 180 || Math.abs(duration * 1000 - Math.round(duration * 1000)) > 1e-7) fail("PLAN_INVALID_DURATION");
    const neutral = (value, fallback, max = 240) => value === undefined ? fallback : text(value, max, "PLAN_INVALID_BRIEF");
    return { originalIdea: idea, subject: idea.trim().slice(0, 500),
      goal: neutral(options.goal, "inform"), audience: neutral(options.audience, "general"),
      platform: neutral(options.platform, "short-form"), duration,
      tone: neutral(options.tone, "neutral"), language: options.language === "en" ? "en" : "vi",
      orientation: ["portrait", "landscape", "square"].includes(options.orientation) ? options.orientation : "portrait" };
  }
  function validateBrief(input) {
    if (!input || typeof input !== "object") fail("PLAN_INVALID_BRIEF");
    const brief = createBrief(input.originalIdea, input);
    brief.subject = text(input.subject, 500, "PLAN_INVALID_BRIEF");
    return brief;
  }
  function semanticText(value, max) {
    const result = text(value, max);
    if (/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:^|\s)\/\/|\b(?:api[_ -]?key|bearer|sk-[a-z0-9]{12}))/iu.test(result)) fail("PLAN_INVALID_RESULT");
    return result;
  }
  // Beats are the ordered script, with production annotations. Only the existing
  // Scene authority materializes them into Scenes, at the durable commit boundary.
  function validateScript(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.beats) || input.beats.length < 3 || input.beats.length > MAX_BEATS) fail("PLAN_INVALID_RESULT");
    const beats = input.beats.map((beat, index, all) => {
      const purpose = index === 0 ? "hook" : index === all.length - 1 ? "cta" : "body";
      if (beat?.purpose !== purpose) fail("PLAN_INVALID_RESULT");
      const queries = beat.searchQueries;
      if (!Array.isArray(queries) || queries.length < 1 || queries.length > 8) fail("PLAN_INVALID_RESULT");
      const searchQueries = queries.map(query => semanticText(query, 180));
      if (new Set(searchQueries.map(query => query.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase())).size !== queries.length) fail("PLAN_INVALID_RESULT");
      const kinds = beat.targetKinds;
      if (!Array.isArray(kinds) || !kinds.length || kinds.length > 2 || new Set(kinds).size !== kinds.length || kinds.some(kind => !["image", "video"].includes(kind))) fail("PLAN_INVALID_RESULT");
      return { purpose, text: text(beat.text, 2000), visualIntent: semanticText(beat.visualIntent, 1200),
        searchQueries, generationPrompt: semanticText(beat.generationPrompt, 1600), targetKinds: [...kinds] };
    });
    const hook = text(input.hook, 2000), body = text(input.body, 10000), cta = text(input.cta, 2000);
    if (hook !== beats[0].text || cta !== beats.at(-1).text || body !== beats.slice(1, -1).map(beat => beat.text).join("\n\n")) fail("PLAN_INVALID_RESULT");
    const narration = beats.map(beat => beat.text).join("\n\n");
    if (narration.length > 12000) fail("PLAN_INVALID_RESULT");
    return { hook, body, cta, beats, narration };
  }
  function validateAuthoring(input) {
    if (input?.version !== 1 || input?.origin !== "ai") fail("PLAN_INVALID_RESULT");
    return { version: 1, origin: "ai", contentBrief: validateBrief(input.contentBrief), script: validateScript(input.script) };
  }
  function canAuthor(snapshot) {
    if (!snapshot) return true;
    if (snapshot.projectKind !== "ai" || snapshot.source || snapshot.scenePlan?.authoring || snapshot.media?.assets?.length || snapshot.workflow?.generationOutputs?.length || snapshot.workflow?.jobs?.length) return false;
    const plan = snapshot.scenePlan;
    if (["validating", "queued", "planning", "cancelling"].includes(plan?.plannerJob?.status)) return false;
    if (snapshot.mediaAssembly?.slots?.some(slot => slot.selectedAssetId || slot.candidateAssetIds?.length)) return false;
    const scenes = plan?.scenes || [];
    return scenes.length === 0 || scenes.length === 1 && scenes.every(scene =>
      !scene.title && !scene.purpose && !scene.sourceText && !scene.visualIntent && !scene.searchQueries?.length &&
      !scene.generationPrompt && !scene.start && !scene.end && !scene.lockedFields?.length && scene.sceneState === "draft");
  }
  function materialize(input, { sceneModel, id, now = Date.now() }) {
    const authoring = validateAuthoring(input), brief = authoring.contentBrief, beats = authoring.script.beats;
    const weights = beats.map(beat => Array.from(beat.text).length), total = weights.reduce((a, b) => a + b, 0);
    // Give each beat a positive minimum, then distribute the remaining time by
    // narration length. Millisecond boundaries are deterministic, not TTS alignment.
    const milliseconds = Math.round(brief.duration * 1000), base = 100;
    let cursor = 0, accumulated = 0;
    const scenes = beats.map((beat, order) => {
      accumulated += weights[order];
      const end = order === beats.length - 1 ? milliseconds : base * (order + 1) + Math.floor((milliseconds - base * beats.length) * accumulated / total);
      const sceneId = id();
      if (typeof sceneId !== "string" || !sceneId.trim() || sceneId.trim() !== sceneId || sceneId.length > 512) fail("PLAN_INVALID_SCENES");
      const scene = sceneModel.normalizeScene({ id: sceneId, order, purpose: beat.purpose, sourceText: beat.text,
        start: cursor / 1000, end: end / 1000, visualIntent: beat.visualIntent, searchQueries: beat.searchQueries,
        generationPrompt: beat.generationPrompt, targetKinds: beat.targetKinds, orientation: brief.orientation,
        sceneState: "suggested", provenance: { origin: "ai", generatedAt: new Date(now).toISOString() } }, order, now);
      cursor = end;
      return scene;
    });
    if (new Set(scenes.map(scene => scene.id)).size !== scenes.length || scenes.some(scene => !scene.id || scene.id.length > 512 || scene.end <= scene.start)) fail("PLAN_INVALID_SCENES");
    return sceneModel.normalizePlan({ sourceType: "script", authoring, scenes, selectedSceneId: scenes[0].id,
      plannerJob: { status: "completed", progress: 100 }, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }, { now });
  }
  function create({ persistence, sceneModel, adapter = null, changed = () => {} }) {
    let status = "idle", active = null;
    const publish = next => { status = next; try { changed(status); } catch {} };
    const result = code => ({ ok: false, code });
    async function generate(idea, options = {}) {
      if (active) return result("PLAN_BUSY");
      const controller = new AbortController();
      active = controller;
      publish("validating");
      try {
        const contentBrief = createBrief(idea, options), before = persistence.snapshot();
        if (!canAuthor(before)) fail("PLAN_EXISTING_CONTENT");
        if (typeof adapter?.generate !== "function") fail("PLAN_UNAVAILABLE");
        const signature = JSON.stringify(before), projectId = before?.projectId || null;
        publish("queued");
        if (controller.signal.aborted) fail("PLAN_CANCELLED");
        publish("planning");
        if (controller.signal.aborted) fail("PLAN_CANCELLED");
        const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(Object.assign(Error("PLAN_CANCELLED"), { code: "PLAN_CANCELLED" })), { once: true }));
        const raw = await Promise.race([Promise.resolve().then(() => {
          if (controller.signal.aborted) fail("PLAN_CANCELLED");
          return adapter.generate({ contentBrief: clone(contentBrief),
            suggestedSceneCount: Math.max(3, Math.min(6, Math.round(contentBrief.duration / 6))), signal: controller.signal });
        }), aborted]);
        if (controller.signal.aborted) fail("PLAN_CANCELLED");
        const authoring = validateAuthoring({ version: 1, origin: "ai", contentBrief, script: raw });
        if (JSON.stringify(persistence.snapshot()) !== signature) fail("PLAN_PROJECT_CHANGED");
        const snapshot = persistence.commitContentPlan(authoring, { projectId, expectedSignature: signature, idea });
        publish("completed");
        return { ok: true, snapshot };
      } catch (error) {
        const cancelled = controller.signal.aborted;
        publish(cancelled ? "cancelled" : "failed");
        return result(cancelled ? "PLAN_CANCELLED" : /^PLAN_[A-Z_]+$/.test(error?.code || error?.message) ? error.code || error.message : "PLAN_FAILED");
      } finally { active = null; }
    }
    return { generate, cancel() { if (active) { publish("cancelling"); active.abort(); } },
      state: () => status, busy: () => !!active, ready: () => typeof adapter?.generate === "function" };
  }
  return { MAX_IDEA, MAX_BEATS, createBrief, validateBrief, validateScript, validateAuthoring, canAuthor, materialize, create };
});
