const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const loader = read("renderer/core-editor-output-state.js");
const js = read("renderer/core-editor-output-state-v2.js");
const css = read("renderer/core-editor-output-state.css");
const index = read("renderer/index.html");
const preload = read("preload.js");

assert.doesNotThrow(() => new Function(loader), "Output-state loader must parse.");
assert.doesNotThrow(() => new Function(js), "Output-state v2 must parse.");
assert(loader.includes('core-editor-output-state-v2.js'), "Legacy output-state entry must load v2 only.");

for (const required of [
  'state: "idle"',
  '"checking"',
  '"ready"',
  '"missing"',
  '"unverified"',
  "Rendered video is ready",
  "Video render đã sẵn sàng",
  "Chưa xác minh được file render",
  "Kiểm tra lại",
  "Render lại",
  "window.desktopAPI?.fileStatus",
  "window.desktopAPI.showFile",
  "onRenderProgress",
  "beforeunload",
  "data-output-show",
  "core-output-state-card"
]) {
  assert(js.includes(required), "Output state v2 missing: " + required);
}

assert(preload.includes("onRenderProgress"), "Desktop bridge must expose render progress events.");
assert(!js.includes("setInterval("), "Output verification must remain event-driven.");
assert(!js.includes("outputExists = null"), "V2 must not overload null as both unchecked and verification failure.");

for (const required of [
  ".core-output-state-card",
  '.core-output-state-card[data-output-state="checking"]',
  '.core-output-state-card[data-output-state="missing"]',
  ".core-output-state-action",
  ".core-output-state-hint"
]) {
  assert(css.includes(required), "Output state CSS missing: " + required);
}

assert(index.includes('href="core-editor-output-state.css"'), "Output state CSS must be loaded.");
assert(index.includes('src="core-editor-output-state.js"'), "Compatibility output-state entry must stay loaded.");

console.log("core-editor-output-state v2 tests passed");
