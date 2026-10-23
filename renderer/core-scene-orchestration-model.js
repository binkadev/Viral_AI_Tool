(function attachSceneActionModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralSceneActionModel = api;
})(typeof window !== "undefined" ? window : globalThis, function sceneActionModel() {
  "use strict";
  // Input is ONE canonical normalized Scene. This projection neither plans nor
  // edits it: no title/sourceText/visualIntent/global-brief fallback exists.
  function buildSceneActionPlan(scene) {
    const sceneId = typeof scene?.id === "string" && scene.id ? scene.id : null;
    const queries = Object.freeze([...(scene?.searchQueries || [])]);
    const targetKinds = Object.freeze((scene?.targetKinds || []).filter(kind => kind === "video" || kind === "image"));
    const prompt = scene?.generationPrompt || null;
    return Object.freeze({ sceneId,
      search: Object.freeze({ available: !!sceneId && queries.length > 0 && targetKinds.length > 0,
        queries, targetKinds, orientation: scene?.orientation || "any" }),
      generation: Object.freeze({ available: !!sceneId && !!prompt && targetKinds.includes("video"), prompt }) });
  }
  function buildGenerationRequest(context, readiness, preferences = {}) {
    if (!context?.projectId || !context.sceneId || !context.prompt || !context.idempotencyKey) throw Error("SCENE_ACTION_INVALID");
    if (readiness?.ready !== true || readiness.state !== "ready") throw Error("SCENE_GENERATION_UNAVAILABLE");
    const request = { projectId: context.projectId, sceneId: context.sceneId, idempotencyKey: context.idempotencyKey,
      kind: "video", mode: "text-to-video", prompt: context.prompt,
      goal: ["economy", "balanced", "quality"].includes(preferences.goal) ? preferences.goal : "balanced" };
    const museSession = readiness.providers?.some(p => p.id === "muse" && p.ready) && !readiness.modelIds?.length;
    // Match existing AI Create policy: selected Muse session owns all specs.
    if (museSession) request.providerId = "muse";
    else {
      request.aspectRatio = ["9:16", "16:9", "1:1"].includes(preferences.aspect) ? preferences.aspect : "9:16";
      request.durationSeconds = ["5", "10"].includes(preferences.duration) ? Number(preferences.duration) : 5;
    }
    return Object.freeze(request);
  }
  return { buildSceneActionPlan, buildGenerationRequest };
});
