'use strict';

const { ipcMain } = require('electron');
const provider = require('./openai-script-provider');
const {
  createScriptEngine,
  serializeScriptError,
  activeScriptCount,
  cancelAllScripts
} = require('./script-engine');

let installed = false;
const engine = createScriptEngine({ provider });

function publicError(error) {
  const serialized = serializeScriptError(error);
  return {
    code: serialized.code,
    details: serialized.details || {}
  };
}

function installAutomationScriptIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle('automation:script-status', async () => {
    try {
      return await engine.status();
    } catch (error) {
      const serialized = serializeScriptError(error);
      return { ready: false, code: serialized.code, provider: provider.id };
    }
  });

  ipcMain.handle('automation:script-start', async (event, payload) => {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    try {
      const data = await engine.start({
        jobId: safePayload.jobId,
        brief: safePayload.brief,
        onProgress: progress => {
          if (!event.sender.isDestroyed()) event.sender.send('automation:script-progress', progress);
        }
      });
      return { ok: true, data };
    } catch (error) {
      console.error('[AutomationScript]', error?.code || error?.message);
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.handle('automation:script-cancel', async (_event, jobId) => {
    try {
      return { ok: true, cancelled: await engine.cancel(jobId) };
    } catch (error) {
      return { ok: false, cancelled: false, error: publicError(error) };
    }
  });
}

function activeAutomationScriptCount() {
  return activeScriptCount();
}

async function cancelAllAutomationScripts() {
  return cancelAllScripts();
}

module.exports = {
  installAutomationScriptIpc,
  activeAutomationScriptCount,
  cancelAllAutomationScripts
};
