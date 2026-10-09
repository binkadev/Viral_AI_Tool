'use strict';

const { app } = require('electron');

const STARTUP_DIAGNOSTICS = process.env.VIRAL_AI_STARTUP_DIAGNOSTICS === '1';

function isAppRendererUrl(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .split('#')[0]
    .split('?')[0]
    .toLowerCase();
  return normalized.startsWith('file:') && normalized.endsWith('/renderer/index.html');
}

app.on('browser-window-created', (_event, win) => {
  const webContents = win.webContents;
  const currentUrl = () => String(webContents.getURL?.() || '');

  if (STARTUP_DIAGNOSTICS) {
    console.log('[viral-ai:start] browser-window-created');
    webContents.on('dom-ready', () => console.log('[viral-ai:start] dom-ready', currentUrl()));
    webContents.on('did-finish-load', () => console.log('[viral-ai:start] did-finish-load', currentUrl()));
    webContents.on('did-fail-load', (_loadEvent, code, description, url, isMainFrame) => {
      console.error('[viral-ai:start] did-fail-load', { code, description, url, isMainFrame });
    });
    webContents.on('preload-error', (_preloadEvent, preloadPath, error) => {
      console.error('[viral-ai:start] preload-error', preloadPath, error?.stack || error?.message || error);
    });
    webContents.on('console-message', (_consoleEvent, level, message, line, sourceId) => {
      console.log(`[viral-ai:renderer:${level}] ${message} @ ${sourceId || 'renderer'}:${line || 0}`);
    });
    webContents.on('render-process-gone', (_goneEvent, details) => {
      console.error('[viral-ai:start] render-process-gone', details);
    });
    win.on('unresponsive', () => console.error('[viral-ai:start] browser-window-unresponsive'));
    win.on('responsive', () => console.log('[viral-ai:start] browser-window-responsive'));
  }

  const revealWindow = () => {
    if (!win || win.isDestroyed() || win.isVisible()) return;
    win.show();
  };

  const detachFailureFallbacks = () => {
    webContents.removeListener('did-fail-load', onDidFailLoad);
    webContents.removeListener('render-process-gone', onRenderProcessGone);
    win.removeListener('unresponsive', onUnresponsive);
  };

  const revealFailure = () => {
    detachFailureFallbacks();
    revealWindow();
  };

  const onDidFailLoad = (_event, _code, _description, url, isMainFrame) => {
    if (isMainFrame === false) return;
    const failedUrl = String(url || currentUrl());
    if (!isAppRendererUrl(failedUrl)) {
      if (STARTUP_DIAGNOSTICS) console.log('[viral-ai:start] ignored-fail-load', failedUrl || '(empty)');
      return;
    }
    revealFailure();
  };

  const onRenderProcessGone = () => revealFailure();
  const onUnresponsive = () => revealFailure();

  // Successful startup stays on BrowserWindow's native `ready-to-show` path in
  // main.js so the first visible frame is already painted. These listeners are
  // failure-only fallbacks: they prevent a load error, renderer exit or startup
  // hang from leaving the only application window hidden forever.
  webContents.on('did-fail-load', onDidFailLoad);
  webContents.once('render-process-gone', onRenderProcessGone);
  win.once('unresponsive', onUnresponsive);
});

require('./main.js');
