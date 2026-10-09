'use strict';

const { app } = require('electron');

app.on('browser-window-created', (_event, win) => {
  const webContents = win.webContents;

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
