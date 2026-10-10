(function installAutomationDesktopStockProvider() {
  "use strict";

  const assetState = window.ViralAutomationAssetState;
  const router = assetState?.router;
  const desktop = window.desktopAPI;
  if (!router?.register || !desktop?.getAutomationStockStatus) return;

  let cachedStatus = null;
  let statusAt = 0;

  function operationId(provider, phase) {
    return 'stock-' + String(provider) + '-' + String(phase) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  async function status(force = false) {
    if (!force && cachedStatus && Date.now() - statusAt < 2000) return cachedStatus;
    cachedStatus = await desktop.getAutomationStockStatus();
    statusAt = Date.now();
    return cachedStatus || { providers: [] };
  }

  function providerStatus(id, snapshot) {
    const list = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
    return list.find(item => String(item?.id) === String(id)) || null;
  }

  function normalizedError(payload, fallbackCode = 'PROVIDER_REJECTED') {
    const error = new Error(String(payload?.message || payload?.code || fallbackCode));
    error.code = String(payload?.code || fallbackCode);
    return error;
  }

  function bindAbort(signal, id) {
    if (!signal) return () => {};
    const cancel = () => desktop.cancelAutomationStock?.(id).catch?.(() => {});
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return () => signal.removeEventListener?.('abort', cancel);
  }

  function createProvider(id) {
    return {
      id,
      capabilities: {
        strategies: ['stock'],
        mediaTypes: ['video'],
        aspects: ['16:9', '9:16', '1:1']
      },

      async isConfigured() {
        const snapshot = await status();
        return providerStatus(id, snapshot)?.ready === true;
      },

      async search(request, { signal } = {}) {
        const op = operationId(id, 'search');
        const unbind = bindAbort(signal, op);
        try {
          const response = await desktop.searchAutomationStock({ provider: id, operationId: op, request });
          if (!response?.ok) throw normalizedError(response?.error);
          return Array.isArray(response.candidates) ? response.candidates : [];
        } finally {
          unbind();
        }
      },

      async materialize(candidate, { signal, request } = {}) {
        const token = candidate?.raw?.candidateToken;
        if (!token) throw normalizedError({ code: 'STALE_INPUT', message: 'Stock candidate token is missing.' });
        const op = operationId(id, 'materialize');
        const unbind = bindAbort(signal, op);
        try {
          const response = await desktop.materializeAutomationStock({
            provider: id,
            operationId: op,
            candidateToken: token,
            request
          });
          if (!response?.ok) throw normalizedError(response?.error);
          return response.asset;
        } finally {
          unbind();
        }
      }
    };
  }

  ['pexels', 'dev-stock'].forEach(id => {
    try { router.register(createProvider(id)); } catch {}
  });

  status(true)
    .then(snapshot => {
      window.ViralAutomationStockStatus = snapshot;
      window.dispatchEvent(new CustomEvent('viral-ai:automation-stock-status', { detail: snapshot }));
    })
    .catch(() => {});

  window.ViralAutomationDesktopStockProvider = {
    refreshStatus: async () => {
      const snapshot = await status(true);
      window.ViralAutomationStockStatus = snapshot;
      window.dispatchEvent(new CustomEvent('viral-ai:automation-stock-status', { detail: snapshot }));
      return snapshot;
    }
  };
})();
