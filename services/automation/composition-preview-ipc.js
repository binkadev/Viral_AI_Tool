'use strict';

const path = require('path');
const { app, ipcMain } = require('electron');
const {
  buildCompositionPreview,
  cancelCompositionPreview,
  cancelAllCompositionPreviews,
  serializePreviewError
} = require('./composition-preview');

let installed = false;

function cacheRoot() {
  return path.join(app.getPath('userData'), 'automation-composition-previews');
}

function installAutomationCompositionPreviewIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:composition-preview-build', async (event, payload = {}) => {
    const operationId = String(payload?.operationId || '');
    try {
      const result = await buildCompositionPreview({
        operationId,
        composition: payload?.composition,
        cacheRoot: cacheRoot(),
        onProgress(progress) {
          if (event.sender?.isDestroyed?.()) return;
          event.sender.send('automation:composition-preview-progress', {
            operationId,
            phase: String(progress?.phase || 'building-preview'),
            percent: Math.max(0, Math.min(100, Number(progress?.percent || 0)))
          });
        }
      });
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: serializePreviewError(error) };
    }
  });

  ipcMain.handle('automation:composition-preview-cancel', (_event, operationId) => ({
    cancelled: cancelCompositionPreview(operationId)
  }));
}

module.exports = {
  installAutomationCompositionPreviewIpc,
  cancelAllAutomationCompositionPreviews: cancelAllCompositionPreviews
};
