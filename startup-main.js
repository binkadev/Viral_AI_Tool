"use strict";

const { app, BrowserWindow } = require("electron");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  console.warn("[Startup] Another Viral AI Tool instance is already running. Exiting this launch.");
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows().find(item => item && !item.isDestroyed());
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame === false) return;
      console.error("[Startup] Renderer failed to load", {
        errorCode,
        errorDescription,
        validatedURL
      });
    });

    contents.on("preload-error", (_preloadEvent, preloadPath, error) => {
      console.error("[Startup] Preload failed", {
        preloadPath,
        message: String(error?.message || error || "unknown preload error")
      });
    });

    contents.on("render-process-gone", (_goneEvent, details) => {
      console.error("[Startup] Renderer process stopped", {
        reason: details?.reason || "unknown",
        exitCode: details?.exitCode ?? null
      });
    });

    contents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
      if (Number(level) < 2) return;
      console.error("[Renderer]", String(message || ""), sourceId ? `(${sourceId}:${line || 0})` : "");
    });

    contents.on("did-finish-load", () => {
      setTimeout(async () => {
        if (contents.isDestroyed()) return;
        try {
          const health = await contents.executeJavaScript(`(() => {
            const shell = document.querySelector('.shell');
            const titlebar = document.querySelector('.titlebar');
            const page = document.getElementById('page');
            const visible = node => {
              if (!node) return false;
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
            };
            return {
              readyState: document.readyState,
              shellPresent: Boolean(shell),
              shellVisible: visible(shell),
              titlebarPresent: Boolean(titlebar),
              titlebarVisible: visible(titlebar),
              pagePresent: Boolean(page),
              pageVisible: visible(page),
              firstPaint: document.documentElement.dataset.coreFirstPaint || null,
              bodyChildren: document.body?.children?.length || 0
            };
          })()`, true);

          console.log("[Startup] Renderer health", health);

          if (!health?.shellPresent || !health?.titlebarPresent || !health?.shellVisible || !health?.titlebarVisible) {
            console.error("[Startup] Renderer loaded but the commercial shell is not visible.");
          }
        } catch (error) {
          console.error("[Startup] Renderer health check failed", {
            message: String(error?.message || error || "unknown health-check error")
          });
        }
      }, 1200);
    });
  });

  require("./main.js");
}
