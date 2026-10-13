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
  "window.setIgnoreMouseEvents(false)",
  "window.setFocusable(true)",
  '"startup-timeout"',
  '"did-finish-load"',
  "readRendererHealth",
  "recoverRenderer",
  "recoverInteraction",
  "probeAndRecover",
  "contents.executeJavaScript",
  "shellPresent",
  "shellVisible",
  "titlebarPresent",
  "titlebarVisible",
  "bodyInert",
  "shellInert",
  "titlebarInert",
  "pageInert",
  "interactionBlocked",
  "activeModal",
  'health?.firstPaint !== "pending"',
  "coreFirstPaintGuard",
  "core-media-discovery-open",
  "startupRecovery",
  '"first-paint"',
  '"interaction-settle"',
  'require("./main.js")'
]) {
  assert(startup.includes(required), "Startup guard is missing: " + required);
}

assert(
  startup.indexOf("app.requestSingleInstanceLock()") < startup.indexOf('require("./main.js")'),
  "single-instance lock must be acquired before the application main process initializes"
);

const didFinishHandler = startup.indexOf('contents.on("did-finish-load"');
const showAfterFinish = startup.indexOf('showOwnerWindow(contents, "did-finish-load")', didFinishHandler);
const firstProbe = startup.indexOf('probeAndRecover(contents, "first-paint")', didFinishHandler);
const settleProbe = startup.indexOf('probeAndRecover(contents, "interaction-settle")', didFinishHandler);

assert(didFinishHandler >= 0, "startup must register a did-finish-load handler");
assert(showAfterFinish >= didFinishHandler, "did-finish-load must activate the owner window");
assert(firstProbe >= didFinishHandler, "did-finish-load must schedule the first renderer health probe");
assert(settleProbe > firstProbe, "startup must re-check interaction after renderer state settles");
assert(
  showAfterFinish < firstProbe,
  "the window must become active before renderer health probing can leave the user staring at a blank surface"
);

assert(
  startup.includes("root.dataset.coreFirstPaint = 'recovered'"),
  "startup recovery must release a stuck first-paint guard"
);
assert(
  startup.includes("child.inert = false") && startup.includes("node.inert = false"),
  "interaction recovery must clear stale inert locks when no modal is active"
);
assert(
  startup.includes("node.style.removeProperty('pointer-events')"),
  "interaction recovery must clear stale pointer-event locks from critical surfaces"
);
assert(
  startup.includes("if (health?.activeModal) return { skipped: \"active-modal\" }"),
  "interaction recovery must not break legitimate modal isolation"
);

console.log("Startup single-instance, first-paint recovery, native hit-test reset, and renderer interaction recovery regression passed.");
