"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

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
assert(!entry.includes("BrowserWindow.prototype.show"), "The hotfix must not monkey-patch BrowserWindow.show.");
assert(!entry.includes("showRequested"), "The hotfix must not gate show requests behind custom state.");
assert(!entry.includes("WeakMap"), "The hotfix must not retain custom per-window reveal ownership.");
assert(!entry.includes("requestAnimationFrame"), "A hidden Electron window must not wait on renderer animation frames before show.");
assert(!entry.includes("executeJavaScript"), "First reveal must not depend on renderer script execution while the window is hidden.");
assert(!entry.includes("setInterval("), "First-paint reveal must not poll.");
assert(!entry.includes("setTimeout("), "First-paint reveal must not use fake timing delays.");

console.log("core Electron first-paint bridge passed");
