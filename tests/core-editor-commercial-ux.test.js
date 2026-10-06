const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-commercial-ux.js");
const css = read("renderer/core-editor-commercial-ux.css");
const assets = read("renderer/core-editor-assets.js");
const index = read("renderer/index.html");

assert.doesNotThrow(() => new Function(js), "Commercial UX JS must parse.");

for (const required of [
  "sourceMissingTitle",
  "preview-unavailable",
  "commercial-preview-retry",
  "core-commercial-connection-badge",
  "data-commercial-media-action",
  "typeof addFiles === \"function\"",
  "dataset.fileState",
  "classifyToast"
]) {
  assert(js.includes(required), "Commercial UX JS missing: " + required);
}

for (const required of [
  ".core-commercial-media-state",
  ".core-commercial-media-card",
  ".core-commercial-connection-badge",
  '[data-commercial-connection-state="ready"]',
  '.toast[data-tone="error"]',
  '.core-editor-assets-panel.is-collapsed'
]) {
  assert(css.includes(required), "Commercial UX CSS missing: " + required);
}

for (const required of [
  "function currentSource()",
  "source?.meta?.duration",
  "source?.meta?.width",
  "source?.meta?.height",
  "if (!video && !source) return"
]) {
  assert(assets.includes(required), "Assets missing-state support missing: " + required);
}

assert(index.includes('href="core-editor-commercial-ux.css"'), "Commercial UX CSS must be loaded.");
assert(index.includes('src="core-editor-commercial-ux.js"'), "Commercial UX JS must be loaded.");

console.log("core-editor-commercial-ux tests passed");
