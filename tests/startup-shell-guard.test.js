"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const startup = fs.readFileSync(path.join(root, "startup-main.js"), "utf8");

assert.strictEqual(pkg.main, "startup-main.js", "Electron must launch through the startup guard");
assert(pkg.build.files.includes("startup-main.js"), "packaged builds must include the startup guard");
assert(pkg.scripts["test:startup-shell"], "package.json must expose the startup shell regression");
assert(pkg.scripts["test:core-commercial"].includes("test:startup-shell"), "commercial regression must gate startup diagnostics");

for (const required of [
  "app.requestSingleInstanceLock()",
  'app.on("second-instance"',
  'app.on("web-contents-created"',
  'contents.on("did-fail-load"',
  'contents.on("preload-error"',
  'contents.on("render-process-gone"',
  'contents.on("unresponsive"',
  'contents.on("console-message"',
  'contents.on("did-finish-load"',
  "BrowserWindow.fromWebContents",
  "showOwnerWindow",
  '"startup-timeout"',
  '"did-finish-load"',
  "readRendererHealth",
  "recoverRenderer",
  "contents.executeJavaScript",
  "shellPresent",
  "shellVisible",
  "titlebarPresent",
  "titlebarVisible",
  'health?.firstPaint !== "pending"',
  "coreFirstPaintGuard",
  "startupRecovery",
  'require("./main.js")'
]) {
  assert(startup.includes(required), "Startup guard is missing: " + required);
}

assert(
  startup.indexOf("app.requestSingleInstanceLock()") < startup.indexOf('require("./main.js")'),
  "single-instance lock must be acquired before the application main process initializes"
);

assert(
  startup.indexOf('showOwnerWindow(contents, "did-finish-load")') < startup.indexOf("readRendererHealth(contents)"),
  "the window must become visible before renderer health probing can leave the user staring at a blank surface"
);

assert(
  startup.includes("root.dataset.coreFirstPaint = 'recovered'"),
  "startup recovery must release a stuck first-paint guard"
);

console.log("Startup single-instance, visibility fallback, health probe, and renderer recovery regression passed.");
