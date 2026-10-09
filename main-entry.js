'use strict';

const { app, BrowserWindow } = require('electron');

const nativeShow = BrowserWindow.prototype.show;
const revealState = new WeakMap();

function revealWindow(win, state) {
  if (!win || win.isDestroyed() || state.revealed) return;
  state.revealed = true;
  nativeShow.call(win);
}

app.on('browser-window-created', (_event, win) => {
  const state = {
    loaded: false,
    showRequested: false,
    revealed: false
  };
  revealState.set(win, state);

  const releaseLoaded = () => {
    state.loaded = true;
    if (state.showRequested) revealWindow(win, state);
  };

  const releaseFailure = () => {
    state.loaded = true;
    state.showRequested = true;
    revealWindow(win, state);
  };

  win.webContents.once('did-finish-load', releaseLoaded);
  win.webContents.once('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame === false) return;
    releaseFailure();
  });
  win.webContents.once('render-process-gone', releaseFailure);
});

BrowserWindow.prototype.show = function showAfterMainFrameLoad() {
  const win = this;
  const state = revealState.get(win);

  if (!state) return nativeShow.call(win);
  state.showRequested = true;
  if (state.loaded) return revealWindow(win, state);
  return undefined;
};

require('./main.js');
