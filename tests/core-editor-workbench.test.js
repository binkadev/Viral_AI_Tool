"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-editor-workbench.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor-workbench.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const selector of ["#speechMode", "#translationMode", "#voiceMode", "#render"]) {
  assert(js.includes(selector), `Workbench must preserve and move existing ${selector} controls`);
}

assert(js.includes("appendChild(card)"), "Workbench must move existing card nodes rather than recreate their behavior");
assert(!js.includes("cloneNode("), "Workbench must not clone functional controls or their handlers");
assert(js.includes("core-editor-legacy-workflow"), "Legacy duplicate workflow must be hidden after the real render control is moved");
assert(js.includes("viral-ai-core-editor-inspector-tab"), "Selected inspector tab must persist between editor renders");
assert(js.includes("MutationObserver"), "Workbench must recover after legacy page rerenders");

for (const token of [
  ".core-editor-inspector",
  ".core-inspector-tabs",
  ".core-inspector-pane[hidden]",
  ".core-editor-legacy-workflow",
  "grid-template-columns:minmax(0,1fr) clamp(320px,25vw,390px)"
]) {
  assert(css.includes(token), `Missing workbench layout rule: ${token}`);
}

assert(css.includes("@media (max-width:980px)"), "Workbench must collapse to one column on constrained windows");
assert(css.includes("prefers-reduced-motion"), "Workbench must respect reduced motion preferences");
assert(index.includes('href="core-editor-workbench.css"'), "Production renderer must load workbench CSS");
assert(index.includes('src="core-editor-workbench.js"'), "Production renderer must load workbench JS");

console.log("Core Editor workbench tests passed.");
