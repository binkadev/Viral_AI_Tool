"use strict";

const fs = require("fs");
const path = require("path");
const target = path.join(__dirname, "..", "main.js");
let source = fs.readFileSync(target, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) throw new Error(label + " anchor must exist exactly once");
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "    activeVoiceCount() +\n    speechModelManager.activeDownloadCount();",
  "    activeVoiceCount() +\n    speechModelManager.activeDownloadCount() +\n    Number(mediaDesktopController?.activeAcquisitionCount?.() || 0);",
  "active media acquisition work count"
);

replaceOnce(
  "    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    refreshSession: () => refreshSessionIfNeeded(),\n    appVersion: app.getVersion()\n  });",
  "    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    refreshSession: () => refreshSessionIfNeeded(),\n    appVersion: app.getVersion(),\n    cacheRoot: path.join(app.getPath('userData'), 'media-cache'),\n    onAcquisitionProgress: payload => {\n      try {\n        if (mainWindow && !mainWindow.isDestroyed()) {\n          mainWindow.webContents.send('media:acquisition-progress', payload);\n        }\n      } catch {}\n    }\n  });",
  "media cache and progress composition"
);

replaceOnce(
  "ipcMain.handle('media:search-cancel', async (_event, requestId) => {\n  return { ok: true, data: mediaDesktopController?.cancel(requestId) || { cancelled: false } };\n});\n\nipcMain.handle('files:select-videos', async () => {",
  "ipcMain.handle('media:search-cancel', async (_event, requestId) => {\n  return { ok: true, data: mediaDesktopController?.cancel(requestId) || { cancelled: false } };\n});\n\nipcMain.handle('media:acquire', async (_event, payload) => {\n  try {\n    if (!mediaDesktopController) throw Object.assign(new Error('Media acquisition is unavailable.'), { code: 'MEDIA_DESTINATION_UNAVAILABLE' });\n    const safePayload = payload && typeof payload === 'object' ? payload : {};\n    const data = await mediaDesktopController.acquire(safePayload);\n    return { ok: true, data };\n  } catch (error) {\n    diagnosticLogger?.info('media.acquisition_failed', { code: error?.code || 'MEDIA_DOWNLOAD_FAILED' });\n    return { ok: false, error: mediaDesktopController?.publicError(error) || { code: 'MEDIA_DOWNLOAD_FAILED', details: {} } };\n  }\n});\n\nipcMain.handle('media:acquisition-cancel', async (_event, jobId) => {\n  return { ok: true, data: mediaDesktopController?.cancelAcquisition(jobId) || { cancelled: false } };\n});\n\nipcMain.handle('files:select-videos', async () => {",
  "media acquisition IPC handlers"
);

fs.writeFileSync(target, source, "utf8");
console.log("Media acquisition main-process patch applied.");
