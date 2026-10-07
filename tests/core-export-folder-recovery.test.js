"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-export-folder-recovery.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Export folder recovery must parse.");
for (const required of [
  "legacy = handleExportBlock",
  '"OUTPUT_UNAVAILABLE"',
  '"OUTPUT_REQUIRED"',
  "return legacy(response, source)",
  "selectOutputFolder",
  "state.output = folder",
  "outputFolderChoose",
  "outputFolderCancel",
  "export.folderTitle",
  "export.folderBody"
]) {
  assert(js.includes(required), "Export folder recovery missing: " + required);
}
assert(!js.includes("setInterval("), "Export folder recovery must stay action-driven.");
assert(bootstrap.includes('core-export-folder-recovery.js'), "Bootstrap must load export folder recovery.");

console.log("core export folder recovery tests passed");
