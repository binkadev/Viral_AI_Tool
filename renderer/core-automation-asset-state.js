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

  function staleSet(automation) {
    return new Set(Array.isArray(automation?.stale?.assets) ? automation.stale.assets.map(String) : []);
  }

  function currentAssetForRequest(automation, request, { allowStale = false } = {}) {
    const assets = Array.isArray(automation?.resolvedAssets) ? automation.resolvedAssets : [];
    const stale = staleSet(automation);
    return assets.find(asset => {
      if (String(asset?.requestSignature || "") !== String(request?.requestSignature || "")) return false;
      if (!allowStale && stale.has(String(asset?.id || ""))) return false;
      return true;
    }) || null;
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
    const resolvedAssets = Array.isArray(automation.resolvedAssets) ? automation.resolvedAssets : [];
    const staleIds = staleSet(automation);

    // Request synchronization may mark old assets stale, but it must never clear an
    // existing stale marker because that marker can also represent a missing/corrupt
    // local file discovered by the A5 health check. A successful re-resolution is the
    // only operation that clears an asset's stale marker.
    for (const asset of resolvedAssets) {
      const id = String(asset?.id || "");
      if (!id) continue;
      if (!validSignatures.has(String(asset?.requestSignature || ""))) staleIds.add(id);
    }

    automation.resolvedAssets = resolvedAssets;
    automation.stale.assets = [...staleIds];
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
        const staleIds = staleSet(automation);
        staleIds.delete(String(result.asset.id || ""));
        for (const asset of existing) {
          if (String(asset?.requestId || "") === String(request.id)) staleIds.delete(String(asset?.id || ""));
        }
        automation.stale.assets = [...staleIds].filter(Boolean);
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

  async function resolveAll({ signal, onProgress, includeResolved = false } = {}) {
    const synced = syncRequests();
    if (!synced.ok) return synced;
    const current = appState();
    const automation = current?.automation;
    const list = synced.requests || [];
    const results = [];
    let completed = 0;
    let resolved = 0;
    let skipped = 0;

    for (const request of list) {
      if (signal?.aborted) return { ok: false, code: "CANCELLED", completed, resolved, skipped, results };
      const existing = currentAssetForRequest(automation, request);
      if (existing && !includeResolved) {
        skipped += 1;
        completed += 1;
        const progress = { sceneId: request.sceneId, completed, total: list.length, resolved, skipped, state: "skipped" };
        try { onProgress?.(progress); } catch {}
        results.push({ ok: true, skipped: true, sceneId: request.sceneId, asset: clone(existing) });
        continue;
      }

      const startProgress = { sceneId: request.sceneId, completed, total: list.length, resolved, skipped, state: "resolving" };
      try { onProgress?.(startProgress); } catch {}
      const result = await resolveScene(request.sceneId, { signal });
      completed += 1;
      if (result?.ok && result?.asset) resolved += 1;
      results.push({ ...result, sceneId: request.sceneId });
      const progress = { sceneId: request.sceneId, completed, total: list.length, resolved, skipped, state: result?.ok ? "completed" : "failed", code: result?.code || null };
      try { onProgress?.(progress); } catch {}
      if (!result?.ok && result?.code === "CANCELLED") return { ok: false, code: "CANCELLED", completed, resolved, skipped, results };
    }

    const failures = results.filter(item => item?.ok === false);
    return {
      ok: failures.length === 0,
      code: failures.length ? "PARTIAL_FAILURE" : null,
      completed,
      total: list.length,
      resolved,
      skipped,
      failures: failures.map(item => ({ sceneId: item.sceneId, code: item.code || "UNKNOWN" })),
      results
    };
  }

  async function validateLocalAssets({ forceEmit = false } = {}) {
    const current = appState();
    const automation = current?.automation;
    const assets = Array.isArray(automation?.resolvedAssets) ? automation.resolvedAssets : [];
    if (!assets.length || !window.desktopAPI?.fileStatus) {
      return { ok: true, checked: 0, missing: [], available: [] };
    }

    const missing = [];
    const available = [];
    for (const asset of assets) {
      const id = String(asset?.id || "");
      const localPath = String(asset?.localPath || "");
      if (!id || !localPath) continue;
      try {
        const status = await window.desktopAPI.fileStatus(localPath);
        if (status?.exists === true) available.push(id);
        else missing.push(id);
      } catch {
        // Unknown file health must not destroy accepted project data.
      }
    }

    const staleIds = staleSet(automation);
    let changed = false;
    for (const id of missing) {
      if (!staleIds.has(id)) {
        staleIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      automation.stale.assets = [...staleIds];
      automation.stale.composition = Boolean(automation.composition) || missing.length > 0;
      emit("automation-asset-file-health");
    } else if (forceEmit) {
      emit("automation-asset-file-health-checked");
    }

    return { ok: true, checked: assets.length, missing, available };
  }

  function completion() {
    const current = appState()?.automation;
    const list = Array.isArray(current?.assetRequests) ? current.assetRequests : [];
    if (!list.length) return { total: 0, resolved: 0, missing: 0, complete: false };
    let resolved = 0;
    for (const request of list) {
      if (currentAssetForRequest(current, request)) resolved += 1;
    }
    return { total: list.length, resolved, missing: Math.max(0, list.length - resolved), complete: resolved === list.length };
  }

  function snapshot() {
    const current = appState()?.automation;
    return {
      requests: clone(current?.assetRequests, []),
      assets: clone(current?.resolvedAssets, []),
      stale: clone(current?.stale?.assets, []),
      completion: completion(),
      router: router?.status?.() || { providers: [], activeRequestSignatures: [] }
    };
  }

  window.ViralAutomationAssetState = {
    syncRequests,
    requests,
    requestForScene,
    resolveScene,
    resolveAll,
    validateLocalAssets,
    completion,
    snapshot,
    router
  };
})();
