'use strict';

const os = require('os');
const { app } = require('electron');
const {
  installAutomationScriptIpc,
  cancelAllAutomationScripts
} = require('./services/automation/desktop-ipc');
const {
  installAutomationStockIpc,
  cancelAllAutomationStockOperations
} = require('./services/automation/stock-desktop-ipc');
const {
  installAutomationVoiceIpc,
  cancelAllAutomationVoice
} = require('./services/automation/voice-desktop-ipc');
const {
  installAutomationCompositionPreviewIpc,
  cancelAllAutomationCompositionPreviews
} = require('./services/automation/composition-preview-ipc');
const {
  installAutomationCompositionExportIpc,
  cancelAllAutomationCompositionExports,
  getActiveAutomationCompositionExportCount
} = require('./services/automation/composition-export-ipc');

const WINDOWS_11_MIN_BUILD = 22000;
const STARTUP_DIAGNOSTICS = process.env.VIRAL_AI_STARTUP_DIAGNOSTICS === '1';
const STARTUP_STABILIZER_DISABLED = process.env.VIRAL_AI_DISABLE_STARTUP_STABILIZER === '1';

function windowsBuildNumber() {
  if (process.platform !== 'win32') return 0;
  const release = String(os.release() || '');
  const parts = release.split('.');
  const build = Number(parts[2] || 0);
  return Number.isFinite(build) ? build : 0;
}

const windowsBuild = windowsBuildNumber();
const forceGpu = process.env.VIRAL_AI_FORCE_GPU === '1';
const forceSoftware = process.env.VIRAL_AI_FORCE_SOFTWARE_RENDERING === '1';
const windows10SafeMode =
  process.platform === 'win32' &&
  windowsBuild > 0 &&
  windowsBuild < WINDOWS_11_MIN_BUILD &&
  !forceGpu;
const softwareRendering = process.platform === 'win32' && (forceSoftware || windows10SafeMode);

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  if (softwareRendering) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
  }
}

function installWindowsFirstPaintStabilizer() {
  if (process.platform !== 'win32' || STARTUP_STABILIZER_DISABLED) return;

  app.on('browser-window-created', (_event, win) => {
    if (!win || win.isDestroyed?.()) return;
    const contents = win.webContents;
    if (!contents) return;

    const timers = new Set();
    let flushInFlight = false;

    const flushCompositor = async () => {
      if (flushInFlight || win.isDestroyed?.() || contents.isDestroyed?.()) return;
      flushInFlight = true;
      try {
        try {
          await contents.executeJavaScript(
            'void document.documentElement.getBoundingClientRect(); void document.body?.getBoundingClientRect(); true;',
            true
          );
        } catch {}
        if (win.isDestroyed?.() || contents.isDestroyed?.()) return;
        try { await win.capturePage({ x: 0, y: 0, width: 2, height: 2 }); } catch {}
        if (win.isDestroyed?.() || contents.isDestroyed?.()) return;
        try { contents.invalidate(); } catch {}
      } finally {
        flushInFlight = false;
      }
    };

    const scheduleFlush = delay => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        flushCompositor().catch(() => {});
      }, delay);
      timers.add(timer);
    };

    contents.once('did-finish-load', () => {
      [0, 150, 500, 1500].forEach(scheduleFlush);
    });

    win.once('show', () => {
      [0, 250, 900].forEach(scheduleFlush);
    });

    win.once('closed', () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    });
  });
}

function installAutomationCompositionCloseGuard() {
  const promptOpen = new WeakSet();
  const allowClose = new WeakSet();

  app.on('browser-window-created', (_event, win) => {
    if (!win || win.isDestroyed?.()) return;
    const contents = win.webContents;
    if (!contents) return;

    contents.once('did-finish-load', () => {
      win.on('close', async event => {
        if (allowClose.has(win) || event.defaultPrevented) return;
        if (getActiveAutomationCompositionExportCount() <= 0) return;

        event.preventDefault();
        if (promptOpen.has(win)) return;
        promptOpen.add(win);

        let confirmed = false;
        try {
          confirmed = await contents.executeJavaScript(`(async () => {
            try {
              if (typeof confirmAction !== "function" || typeof t !== "function") return false;
              const active = (typeof state !== "undefined" && Array.isArray(state.jobs))
                ? state.jobs.find(job => job?.isAutomationCompositionExport === true && ["processing", "queued", "cancelling"].includes(String(job?.status || "")))
                : null;
              return Boolean(await confirmAction({
                title: t("export.stopTitle"),
                body: t("export.stopBody", { name: active?.name || t("common.video") }),
                confirmLabel: t("export.stop"),
                cancelLabel: t("export.keepGoing"),
                danger: true
              }));
            } catch {
              return false;
            }
          })()`, true);
        } catch {
          confirmed = false;
        } finally {
          promptOpen.delete(win);
        }

        if (!confirmed || win.isDestroyed?.()) return;
        allowClose.add(win);
        cancelAllAutomationCompositionExports();
        win.destroy();
      });
    });
  });
}

installWindowsFirstPaintStabilizer();
installAutomationCompositionCloseGuard();
installAutomationScriptIpc();
installAutomationStockIpc();
installAutomationVoiceIpc();
installAutomationCompositionPreviewIpc();
installAutomationCompositionExportIpc();
app.on('before-quit', () => {
  cancelAllAutomationScripts().catch(() => {});
  cancelAllAutomationStockOperations();
  cancelAllAutomationVoice();
  cancelAllAutomationCompositionPreviews();
  cancelAllAutomationCompositionExports();
});

if (STARTUP_DIAGNOSTICS) {
  console.log('[viral-ai:start] windows-rendering-policy', {
    platform: process.platform,
    windowsBuild,
    windows10SafeMode,
    softwareRendering,
    forceGpu,
    forceSoftware,
    startupStabilizer: process.platform === 'win32' && !STARTUP_STABILIZER_DISABLED
  });
}

require('./main.js');
