'use strict';

const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, safeStorage } = require('electron');
const { createAssetCache } = require('./asset-cache');
const { createMuseConfigStore } = require('./muse-config-store');
const { createMuseVideoProvider } = require('./muse-video-provider');

let installed = false;
let cacheInstance = null;
let configInstance = null;
let providerInstance = null;
const operations = new Map();
const candidateTokens = new Map();

function cache() {
  if (!cacheInstance) {
    cacheInstance = createAssetCache({
      rootDir: path.join(app.getPath('userData'), 'automation-assets')
    });
  }
  return cacheInstance;
}

function configStore() {
  if (!configInstance) {
    configInstance = createMuseConfigStore({
      userDataPath: app.getPath('userData'),
      safeStorage
    });
  }
  return configInstance;
}

function provider() {
  if (!providerInstance) {
    providerInstance = createMuseVideoProvider({
      cache: cache(),
      configStore: configStore()
    });
  }
  return providerInstance;
}

function pruneTokens() {
  const now = Date.now();
  for (const [token, entry] of candidateTokens) {
    if (!entry || entry.expiresAt <= now) candidateTokens.delete(token);
  }
}

function publicCandidate(candidate) {
  const token = crypto.randomUUID();
  candidateTokens.set(token, {
    candidate,
    expiresAt: Date.now() + 30 * 60 * 1000
  });
  return {
    providerAssetId: String(candidate?.providerAssetId || ''),
    type: String(candidate?.type || 'video'),
    width: Number(candidate?.width || 0),
    height: Number(candidate?.height || 0),
    durationSec: Number(candidate?.durationSec || 0),
    // Result/download URLs can be signed and short-lived. Keep them in the main
    // process token vault and expose only a candidate token to the renderer.
    previewUrl: '',
    sourcePage: String(candidate?.sourcePage || ''),
    license: String(candidate?.license || ''),
    attribution: String(candidate?.attribution || ''),
    score: Number(candidate?.score || 0),
    raw: {
      candidateToken: token,
      model: String(candidate?.raw?.model || ''),
      consumedCredits: Number(candidate?.raw?.consumedCredits || 0),
      generateAudio: candidate?.raw?.generateAudio === true
    }
  };
}

function normalizedCode(error) {
  const explicit = String(error?.code || '').toUpperCase();
  const providerCode = String(error?.providerCode || '').toUpperCase();
  const status = Number(error?.status || 0);
  if (explicit === 'CANCELLED' || String(error?.name || '').toLowerCase() === 'aborterror') return 'CANCELLED';
  if (explicit === 'PROVIDER_TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (explicit === 'PROVIDER_NOT_CONFIGURED') return 'PROVIDER_NOT_CONFIGURED';
  if (explicit === 'INVALID_INPUT') return 'INVALID_INPUT';
  if (explicit === 'FILE_INVALID') return 'FILE_INVALID';
  if (providerCode === 'INVALID_API_KEY' || status === 401 || status === 403) return 'AUTH_REQUIRED';
  if (providerCode === 'INSUFFICIENT_CREDITS' || status === 402) return 'QUOTA_EXCEEDED';
  if (providerCode === 'RATE_LIMITED' || providerCode === 'TOO_MANY_TASKS' || status === 429) return 'RATE_LIMITED';
  if (providerCode === 'TIMEOUT' || status === 504) return 'PROVIDER_TIMEOUT';
  if ([500, 503].includes(status)) return 'NETWORK_ERROR';
  if (providerCode === 'CONTENT_POLICY_VIOLATION') return 'PROVIDER_REJECTED';
  if (providerCode === 'INVALID_PROMPT' || providerCode === 'INVALID_MODEL' || providerCode === 'INVALID_PARAMETER') return 'INVALID_INPUT';
  return 'PROVIDER_REJECTED';
}

function publicError(error) {
  return {
    code: normalizedCode(error),
    status: Number(error?.status || 0) || null,
    providerCode: error?.providerCode ? String(error.providerCode) : null,
    message: String(error?.message || 'Muse Video operation failed.').slice(0, 500)
  };
}

function operation(operationId) {
  const id = String(operationId || crypto.randomUUID());
  if (operations.has(id)) {
    const error = new Error('An identical Muse Video operation is already active.');
    error.code = 'DUPLICATE_ACTIVE';
    throw error;
  }
  const controller = new AbortController();
  operations.set(id, controller);
  return { id, controller };
}

async function status() {
  const configured = await provider().isConfigured().catch(() => false);
  const config = configStore().publicConfig();
  return {
    ready: configured,
    provider: 'muse-video',
    config,
    models: provider().modelCatalog(),
    capabilities: provider().capabilities,
    activeCount: operations.size
  };
}

function installAutomationMuseVideoIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:muse-status', async () => status());
  ipcMain.handle('automation:muse-config-get', async () => configStore().publicConfig());
  ipcMain.handle('automation:muse-config-save', async (_event, payload) => {
    try {
      const config = configStore().save(payload && typeof payload === 'object' ? payload : {});
      return { ok: true, config };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
  ipcMain.handle('automation:muse-config-clear', async () => {
    try {
      return { ok: true, config: configStore().clear() };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.handle('automation:muse-generate', async (event, payload) => {
    pruneTokens();
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    let op;
    try {
      op = operation(safePayload.operationId);
      const candidates = await provider().generate(safePayload.request || {}, {
        signal: op.controller.signal,
        onProgress: progress => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('automation:muse-progress', {
              operationId: op.id,
              ...(progress && typeof progress === 'object' ? progress : {})
            });
          }
        }
      });
      return {
        ok: true,
        operationId: op.id,
        candidates: (Array.isArray(candidates) ? candidates : []).map(publicCandidate)
      };
    } catch (error) {
      return {
        ok: false,
        operationId: op?.id || String(safePayload.operationId || ''),
        error: publicError(error)
      };
    } finally {
      if (op?.id) operations.delete(op.id);
    }
  });

  ipcMain.handle('automation:muse-materialize', async (_event, payload) => {
    pruneTokens();
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const token = String(safePayload.candidateToken || '');
    const entry = candidateTokens.get(token);
    if (!entry) {
      return { ok: false, error: { code: 'STALE_INPUT', message: 'Muse Video result is no longer available.' } };
    }
    let op;
    try {
      op = operation(safePayload.operationId);
      const asset = await provider().materialize(entry.candidate, {
        signal: op.controller.signal,
        request: safePayload.request || {}
      });
      candidateTokens.delete(token);
      return { ok: true, operationId: op.id, asset };
    } catch (error) {
      return { ok: false, operationId: op?.id || '', error: publicError(error) };
    } finally {
      if (op?.id) operations.delete(op.id);
    }
  });

  ipcMain.handle('automation:muse-cancel', async (_event, operationId) => {
    const id = String(operationId || '');
    const controller = operations.get(id);
    if (!controller) return { ok: true, cancelled: false };
    try { controller.abort(); } catch {}
    operations.delete(id);
    return { ok: true, cancelled: true };
  });
}

function cancelAllAutomationMuseVideo() {
  for (const controller of operations.values()) {
    try { controller.abort(); } catch {}
  }
  operations.clear();
}

function getActiveAutomationMuseVideoCount() {
  return operations.size;
}

module.exports = {
  installAutomationMuseVideoIpc,
  cancelAllAutomationMuseVideo,
  getActiveAutomationMuseVideoCount,
  status
};
