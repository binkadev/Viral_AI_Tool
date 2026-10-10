(function installAutomationSceneState() {
  "use strict";

  const planner = window.ViralAutomationScenePlanner;

  function currentState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: String(reason || "automation-scene-change") }
    }));
    try { window.ViralCoreProjectPersistence?.schedule?.(String(reason || "automation-scene-change")); } catch {}
  }

  function markAssetsAndCompositionStale(current) {
    if (!current?.automation) return;
    current.automation.stale.assets = (current.automation.resolvedAssets || [])
      .map(asset => String(asset?.id || asset?.requestId || ""))
      .filter(Boolean);
    current.automation.stale.composition = Boolean(current.automation.composition);
  }

  function acceptPlan(input) {
    const current = currentState();
    const script = current?.automation?.script;
    if (!current?.automation || !script) return { ok: false, code: "AUTOMATION_SCRIPT_REQUIRED" };

    const plan = planner?.normalizeScenePlan?.(input);
    if (!plan) return { ok: false, code: "AUTOMATION_SCENE_PLAN_INVALID" };

    const expected = String(script.outputSignature || "");
    if (!plan.inputSignature || plan.inputSignature !== expected) {
      return { ok: false, code: "STALE_INPUT" };
    }

    const previousSignature = current.automation.scenePlan?.outputSignature || null;
    current.automation.scenePlan = plan;
    current.automation.stale.scenes = false;
    if (previousSignature && previousSignature !== plan.outputSignature) markAssetsAndCompositionStale(current);
    emit("automation-scene-plan-accepted");
    return { ok: true, plan: clone(plan, plan) };
  }

  function generatePlan() {
    const current = currentState();
    const brief = current?.automation?.brief;
    const script = current?.automation?.script;
    if (!brief || !script) return { ok: false, code: "AUTOMATION_SCRIPT_REQUIRED" };
    const result = planner?.planScenes?.({ brief, script });
    if (!result?.ok) return { ok: false, code: result?.errors?.[0]?.code || "AUTOMATION_SCENE_PLAN_INVALID", errors: result?.errors || [] };
    return acceptPlan(result.value);
  }

  function editScene(sceneId, patch = {}) {
    const current = currentState();
    const existing = current?.automation?.scenePlan;
    if (!existing?.scenes?.length) return { ok: false, code: "AUTOMATION_SCENE_PLAN_REQUIRED" };
    const index = existing.scenes.findIndex(scene => String(scene.id) === String(sceneId));
    if (index < 0) return { ok: false, code: "AUTOMATION_SCENE_NOT_FOUND" };

    const before = existing.scenes[index];
    const nextScene = {
      ...before,
      narration: patch.narration == null ? before.narration : String(patch.narration).trim(),
      visualIntent: patch.visualIntent == null ? before.visualIntent : String(patch.visualIntent).trim(),
      searchTerms: patch.searchTerms == null
        ? before.searchTerms
        : (Array.isArray(patch.searchTerms) ? patch.searchTerms : String(patch.searchTerms).split(/[,\n]/g))
            .map(item => String(item).trim())
            .filter(Boolean)
            .slice(0, 12),
      subtitleText: patch.subtitleText == null ? before.subtitleText : String(patch.subtitleText).trim()
    };
    if (!nextScene.narration) return { ok: false, code: "AUTOMATION_SCENE_NARRATION_REQUIRED" };

    const semanticBefore = JSON.stringify({ narration: before.narration, visualIntent: before.visualIntent, searchTerms: before.searchTerms, subtitleText: before.subtitleText });
    const semanticAfter = JSON.stringify({ narration: nextScene.narration, visualIntent: nextScene.visualIntent, searchTerms: nextScene.searchTerms, subtitleText: nextScene.subtitleText });
    if (semanticBefore === semanticAfter) return { ok: true, changed: false, scene: clone(before, before) };

    existing.scenes[index] = nextScene;
    existing.outputSignature = "scene-edit:" + Date.now().toString(36);
    existing.updatedAt = new Date().toISOString();
    existing.meta = {
      ...(existing.meta && typeof existing.meta === "object" ? existing.meta : {}),
      userEdited: true
    };
    current.automation.stale.scenes = false;
    markAssetsAndCompositionStale(current);
    emit("automation-scene-edited");
    return { ok: true, changed: true, scene: clone(nextScene, nextScene) };
  }

  function snapshot() {
    const current = currentState();
    return {
      plan: clone(current?.automation?.scenePlan, null),
      stale: current?.automation?.stale?.scenes === true
    };
  }

  window.ViralAutomationSceneState = {
    acceptPlan,
    generatePlan,
    editScene,
    snapshot
  };
})();
