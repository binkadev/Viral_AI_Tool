const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-output-state.js");
const css = read("renderer/core-editor-output-state.css");
const index = read("renderer/index.html");

assert.doesNotThrow(() => new Function(js), "Output state JS must parse.");

for (const required of [
  "Rendered video is ready",
  "Video render đã sẵn sàng",
  "flow?.renderOutput",
  "output?.outputPath",
  "window.desktopAPI?.showFile",
  "data-output-show",
  "core-output-state-card"
]) {
  assert(js.includes(required), "Output state JS missing: " + required);
}

for (const required of [
  ".core-output-state-card",
  ".core-output-state-action",
  ".core-output-state-hint",
  "rgba(51,194,127"
]) {
  assert(css.includes(required), "Output state CSS missing: " + required);
}

assert(index.includes('href="core-editor-output-state.css"'), "Output state CSS must be loaded.");
assert(index.includes('src="core-editor-output-state.js"'), "Output state JS must be loaded.");

console.log("core-editor-output-state tests passed");
