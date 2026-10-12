'use strict';

const PORTS = Array.from({ length: 11 }, (_, index) => 32147 + index);
const MUSE_URL = 'https://muse.ai/';
const MUSE_PATTERNS = ['https://muse.ai/*'];
let loopRunning = false;
let activeContentPorts = 0;
let currentCommandId = '';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function storageSet(value) {
  return chrome.storage.local.set(value);
}

function randomId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'muse-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

async function identity() {
  const stored = await storageGet(['instanceId', 'profileLabel']);
  const instanceId = String(stored.instanceId || randomId());
  const profileLabel = String(stored.profileLabel || ('Chrome profile ' + instanceId.slice(0, 6)));
  if (!stored.instanceId) await storageSet({ instanceId, profileLabel });
  return { instanceId, profileLabel };
}

function browserName() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Brave/i.test(ua)) return 'Brave';
  return 'Chrome';
}

async function bridgeState() {
  return storageGet(['bridgePort', 'bridgeToken', 'bridgeServerId']);
}

async function clearBridgeState() {
  await storageSet({ bridgePort: null, bridgeToken: null, bridgeServerId: null });
}

async function requestJson(port, pathname, { method = 'GET', token = '', body = null, timeoutMs = 3500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Cache-Control': 'no-store' };
    if (token) headers['X-Viral-Muse-Token'] = token;
    if (body != null) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverBridge() {
  const cached = await bridgeState();
  if (cached.bridgePort) {
    try {
      const ping = await requestJson(Number(cached.bridgePort), '/v1/ping', { timeoutMs: 900 });
      if (ping?.ok && (!cached.bridgeServerId || ping.serverId === cached.bridgeServerId)) {
        return { port: Number(cached.bridgePort), token: String(cached.bridgeToken || ''), serverId: ping.serverId };
      }
    } catch {}
  }
  for (const port of PORTS) {
    try {
      const ping = await requestJson(port, '/v1/ping', { timeoutMs: 500 });
      if (ping?.ok && ping.bridge === 'meta-muse-extension') {
        await storageSet({ bridgePort: port, bridgeServerId: ping.serverId, bridgeToken: null });
        return { port, token: '', serverId: ping.serverId };
      }
    } catch {}
  }
  throw new Error('Viral AI Tool bridge is offline');
}

async function register(bridge) {
  const ident = await identity();
  const response = await requestJson(bridge.port, '/v1/register', {
    method: 'POST',
    body: {
      instanceId: ident.instanceId,
      profileLabel: ident.profileLabel,
      browserName: browserName(),
      extensionVersion: chrome.runtime.getManifest().version
    }
  });
  if (!response?.token) throw new Error('Bridge registration failed');
  const next = { port: bridge.port, token: String(response.token), serverId: String(response.serverId || '') };
  await storageSet({ bridgePort: next.port, bridgeToken: next.token, bridgeServerId: next.serverId });
  return next;
}

async function contentStatus(tabId) {
  try {
    const result = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'viral-ai:muse-status' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1200))
    ]);
    return result && typeof result === 'object' ? result : {};
  } catch {
    return {};
  }
}

async function museTabs() {
  const tabs = await chrome.tabs.query({ url: MUSE_PATTERNS });
  const result = [];
  for (const tab of tabs.slice(0, 20)) {
    const status = await contentStatus(tab.id);
    result.push({
      tabId: Number(tab.id || 0),
      url: String(tab.url || ''),
      title: String(tab.title || 'Muse'),
      loggedIn: status.loggedIn === true,
      composerReady: status.composerReady === true,
      accountLabel: String(status.accountLabel || '')
    });
  }
  return result;
}

async function ensureRegistered() {
  let bridge = await discoverBridge();
  if (!bridge.token) bridge = await register(bridge);
  return bridge;
}

async function heartbeat(bridge) {
  const ident = await identity();
  try {
    return await requestJson(bridge.port, `/v1/heartbeat?instanceId=${encodeURIComponent(ident.instanceId)}`, {
      method: 'POST',
      token: bridge.token,
      body: {
        profileLabel: ident.profileLabel,
        browserName: browserName(),
        tabs: await museTabs()
      }
    });
  } catch (error) {
    if (error.status === 401) {
      await clearBridgeState();
      throw error;
    }
    throw error;
  }
}

async function sendEvent(bridge, commandId, progress) {
  const ident = await identity();
  try {
    await requestJson(bridge.port, `/v1/event?instanceId=${encodeURIComponent(ident.instanceId)}`, {
      method: 'POST',
      token: bridge.token,
      body: { commandId, progress },
      timeoutMs: 2500
    });
  } catch {}
}

async function sendResult(bridge, commandId, ok, result = null, error = null) {
  const ident = await identity();
  await requestJson(bridge.port, `/v1/result?instanceId=${encodeURIComponent(ident.instanceId)}`, {
    method: 'POST',
    token: bridge.token,
    body: { commandId, ok, result, error },
    timeoutMs: 5000
  });
}

function normalizeError(error) {
  return {
    code: String(error?.code || (error?.name === 'AbortError' ? 'CANCELLED' : 'META_MUSE_FAILED')),
    message: String(error?.message || error || 'Meta Muse extension command failed.').slice(0, 800)
  };
}

async function waitForDownload(downloadId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(Object.assign(new Error('Chrome download timed out.'), { code: 'MEDIA_DOWNLOAD_FAILED' }));
    }, timeoutMs);
    const listener = async delta => {
      if (delta.id !== downloadId) return;
      if (delta.error?.current) {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        reject(Object.assign(new Error(delta.error.current), { code: 'MEDIA_DOWNLOAD_FAILED' }));
        return;
      }
      if (delta.state?.current === 'complete') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        const items = await chrome.downloads.search({ id: downloadId });
        const item = items[0];
        if (!item?.filename) return reject(Object.assign(new Error('Chrome download path is unavailable.'), { code: 'MEDIA_DOWNLOAD_FAILED' }));
        resolve({ localPath: item.filename, mime: item.mime || '', size: Number(item.fileSize || 0) });
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function executeCommand(bridge, command) {
  const type = String(command?.type || '');
  const payload = command?.payload || {};
  currentCommandId = String(command?.id || '');
  try {
    if (type === 'openMuse') {
      const tab = await chrome.tabs.create({ url: MUSE_URL, active: true });
      return { tabId: tab.id, url: tab.url || MUSE_URL };
    }
    if (type === 'cancel') {
      const tabs = await chrome.tabs.query({ url: MUSE_PATTERNS });
      for (const tab of tabs) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'viral-ai:muse-cancel', targetCommandId: payload.targetCommandId || '' }); } catch {}
      }
      return { cancelled: true };
    }
    if (type === 'downloadMedia') {
      await sendEvent(bridge, currentCommandId, { phase: 'downloading', progress: 4 });
      const downloadId = await chrome.downloads.download({
        url: String(payload.url || ''),
        filename: String(payload.filename || ('ViralAI-Muse-Bridge/muse-' + randomId() + '.mp4')),
        saveAs: false,
        conflictAction: 'uniquify'
      });
      const result = await waitForDownload(downloadId);
      await sendEvent(bridge, currentCommandId, { phase: 'downloading', progress: 98 });
      return result;
    }
    if (type === 'generate') {
      const tabId = Number(payload.tabId || 0);
      if (!tabId) throw Object.assign(new Error('Muse tab is missing.'), { code: 'MUSE_TAB_NOT_FOUND' });
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'viral-ai:muse-generate',
        commandId: currentCommandId,
        prompt: String(payload.prompt || ''),
        timeoutMs: Number(payload.timeoutMs || 720000)
      });
      if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'Muse generation failed.'), { code: result?.error?.code || 'META_MUSE_FAILED' });
      return result.result || {};
    }
    throw Object.assign(new Error('Unsupported bridge command: ' + type), { code: 'BRIDGE_COMMAND_UNSUPPORTED' });
  } finally {
    currentCommandId = '';
  }
}

async function pollOnce() {
  let bridge;
  try {
    bridge = await ensureRegistered();
    await heartbeat(bridge);
    const ident = await identity();
    const response = await requestJson(bridge.port, `/v1/poll?instanceId=${encodeURIComponent(ident.instanceId)}`, {
      token: bridge.token,
      timeoutMs: 4000
    });
    if (!response?.command) return true;
    try {
      const result = await executeCommand(bridge, response.command);
      await sendResult(bridge, response.command.id, true, result, null);
    } catch (error) {
      await sendResult(bridge, response.command.id, false, null, normalizeError(error)).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

async function runLoop() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    let quietFailures = 0;
    while (activeContentPorts > 0 || quietFailures < 8) {
      const ok = await pollOnce();
      quietFailures = ok ? 0 : quietFailures + 1;
      await sleep(ok ? 900 : Math.min(5000, 700 + quietFailures * 600));
    }
  } finally {
    loopRunning = false;
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'viral-ai-muse-tab') return;
  activeContentPorts += 1;
  runLoop();
  port.onDisconnect.addListener(() => { activeContentPorts = Math.max(0, activeContentPorts - 1); });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'viral-ai:muse-progress') {
    (async () => {
      try {
        const bridge = await ensureRegistered();
        await sendEvent(bridge, String(message.commandId || currentCommandId || ''), message.progress || {});
      } catch {}
    })();
    return false;
  }
  if (message?.type === 'viral-ai:bridge-state') {
    (async () => {
      const ident = await identity();
      const bridge = await bridgeState();
      sendResponse({
        ok: true,
        instanceId: ident.instanceId,
        profileLabel: ident.profileLabel,
        browserName: browserName(),
        connected: Boolean(bridge.bridgePort && bridge.bridgeToken),
        bridgePort: bridge.bridgePort || null,
        tabs: await museTabs()
      });
    })();
    return true;
  }
  if (message?.type === 'viral-ai:set-profile-label') {
    (async () => {
      const value = String(message.profileLabel || '').trim().slice(0, 120);
      if (value) await storageSet({ profileLabel: value });
      await clearBridgeState();
      runLoop();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message?.type === 'viral-ai:open-muse') {
    chrome.tabs.create({ url: MUSE_URL, active: true }).then(tab => sendResponse({ ok: true, tabId: tab.id })).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'viral-ai:reconnect') {
    clearBridgeState().then(() => pollOnce()).then(ok => sendResponse({ ok })).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('viral-ai-muse-heartbeat', { periodInMinutes: 0.5 });
  runLoop();
});
chrome.runtime.onStartup.addListener(() => runLoop());
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'viral-ai-muse-heartbeat') pollOnce();
});

runLoop();
