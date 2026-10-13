"use strict";

const { app, BrowserWindow } = require("electron");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

function ownerWindow(contents) {
  try {
    const window = BrowserWindow.fromWebContents(contents) || contents.getOwnerBrowserWindow?.();
    return window && !window.isDestroyed() ? window : null;
  } catch {
    return null;
  }
}

function showOwnerWindow(contents, reason) {
  const window = ownerWindow(contents);
  if (!window) return false;
  try {
    if (!window.isVisible()) window.show();
    console.log("[Startup] Window visible", { reason });
    return true;
  } catch (error) {
    console.error("[Startup] Failed to show owner window", {
      reason,
      message: String(error?.message || error || "unknown show error")
    });
    return false;
  }
}

async function readRendererHealth(contents) {
  return contents.executeJavaScript(`(() => {
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
}

async function recoverRenderer(contents, health) {
  if (contents.isDestroyed()) return null;

  console.error("[Startup] Renderer first paint unhealthy; attempting recovery", health || {});

  try {
    const recovered = await contents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const shell = document.querySelector('.shell');
      const titlebar = document.querySelector('.titlebar');
      const page = document.getElementById('page');
      const guard = document.getElementById('coreFirstPaintGuard');

      root.dataset.coreFirstPaint = 'recovered';
      if (guard) guard.remove();

      for (const node of [shell, titlebar, page]) {
        if (!node) continue;
        node.style.removeProperty('display');
        node.style.setProperty('visibility', 'visible', 'important');
        node.style.setProperty('opacity', '1', 'important');
      }

      if (!shell || !titlebar) {
        document.body.innerHTML = \`
          <main id="startupRecovery" style="min-height:100vh;box-sizing:border-box;padding:48px;background:#f4f7fc;color:#172033;font-family:Inter,Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center">
            <section style="max-width:680px;width:100%;background:#fff;border:1px solid #dfe5ef;border-radius:20px;padding:28px;box-shadow:0 18px 50px rgba(30,45,80,.12)">
              <div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#65728a;margin-bottom:12px">VIRAL AI TOOL</div>
              <h1 style="font-size:24px;line-height:1.3;margin:0 0 10px">Giao diện chưa khởi động đúng</h1>
              <p style="font-size:15px;line-height:1.65;margin:0;color:#536078">Ứng dụng đã mở an toàn nhưng phần giao diện gặp lỗi khi khởi động. Hãy đóng ứng dụng và mở lại. Nhật ký chẩn đoán đã ghi lại lỗi để có thể sửa chính xác.</p>
            </section>
          </main>\`;
      }

      return {
        guardRemoved: !document.getElementById('coreFirstPaintGuard'),
        recoveryShell: Boolean(document.getElementById('startupRecovery')),
        firstPaint: root.dataset.coreFirstPaint
      };
    })()`, true);

    showOwnerWindow(contents, "renderer-recovery");
    return recovered;
  } catch (error) {
    console.error("[Startup] Renderer recovery failed", {
      message: String(error?.message || error || "unknown recovery error")
    });
    showOwnerWindow(contents, "renderer-recovery-failed");
    return null;
  }
}

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
    const visibilityFallback = setTimeout(() => {
      showOwnerWindow(contents, "startup-timeout");
    }, 3000);

    contents.once("destroyed", () => clearTimeout(visibilityFallback));

    contents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame === false) return;
      console.error("[Startup] Renderer failed to load", {
        errorCode,
        errorDescription,
        validatedURL
      });
      showOwnerWindow(contents, "did-fail-load");
    });

    contents.on("preload-error", (_preloadEvent, preloadPath, error) => {
      console.error("[Startup] Preload failed", {
        preloadPath,
        message: String(error?.message || error || "unknown preload error")
      });
      showOwnerWindow(contents, "preload-error");
    });

    contents.on("render-process-gone", (_goneEvent, details) => {
      console.error("[Startup] Renderer process stopped", {
        reason: details?.reason || "unknown",
        exitCode: details?.exitCode ?? null
      });
      showOwnerWindow(contents, "render-process-gone");
    });

    contents.on("unresponsive", () => {
      console.error("[Startup] Renderer became unresponsive before or during first paint.");
      showOwnerWindow(contents, "renderer-unresponsive");
    });

    contents.on("console-message", (...args) => {
      const current = args[0];
      let level;
      let message;
      let lineNumber;
      let sourceId;

      if (current && typeof current === "object" && typeof current.message === "string") {
        level = current.level;
        message = current.message;
        lineNumber = current.lineNumber;
        sourceId = current.sourceId;
      } else {
        level = args[1];
        message = args[2];
        lineNumber = args[3];
        sourceId = args[4];
      }

      const important = typeof level === "string"
        ? ["warning", "error"].includes(level)
        : Number(level) >= 2;
      if (!important) return;

      console.error("[Renderer]", String(message || ""), sourceId ? `(${sourceId}:${lineNumber || 0})` : "");
    });

    contents.on("did-finish-load", () => {
      clearTimeout(visibilityFallback);
      showOwnerWindow(contents, "did-finish-load");

      setTimeout(async () => {
        if (contents.isDestroyed()) return;
        try {
          const health = await readRendererHealth(contents);
          console.log("[Startup] Renderer health", health);

          const shellHealthy = Boolean(
            health?.shellPresent &&
            health?.titlebarPresent &&
            health?.shellVisible &&
            health?.titlebarVisible &&
            health?.firstPaint !== "pending"
          );

          if (!shellHealthy) {
            const recovery = await recoverRenderer(contents, health);
            console.log("[Startup] Renderer recovery result", recovery);
          }
        } catch (error) {
          console.error("[Startup] Renderer health check failed", {
            message: String(error?.message || error || "unknown health-check error")
          });
          await recoverRenderer(contents, { healthCheckFailed: true });
        }
      }, 1200);
    });
  });

  require("./main.js");
}
