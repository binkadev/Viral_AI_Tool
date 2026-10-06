"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const layoutJs = fs.readFileSync(path.join(root, "renderer", "core-layout.js"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "renderer", "core-layout.css"), "utf8");
const previewCss = fs.readFileSync(path.join(root, "renderer", "premium-preview.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const required of [
  "core-left-collapsed",
  "core-right-collapsed",
  "core-transcript-dock",
  "localStorage",
  "dockTranscript",
  "ensureRightToggle"
]) {
  assert(layoutJs.includes(required), "Core layout JS missing: " + required);
}

for (const required of [
  "html.core-left-collapsed",
  ".core-editor-layout.core-right-collapsed",
  ".core-transcript-dock",
  "grid-column:1 / -1"
]) {
  assert(layoutCss.includes(required), "Core layout CSS missing: " + required);
}

for (const required of [
  ".preview.core-player-host",
  ".preview-video",
  "object-fit:contain!important",
  ".core-player-timeline",
  ".core-player-controls",
  "cubic-bezier(.22, 1, .36, 1)",
  "prefers-reduced-motion"
]) {
  assert(previewCss.includes(required), "Premium preview CSS missing: " + required);
}

assert(!previewCss.includes("object-fit:cover"), "Premium preview must never crop media with object-fit: cover.");
assert(index.includes('href="core-layout.css"'));
assert(index.includes('href="premium-preview.css"'));
assert(index.includes('src="core-layout.js"'));
console.log("Core editor layout tests passed.");
