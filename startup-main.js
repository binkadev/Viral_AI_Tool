"use strict";

const { app, BrowserWindow } = require("electron");

// Isolate storage BEFORE lock/session initialization; DEV code is not shipped.
let devHandoff = null;
if (app.isPackaged === false && process.env.NODE_ENV !== "production" &&
    ["completed", "persistence-failure", "tampered", "noncompleted", "legacy"].includes(process.env.VIRAL_AI_DEV_HANDOFF_FIXTURE) &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(process.env.VIRAL_AI_DEV_HANDOFF_SESSION || "")) {
  devHandoff = require("./dev/generated-handoff-harness").setup(app, process.env);
}
require("electron").ipcMain.handle("dev:generated-handoff", async (event, action, payload) => {
  if (!devHandoff || app.isPackaged !== false || process.env.NODE_ENV === "production") return null;
  const { pathToFileURL } = require("url"), path = require("path");
  if (event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== pathToFileURL(path.join(__dirname, "renderer", "index.html")).href) return null;
  return devHandoff.command?.(action, payload) ?? null;
});
if (devHandoff) app.on("web-contents-created", (_event, contents) => {
  contents.once("did-finish-load", () => {
    const path = require("path"), { pathToFileURL } = require("url");
    if (contents.getURL() !== pathToFileURL(path.join(__dirname, "renderer", "index.html")).href) return;
    contents.executeJavaScript(require("fs").readFileSync(path.join(__dirname, "dev", "generated-handoff-renderer.js"), "utf8"))
      .catch(error => console.error("[DEV handoff]", error));
  });
});
require("electron").ipcMain.on?.("dev:handoff-storage-fault", event => {
  const path = require("path"), { pathToFileURL } = require("url");
  const allowed = Boolean(devHandoff?.mode === "persistence-failure" && app.isPackaged === false &&
    process.env.NODE_ENV !== "production" && event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url === pathToFileURL(path.join(__dirname, "renderer", "index.html")).href);
  event.returnValue = allowed ? "dev-handoff-registry-fault-v1" : false;
});

// The fixture module is excluded from release files and never loaded in production.
let devGenerationFixture = null;
if (app.isPackaged === false && process.env.NODE_ENV !== "production" &&
    ["running", "failed", "interrupted", "completed"].includes(process.env.VIRAL_AI_DEV_GENERATION_STATE)) {
  devGenerationFixture = require("./dev/generation-visual-harness").setup(app, process.env);
}
require("electron").ipcMain.handle("dev:generation-fixture", event => {
  const { pathToFileURL } = require("url");
  const path = require("path");
  if (app.isPackaged !== false || process.env.NODE_ENV === "production" || !devGenerationFixture) return null;
  if (event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== pathToFileURL(path.join(__dirname, "renderer", "index.html")).href) return null;
  return devGenerationFixture;
});

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
    if (window.isMinimized()) window.restore();
    try { window.setIgnoreMouseEvents(false); } catch {}
    try { window.setFocusable(true); } catch {}
    if (!window.isVisible()) window.show();
    window.focus();
    console.log("[Startup] Window interactive", { reason });
    return true;
  } catch (error) {
    console.error("[Startup] Failed to activate owner window", {
      reason,
      message: String(error?.message || error || "unknown activation error")
    });
    return false;
  }
}

async function readRendererHealth(contents) {
  return contents.executeJavaScript(`(() => {
    const shell = document.querySelector('.shell');
    const titlebar = document.querySelector('.titlebar');
    const page = document.getElementById('page');
    const quickProject = document.getElementById('quickProject');
    const visible = node => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const pointerEvents = node => node ? getComputedStyle(node).pointerEvents : null;
    const dialogSelectors = [
      '#modal:not(.hidden)',
      '#core-media-discovery:not(.hidden)',
      '.core-command-overlay:not([hidden])',
      '[role="dialog"][aria-modal="true"]'
    ];
    const activeModal = dialogSelectors.some(selector => Array.from(document.querySelectorAll(selector)).some(visible));

    let interactionBlocked = false;
    let hitTarget = null;
    if (!activeModal && quickProject && visible(quickProject)) {
      const rect = quickProject.getBoundingClientRect();
      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      interactionBlocked = !hit || !(hit === quickProject || quickProject.contains(hit));
      hitTarget = hit ? [hit.tagName, hit.id || '', hit.className || ''].join('#').slice(0, 180) : null;
    }

    return {
      readyState: document.readyState,
      shellPresent: Boolean(shell),
      shellVisible: visible(shell),
      titlebarPresent: Boolean(titlebar),
      titlebarVisible: visible(titlebar),
      pagePresent: Boolean(page),
      pageVisible: visible(page),
      firstPaint: document.documentElement.dataset.coreFirstPaint || null,
      bodyChildren: document.body?.children?.length || 0,
      bodyInert: Boolean(document.body?.inert),
      shellInert: Boolean(shell?.inert),
      titlebarInert: Boolean(titlebar?.inert),
      pageInert: Boolean(page?.inert),
      shellPointerEvents: pointerEvents(shell),
      titlebarPointerEvents: pointerEvents(titlebar),
      pagePointerEvents: pointerEvents(page),
      activeModal,
      interactionBlocked,
      hitTarget
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

async function recoverInteraction(contents, health) {
  if (contents.isDestroyed()) return null;
  if (health?.activeModal) return { skipped: "active-modal" };

  console.error("[Startup] Renderer interaction unhealthy; attempting hit-test recovery", health || {});

  try {
    const recovered = await contents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const visible = node => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      };
      const activeModal = [
        '#modal:not(.hidden)',
        '#core-media-discovery:not(.hidden)',
        '.core-command-overlay:not([hidden])',
        '[role="dialog"][aria-modal="true"]'
      ].some(selector => Array.from(document.querySelectorAll(selector)).some(visible));
      if (activeModal) return { skipped: 'active-modal' };

      const drawer = document.getElementById('core-media-discovery');
      if (drawer && (!visible(drawer) || drawer.classList.contains('hidden'))) {
        drawer.classList.add('hidden');
        drawer.setAttribute('aria-hidden', 'true');
        root.classList.remove('core-media-discovery-open');
      }

      const commandOverlay = document.querySelector('.core-command-overlay');
      if (commandOverlay && !visible(commandOverlay)) commandOverlay.hidden = true;

      const modal = document.getElementById('modal');
      if (modal && !visible(modal)) modal.classList.add('hidden');

      if (document.body) document.body.inert = false;
      for (const child of Array.from(document.body?.children || [])) {
        if (!(child instanceof HTMLElement)) continue;
        if (child !== drawer || drawer?.classList.contains('hidden')) child.inert = false;
      }

      const critical = [
        document.querySelector('.titlebar'),
        document.querySelector('.shell'),
        document.querySelector('.main'),
        document.querySelector('.sidebar'),
        document.querySelector('.topbar'),
        document.getElementById('page')
      ];
      for (const node of critical) {
        if (!(node instanceof HTMLElement)) continue;
        node.inert = false;
        node.removeAttribute('aria-hidden');
        node.style.removeProperty('pointer-events');
      }

      const firstPaintGuard = document.getElementById('coreFirstPaintGuard');
      if (root.dataset.coreFirstPaint === 'pending') {
        root.dataset.coreFirstPaint = 'recovered';
        firstPaintGuard?.remove();
      }

      return {
        bodyInert: Boolean(document.body?.inert),
        shellInert: Boolean(document.querySelector('.shell')?.inert),
        titlebarInert: Boolean(document.querySelector('.titlebar')?.inert),
        pageInert: Boolean(document.getElementById('page')?.inert),
        discoveryOpen: root.classList.contains('core-media-discovery-open'),
        firstPaint: root.dataset.coreFirstPaint || null
      };
    })()`, true);

    showOwnerWindow(contents, "interaction-recovery");
    return recovered;
  } catch (error) {
    console.error("[Startup] Renderer interaction recovery failed", {
      message: String(error?.message || error || "unknown interaction recovery error")
    });
    showOwnerWindow(contents, "interaction-recovery-failed");
    return null;
  }
}

async function probeAndRecover(contents, reason) {
  if (contents.isDestroyed()) return;
  try {
    const health = await readRendererHealth(contents);
    console.log("[Startup] Renderer health", { reason, ...health });

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

    const interactionHealthy = Boolean(
      !health?.bodyInert &&
      !health?.shellInert &&
      !health?.titlebarInert &&
      !health?.pageInert &&
      health?.shellPointerEvents !== "none" &&
      health?.titlebarPointerEvents !== "none" &&
      health?.pagePointerEvents !== "none" &&
      !health?.interactionBlocked
    );

    if (!health?.activeModal && !interactionHealthy) {
      const recovery = await recoverInteraction(contents, health);
      console.log("[Startup] Interaction recovery result", recovery);
    }
  } catch (error) {
    console.error("[Startup] Renderer health check failed", {
      reason,
      message: String(error?.message || error || "unknown health-check error")
    });
    await recoverRenderer(contents, { healthCheckFailed: true, reason });
    await recoverInteraction(contents, { healthCheckFailed: true, reason });
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
    try { window.setIgnoreMouseEvents(false); } catch {}
    try { window.setFocusable(true); } catch {}
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

      setTimeout(() => probeAndRecover(contents, "first-paint").catch(() => {}), 1200);
      setTimeout(() => probeAndRecover(contents, "interaction-settle").catch(() => {}), 3500);
    });
  });

  require("./main.js");
}
