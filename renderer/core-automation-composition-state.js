(function installAutomationCompositionState() {
  "use strict";

  const model = window.ViralAutomationCompositionModel;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: String(reason || "automation-composition-change") }
    }));
    try { window.ViralCoreProjectPersistence?.schedule?.(String(reason || "automation-composition-change")); } catch {}
  }

  function currentAutomation() {
    return appState()?.automation || null;
  }

  function currentAssetForScene(sceneId) {
    const automation = currentAutomation();
    const stale = new Set((Array.isArray(automation?.stale?.assets) ? automation.stale.assets : []).map(String));
    const assets = Array.isArray(automation?.resolvedAssets) ? automation.resolvedAssets : [];
    return assets.find(asset => String(asset?.sceneId || "") === String(sceneId || "") && !stale.has(String(asset?.id || "")) && asset?.localPath) || null;
  }

  function currentVoiceResult() {
    const fromVoiceState = window.ViralAutomationVoiceState?.currentResult?.();
    if (fromVoiceState) return fromVoiceState;
    const automation = currentAutomation();
    if (!automation?.voiceResult) return null;
    if (window.ViralAutomationVoiceModel?.isCurrent) {
      const current = window.ViralAutomationVoiceModel.isCurrent(automation.voiceResult, {
        brief: automation.brief || {},
        scenePlan: automation.scenePlan || {},
        voiceId: automation.voiceSettings?.voiceId || "default"
      });
      return current ? automation.voiceResult : null;
    }
    return null;
  }

  function readiness() {
    const automation = currentAutomation();
    const scenes = Array.isArray(automation?.scenePlan?.scenes) ? automation.scenePlan.scenes : [];
    if (!automation?.scenePlan || automation?.stale?.scenes === true || !scenes.length) {
      return { ready: false, code: "COMPOSITION_SCENE_PLAN_REQUIRED", total: scenes.length, assets: 0, missingSceneIds: scenes.map(scene => String(scene?.id || "")).filter(Boolean) };
    }
    const missingSceneIds = [];
    let assets = 0;
    for (const scene of scenes) {
      const id = String(scene?.id || "");
      if (currentAssetForScene(id)) assets += 1;
      else if (id) missingSceneIds.push(id);
    }
    return {
      ready: missingSceneIds.length === 0 && scenes.length > 0,
      code: missingSceneIds.length ? "COMPOSITION_ASSETS_REQUIRED" : null,
      total: scenes.length,
      assets,
      missingSceneIds
    };
  }

  function currentInputSignature() {
    const automation = currentAutomation();
    if (!automation?.scenePlan) return "";
    return model?.compositionInputSignature?.({
      brief: automation.brief || {},
      scenePlan: automation.scenePlan,
      resolvedAssets: automation.resolvedAssets || [],
      staleAssetIds: automation.stale?.assets || [],
      voiceResult: currentVoiceResult()
    }) || "";
  }

  function isCurrent() {
    const automation = currentAutomation();
    const plan = automation?.composition;
    if (!plan || automation?.stale?.composition === true) return false;
    const expected = currentInputSignature();
    return Boolean(expected && String(plan?.inputSignature || "") === expected);
  }

  function compose(options = {}) {
    const current = appState();
    const automation = current?.automation;
    if (!automation) return { ok: false, code: "COMPOSITION_AUTOMATION_REQUIRED" };
    const ready = readiness();
    if (!ready.ready) return { ok: false, code: ready.code, readiness: ready };

    const result = model?.buildCompositionPlan?.({
      brief: automation.brief || {},
      scenePlan: automation.scenePlan,
      resolvedAssets: automation.resolvedAssets || [],
      staleAssetIds: automation.stale?.assets || [],
      voiceResult: currentVoiceResult(),
      now: options.now == null ? Date.now() : options.now
    });
    if (!result?.ok) {
      return { ok: false, code: result?.errors?.[0]?.code || "COMPOSITION_INVALID", errors: result?.errors || [] };
    }

    const previous = automation.composition;
    const next = result.value;
    if (previous?.id && previous?.inputSignature === next.inputSignature) {
      next.id = previous.id;
      next.createdAt = previous.createdAt || next.createdAt;
      next.versionNumber = Number(previous.versionNumber || 1);
    } else if (previous?.id) {
      next.versionNumber = Math.max(1, Number(previous.versionNumber || 1) + 1);
    }

    automation.composition = next;
    automation.stale.composition = false;
    emit("automation-composition-built");
    return { ok: true, composition: clone(next), readiness: ready };
  }

  function markStale(reason = "automation-composition-stale") {
    const automation = currentAutomation();
    if (!automation?.composition) return false;
    if (automation.stale.composition === true) return true;
    automation.stale.composition = true;
    emit(reason);
    return true;
  }

  function snapshot() {
    const automation = currentAutomation();
    return {
      readiness: readiness(),
      composition: clone(automation?.composition, null),
      current: isCurrent(),
      inputSignature: currentInputSignature(),
      stale: automation?.stale?.composition === true,
      voiceReady: Boolean(currentVoiceResult())
    };
  }

  window.ViralAutomationCompositionState = {
    readiness,
    compose,
    isCurrent,
    currentInputSignature,
    currentVoiceResult,
    markStale,
    snapshot
  };
})();
