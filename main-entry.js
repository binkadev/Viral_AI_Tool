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

  const detachLifecycle = () => {
    webContents.removeListener('did-finish-load', onDidFinishLoad);
    webContents.removeListener('did-fail-load', onDidFailLoad);
    webContents.removeListener('render-process-gone', onRenderProcessGone);
  };

  const finishReveal = () => {
    detachLifecycle();
    revealWindow();
  };

  const onDidFinishLoad = () => {
    const url = currentUrl();
    if (!isAppRendererUrl(url)) {
      if (STARTUP_DIAGNOSTICS) console.log('[viral-ai:start] ignored-finish-load', url || '(empty)');
      return;
    }
    finishReveal();
  };

  const onDidFailLoad = (_event, _code, _description, url, isMainFrame) => {
    if (isMainFrame === false) return;
    const failedUrl = String(url || currentUrl());
    if (!isAppRendererUrl(failedUrl)) {
      if (STARTUP_DIAGNOSTICS) console.log('[viral-ai:start] ignored-fail-load', failedUrl || '(empty)');
      return;
    }
    finishReveal();
  };

  const onRenderProcessGone = () => finishReveal();

  // `BrowserWindow` may complete an initial about:blank document before
  // loadFile() finishes the real renderer. Keep listening until the actual app
  // document settles instead of revealing that blank intermediate surface.
  webContents.on('did-finish-load', onDidFinishLoad);
  webContents.on('did-fail-load', onDidFailLoad);
  webContents.once('render-process-gone', onRenderProcessGone);
});

require('./main.js');
