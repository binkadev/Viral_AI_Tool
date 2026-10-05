"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const layoutJs = fs.readFileSync(path.join(root, "renderer", "core-layout.js"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "renderer", "core-layout.css"), "utf8");
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

assert(index.includes('href="core-layout.css"'));
assert(index.includes('src="core-layout.js"'));
console.log("Core editor layout tests passed.");
