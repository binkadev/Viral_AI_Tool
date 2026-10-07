"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor-panels-workstation.css"), "utf8");
const inspector = fs.readFileSync(path.join(root, "renderer", "core-inspector-workflow.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(inspector), "Inspector workflow script must parse.");

for (const required of [
  'const KEY = "viral-ai-core-editor-inspector-tab"',
  "recommendedTab()",
  '!current?.speech?.result',
  '!current?.translation?.result',
  '!current?.voice?.result',
  'button.click()',
  'VALID.has(saved)',
  'workflowDefaulted'
]) {
  assert(inspector.includes(required), "Inspector workflow behavior missing: " + required);
}
assert(!inspector.includes("setInterval("), "Inspector workflow must be event/DOM driven.");

for (const required of [
  ".core-editor-assets-panel",
  ".core-editor-inspector",
  ".core-inspector-tab.is-active",
  ".core-asset-item:hover:not(:disabled)",
  "transform:none!important",
  "backdrop-filter:none!important",
  "animation:none!important",
  "prefers-reduced-motion"
]) {
  assert(css.includes(required), "Final editor panel CSS missing: " + required);
}
assert(!css.includes("@keyframes"), "Final editor panels must not add decorative animation loops.");

assert(index.includes('href="core-editor-panels-workstation.css"'), "Final editor panels CSS must be loaded.");
assert(index.includes('src="core-inspector-workflow.js"'), "Inspector workflow helper must be loaded.");
assert(
  index.indexOf('href="core-editor-panels-workstation.css"') > index.indexOf('href="core-timeline-workstation.css"'),
  "Final panel material must load after player/timeline geometry."
);
assert(
  index.indexOf('src="core-inspector-workflow.js"') > index.indexOf('src="core-editor-workbench.js"'),
  "Inspector workflow helper must augment the workbench after it exists."
);

console.log("Editor panels and workflow-aware inspector tests passed.");
