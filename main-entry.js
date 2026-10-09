'use strict';

const { app } = require('electron');

const STARTUP_DIAGNOSTICS = process.env.VIRAL_AI_STARTUP_DIAGNOSTICS === '1';

app.on('browser-window-created', (_event, win) => {
  const webContents = win.webContents;

  if (STARTUP_DIAGNOSTICS) {
    console.log('[viral-ai:start] browser-window-created');
    webContents.on('dom-ready', () => console.log('[viral-ai:start] dom-ready'));
    webContents.on('did-finish-load', () => console.log('[viral-ai:start] did-finish-load'));
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

  const onDidFinishLoad = () => finishReveal();
  const onDidFailLoad = (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame === false) return;
    finishReveal();
  };
  const onRenderProcessGone = () => finishReveal();

  webContents.once('did-finish-load', onDidFinishLoad);
  webContents.on('did-fail-load', onDidFailLoad);
  webContents.once('render-process-gone', onRenderProcessGone);
});

require('./main.js');
