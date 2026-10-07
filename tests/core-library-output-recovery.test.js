"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-library-output-recovery.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Library output recovery must parse.");
for (const required of [
  "legacyMissingDialog",
  "job?.isRenderOutput",
  "return legacyMissingDialog(job)",
  "missingRerender",
  "export.retry",
  "export.retrySourceMissing",
  "startLocalizedRender",
  "startRealRender",
  "removeJobFromLibrary",
  "source.fileState !== \"missing\"",
  "source.fileState !== \"trashed\""
]) {
  assert(js.includes(required), "Library output recovery missing: " + required);
}
assert(!js.includes("setInterval("), "Library output recovery must remain event/action driven.");
assert(bootstrap.includes('core-library-output-recovery.js'), "Bootstrap must load library output recovery.");

console.log("core library output recovery tests passed");
