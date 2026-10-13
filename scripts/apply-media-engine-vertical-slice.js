"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
}

function write(relative, value) {
  fs.writeFileSync(path.join(root, relative), value, "utf8");
}

function insertAfter(source, anchor, insertion, label) {
  if (source.includes(insertion.trim())) return source;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`Missing anchor for ${label}`);
  const end = index + anchor.length;
  return source.slice(0, end) + insertion + source.slice(end);
}

function insertBefore(source, anchor, insertion, label) {
  if (source.includes(insertion.trim())) return source;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`Missing anchor for ${label}`);
  return source.slice(0, index) + insertion + source.slice(index);
}

function patchMain() {
  const file = "main.js";
  let source = read(file);

  source = insertAfter(
    source,
    "const { BillingClient } = require('./services/billing/billing-client');",
    "\nconst { CloudMediaClient } = require('./services/media/cloud-client');",
    "main media client import"
  );

  source = insertAfter(
    source,
    "let removeDiagnosticConsoleCapture = null;",
    "\nconst activeMediaSearchControllers = new Map();",
    "main media search controller map"
  );

  source = insertBefore(
    source,
    "async function withBillingSession(action) {",
    `function mediaClient() {\n  const cloudConfig = cloudConfigStore?.read() || {\n    backendUrl: process.env.VIRAL_AI_CLOUD_URL || ''\n  };\n\n  return new CloudMediaClient({\n    backendUrl: cloudConfig.backendUrl || '',\n    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    appVersion: app.getVersion()\n  });\n}\n\nfunction publicMediaError(error) {\n  const allowed = new Set([\n    'MEDIA_AUTH_REQUIRED',\n    'MEDIA_NOT_CONFIGURED',\n    'MEDIA_CONFIG_INVALID',\n    'MEDIA_HTTPS_REQUIRED',\n    'MEDIA_SEARCH_INVALID',\n    'MEDIA_PROVIDER_UNAVAILABLE',\n    'MEDIA_SEARCH_UNAVAILABLE',\n    'MEDIA_SEARCH_TIMEOUT',\n    'MEDIA_QUOTA_EXCEEDED',\n    'MEDIA_NETWORK',\n    'MEDIA_CANCELLED'\n  ]);\n  return {\n    code: allowed.has(error?.code) ? error.code : 'MEDIA_SEARCH_UNAVAILABLE',\n    details: {}\n  };\n}\n\n`,
    "main media client helper"
  );

  source = insertBefore(
    source,
    "ipcMain.handle('files:select-videos', async () => {",
    `ipcMain.handle('media:status', async () => {\n  try {\n    const ready = await refreshSessionIfNeeded();\n    if (!ready) return { ready: false, code: 'MEDIA_AUTH_REQUIRED', providers: [] };\n    return await mediaClient().status();\n  } catch (error) {\n    const serialized = publicMediaError(error);\n    console.error('[MediaStatus]', serialized.code);\n    return { ready: false, code: serialized.code, providers: [] };\n  }\n});\n\nipcMain.handle('media:search', async (_event, payload) => {\n  const safePayload = payload && typeof payload === 'object' ? payload : {};\n  const requestedId = String(safePayload.requestId || '').trim();\n  const requestId = /^[A-Za-z0-9._-]{1,120}$/.test(requestedId)\n    ? requestedId\n    : crypto.randomUUID();\n\n  const previous = activeMediaSearchControllers.get(requestId);\n  if (previous) previous.abort();\n  const controller = new AbortController();\n  activeMediaSearchControllers.set(requestId, controller);\n\n  try {\n    const ready = await refreshSessionIfNeeded();\n    if (!ready) return { ok: false, requestId, error: { code: 'MEDIA_AUTH_REQUIRED', details: {} } };\n\n    const data = await mediaClient().search({\n      query: safePayload.query,\n      kind: safePayload.kind,\n      orientation: safePayload.orientation,\n      page: safePayload.page,\n      perPage: safePayload.perPage,\n      provider: safePayload.provider,\n      signal: controller.signal\n    });\n\n    return { ok: true, requestId, data };\n  } catch (error) {\n    const serialized = publicMediaError(error);\n    if (serialized.code !== 'MEDIA_CANCELLED') console.error('[MediaSearch]', serialized.code);\n    return { ok: false, requestId, error: serialized };\n  } finally {\n    if (activeMediaSearchControllers.get(requestId) === controller) {\n      activeMediaSearchControllers.delete(requestId);\n    }\n  }\n});\n\nipcMain.handle('media:cancel-search', async (_event, requestIdValue) => {\n  const requestId = String(requestIdValue || '').trim();\n  const controller = activeMediaSearchControllers.get(requestId);\n  if (!controller) return { ok: true, cancelled: false };\n  activeMediaSearchControllers.delete(requestId);\n  controller.abort();\n  return { ok: true, cancelled: true };\n});\n\n`,
    "main media IPC handlers"
  );

  write(file, source);
}

function patchPreload() {
  const file = "preload.js";
  let source = read(file);
  source = insertAfter(
    source,
    "  testCloudConnection: backendUrl => ipcRenderer.invoke('cloud:test-connection', backendUrl),",
    "\n  getMediaStatus: () => ipcRenderer.invoke('media:status'),\n  searchMedia: payload => ipcRenderer.invoke('media:search', payload),\n  cancelMediaSearch: requestId => ipcRenderer.invoke('media:cancel-search', requestId),",
    "preload media bridge"
  );
  write(file, source);
}

function patchBackend() {
  const file = "dev-backend/server.js";
  let source = read(file);

  source = insertAfter(
    source,
    "const voiceJobs = require(\"./voice-jobs\");",
    "\nconst { createMediaSearchService } = require(\"./media-search\");\nconst { createMediaRouteHandler } = require(\"./media-routes\");",
    "backend media imports"
  );

  source = insertAfter(
    source,
    "const serviceQuotaReservations = new Map();",
    `\nconst mediaSearchService = createMediaSearchService();\nconst handleMediaRoute = createMediaRouteHandler({\n  mediaSearchService,\n  authenticate,\n  json,\n  error,\n  requestRateLimited\n});`,
    "backend media route handler"
  );

  const handleAnchor = `async function handle(req, res) {\n  const url = new URL(req.url, \"http://\" + (req.headers.host || HOST));\n  const method = req.method || \"GET\";`;
  source = insertAfter(
    source,
    handleAnchor,
    "\n\n  if (await handleMediaRoute(req, res, url, method)) return;",
    "backend media route dispatch"
  );

  write(file, source);
}

function patchEnvExample() {
  const file = ".env.example";
  let source = read(file);
  source = insertAfter(
    source,
    "VIRAL_AI_OPENAI_TTS_MODEL=gpt-4o-mini-tts",
    "\n\n# Stock media search credentials stay server-side. Never embed these in the desktop app.\nPEXELS_API_KEY=\nPIXABAY_API_KEY=",
    "media provider environment examples"
  );
  write(file, source);
}

function patchPackage() {
  const file = "package.json";
  let pkg = JSON.parse(read(file));
  pkg.scripts ||= {};
  pkg.scripts["test:media-desktop-integration"] = "node tests/media-desktop-integration.test.js";
  if (pkg.scripts["test:media-engine-search"] && !pkg.scripts["test:media-engine-search"].includes("test:media-desktop-integration")) {
    pkg.scripts["test:media-engine-search"] += " && npm run test:media-desktop-integration";
  }
  write(file, JSON.stringify(pkg, null, 2) + "\n");
}

patchMain();
patchPreload();
patchBackend();
patchEnvExample();
patchPackage();
console.log("Media Engine vertical slice integration patch applied.");
