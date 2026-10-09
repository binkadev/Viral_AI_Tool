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
assert(main.includes("mainWindow.once('ready-to-show', () => mainWindow.show())"), "Successful startup must reveal through Electron's painted ready-to-show lifecycle.");
assert(entry.includes("app.on('browser-window-created'"), "The first-paint bridge must observe BrowserWindow creation before main.js creates the window.");
assert(entry.includes("did-fail-load"), "A failed app main-frame load must not leave the window hidden forever.");
assert(entry.includes("render-process-gone"), "Renderer failure must not leave the native window hidden forever.");
assert(entry.includes("win.once('unresponsive'"), "A startup renderer hang must reveal a recoverable window instead of staying hidden forever.");
assert(entry.includes("renderer/index.html"), "Load-failure recovery must be gated to the real renderer document.");
assert(entry.includes("win.show()"), "Failure recovery must use the BrowserWindow instance's native show path.");
assert(entry.includes("require('./main.js')"), "The bridge must delegate application behavior to the existing main process.");
assert(entry.includes("CalculateNativeWinOcclusion"), "Windows startup must disable Chromium native occlusion classification.");
assert(entry.includes("disable-renderer-backgrounding"), "Windows startup must keep the renderer active while the window is initially hidden.");
assert(entry.includes("disable-backgrounding-occluded-windows"), "Windows startup must keep occluded windows paintable.");
assert(entry.includes("app.disableHardwareAcceleration()"), "Windows startup must provide a deterministic software compositor fallback.");
assert(entry.includes("VIRAL_AI_ENABLE_HARDWARE_ACCELERATION"), "Hardware acceleration must remain explicitly testable without editing source.");
assert(!entry.includes("BrowserWindow.prototype.show"), "The hotfix must not monkey-patch BrowserWindow.show.");
assert(!entry.includes("showRequested"), "The hotfix must not gate show requests behind custom state.");
assert(!entry.includes("WeakMap"), "The hotfix must not retain custom per-window reveal ownership.");
assert(!entry.includes("requestAnimationFrame"), "A hidden Electron window must not wait on renderer animation frames before show.");
assert(!entry.includes("executeJavaScript"), "First reveal must not depend on renderer script execution while the window is hidden.");
assert(!entry.includes("setInterval("), "First-paint reveal must not poll.");
assert(!entry.includes("setTimeout("), "First-paint reveal must not use fake timing delays.");

function bootBridge({ platform = "win32", env = {} } = {}) {
  const app = new EventEmitter();
  const switches = [];
  let hardwareAccelerationDisableCount = 0;
  let delegated = 0;

  app.commandLine = {
    appendSwitch(name, value) {
      switches.push([String(name), value === undefined ? undefined : String(value)]);
    }
  };
  app.disableHardwareAcceleration = () => {
    hardwareAccelerationDisableCount += 1;
  };

  const sandbox = {
    require(id) {
      if (id === "electron") return { app };
      if (id === "./main.js") {
        delegated += 1;
        return {};
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { env: { ...env }, platform },
    console
  };

  vm.runInNewContext(entry, sandbox, { filename: "main-entry.js" });
  assert.strictEqual(delegated, 1, "The entry bridge must delegate to main.js exactly once.");

  return {
    app,
    switches,
    get hardwareAccelerationDisableCount() {
      return hardwareAccelerationDisableCount;
    }
  };
}

function hasSwitch(switches, name, value) {
  return switches.some(([switchName, switchValue]) =>
    switchName === name && (value === undefined || switchValue === value)
  );
}

{
  const boot = bootBridge();
  assert(hasSwitch(boot.switches, "disable-features", "CalculateNativeWinOcclusion"), "Windows must disable native occlusion before app readiness.");
  assert(hasSwitch(boot.switches, "disable-renderer-backgrounding"), "Windows must disable renderer backgrounding before app readiness.");
  assert(hasSwitch(boot.switches, "disable-backgrounding-occluded-windows"), "Windows must keep occluded windows paintable before app readiness.");
  assert.strictEqual(boot.hardwareAccelerationDisableCount, 1, "Windows must use the software compositor by default for startup stability.");
}

{
  const boot = bootBridge({
    env: { VIRAL_AI_ENABLE_HARDWARE_ACCELERATION: "1" }
  });
  assert.strictEqual(boot.hardwareAccelerationDisableCount, 0, "Explicit GPU validation must bypass the software compositor fallback.");
  assert(hasSwitch(boot.switches, "disable-features", "CalculateNativeWinOcclusion"), "GPU validation must still retain the native occlusion fix.");
}

{
  const boot = bootBridge({ platform: "linux" });
  assert.strictEqual(boot.switches.length, 0, "Windows compositor switches must not leak to other platforms.");
  assert.strictEqual(boot.hardwareAccelerationDisableCount, 0, "Non-Windows startup must not disable hardware acceleration.");
}

function createWindowHarness(initialUrl = "about:blank") {
  const webContents = new EventEmitter();
  let visible = false;
  let destroyed = false;
  let showCount = 0;
  let currentUrl = initialUrl;
  webContents.getURL = () => currentUrl;

  return {
    win: Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => destroyed,
      isVisible: () => visible,
      show() {
        showCount += 1;
        visible = true;
      }
    }),
    webContents,
    get showCount() { return showCount; },
    setVisible(value) { visible = Boolean(value); },
    setUrl(value) { currentUrl = String(value || ""); },
    destroy() { destroyed = true; }
  };
}

const { app } = bootBridge();
const rendererUrl = "file:///C:/workspace/Viral_AI_Tool/renderer/index.html";

{
  const harness = createWindowHarness();
  app.emit("browser-window-created", {}, harness.win);
  assert.strictEqual(harness.showCount, 0, "Window must remain hidden before Electron reports a painted success frame.");

  harness.webContents.emit("did-finish-load");
  assert.strictEqual(harness.showCount, 0, "about:blank did-finish-load must never reveal the application window.");

  harness.setUrl(rendererUrl);
  harness.webContents.emit("did-finish-load");
  assert.strictEqual(harness.showCount, 0, "Successful renderer did-finish-load must stay hidden until main.js receives ready-to-show.");
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
  const harness = createWindowHarness();
  app.emit("browser-window-created", {}, harness.win);
  harness.win.emit("unresponsive");
  assert.strictEqual(harness.showCount, 1, "An unresponsive startup renderer must reveal the window for recovery instead of hiding forever.");
}

{
  const harness = createWindowHarness(rendererUrl);
  harness.destroy();
  app.emit("browser-window-created", {}, harness.win);
  harness.webContents.emit("did-fail-load", {}, -2, "renderer main frame failed", rendererUrl, true);
  assert.strictEqual(harness.showCount, 0, "Destroyed windows must never be shown by failure recovery.");
}

console.log("core Electron first-paint bridge behavior passed");
