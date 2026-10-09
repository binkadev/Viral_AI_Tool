"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("events");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "main-entry.js"), "utf8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");

assert.strictEqual(pkg.main, "main-entry.js", "Electron must boot through the paint-safe entry bridge.");
assert(Array.isArray(pkg.build?.files) && pkg.build.files.includes("main-entry.js"), "Packaged builds must include the first-paint entry bridge.");
assert(main.includes("show: false"), "The native window must remain hidden during renderer startup.");
assert(entry.includes("app.on('browser-window-created'"), "The first-paint bridge must observe BrowserWindow creation before main.js creates the window.");
assert(entry.includes("did-finish-load"), "The bridge must reveal after the renderer main frame finishes loading.");
assert(entry.includes("did-fail-load"), "A failed main-frame load must not leave the window hidden forever.");
assert(entry.includes("render-process-gone"), "Renderer failure must not leave the native window hidden forever.");
assert(entry.includes("win.show()"), "The bridge must use the BrowserWindow instance's native show path.");
assert(entry.includes("require('./main.js')"), "The bridge must delegate application behavior to the existing main process.");
assert(entry.includes("renderer/index.html"), "Reveal ownership must be gated to the real renderer document.");
assert(entry.includes("webContents.getURL"), "Reveal gating must inspect the currently loaded document.");
assert(!entry.includes("BrowserWindow.prototype.show"), "The hotfix must not monkey-patch BrowserWindow.show.");
assert(!entry.includes("showRequested"), "The hotfix must not gate show requests behind custom state.");
assert(!entry.includes("WeakMap"), "The hotfix must not retain custom per-window reveal ownership.");
assert(!entry.includes("requestAnimationFrame"), "A hidden Electron window must not wait on renderer animation frames before show.");
assert(!entry.includes("executeJavaScript"), "First reveal must not depend on renderer script execution while the window is hidden.");
assert(!entry.includes("setInterval("), "First-paint reveal must not poll.");
assert(!entry.includes("setTimeout("), "First-paint reveal must not use fake timing delays.");

function bootBridge() {
  const app = new EventEmitter();
  let delegated = 0;
  const sandbox = {
    require(id) {
      if (id === "electron") return { app };
      if (id === "./main.js") {
        delegated += 1;
        return {};
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { env: {} },
    console
  };

  vm.runInNewContext(entry, sandbox, { filename: "main-entry.js" });
  assert.strictEqual(delegated, 1, "The entry bridge must delegate to main.js exactly once.");
  return app;
}

function createWindowHarness(initialUrl = "about:blank") {
  const webContents = new EventEmitter();
  let visible = false;
  let destroyed = false;
  let showCount = 0;
  let currentUrl = initialUrl;
  webContents.getURL = () => currentUrl;

  return {
    win: {
      webContents,
      isDestroyed: () => destroyed,
      isVisible: () => visible,
      show() {
        showCount += 1;
        visible = true;
      }
    },
    webContents,
    get showCount() { return showCount; },
    setVisible(value) { visible = Boolean(value); },
    setUrl(value) { currentUrl = String(value || ""); },
    destroy() { destroyed = true; }
  };
}

const app = bootBridge();
const rendererUrl = "file:///C:/workspace/Viral_AI_Tool/renderer/index.html";

{
  const harness = createWindowHarness();
  app.emit("browser-window-created", {}, harness.win);
  assert.strictEqual(harness.showCount, 0, "Window must remain hidden before renderer load completes.");

  harness.webContents.emit("did-finish-load");
  assert.strictEqual(harness.showCount, 0, "Initial about:blank must never reveal the application window.");

  harness.setUrl(rendererUrl);
  harness.webContents.emit("did-finish-load");
  assert.strictEqual(harness.showCount, 1, "The real renderer document must reveal the hidden window.");

  harness.webContents.emit("did-fail-load", {}, -1, "late failure", rendererUrl, true);
  assert.strictEqual(harness.showCount, 1, "Later lifecycle events must not reveal an already-visible window twice.");
}

{
  const harness = createWindowHarness();
  app.emit("browser-window-created", {}, harness.win);

  harness.webContents.emit("did-fail-load", {}, -1, "subframe", "file:///subframe.html", false);
  assert.strictEqual(harness.showCount, 0, "Subframe load failure must not reveal the application window.");

  harness.webContents.emit("did-fail-load", {}, -2, "blank main frame failed", "about:blank", true);
  assert.strictEqual(harness.showCount, 0, "A non-app main-frame failure must not reveal a blank window.");

  harness.webContents.emit("did-fail-load", {}, -2, "renderer main frame failed", rendererUrl, true);
  assert.strictEqual(harness.showCount, 1, "The app renderer main-frame failure must reveal the window for recovery instead of hiding forever.");
}

{
  const harness = createWindowHarness();
  app.emit("browser-window-created", {}, harness.win);
  harness.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.strictEqual(harness.showCount, 1, "Renderer exit must reveal the window for recovery instead of hiding forever.");
}

{
  const harness = createWindowHarness(rendererUrl);
  harness.destroy();
  app.emit("browser-window-created", {}, harness.win);
  harness.webContents.emit("did-finish-load");
  assert.strictEqual(harness.showCount, 0, "Destroyed windows must never be shown.");
}

console.log("core Electron first-paint bridge behavior passed");
