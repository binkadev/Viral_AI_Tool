'use strict';

const path = require('path');
const { app, ipcMain } = require('electron');
const {
  startDevVoice,
  cancelDevVoice,
  cancelAllDevVoice,
  status,
  activeCount,
  serializeError
} = require('./dev-voice-provider');

let installed = false;

function outputRoot() {
  return path.join(app.getPath('userData'), 'automation-voice', 'dev');
}

function installAutomationVoiceIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:voice-status', () => status());
  ipcMain.handle('automation:voice-active-count', () => ({ activeCount: activeCount() }));

  ipcMain.handle('automation:voice-start', async (event, payload = {}) => {
    const provider = status();
    if (!provider.ready) {
      return { ok: false, error: { code: provider.code, details: {}, technicalMessage: 'Automation voice provider is not configured.' } };
    }
    const operationId = String(payload?.operationId || '');
    try {
      const response = await startDevVoice({
        operationId,
        inputSignature: payload?.inputSignature,
        segments: payload?.segments,
        outputRoot: outputRoot(),
        onProgress(progress) {
          if (event.sender?.isDestroyed?.()) return;
          event.sender.send('automation:voice-progress', {
            operationId,
            phase: String(progress?.phase || 'generating'),
            percent: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
            sceneId: progress?.sceneId ? String(progress.sceneId) : null
          });
        }
      });
      return { ok: true, data: response };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });

  ipcMain.handle('automation:voice-cancel', (_event, operationId) => ({
    cancelled: cancelDevVoice(operationId)
  }));
}

module.exports = {
  installAutomationVoiceIpc,
  cancelAllAutomationVoice: cancelAllDevVoice,
  getActiveAutomationVoiceCount: activeCount
};
