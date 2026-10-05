"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "renderer", "core-product-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-product-shell.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const capabilities = fs.readFileSync(path.join(root, "renderer", "core-capabilities.css"), "utf8");

for (const required of [
  "LEGACY_DEMO_NAMES",
  "removeLegacyDemoJobs",
  "current.jobs.filter(job => !job?.isRenderOutput)",
  'data-core-capability="coming-soon"',
  'current.page = hasSourceVideo() ? "ai-video" : "download"',
  '{ id: "download", icon: "⇩", label: "core-import" }',
  '{ id: "ai-video", icon: "◫", label: "core-editor" }',
  'pages.download = function coreImportPage()'
]) {
  assert(shell.includes(required), "Core product shell is missing behavior: " + required);
}

for (const legacyName of [
  "Douyin_Product_042.mp4",
  "UGC_Beauty_118.mp4",
  "Review_Camera_090.mp4",
  "Short_Fashion_031.mp4"
]) {
  assert(shell.includes(legacyName), "Legacy demo cleanup is missing: " + legacyName);
}

assert(index.includes('href="core-product-shell.css"'), "Core product shell CSS must be loaded.");
assert(index.includes('src="core-product-shell.js"'), "Core product shell JS must be loaded.");
assert(css.includes(".core-import-primary"), "Core import UI styles must be present.");
assert(!capabilities.includes('[data-page="ai-video"]'), "Core Editor must not be hidden by capability CSS.");

console.log("Core product shell tests passed.");