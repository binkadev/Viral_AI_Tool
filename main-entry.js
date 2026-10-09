'use strict';

const { app } = require('electron');

const WINDOWS_STARTUP_BACKGROUND = '#080d17';

// Viral AI Tool is Windows-first and uses a frameless BrowserWindow. Keeping
// that window hidden until `ready-to-show` has proven unreliable on the target
// Windows setup: Chromium can render the document background while the native
// surface never presents the composed shell. Electron's own BrowserWindow docs
// recommend showing complex windows immediately with a matching background.
//
// Keep the existing main process untouched. We only intercept window creation
// on Windows, set a startup color that matches the production dark shell and
// reveal the native window before the renderer starts loading. main.js may call
// show() again on `ready-to-show`; that second call is intentionally harmless.
if (process.platform === 'win32') {
  app.on('browser-window-created', (_event, win) => {
    if (!win || win.isDestroyed()) return;

    try {
      win.setBackgroundColor(WINDOWS_STARTUP_BACKGROUND);
    } catch {}

    if (!win.isVisible()) {
      win.show();
    }
  });
}

require('./main.js');
