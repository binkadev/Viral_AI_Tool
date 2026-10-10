'use strict';

const path = require('path');
const crypto = require('crypto');
const { app, ipcMain } = require('electron');
const { createAssetCache } = require('./asset-cache');
const { createPexelsStockProvider } = require('./pexels-stock-provider');
const { createDevStockProvider } = require('./dev-stock-provider');

let installed = false;
const operations = new Map();
const candidateTokens = new Map();
let cacheInstance = null;
let providers = null;

function cache() {
  if (!cacheInstance) {
    cacheInstance = createAssetCache({
      rootDir: path.join(app.getPath('userData'), 'automation-assets')
    });
  }
  return cacheInstance;
}

function providerList() {
  if (!providers) {
    const sharedCache = cache();
    providers = [
      createPexelsStockProvider({ cache: sharedCache }),
      createDevStockProvider({ cache: sharedCache })
    ];
  }
  return providers;
}

function providerById(id) {
  return providerList().find(provider => provider.id === String(id || '')) || null;
}

function safeRequest(payload) {
  const request = payload && typeof payload.request === 'object' ? payload.request : {};
  return JSON.parse(JSON.stringify(request));
}

function publicCandidate(providerId, candidate) {
  const token = crypto.randomUUID();
  candidateTokens.set(token, {
    providerId,
    candidate,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  return {
    providerAssetId: String(candidate?.providerAssetId || ''),
    type: String(candidate?.type || 'video'),
    width: Number(candidate?.width || 0),
    height: Number(candidate?.height || 0),
    durationSec: Number(candidate?.durationSec || 0),
    previewUrl: String(candidate?.previewUrl || ''),
    sourcePage: String(candidate?.sourcePage || ''),
    license: String(candidate?.license || ''),
    attribution: String(candidate?.attribution || ''),
    score: Number(candidate?.score || 0),
    raw: { candidateToken: token }
  };
}

function pruneTokens() {
  const now = Date.now();
  for (const [token, entry] of candidateTokens) {
    if (!entry || entry.expiresAt <= now) candidateTokens.delete(token);
  }
}

function operationController(operationId) {
  const id = String(operationId || crypto.randomUUID());
  const controller = new AbortController();
  operations.set(id, controller);
  return { id, controller };
}

function publicError(error) {
  return {
    code: String(error?.code || (error?.name === 'AbortError' ? 'CANCELLED' : 'UNKNOWN')),
    message: String(error?.message || 'Stock provider operation failed.')
  };
}

async function status() {
  const items = [];
  for (const provider of providerList()) {
    let ready = false;
    try { ready = (await provider.isConfigured()) === true; } catch {}
    items.push({
      id: provider.id,
      ready,
      capabilities: provider.capabilities || {}
    });
  }
  return {
    providers: items,
    cache: await cache().status()
  };
}

function installAutomationStockIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:stock-status', async () => status());

  ipcMain.handle('automation:stock-search', async (_event, payload) => {
    pruneTokens();
    const provider = providerById(payload?.provider);
    if (!provider) return { ok: false, error: { code: 'UNSUPPORTED_REQUEST', message: 'Unknown stock provider.' } };
    const { id, controller } = operationController(payload?.operationId);
    try {
      const request = safeRequest(payload);
      const result = await provider.search(request, { signal: controller.signal });
      return { ok: true, operationId: id, candidates: (Array.isArray(result) ? result : []).map(candidate => publicCandidate(provider.id, candidate)) };
    } catch (error) {
      return { ok: false, operationId: id, error: publicError(error) };
    } finally {
      operations.delete(id);
    }
  });

  ipcMain.handle('automation:stock-materialize', async (_event, payload) => {
    pruneTokens();
    const token = String(payload?.candidateToken || '');
    const entry = candidateTokens.get(token);
    if (!entry || entry.providerId !== String(payload?.provider || '')) {
      return { ok: false, error: { code: 'STALE_INPUT', message: 'Stock candidate is no longer available.' } };
    }
    const provider = providerById(entry.providerId);
    if (!provider) return { ok: false, error: { code: 'UNSUPPORTED_REQUEST', message: 'Unknown stock provider.' } };
    const { id, controller } = operationController(payload?.operationId);
    try {
      const request = safeRequest(payload);
      const asset = await provider.materialize(entry.candidate, { signal: controller.signal, request });
      candidateTokens.delete(token);
      return { ok: true, operationId: id, asset };
    } catch (error) {
      return { ok: false, operationId: id, error: publicError(error) };
    } finally {
      operations.delete(id);
    }
  });

  ipcMain.handle('automation:stock-cancel', async (_event, operationId) => {
    const id = String(operationId || '');
    const controller = operations.get(id);
    if (!controller) return { ok: true, cancelled: false };
    controller.abort();
    operations.delete(id);
    return { ok: true, cancelled: true };
  });
}

function cancelAllAutomationStockOperations() {
  for (const controller of operations.values()) {
    try { controller.abort(); } catch {}
  }
  operations.clear();
}

module.exports = {
  installAutomationStockIpc,
  cancelAllAutomationStockOperations,
  status
};
