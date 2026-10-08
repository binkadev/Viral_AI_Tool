'use strict';

const { BrowserWindow } = require('electron');

const nativeShow = BrowserWindow.prototype.show;
const revealState = new WeakMap();

function revealWindow(win, state) {
  if (!win || win.isDestroyed() || state.ready) return;
  state.ready = true;
  setImmediate(() => {
    if (!win || win.isDestroyed()) return;
    nativeShow.call(win);
  });
}

BrowserWindow.prototype.show = function showAfterRendererLoad() {
  const win = this;
  let state = revealState.get(win);

  if (state?.ready) return nativeShow.call(win);
  if (state?.scheduled) return;

  state = { scheduled: true, ready: false };
  revealState.set(win, state);

  if (win.webContents?.isLoadingMainFrame?.()) {
    win.webContents.once('did-finish-load', () => revealWindow(win, state));
    return;
  }

  revealWindow(win, state);
};

require('./main.js');
