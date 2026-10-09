"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("events");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "main-entry.js"), "utf8");

assert.strictEqual(pkg.main, "main-entry.js", "Electron must boot through the Windows startup bridge.");
assert(pkg.build.files.includes("main-entry.js"), "Packaged builds must include the startup bridge.");
assert(entry.includes("browser-window-created"), "Startup bridge must observe native window creation.");
assert(entry.includes("setBackgroundColor"), "Startup bridge must match the production dark shell background.");
assert(entry.includes("win.show()"), "Windows startup must reveal the native window immediately.");
assert(!entry.includes("disableHardwareAcceleration"), "Startup fix must preserve GPU acceleration.");
assert(!entry.includes("BrowserWindow.prototype"), "Startup fix must not monkey-patch BrowserWindow.");
assert(!entry.includes("requestAnimationFrame"), "Native startup must not depend on renderer animation timing.");

function boot(platform) {
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
    process: { platform },
    console
  };
  vm.runInNewContext(entry, sandbox, { filename: "main-entry.js" });
  assert.strictEqual(delegated, 1, "Startup bridge must delegate to main.js exactly once.");
  return app;
}

{
  const app = boot("win32");
  let shown = 0;
  let background = null;
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    setBackgroundColor(value) { background = value; },
    show() { shown += 1; }
  };
  app.emit("browser-window-created", {}, win);
  assert.strictEqual(background, "#080d17", "Windows startup background must match the dark shell.");
  assert.strictEqual(shown, 1, "Hidden Windows window must be shown immediately.");
}

{
  const app = boot("win32");
  let shown = 0;
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    setBackgroundColor() {},
    show() { shown += 1; }
  };
  app.emit("browser-window-created", {}, win);
  assert.strictEqual(shown, 0, "Already-visible window must not be shown twice by the bridge.");
}

{
  const app = boot("linux");
  let shown = 0;
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    setBackgroundColor() {},
    show() { shown += 1; }
  };
  app.emit("browser-window-created", {}, win);
  assert.strictEqual(shown, 0, "Immediate reveal must remain Windows-specific.");
}

console.log("Windows immediate startup bridge behavior passed");
