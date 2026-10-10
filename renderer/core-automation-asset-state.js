(function installAutomationAssetState() {
  "use strict";

  const model = window.ViralAutomationAssetModel;
  const routerApi = window.ViralAutomationAssetRouter;
  const router = routerApi?.createRouter?.({ providers: [] });

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
      detail: { reason: String(reason || "automation-asset-change") }
    }));
    try { window.ViralCoreProjectPersistence?.schedule?.(String(reason || "automation-asset-change")); } catch {}
  }

  function syncRequests() {
    const current = appState();
    const automation = current?.automation;
    if (!automation?.scenePlan) return { ok: false, code: "ASSET_SCENE_PLAN_REQUIRED", requests: [] };

    const result = model?.buildAssetRequests?.({
      brief: automation.brief || {},
      scenePlan: automation.scenePlan
    });
    if (!result?.ok) return { ok: false, code: result?.errors?.[0]?.code || "ASSET_REQUEST_INVALID", errors: result?.errors || [], requests: [] };

    automation.assetRequests = result.value;
    const validSignatures = new Set(result.value.map(request => request.requestSignature));
    automation.resolvedAssets = (Array.isArray(automation.resolvedAssets) ? automation.resolvedAssets : [])
      .filter(asset => validSignatures.has(String(asset?.requestSignature || "")));
    automation.stale.assets = (Array.isArray(automation.stale.assets) ? automation.stale.assets : [])
      .filter(id => automation.resolvedAssets.some(asset => String(asset?.id) === String(id)));
    automation.stale.composition = Boolean(automation.composition);
    emit("automation-asset-requests-synced");
    return { ok: true, requests: clone(result.value, []) };
  }

  function requests() {
    return clone(appState()?.automation?.assetRequests, []);
  }

  function requestForScene(sceneId) {
    return requests().find(request => String(request.sceneId) === String(sceneId)) || null;
  }

  async function resolveScene(sceneId, options = {}) {
    const current = appState();
    const automation = current?.automation;
    if (!automation?.scenePlan) return { ok: false, code: "ASSET_SCENE_PLAN_REQUIRED" };
    let request = requestForScene(sceneId);
    if (!request) {
      const synced = syncRequests();
      if (!synced.ok) return synced;
      request = synced.requests.find(item => String(item.sceneId) === String(sceneId)) || null;
    }
    if (!request) return { ok: false, code: "ASSET_REQUEST_NOT_FOUND" };

    try {
      const result = await router.resolve(request, options);
      if (result?.asset) {
        const existing = Array.isArray(automation.resolvedAssets) ? automation.resolvedAssets : [];
        automation.resolvedAssets = [
          ...existing.filter(asset => String(asset?.requestId) !== String(request.id)),
          result.asset
        ];
        automation.stale.assets = (Array.isArray(automation.stale.assets) ? automation.stale.assets : [])
          .filter(id => String(id) !== String(result.asset.id));
        automation.stale.composition = Boolean(automation.composition);
        emit("automation-asset-resolved");
      }
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        code: String(error?.code || "UNKNOWN"),
        message: String(error?.message || "Asset routing failed."),
        details: clone(error?.details, null)
      };
    }
  }

  function snapshot() {
    const current = appState()?.automation;
    return {
      requests: clone(current?.assetRequests, []),
      assets: clone(current?.resolvedAssets, []),
      stale: clone(current?.stale?.assets, []),
      router: router?.status?.() || { providers: [], activeRequestSignatures: [] }
    };
  }

  window.ViralAutomationAssetState = {
    syncRequests,
    requests,
    requestForScene,
    resolveScene,
    snapshot,
    router
  };
})();