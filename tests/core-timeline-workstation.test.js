"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-timeline-workstation.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bottomJs = fs.readFileSync(path.join(root, "renderer", "core-editor-bottom-dock.js"), "utf8");
const selectionJs = fs.readFileSync(path.join(root, "renderer", "core-timeline-selection.js"), "utf8");

assert.doesNotThrow(() => new Function(selectionJs), "Timeline selection JavaScript must parse.");

for (const required of [
  ".core-editor-bottom-dock",
  "animation:none!important",
  ".core-timeline-workspace",
  ".core-track-lane",
  ".core-track-video",
  ".core-track-audio",
  ".core-track-subtitle",
  ".core-bottom-segment.is-active",
  ".core-source-clip.is-selected",
  ".core-bottom-segment.is-selected",
  ".core-bottom-playhead",
  "font-variant-numeric:tabular-nums",
  ":focus-visible",
  "transform:none!important",
  "backdrop-filter:none!important",
  "prefers-reduced-motion",
  'html[data-motion="reduced"].core-editor-premium'
]) {
  assert(css.includes(required), "Workstation timeline CSS missing: " + required);
}
assert(!css.includes("@keyframes"), "Final timeline layer must not add decorative timeline animations.");
assert(!css.includes("filter:blur"), "Timeline dock must not depend on blur animation effects.");
assert(css.includes('font-family:"Segoe UI Variable Text","Segoe UI Variable","Segoe UI","Noto Sans",Arial,sans-serif!important'), "Timeline time readouts must use the product Windows font stack.");

for (const required of [
  "video.currentTime",
  "data-bottom-playhead",
  "data-bottom-zoom",
  "data-bottom-resize",
  "localStorage"
]) {
  assert(bottomJs.includes(required), "Timeline must preserve real editor behavior: " + required);
}

for (const required of [
  "selectedKey",
  "currentSource",
  "sourceKey()",
  "itemKey(node)",
  'return "video"',
  'return "audio"',
  '"subtitle:"',
  'classList.toggle("is-selected", active)',
  'setAttribute("aria-selected", active ? "true" : "false")',
  "MutationObserver",
  'root.addEventListener("click", onClick)',
  "requestAnimationFrame(restoreSelection)"
]) {
  assert(selectionJs.includes(required), "Timeline selection behavior missing: " + required);
}
assert(!selectionJs.includes("setInterval("), "Timeline selection must remain event/DOM driven without polling.");
assert(!selectionJs.includes("setTimeout("), "Timeline selection must not use artificial timing delays.");

assert(index.includes('href="core-timeline-workstation.css"'), "Final timeline stylesheet must be loaded.");
assert(index.includes('src="core-timeline-selection.js"'), "Timeline selection module must be loaded.");
assert(
  index.indexOf('href="core-timeline-workstation.css"') > index.indexOf('href="core-player-workstation.css"'),
  "Timeline presentation must load after the final player geometry layer."
);
assert(
  index.indexOf('src="core-timeline-selection.js"') > index.indexOf('src="core-editor-bottom-dock.js"'),
  "Timeline selection must augment the real bottom dock after it is installed."
);

console.log("Workstation timeline hierarchy, selection and stability tests passed.");
