"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "main-entry.js"), "utf8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");

assert.strictEqual(pkg.main, "main-entry.js", "Electron must boot through the paint-safe entry guard.");
assert(Array.isArray(pkg.build?.files) && pkg.build.files.includes("main-entry.js"), "Packaged builds must include the paint-safe entry guard.");
assert(main.includes("show: false"), "The native window must remain hidden during renderer startup.");
assert(entry.includes("BrowserWindow.prototype.show"), "The entry guard must own the first native show call.");
assert(entry.includes("isLoadingMainFrame"), "The entry guard must defer reveal while the main frame is still loading.");
assert(entry.includes("did-finish-load"), "The entry guard must reveal after renderer load completion when needed.");
assert(entry.includes("setImmediate(() =>"), "The final native reveal must occur on the next main-process tick.");
assert(entry.includes("nativeShow.call(win)"), "The window must reveal through Electron's native show implementation.");
assert(entry.includes("require('./main.js')"), "The guard must delegate all application behavior to the existing main process.");
assert(!entry.includes("requestAnimationFrame"), "A hidden Electron window must not wait on renderer animation frames before show.");
assert(!entry.includes("executeJavaScript"), "First reveal must not depend on renderer script execution while the window is hidden.");
assert(!entry.includes("setInterval("), "First-paint reveal must not poll.");
assert(!entry.includes("setTimeout("), "First-paint reveal must not use fake timing delays.");

console.log("core Electron first-paint guard passed");
