"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-navigation-stability.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Navigation/editor render stability module must parse.");
for (const token of [
  "function editorSignature()",
  'page !== "ai-video"',
  "core-editor-docked-page",
  "nextSignature === lastEditorSignature",
  'typeof applyChromeLocale === "function"',
  'typeof navRender === "function"',
  'viral-ai:editor-render-preserved',
  'reason: "structural-signature-unchanged"',
  "stableRender.__coreStableRender = true",
  "render = stableRender",
  'root.dataset.stableEditorRender = "enabled"',
  "segments: Array.isArray(result.segments) ? result.segments.length : 0",
  "fileState: output.fileState || \"\""
]) {
  assert(js.includes(token), "Stable editor render missing: " + token);
}
assert(!js.includes("setInterval("), "Stable editor rendering must not poll.");

console.log("Core Editor structural render stability tests passed");
