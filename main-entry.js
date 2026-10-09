'use strict';

const { app } = require('electron');

app.on('browser-window-created', (_event, win) => {
  const revealWindow = () => {
    if (!win || win.isDestroyed() || win.isVisible()) return;
    win.show();
  };

  win.webContents.once('did-finish-load', revealWindow);
  win.webContents.once('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame === false) return;
    revealWindow();
  });
  win.webContents.once('render-process-gone', revealWindow);
});

require('./main.js');
