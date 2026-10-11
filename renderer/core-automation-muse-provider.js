(function installAutomationMuseProvider() {
  "use strict";

  const desktop = window.desktopAPI;
  const router = window.ViralAutomationAssetState?.router;
  if (!desktop?.getAutomationMuseStatus || !router?.register) return;

  let cachedStatus = null;
  let statusAt = 0;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function operationId(phase) {
    return 'muse-' + String(phase || 'op') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function normalizedError(payload, fallbackCode = 'PROVIDER_REJECTED') {
    const error = new Error(String(payload?.message || payload?.code || fallbackCode));
    error.code = String(payload?.code || fallbackCode);
    if (payload?.status) error.status = Number(payload.status);
    if (payload?.providerCode) error.providerCode = String(payload.providerCode);
    return error;
  }

  async function status(force = false) {
    if (!force && cachedStatus && Date.now() - statusAt < 2000) return cachedStatus;
    cachedStatus = await desktop.getAutomationMuseStatus();
    statusAt = Date.now();
    return cachedStatus || { ready: false, models: [] };
  }

  function sceneContext(sceneId) {
    const automation = appState()?.automation;
    const scenes = Array.isArray(automation?.scenePlan?.scenes) ? automation.scenePlan.scenes : [];
    const scene = scenes.find(item => String(item?.id || '') === String(sceneId || '')) || null;
    return scene ? {
      visualIntent: String(scene.visualIntent || ''),
      narration: String(scene.narration || ''),
      searchTerms: Array.isArray(scene.searchTerms) ? scene.searchTerms.slice(0, 12) : []
    } : null;
  }

  function enrichedRequest(request) {
    const scene = sceneContext(request?.sceneId);
    return {
      ...(request || {}),
      prompt: scene?.visualIntent || request?.query || '',
      visualIntent: scene?.visualIntent || '',
      narration: scene?.narration || '',
      searchTerms: scene?.searchTerms || []
    };
  }

  function bindAbort(signal, id) {
    if (!signal) return () => {};
    const cancel = () => desktop.cancelAutomationMuseVideo?.(id).catch?.(() => {});
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return () => signal.removeEventListener?.('abort', cancel);
  }

  const provider = {
    id: 'muse-video',
    capabilities: {
      strategies: ['generated'],
      mediaTypes: ['video'],
      aspects: ['16:9', '9:16', '1:1']
    },

    async isConfigured() {
      return (await status())?.ready === true;
    },

    async generate(request, { signal, onProgress } = {}) {
      const op = operationId('generate');
      const unbindAbort = bindAbort(signal, op);
      const unsubscribe = desktop.onAutomationMuseProgress?.(progress => {
        if (String(progress?.operationId || '') !== op) return;
        try { onProgress?.(progress); } catch {}
        window.dispatchEvent(new CustomEvent('viral-ai:automation-muse-progress', { detail: progress }));
      }) || (() => {});
      try {
        const response = await desktop.startAutomationMuseVideo({
          operationId: op,
          request: enrichedRequest(request)
        });
        if (!response?.ok) throw normalizedError(response?.error);
        return Array.isArray(response.candidates) ? response.candidates : [];
      } finally {
        unsubscribe();
        unbindAbort();
      }
    },

    async materialize(candidate, { signal, request } = {}) {
      const token = candidate?.raw?.candidateToken;
      if (!token) throw normalizedError({ code: 'STALE_INPUT', message: 'Muse Video result token is missing.' });
      const op = operationId('materialize');
      const unbindAbort = bindAbort(signal, op);
      try {
        const response = await desktop.materializeAutomationMuseVideo({
          operationId: op,
          candidateToken: token,
          request: enrichedRequest(request)
        });
        if (!response?.ok) throw normalizedError(response?.error);
        return response.asset;
      } finally {
        unbindAbort();
      }
    }
  };

  try { router.register(provider); } catch {}

  async function refreshStatus() {
    const snapshot = await status(true);
    window.ViralAutomationMuseStatus = snapshot;
    window.dispatchEvent(new CustomEvent('viral-ai:automation-muse-status', { detail: snapshot }));
    return snapshot;
  }

  refreshStatus().catch(() => {});

  window.ViralAutomationMuseProvider = {
    provider,
    refreshStatus,
    getStatus: () => cachedStatus,
    saveConfig: async payload => {
      const result = await desktop.saveAutomationMuseConfig(payload || {});
      await refreshStatus().catch(() => {});
      return result;
    },
    clearConfig: async () => {
      const result = await desktop.clearAutomationMuseConfig();
      await refreshStatus().catch(() => {});
      return result;
    }
  };
})();
