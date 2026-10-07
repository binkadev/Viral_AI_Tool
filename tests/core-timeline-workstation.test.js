"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-timeline-workstation.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bottomJs = fs.readFileSync(path.join(root, "renderer", "core-editor-bottom-dock.js"), "utf8");

for (const required of [
  ".core-editor-bottom-dock",
  "animation:none!important",
  ".core-timeline-workspace",
  ".core-track-lane",
  ".core-bottom-segment.is-active",
  ".core-bottom-playhead",
  "transform:none!important",
  "backdrop-filter:none!important",
  "prefers-reduced-motion"
]) {
  assert(css.includes(required), "Workstation timeline CSS missing: " + required);
}
assert(!css.includes("@keyframes"), "Final timeline layer must not add decorative timeline animations.");
assert(!css.includes("filter:blur"), "Timeline dock must not depend on blur animation effects.");

for (const required of [
  "video.currentTime",
  "data-bottom-playhead",
  "data-bottom-zoom",
  "data-bottom-resize",
  "localStorage"
]) {
  assert(bottomJs.includes(required), "Timeline must preserve real editor behavior: " + required);
}

assert(index.includes('href="core-timeline-workstation.css"'), "Final timeline stylesheet must be loaded.");
assert(
  index.indexOf('href="core-timeline-workstation.css"') > index.indexOf('href="core-player-workstation.css"'),
  "Timeline presentation must load after the final player geometry layer."
);

console.log("Workstation timeline stability tests passed.");
