'use strict';

const { BrowserWindow } = require('electron');

const nativeShow = BrowserWindow.prototype.show;
const revealState = new WeakMap();

async function revealAfterRendererPaint(win, state) {
  if (!win || win.isDestroyed() || state.ready) return;

  try {
    await win.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true
    );
  } catch {}

  if (!win || win.isDestroyed() || state.ready) return;
  state.ready = true;
  nativeShow.call(win);
}

BrowserWindow.prototype.show = function showAfterRendererPaint() {
  const win = this;
  let state = revealState.get(win);

  if (state?.ready) return nativeShow.call(win);
  if (state?.scheduled) return;

  state = { scheduled: true, ready: false };
  revealState.set(win, state);

  const reveal = () => revealAfterRendererPaint(win, state);
  if (win.webContents?.isLoadingMainFrame?.()) {
    win.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
  }
};

require('./main.js');
