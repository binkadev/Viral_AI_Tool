"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-settings-production.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");
const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Production settings sanitizer must parse.");
for (const required of [
  "pages.settings",
  "legacy()",
  'class="setting-row"',
  "1080p",
  "4K",
  "__coreProductionSettings"
]) {
  assert(js.includes(required), "Production settings sanitizer missing: " + required);
}
assert(bootstrap.includes('core-settings-production.js'), "Bootstrap must load production settings sanitizer.");
assert(app.includes('id="settingsLocale"'), "Functional locale control must remain in legacy settings source.");
assert(app.includes('id="appearanceSelect"'), "Functional appearance control must remain.");
assert(app.includes('id="motionSelect"'), "Functional motion control must remain.");
assert(app.includes('id="scaleSelect"'), "Functional scale control must remain.");
assert(app.includes('id="chooseOutput"'), "Functional output-folder control must remain.");
assert(!js.includes("setInterval("), "Settings sanitizer must not poll the UI.");

console.log("core production settings tests passed");
