'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_APP_URL = 'https://muse.ai/';
const PORT_START = 32147;
const PORT_END = 32157;
const SESSION_TTL_MS = 12000;
const COMMAND_TIMEOUT_MS = 12 * 60 * 1000;
const EXTENSION_FILES = Object.freeze([
  'manifest.json',
  'service-worker.js',
  'content-script.js',
  'popup.html',
  'popup.js',
  'popup.css'
]);

function museError(code, message, details = {}) {
  const error = new Error(String(message || code || 'META_MUSE_FAILED'));
  error.code = String(code || 'META_MUSE_FAILED');
  error.details = details;
  return error;
}

function abortError() {
  const error = museError('CANCELLED', 'Muse generation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function safeText(value, max = 6000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function buildScenePrompt(request = {}) {
  const visual = safeText(request.visualIntent || request.prompt || request.query, 2400);
  const narration = safeText(request.narration, 1800);
  const aspect = ['16:9', '9:16', '1:1'].includes(String(request.aspectRatio || ''))
    ? String(request.aspectRatio)
    : '9:16';
  const seconds = Math.max(2, Math.min(30, Number(request.desiredDurationSec || 5)));
  const negatives = Array.isArray(request.negativeConstraints)
    ? request.negativeConstraints.map(item => safeText(item, 120)).filter(Boolean).slice(0, 8)
    : [];
  return [
    'Generate the actual video clip in this chat for a short-form edited video.',
    visual ? 'Visual direction: ' + visual : '',
    narration ? 'Narration context only (do not render these words as text): ' + narration : '',
    'Target aspect ratio: ' + aspect + '.',
    'Target duration: about ' + seconds.toFixed(1).replace(/\.0$/, '') + ' seconds.',
    'No subtitles, captions, UI, logos, or text overlays.',
    negatives.length ? 'Avoid: ' + negatives.join(', ') + '.' : '',
    'Return/generate the video itself, not a written storyboard or explanation.'
  ].filter(Boolean).join('\n').slice(0, 6000);
}

function mediaExtension(url, contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('webm')) return '.webm';
  if (type.includes('quicktime')) return '.mov';
  if (type.includes('mp4')) return '.mp4';
  try {
    const ext = path.extname(new URL(String(url || '')).pathname).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return ext;
  } catch {}
  return '.mp4';
}

function json(res, status, payload, origin = '') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (origin && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.end(JSON.stringify(payload));
}

function isLoopback(address) {
  const value = String(address || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

async function readJsonBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw museError('BRIDGE_PAYLOAD_TOO_LARGE', 'Muse bridge payload is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw museError('BRIDGE_BAD_JSON', 'Muse bridge received invalid JSON.'); }
}

class MetaMuseExtensionBridge {
  constructor({ userDataPath, extensionSourceDir, shell, fetchImpl = global.fetch, env = process.env } = {}) {
    if (!userDataPath) throw new Error('Meta Muse extension bridge requires userDataPath.');
    if (!extensionSourceDir) throw new Error('Meta Muse extension bridge requires extensionSourceDir.');
    this.userDataPath = path.resolve(userDataPath);
    this.extensionSourceDir = path.resolve(extensionSourceDir);
    this.extensionInstallDir = path.join(this.userDataPath, 'meta-muse-extension');
    this.selectionFile = path.join(this.userDataPath, 'meta-muse-extension-selection.json');
    this.shell = shell || null;
    this.fetchImpl = fetchImpl;
    this.env = env || process.env;
    this.server = null;
    this.port = 0;
    this.serverId = crypto.randomUUID();
    this.sessions = new Map();
    this.pending = new Map();
    this.commandQueues = new Map();
    this.selectedInstanceId = '';
    this.selectedTabId = null;
    this.started = null;
  }

  async installExtensionFiles() {
    await fsp.mkdir(this.extensionInstallDir, { recursive: true });
    for (const file of EXTENSION_FILES) {
      const source = path.join(this.extensionSourceDir, file);
      const destination = path.join(this.extensionInstallDir, file);
      const data = await fsp.readFile(source);
      await fsp.writeFile(destination, data);
    }
    return this.extensionInstallDir;
  }

  async readSelection() {
    try {
      const value = JSON.parse(await fsp.readFile(this.selectionFile, 'utf8'));
      this.selectedInstanceId = safeText(value?.instanceId, 160);
    } catch {}
  }

  async persistSelection() {
    await fsp.mkdir(path.dirname(this.selectionFile), { recursive: true });
    const temp = this.selectionFile + '.tmp';
    await fsp.writeFile(temp, JSON.stringify({ instanceId: this.selectedInstanceId }, null, 2), 'utf8');
    await fsp.rename(temp, this.selectionFile);
  }

  async start() {
    if (this.server && this.port) return this.port;
    if (this.started) return this.started;
    this.started = (async () => {
      await this.installExtensionFiles();
      await this.readSelection();
      for (let port = Number(this.env.VIRAL_AI_MUSE_BRIDGE_PORT || PORT_START); port <= PORT_END; port += 1) {
        try {
          await this.listen(port);
          this.port = port;
          return port;
        } catch (error) {
          if (error?.code !== 'EADDRINUSE') throw error;
        }
      }
      throw museError('BRIDGE_PORT_UNAVAILABLE', 'Viral AI Tool could not open the local Muse extension bridge.', {
        from: PORT_START,
        to: PORT_END
      });
    })();
    try { return await this.started; }
    finally { this.started = null; }
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res).catch(error => {
        const origin = String(req.headers.origin || '');
        json(res, 500, { ok: false, error: { code: error?.code || 'BRIDGE_FAILED', message: String(error?.message || error) } }, origin);
      }));
      const onError = error => {
        server.removeListener('listening', onListening);
        try { server.close(); } catch {}
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        this.server = server;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  extensionOriginAllowed(req) {
    if (!isLoopback(req.socket?.remoteAddress)) return false;
    const origin = String(req.headers.origin || '');
    return !origin || origin.startsWith('chrome-extension://');
  }

  tokenFor(req) {
    const header = String(req.headers['x-viral-muse-token'] || req.headers.authorization || '');
    return header.replace(/^Bearer\s+/i, '').trim();
  }

  sessionForRequest(req, instanceId) {
    const session = this.sessions.get(String(instanceId || ''));
    if (!session) return null;
    const token = this.tokenFor(req);
    return token && token === session.token ? session : null;
  }

  async handleHttp(req, res) {
    const origin = String(req.headers.origin || '');
    if (!this.extensionOriginAllowed(req)) return json(res, 403, { ok: false, error: 'forbidden' }, origin);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      if (origin.startsWith('chrome-extension://')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Viral-Muse-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Vary', 'Origin');
      }
      return res.end();
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/ping') {
      return json(res, 200, { ok: true, serverId: this.serverId, product: 'Viral AI Tool', bridge: 'meta-muse-extension', port: this.port }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/v1/register') {
      const body = await readJsonBody(req);
      const instanceId = safeText(body.instanceId, 160);
      if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(instanceId)) return json(res, 400, { ok: false, error: 'invalid-instance' }, origin);
      const existing = this.sessions.get(instanceId);
      const token = crypto.randomBytes(24).toString('hex');
      this.sessions.set(instanceId, {
        instanceId,
        token,
        profileLabel: safeText(body.profileLabel, 120) || 'Chrome profile ' + instanceId.slice(0, 6),
        browserName: safeText(body.browserName, 80) || 'Chrome',
        extensionVersion: safeText(body.extensionVersion, 40),
        tabs: Array.isArray(existing?.tabs) ? existing.tabs : [],
        lastSeen: Date.now()
      });
      return json(res, 200, { ok: true, token, serverId: this.serverId, pollIntervalMs: 900 }, origin);
    }

    const instanceId = safeText(url.searchParams.get('instanceId'), 160);
    const session = this.sessionForRequest(req, instanceId);
    if (!session) return json(res, 401, { ok: false, error: 'session-required' }, origin);

    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
      const body = await readJsonBody(req);
      session.lastSeen = Date.now();
      session.profileLabel = safeText(body.profileLabel, 120) || session.profileLabel;
      session.browserName = safeText(body.browserName, 80) || session.browserName;
      session.tabs = (Array.isArray(body.tabs) ? body.tabs : []).slice(0, 20).map(tab => ({
        tabId: Number(tab?.tabId || 0),
        url: safeText(tab?.url, 3000),
        title: safeText(tab?.title, 240),
        loggedIn: tab?.loggedIn === true,
        composerReady: tab?.composerReady === true,
        accountLabel: safeText(tab?.accountLabel, 160)
      })).filter(tab => Number.isInteger(tab.tabId) && tab.tabId > 0 && /^https:\/\/muse\.ai\//i.test(tab.url));
      return json(res, 200, { ok: true }, origin);
    }

    if (req.method === 'GET' && url.pathname === '/v1/poll') {
      session.lastSeen = Date.now();
      const queue = this.commandQueues.get(instanceId) || [];
      const command = queue.shift() || null;
      this.commandQueues.set(instanceId, queue);
      return json(res, 200, { ok: true, command }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/v1/event') {
      const body = await readJsonBody(req);
      const commandId = safeText(body.commandId, 160);
      const pending = this.pending.get(commandId);
      if (pending && pending.instanceId === instanceId) {
        try { pending.onProgress?.(body.progress && typeof body.progress === 'object' ? body.progress : {}); } catch {}
      }
      return json(res, 200, { ok: true }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/v1/result') {
      const body = await readJsonBody(req);
      const commandId = safeText(body.commandId, 160);
      const pending = this.pending.get(commandId);
      if (!pending || pending.instanceId !== instanceId) return json(res, 404, { ok: false, error: 'unknown-command' }, origin);
      this.pending.delete(commandId);
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      if (body.ok === false) {
        pending.reject(museError(body.error?.code || 'META_MUSE_FAILED', body.error?.message || 'Muse extension command failed.', body.error?.details || {}));
      } else {
        pending.resolve(body.result || {});
      }
      return json(res, 200, { ok: true }, origin);
    }

    return json(res, 404, { ok: false, error: 'not-found' }, origin);
  }

  activeSessions() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    return [...this.sessions.values()].filter(session => session.lastSeen >= cutoff);
  }

  chooseSelected() {
    const sessions = this.activeSessions();
    const selected = sessions.find(item => item.instanceId === this.selectedInstanceId);
    if (selected) {
      const tab = selected.tabs.find(item => item.tabId === this.selectedTabId)
        || selected.tabs.find(item => item.composerReady)
        || selected.tabs[0]
        || null;
      if (tab) return { session: selected, tab };
    }
    if (sessions.length === 1) {
      const tab = sessions[0].tabs.find(item => item.composerReady) || sessions[0].tabs[0] || null;
      if (tab) return { session: sessions[0], tab };
    }
    return null;
  }

  async status() {
    await this.start();
    const sessions = this.activeSessions().map(session => ({
      instanceId: session.instanceId,
      profileLabel: session.profileLabel,
      browserName: session.browserName,
      extensionVersion: session.extensionVersion,
      tabs: session.tabs.map(tab => ({ ...tab })),
      lastSeen: session.lastSeen
    }));
    const selected = this.chooseSelected();
    return {
      bridgeRunning: true,
      bridgePort: this.port,
      extensionPath: this.extensionInstallDir,
      extensionConnected: sessions.length > 0,
      requiresSelection: sessions.length > 1 && !selected,
      sessions,
      selectedSession: selected ? {
        instanceId: selected.session.instanceId,
        profileLabel: selected.session.profileLabel,
        browserName: selected.session.browserName,
        tabId: selected.tab.tabId,
        url: selected.tab.url,
        title: selected.tab.title,
        accountLabel: selected.tab.accountLabel,
        loggedIn: selected.tab.loggedIn,
        composerReady: selected.tab.composerReady
      } : null,
      browserRunning: sessions.length > 0,
      loggedIn: selected?.tab?.loggedIn === true,
      composerReady: selected?.tab?.composerReady === true
    };
  }

  async selectSession({ instanceId, tabId } = {}) {
    await this.start();
    const session = this.activeSessions().find(item => item.instanceId === String(instanceId || ''));
    if (!session) throw museError('MUSE_SESSION_NOT_FOUND', 'The selected Chrome Muse session is no longer connected.');
    const tab = session.tabs.find(item => item.tabId === Number(tabId)) || session.tabs.find(item => item.composerReady) || session.tabs[0];
    if (!tab) throw museError('MUSE_TAB_NOT_FOUND', 'No Muse tab is open in that Chrome profile.');
    this.selectedInstanceId = session.instanceId;
    this.selectedTabId = tab.tabId;
    await this.persistSelection().catch(() => {});
    return this.status();
  }

  async revealExtension() {
    await this.start();
    const manifest = path.join(this.extensionInstallDir, 'manifest.json');
    try { this.shell?.showItemInFolder?.(manifest); } catch {}
    return { ok: true, extensionPath: this.extensionInstallDir };
  }

  async openMuse() {
    await this.start();
    const selected = this.chooseSelected();
    if (selected) {
      await this.sendCommand(selected.session.instanceId, 'openMuse', {}, { timeoutMs: 15000 });
      return this.status();
    }
    try { await this.shell?.openExternal?.(DEFAULT_APP_URL); } catch {}
    return this.status();
  }

  sendCommand(instanceId, type, payload = {}, { timeoutMs = COMMAND_TIMEOUT_MS, signal, onProgress } = {}) {
    const session = this.activeSessions().find(item => item.instanceId === String(instanceId || ''));
    if (!session) return Promise.reject(museError('EXTENSION_DISCONNECTED', 'The Chrome Muse extension is not connected.'));
    if (signal?.aborted) return Promise.reject(abortError());
    const id = crypto.randomUUID();
    const command = { id, type: String(type), payload, createdAt: Date.now() };
    const queue = this.commandQueues.get(session.instanceId) || [];
    queue.push(command);
    this.commandQueues.set(session.instanceId, queue);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(museError('PROVIDER_TIMEOUT', 'Muse did not finish before the local bridge timeout.'));
      }, Math.max(5000, Number(timeoutMs || COMMAND_TIMEOUT_MS)));
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        const cancelQueue = this.commandQueues.get(session.instanceId) || [];
        cancelQueue.unshift({ id: crypto.randomUUID(), type: 'cancel', payload: { targetCommandId: id }, createdAt: Date.now() });
        this.commandQueues.set(session.instanceId, cancelQueue);
        reject(abortError());
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        instanceId: session.instanceId,
        resolve,
        reject,
        timer,
        onProgress,
        cleanupAbort: () => signal?.removeEventListener?.('abort', onAbort)
      });
    });
  }

  async generateVideo(request, { signal, onProgress } = {}) {
    await this.start();
    const selected = this.chooseSelected();
    if (!selected) throw museError('MUSE_SESSION_REQUIRED', 'Choose the Chrome profile and Muse tab to use first.');
    if (!selected.tab.composerReady) throw museError('LOGIN_REQUIRED', 'The selected Muse tab is not ready. Sign in to Muse first.');
    const prompt = buildScenePrompt(request);
    if (!prompt) throw museError('INVALID_INPUT', 'Muse scene prompt is empty.');
    const result = await this.sendCommand(selected.session.instanceId, 'generate', {
      tabId: selected.tab.tabId,
      prompt,
      timeoutMs: this.timeoutMs || COMMAND_TIMEOUT_MS
    }, { timeoutMs: COMMAND_TIMEOUT_MS, signal, onProgress });
    const mediaUrl = safeText(result?.mediaUrl, 6000);
    if (!mediaUrl) throw museError('MUSE_NO_VIDEO', 'Muse finished without a downloadable video.', { text: safeText(result?.text, 1000) });
    return {
      mediaUrl,
      threadUrl: safeText(result?.threadUrl, 3000) || selected.tab.url,
      text: safeText(result?.text, 2000),
      instanceId: selected.session.instanceId,
      tabId: selected.tab.tabId
    };
  }

  async downloadMedia(url, destinationPath, { signal, onProgress, instanceId = '' } = {}) {
    const targetUrl = safeText(url, 6000);
    if (!targetUrl) throw museError('MUSE_NO_VIDEO', 'Muse media URL is missing.');
    if (signal?.aborted) throw abortError();
    if (typeof this.fetchImpl === 'function' && !targetUrl.startsWith('blob:')) {
      try {
        const response = await this.fetchImpl(targetUrl, { signal, redirect: 'follow' });
        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
        const total = Number(response.headers.get('content-length') || 0);
        let downloaded = 0;
        const source = Readable.fromWeb(response.body);
        source.on('data', chunk => {
          downloaded += chunk.length;
          if (total > 0) {
            try { onProgress?.({ phase: 'downloading', progress: Math.min(98, 2 + downloaded / total * 96) }); } catch {}
          }
        });
        await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
        await pipeline(source, fs.createWriteStream(destinationPath));
        return { path: destinationPath, extension: mediaExtension(targetUrl, response.headers.get('content-type') || '') };
      } catch (error) {
        if (signal?.aborted) throw abortError();
      }
    }

    const selected = this.chooseSelected();
    const sessionId = instanceId || selected?.session?.instanceId;
    if (!sessionId) throw museError('MEDIA_DOWNLOAD_FAILED', 'The Muse video could not be downloaded and no Chrome profile is connected.');
    const result = await this.sendCommand(sessionId, 'downloadMedia', {
      url: targetUrl,
      filename: 'ViralAI-Muse-Bridge/muse-' + crypto.randomUUID() + mediaExtension(targetUrl)
    }, { timeoutMs: 180000, signal, onProgress });
    const localPath = safeText(result?.localPath, 5000);
    if (!localPath) throw museError('MEDIA_DOWNLOAD_FAILED', 'Chrome did not return the downloaded Muse file.');
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    await fsp.copyFile(localPath, destinationPath);
    await fsp.rm(localPath, { force: true }).catch(() => {});
    return { path: destinationPath, extension: path.extname(localPath) || mediaExtension(targetUrl) };
  }

  async close() {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      pending.reject(museError('CANCELLED', 'Viral AI Tool is closing.'));
      this.pending.delete(id);
    }
    if (this.server) {
      await new Promise(resolve => this.server.close(() => resolve())).catch(() => {});
      this.server = null;
      this.port = 0;
    }
    this.sessions.clear();
    this.commandQueues.clear();
  }
}

function createMetaMuseExtensionBridge(options) {
  const bridge = new MetaMuseExtensionBridge(options);
  bridge.timeoutMs = Math.max(60000, Number(options?.timeoutMs || COMMAND_TIMEOUT_MS));
  return bridge;
}

module.exports = {
  DEFAULT_APP_URL,
  PORT_START,
  PORT_END,
  SESSION_TTL_MS,
  EXTENSION_FILES,
  buildScenePrompt,
  mediaExtension,
  MetaMuseExtensionBridge,
  createMetaMuseExtensionBridge
};
