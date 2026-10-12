'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, shell } = require('electron');
const { createAssetCache } = require('./asset-cache');
const { createMetaMuseExtensionBridge } = require('./meta-muse-extension-bridge');
const { probeVideo } = require('../ffmpeg');

let installed = false;
let bridgeInstance = null;
let cacheInstance = null;
const operations = new Map();
const candidates = new Map();

function cache() {
  if (!cacheInstance) {
    cacheInstance = createAssetCache({
      rootDir: path.join(app.getPath('userData'), 'automation-assets')
    });
  }
  return cacheInstance;
}

function bridge() {
  if (!bridgeInstance) {
    bridgeInstance = createMetaMuseExtensionBridge({
      userDataPath: app.getPath('userData'),
      extensionSourceDir: path.join(app.getAppPath(), 'extensions', 'meta-muse-bridge'),
      shell
    });
  }
  return bridgeInstance;
}

function publicError(error) {
  return {
    code: String(error?.code || 'META_MUSE_FAILED'),
    message: String(error?.message || 'Meta Muse operation failed.').slice(0, 600),
    details: error?.details && typeof error.details === 'object' ? error.details : {}
  };
}

function createOperation(operationId) {
  const id = String(operationId || crypto.randomUUID());
  if (operations.has(id)) {
    const error = new Error('Muse operation is already active.');
    error.code = 'DUPLICATE_ACTIVE';
    throw error;
  }
  const controller = new AbortController();
  operations.set(id, controller);
  return { id, controller };
}

function pruneCandidates() {
  const now = Date.now();
  for (const [token, item] of candidates) {
    if (!item || item.expiresAt <= now) candidates.delete(token);
  }
}

function candidateToken(result, request) {
  const token = crypto.randomUUID();
  candidates.set(token, {
    result,
    request,
    expiresAt: Date.now() + 30 * 60 * 1000
  });
  return token;
}

function publicCandidate(token, item) {
  return {
    providerAssetId: token,
    type: 'video',
    width: 0,
    height: 0,
    durationSec: Number(item?.request?.desiredDurationSec || 0),
    previewUrl: '',
    sourcePage: String(item?.result?.threadUrl || ''),
    license: 'Generated with the user\'s Meta Muse account',
    attribution: 'Meta Muse · muse.ai',
    score: 100,
    raw: { candidateToken: token }
  };
}

async function materializeCandidate(item, { signal, onProgress } = {}) {
  const url = String(item?.result?.mediaUrl || '');
  if (!url) {
    const error = new Error('Muse candidate does not contain media.');
    error.code = 'STALE_INPUT';
    throw error;
  }
  const tempRoot = path.join(app.getPath('temp'), 'viral-ai-tool', 'meta-muse');
  await fs.mkdir(tempRoot, { recursive: true });
  const tempPath = path.join(tempRoot, 'muse-' + crypto.randomUUID() + '.mp4');
  try {
    const downloaded = await bridge().downloadMedia(url, tempPath, {
      signal,
      onProgress,
      instanceId: item?.result?.instanceId || ''
    });
    const meta = await probeVideo(downloaded.path);
    const cacheKey = 'meta-muse:' + crypto.createHash('sha256')
      .update([item.result.threadUrl, url, meta.sizeBytes].join('|'))
      .digest('hex')
      .slice(0, 40);
    const adopted = await cache().adopt({
      cacheKey,
      sourcePath: downloaded.path,
      extension: downloaded.extension || path.extname(downloaded.path) || '.mp4',
      metadata: {
        provider: 'meta-muse',
        providerAssetId: cacheKey,
        width: Number(meta.width || 0),
        height: Number(meta.height || 0),
        durationSec: Number(meta.duration || 0),
        sourcePage: String(item.result.threadUrl || ''),
        license: 'Generated with the user\'s Meta Muse account',
        attribution: 'Meta Muse · muse.ai'
      }
    });
    return {
      provider: 'meta-muse',
      providerAssetId: cacheKey,
      type: 'video',
      localPath: adopted.record.localPath,
      previewPath: '',
      sourcePage: String(item.result.threadUrl || ''),
      width: Number(meta.width || 0),
      height: Number(meta.height || 0),
      durationSec: Number(meta.duration || 0),
      license: 'Generated with the user\'s Meta Muse account',
      attribution: 'Meta Muse · muse.ai',
      checksum: adopted.record.checksum,
      cacheKey,
      cacheHit: adopted.cacheHit
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

function installAutomationMetaMuseIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:meta-muse-status', async () => {
    try {
      return { ok: true, status: await bridge().status() };
    } catch (error) {
      return {
        ok: false,
        error: publicError(error),
        status: { bridgeRunning: false, extensionConnected: false, loggedIn: false, composerReady: false, sessions: [] }
      };
    }
  });

  ipcMain.handle('automation:meta-muse-open', async () => {
    try {
      return { ok: true, status: await bridge().openMuse() };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.handle('automation:meta-muse-extension-reveal', async () => {
    try {
      return await bridge().revealExtension();
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.handle('automation:meta-muse-select-session', async (_event, payload) => {
    try {
      return { ok: true, status: await bridge().selectSession(payload || {}) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.handle('automation:meta-muse-generate', async (event, payload) => {
    pruneCandidates();
    const safe = payload && typeof payload === 'object' ? payload : {};
    let op;
    try {
      op = createOperation(safe.operationId);
      const result = await bridge().generateVideo(safe.request || {}, {
        signal: op.controller.signal,
        onProgress: progress => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('automation:meta-muse-progress', {
              operationId: op.id,
              ...(progress && typeof progress === 'object' ? progress : {})
            });
          }
        }
      });
      const token = candidateToken(result, safe.request || {});
      return { ok: true, operationId: op.id, candidates: [publicCandidate(token, candidates.get(token))] };
    } catch (error) {
      return { ok: false, operationId: op?.id || String(safe.operationId || ''), error: publicError(error) };
    } finally {
      if (op?.id) operations.delete(op.id);
    }
  });

  ipcMain.handle('automation:meta-muse-materialize', async (event, payload) => {
    pruneCandidates();
    const safe = payload && typeof payload === 'object' ? payload : {};
    const token = String(safe.candidateToken || '');
    const item = candidates.get(token);
    if (!item) return { ok: false, error: { code: 'STALE_INPUT', message: 'Muse generated media is no longer available.' } };
    let op;
    try {
      op = createOperation(safe.operationId);
      const asset = await materializeCandidate(item, {
        signal: op.controller.signal,
        onProgress: progress => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('automation:meta-muse-progress', {
              operationId: op.id,
              ...(progress && typeof progress === 'object' ? progress : {})
            });
          }
        }
      });
      candidates.delete(token);
      return { ok: true, operationId: op.id, asset };
    } catch (error) {
      return { ok: false, operationId: op?.id || '', error: publicError(error) };
    } finally {
      if (op?.id) operations.delete(op.id);
    }
  });

  ipcMain.handle('automation:meta-muse-cancel', async (_event, operationId) => {
    const id = String(operationId || '');
    const controller = operations.get(id);
    if (!controller) return { ok: true, cancelled: false };
    try { controller.abort(); } catch {}
    operations.delete(id);
    return { ok: true, cancelled: true };
  });

  ipcMain.handle('automation:meta-muse-close', async () => {
    try {
      cancelAllAutomationMetaMuse();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}

function cancelAllAutomationMetaMuse() {
  for (const controller of operations.values()) {
    try { controller.abort(); } catch {}
  }
  operations.clear();
}

async function closeAutomationMetaMuseBridge() {
  cancelAllAutomationMetaMuse();
  if (bridgeInstance) await bridgeInstance.close().catch(() => {});
}

module.exports = {
  installAutomationMetaMuseIpc,
  cancelAllAutomationMetaMuse,
  closeAutomationMetaMuseBridge,
  closeAutomationMetaMuseBrowser: closeAutomationMetaMuseBridge
};
