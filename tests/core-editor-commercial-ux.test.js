const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-commercial-ux.js");
const css = read("renderer/core-editor-commercial-ux.css");
const modeJs = read("renderer/core-editor-processing-mode.js");
const modeCss = read("renderer/core-editor-processing-mode.css");
const assets = read("renderer/core-editor-assets.js");
const index = read("renderer/index.html");

assert.doesNotThrow(() => new Function(js), "Commercial UX JS must parse.");
assert.doesNotThrow(() => new Function(modeJs), "Processing mode JS must parse.");

for (const required of [
  "sourceMissingTitle",
  "preview-unavailable",
  "commercial-preview-retry",
  "core-commercial-connection-badge",
  "data-commercial-media-action",
  "typeof addFiles === \"function\"",
  "dataset.fileState",
  "classifyToast",
  "syncWorkflowActions",
  'setAttribute("data-commercial-stage-state"',
  "commercialActionState",
  "core-commercial-stage-dot",
  'setAttribute("aria-busy"',
  "window.I18N?.t",
  'catalog("common.processing"',
  'catalog("translation.notReady"',
  "ViralCoreWorkflowModel?.derive",
  "workflowSnapshot()?.jobs?.render",
  'if (!(button instanceof HTMLButtonElement)) return "blocked"'
]) {
  assert(js.includes(required), "Commercial UX JS missing: " + required);
}

for (const required of [
  ".core-commercial-media-state",
  ".core-commercial-media-card",
  ".core-commercial-connection-badge",
  '[data-commercial-connection-state="ready"]',
  '.toast[data-tone="error"]',
  '.core-editor-assets-panel.is-collapsed',
  ".core-commercial-stage-dot",
  '[data-commercial-stage-state="processing"]',
  '[data-commercial-action-state="processing"]',
  "coreCommercialPaneIn",
  "coreCommercialSpin",
  "coreCommercialPulse",
  "prefers-reduced-motion"
]) {
  assert(css.includes(required), "Commercial UX CSS missing: " + required);
}

for (const required of [
  "Processing mode",
  "Chế độ xử lý",
  "current?.speech?.mode",
  "current?.translation?.mode",
  "current?.voice?.mode",
  "core-commercial-mode-strip"
]) {
  assert(modeJs.includes(required), "Processing mode JS missing: " + required);
}

for (const required of [
  ".core-commercial-mode-strip",
  '[data-mode="cloud"]',
  '[data-mode="local"]',
  "grid-template-columns:repeat(3,minmax(0,1fr))"
]) {
  assert(modeCss.includes(required), "Processing mode CSS missing: " + required);
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

for (const required of [
  'href="core-editor-commercial-ux.css"',
  'src="core-editor-commercial-ux.js"',
  'href="core-editor-processing-mode.css"',
  'src="core-editor-processing-mode.js"'
]) {
  assert(index.includes(required), "Editor integration missing: " + required);
}

console.log("core-editor-commercial-ux tests passed");
