'use strict';

const path = require('path');
const { app, ipcMain } = require('electron');
const {
  exportComposition,
  cancelCompositionExport,
  cancelAllCompositionExports,
  getActiveCompositionExportCount,
  serializeExportError
} = require('./composition-export');

let installed = false;

function tempRoot() {
  return path.join(app.getPath('temp'), 'viral-ai-tool', 'automation-composition-export');
}

function installAutomationCompositionExportIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:composition-export-start', async (event, payload = {}) => {
    const operationId = String(payload?.operationId || '');
    try {
      const result = await exportComposition({
        operationId,
        composition: payload?.composition,
        outputDir: payload?.outputDir,
        projectName: payload?.projectName,
        burnSubtitles: payload?.burnSubtitles !== false,
        tempRoot: tempRoot(),
        onProgress(progress) {
          if (event.sender?.isDestroyed?.()) return;
          event.sender.send('automation:composition-export-progress', {
            operationId,
            phase: String(progress?.phase || 'processing'),
            percent: Math.max(0, Math.min(100, Number(progress?.percent || 0)))
          });
        }
      });
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: serializeExportError(error) };
    }
  });

  ipcMain.handle('automation:composition-export-cancel', (_event, operationId) => ({
    cancelled: cancelCompositionExport(operationId)
  }));

  ipcMain.handle('automation:composition-export-status', () => ({
    activeCount: getActiveCompositionExportCount()
  }));
}

module.exports = {
  installAutomationCompositionExportIpc,
  cancelAllAutomationCompositionExports: cancelAllCompositionExports,
  getActiveAutomationCompositionExportCount: getActiveCompositionExportCount
};
