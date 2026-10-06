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
assert(js.includes("side.prepend(inspector)"), "Inspector must remain the first right-panel child so its tab bar cannot be clipped by legacy cards");
assert(js.includes("moveStaticSideContent"), "Legacy summary/output cards must move into the Output pane instead of preceding the inspector");
assert(js.includes("scroller.scrollTop = 0"), "Switching inspector tabs must reset only the inspector content scroll");

for (const token of [
  ".core-editor-inspector",
  ".core-inspector-tabs",
  ".core-inspector-panes",
  ".core-inspector-pane[hidden]",
  ".core-inspector-static",
  ".core-editor-legacy-workflow",
  "grid-template-columns:minmax(0,1fr) clamp(360px,27vw,430px)",
  "grid-template-columns:minmax(0,1fr)!important",
  "white-space:nowrap",
  "overflow-wrap:anywhere",
  "overflow-anchor:none"
]) {
  assert(css.includes(token), `Missing workbench layout rule: ${token}`);
}

assert(css.includes(".core-inspector-panes{\n  min-width:0;\n  min-height:0;\n  flex:1 1 auto;\n  overflow:auto"), "Inspector content, not the whole right panel, must own scrolling so tabs remain visible");
assert(css.includes(".core-inspector-card .speech-controls"), "Speech controls must have inspector-specific compact layout");
assert(css.includes(".core-inspector-card .translation-controls"), "Translation controls must have inspector-specific compact layout");
assert(css.includes(".core-inspector-card .voice-top-controls"), "Voice controls must have inspector-specific compact layout");
assert(css.includes('[class*="connection-panel"]'), "Legacy connection panels must stack instead of squeezing their copy");
assert(css.includes("@media (max-width:1120px)"), "Workbench must drop below preview before inspector becomes too narrow");
assert(css.includes("prefers-reduced-motion"), "Workbench must respect reduced motion preferences");
assert(index.includes('href="core-editor-workbench.css"'), "Production renderer must load workbench CSS");
assert(index.includes('src="core-editor-workbench.js"'), "Production renderer must load workbench JS");

console.log("Core Editor workbench tests passed.");
