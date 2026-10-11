(function installAutomationMetaMuseProvider() {
  "use strict";

  const desktop = window.desktopAPI;
  const router = window.ViralAutomationAssetState?.router;
  if (!desktop?.getAutomationMetaMuseStatus || !router?.register) return;

  let cachedStatus = null;
  let statusAt = 0;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function operationId(phase) {
    return 'meta-muse-' + String(phase || 'op') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  async function status(force = false) {
    if (!force && cachedStatus && Date.now() - statusAt < 2000) return cachedStatus;
    const response = await desktop.getAutomationMetaMuseStatus();
    cachedStatus = response?.status || { browserRunning: false, loggedIn: false, composerReady: false };
    statusAt = Date.now();
    return cachedStatus;
  }

  function normalizedError(payload, fallbackCode = 'META_MUSE_FAILED') {
    const error = new Error(String(payload?.message || payload?.code || fallbackCode));
    error.code = String(payload?.code || fallbackCode);
    error.details = payload?.details && typeof payload.details === 'object' ? payload.details : {};
    return error;
  }

  function sceneContext(sceneId) {
    const scenes = Array.isArray(appState()?.automation?.scenePlan?.scenes)
      ? appState().automation.scenePlan.scenes
      : [];
    return scenes.find(scene => String(scene?.id || '') === String(sceneId || '')) || null;
  }

  function enrichedRequest(request) {
    const scene = sceneContext(request?.sceneId);
    return {
      ...(request || {}),
      visualIntent: String(scene?.visualIntent || request?.query || ''),
      narration: String(scene?.narration || ''),
      searchTerms: Array.isArray(scene?.searchTerms) ? scene.searchTerms.slice(0, 12) : []
    };
  }

  function bindAbort(signal, operationIdValue) {
    if (!signal) return () => {};
    const cancel = () => desktop.cancelAutomationMetaMuse?.(operationIdValue).catch?.(() => {});
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return () => signal.removeEventListener?.('abort', cancel);
  }

  const provider = {
    id: 'meta-muse',
    capabilities: {
      strategies: ['generated'],
      mediaTypes: ['video'],
      aspects: ['16:9', '9:16', '1:1']
    },

    async isConfigured() {
      const snapshot = await status();
      return snapshot.loggedIn === true && snapshot.composerReady === true;
    },

    async generate(request, { signal, onProgress } = {}) {
      const op = operationId('generate');
      const unbindAbort = bindAbort(signal, op);
      const unsubscribe = desktop.onAutomationMetaMuseProgress?.(progress => {
        if (String(progress?.operationId || '') !== op) return;
        try { onProgress?.(progress); } catch {}
        window.dispatchEvent(new CustomEvent('viral-ai:automation-meta-muse-progress', { detail: progress }));
      }) || (() => {});
      try {
        const response = await desktop.startAutomationMetaMuseVideo({
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

    async materialize(candidate, { signal, request, onProgress } = {}) {
      const token = candidate?.raw?.candidateToken;
      if (!token) throw normalizedError({ code: 'STALE_INPUT', message: 'Muse generated media token is missing.' });
      const op = operationId('materialize');
      const unbindAbort = bindAbort(signal, op);
      const unsubscribe = desktop.onAutomationMetaMuseProgress?.(progress => {
        if (String(progress?.operationId || '') !== op) return;
        try { onProgress?.(progress); } catch {}
        window.dispatchEvent(new CustomEvent('viral-ai:automation-meta-muse-progress', { detail: progress }));
      }) || (() => {});
      try {
        const response = await desktop.materializeAutomationMetaMuse({
          operationId: op,
          candidateToken: token,
          request: enrichedRequest(request)
        });
        if (!response?.ok) throw normalizedError(response?.error);
        return response.asset;
      } finally {
        unsubscribe();
        unbindAbort();
      }
    }
  };

  try { router.register(provider); } catch {}

  async function refreshStatus() {
    const snapshot = await status(true);
    window.ViralAutomationMetaMuseStatus = snapshot;
    window.dispatchEvent(new CustomEvent('viral-ai:automation-meta-muse-status', { detail: snapshot }));
    return snapshot;
  }

  async function openLogin() {
    const response = await desktop.openAutomationMetaMuse();
    if (!response?.ok) throw normalizedError(response?.error);
    cachedStatus = response.status || cachedStatus;
    statusAt = Date.now();
    window.ViralAutomationMetaMuseStatus = cachedStatus;
    window.dispatchEvent(new CustomEvent('viral-ai:automation-meta-muse-status', { detail: cachedStatus }));
    return cachedStatus;
  }

  refreshStatus().catch(() => {});

  window.ViralAutomationMetaMuseProvider = {
    provider,
    refreshStatus,
    openLogin,
    getStatus: () => cachedStatus
  };
})();
