"use strict";

const fs = require("fs");
const path = require("path");

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(label + " anchor must exist exactly once");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patchFile(relativePath, patches) {
  const filePath = path.join(__dirname, "..", relativePath);
  let source = fs.readFileSync(filePath, "utf8");
  for (const patch of patches) {
    source = replaceOnce(source, patch.before, patch.after, relativePath + ": " + patch.label);
  }
  fs.writeFileSync(filePath, source, "utf8");
}

patchFile("dev-backend/server.js", [
  {
    label: "media imports",
    before: 'const voiceJobs = require("./voice-jobs");\nconst billing = require("./billing");',
    after: 'const voiceJobs = require("./voice-jobs");\nconst { createMediaSearchService } = require("./media-search");\nconst { createMediaHttpHandler } = require("./media-routes");\nconst billing = require("./billing");'
  },
  {
    label: "media handler composition",
    before: '});\n\nrestoreSpeechJobs();\nfor (const job of jobs.values()) {',
    after: '});\n\nconst mediaSearchService = createMediaSearchService();\nconst handleMediaHttp = createMediaHttpHandler({\n  service: mediaSearchService,\n  authenticate,\n  json,\n  error,\n  audit\n});\n\nrestoreSpeechJobs();\nfor (const job of jobs.values()) {'
  },
  {
    label: "health readiness",
    before: '      voiceProviderConfigured: voiceProvider.isConfigured(),\n      adminProvisioningConfigured: adminConfigured(),',
    after: '      voiceProviderConfigured: voiceProvider.isConfigured(),\n      mediaProviderConfigured: mediaSearchService.status().ready,\n      adminProvisioningConfigured: adminConfigured(),'
  },
  {
    label: "media route dispatch",
    before: '  if (requestRateLimited(req, "general")) {\n    audit("rate_limit.general", req, { method, path: url.pathname });\n    return error(res, 429, "RATE_LIMITED");\n  }\n\n  if (method === "GET" && url.pathname === "/v1/internal/ops/status") {',
    after: '  if (requestRateLimited(req, "general")) {\n    audit("rate_limit.general", req, { method, path: url.pathname });\n    return error(res, 429, "RATE_LIMITED");\n  }\n\n  if (await handleMediaHttp({ req, res, url, method })) return;\n\n  if (method === "GET" && url.pathname === "/v1/internal/ops/status") {'
  },
  {
    label: "operations provider status",
    before: '        voiceConfigured: voiceProvider.isConfigured()\n      },',
    after: '        voiceConfigured: voiceProvider.isConfigured(),\n        mediaConfigured: mediaSearchService.status().ready\n      },'
  }
]);

patchFile("main.js", [
  {
    label: "desktop controller import",
    before: "} = require('./services/voice');\nconst { createSessionStore } = require('./services/auth/session-store');",
    after: "} = require('./services/voice');\nconst { createMediaDesktopController } = require('./services/media/desktop-controller');\nconst { createSessionStore } = require('./services/auth/session-store');"
  },
  {
    label: "desktop controller state",
    before: "let sessionStore;\nlet cloudConfigStore;\nlet forceClose = false;",
    after: "let sessionStore;\nlet cloudConfigStore;\nlet mediaDesktopController;\nlet forceClose = false;"
  },
  {
    label: "desktop controller composition",
    before: "  cloudConfigStore = createCloudConfigStore({\n    userDataPath: app.getPath('userData'),\n    isPackaged: app.isPackaged,\n    releaseBackendUrl: release.cloudBackendUrl || '',\n    releaseEnvironment: release.cloudEnvironment || (release.channel === 'stable' ? 'production' : 'development')\n  });\n  createWindow();",
    after: "  cloudConfigStore = createCloudConfigStore({\n    userDataPath: app.getPath('userData'),\n    isPackaged: app.isPackaged,\n    releaseBackendUrl: release.cloudBackendUrl || '',\n    releaseEnvironment: release.cloudEnvironment || (release.channel === 'stable' ? 'production' : 'development')\n  });\n  mediaDesktopController = createMediaDesktopController({\n    getBackendUrl: () => cloudConfigStore?.read()?.backendUrl || process.env.VIRAL_AI_CLOUD_URL || '',\n    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    refreshSession: () => refreshSessionIfNeeded(),\n    appVersion: app.getVersion()\n  });\n  createWindow();"
  },
  {
    label: "shutdown cancellation",
    before: "app.on('will-quit', () => {\n  try { diagnosticLogger?.info('app.stopping', { release: releaseInfo() }); } catch {}",
    after: "app.on('will-quit', () => {\n  try { mediaDesktopController?.cancelAll(); } catch {}\n  try { diagnosticLogger?.info('app.stopping', { release: releaseInfo() }); } catch {}"
  },
  {
    label: "endpoint-change cancellation",
    before: "  const endpointWillChange =\n    (before?.backendUrl || '') !== (previewValidation.backendUrl || '') ||\n    (before?.environment || 'development') !== nextEnvironment;\n\n  let previousSessionRemotePending = false;",
    after: "  const endpointWillChange =\n    (before?.backendUrl || '') !== (previewValidation.backendUrl || '') ||\n    (before?.environment || 'development') !== nextEnvironment;\n\n  if (endpointWillChange) mediaDesktopController?.cancelAll();\n\n  let previousSessionRemotePending = false;"
  },
  {
    label: "media IPC handlers",
    before: "ipcMain.handle('cloud:test-connection', async (_event, backendUrl) => {\n  const configured = cloudConfigStore?.read();\n  const target = typeof backendUrl === 'string' && backendUrl.trim()\n    ? backendUrl.trim()\n    : configured?.backendUrl || '';\n  return testCloudConnection(target);\n});\n\nipcMain.handle('files:select-videos', async () => {",
    after: "ipcMain.handle('cloud:test-connection', async (_event, backendUrl) => {\n  const configured = cloudConfigStore?.read();\n  const target = typeof backendUrl === 'string' && backendUrl.trim()\n    ? backendUrl.trim()\n    : configured?.backendUrl || '';\n  return testCloudConnection(target);\n});\n\nipcMain.handle('media:search-status', async () => {\n  try {\n    if (!mediaDesktopController) throw Object.assign(new Error('Media discovery is unavailable.'), { code: 'MEDIA_SEARCH_UNAVAILABLE' });\n    const data = await mediaDesktopController.status();\n    return { ok: true, data };\n  } catch (error) {\n    return { ok: false, error: mediaDesktopController?.publicError(error) || { code: 'MEDIA_SEARCH_UNAVAILABLE', details: {} } };\n  }\n});\n\nipcMain.handle('media:search', async (_event, payload) => {\n  try {\n    if (!mediaDesktopController) throw Object.assign(new Error('Media discovery is unavailable.'), { code: 'MEDIA_SEARCH_UNAVAILABLE' });\n    const safePayload = payload && typeof payload === 'object' ? payload : {};\n    const data = await mediaDesktopController.search(safePayload);\n    return { ok: true, data };\n  } catch (error) {\n    diagnosticLogger?.info('media.search_failed', { code: error?.code || 'MEDIA_SEARCH_UNAVAILABLE' });\n    return { ok: false, error: mediaDesktopController?.publicError(error) || { code: 'MEDIA_SEARCH_UNAVAILABLE', details: {} } };\n  }\n});\n\nipcMain.handle('media:search-cancel', async (_event, requestId) => {\n  return { ok: true, data: mediaDesktopController?.cancel(requestId) || { cancelled: false } };\n});\n\nipcMain.handle('files:select-videos', async () => {"
  }
]);

console.log("Media runtime integration patch applied.");
