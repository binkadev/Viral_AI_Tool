"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-source-recovery.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-source-recovery.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const commercial = fs.readFileSync(path.join(root, "renderer", "core-editor-commercial-ux.js"), "utf8");
const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Source recovery JavaScript must parse.");
assert(app.includes("async function relinkJob(job)"), "Production relinkJob must remain the source replacement owner.");
assert(app.includes("selectReplacementVideo"), "Production relink must use the replacement-video picker.");

for (const required of [
  "typeof relinkJob !== \"function\"",
  "await relinkJob(source)",
  'source.fileState === "missing"',
  'source.fileState === "trashed"',
  'source.mediaState === "missing"',
  "data-commercial-media-action",
  "data-source-asset",
  "stopImmediatePropagation",
  "source-relinked-from-editor",
  "core-source-recovery-hint",
  "dataSourceRecoveryBusy"
]) {
  if (required === "dataSourceRecoveryBusy") {
    assert(js.includes("sourceRecoveryBusy"), "Recovery must expose an explicit busy state.");
  } else {
    assert(js.includes(required), "Source recovery behavior missing: " + required);
  }
}

assert(!js.includes("addFiles("), "Missing-source recovery must relink the current source instead of adding another project source.");
assert(commercial.includes('visualState === "preview-unavailable"'), "Preview-only failures must remain distinguishable from a missing source.");
assert(commercial.includes("retryPreview(host)"), "Preview-only failures must retain their retry path.");

for (const required of [
  '[data-source-recovery="true"]',
  ".core-commercial-media-action",
  ".core-asset-item.needs-source-recovery",
  ".core-source-recovery-hint",
  'html[data-source-recovery-busy="true"]'
]) {
  assert(css.includes(required), "Source recovery CSS missing: " + required);
}
assert(!css.includes("@keyframes"), "Source recovery UI must not introduce decorative animation loops.");

assert(index.includes('href="core-source-recovery.css"'), "Source recovery styles must be loaded.");
assert(index.includes('src="core-source-recovery.js"'), "Source recovery behavior must be loaded.");
assert(
  index.indexOf('src="core-source-recovery.js"') > index.indexOf('src="core-editor-commercial-ux.js"'),
  "Source recovery must refine the commercial media-state UI after it is installed."
);

console.log("Editor source recovery tests passed.");
