"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const focusJs = fs.readFileSync(path.join(root, "renderer", "core-editor-focus.js"), "utf8");
const focusCss = fs.readFileSync(path.join(root, "renderer", "core-editor-focus.css"), "utf8");
const rebindJs = fs.readFileSync(path.join(root, "renderer", "core-player-rebind.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const required of [
  "core-editor-focus-section",
  "core-editor-focused-page",
  "core-editor-primary-grid",
  "voice-workflow-card",
  "coreDurationHint"
]) {
  assert(focusJs.includes(required), "Core editor focus JS missing: " + required);
}

for (const required of [
  ".core-editor-focus-section",
  ".core-editor-focus-section .editor-grid",
  "grid-template-columns:minmax(0,1fr)",
  "prefers-reduced-motion"
]) {
  assert(focusCss.includes(required), "Core editor focus CSS missing: " + required);
}

for (const required of [
  "effectiveDuration",
  "seekableDuration",
  "coreDurationResolved",
  "viral-ai:editor-preview-preserved",
  "core-player-rebind"
]) {
  assert(rebindJs.includes(required), "Core player rebind missing: " + required);
}

assert(index.includes('href="core-editor-focus.css"'), "Focus stylesheet must load in production renderer.");
assert(index.includes('src="core-player-rebind.js"'), "Player rebind bridge must load in production renderer.");
assert(index.includes('src="core-editor-focus.js"'), "Focus layout script must load in production renderer.");
assert(!focusCss.includes("object-fit:cover"), "Focus layout must never crop video with cover.");

console.log("Core Editor preview-first focus tests passed.");
