"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const shell = read("renderer/core-product-shell.js");
const shellCss = read("renderer/core-product-shell.css");
const index = read("renderer/index.html");
const capabilities = read("renderer/core-capabilities.css");
const shellStability = read("renderer/core-shell-stability.css");
const navigation = read("renderer/core-navigation-stability.js");
const hudJs = read("renderer/core-premium-hud.js");
const hudCss = read("renderer/core-premium-hud.css");
const motionPolicy = read("renderer/core-motion-policy.css");
const workstation = read("renderer/core-premium-workstation.css");
const brand = read("renderer/brand-mark.svg");

assert.doesNotThrow(() => new Function(navigation), "Navigation stability must parse.");
assert.doesNotThrow(() => new Function(hudJs), "Premium HUD module must parse.");

for (const required of [
  "LEGACY_DEMO_NAMES",
  "removeLegacyDemoJobs",
  "current.jobs.filter(job => !job?.isRenderOutput)",
  'const startupPage = hasSourceVideo() ? "ai-video" : "download"',
  '{ id: "download", icon: "⇩", label: "core-import" }',
  '{ id: "ai-video", icon: "◫", label: "core-editor" }',
  "pages.download = function coreImportPage()"
]) assert(shell.includes(required), "Core product shell missing: " + required);

for (const legacyName of ["Douyin_Product_042.mp4", "UGC_Beauty_118.mp4", "Review_Camera_090.mp4", "Short_Fashion_031.mp4"])
  assert(shell.includes(legacyName), "Legacy demo cleanup missing: " + legacyName);

assert(index.includes('data-theme="midnight"'), "Premium Dark must be first-paint theme.");
assert(index.includes('data-motion="balanced"'), "Balanced motion must be first-paint default.");
assert(index.includes('root.dataset.motion = motions.has(saved.motion) ? saved.motion : "balanced"'));
assert(index.indexOf('localStorage.getItem(stateKey)') < index.indexOf('href="styles.css"'), "Saved theme must resolve before CSS first paint.");
assert(!index.includes("core-startup-experience"), "Removed startup animation must stay removed.");
assert(index.includes('href="core-shell-stability.css"'));
assert(index.includes('src="core-navigation-stability.js"'));
assert(index.includes('href="core-motion-policy.css"'));
assert(index.includes('href="core-premium-workstation.css"'));
assert(index.includes('src="brand-mark.svg"'));
assert(brand.includes('linearGradient id="bg"'));
assert(shellCss.includes(".core-import-primary"));
assert(!capabilities.includes('[data-page="ai-video"]'), "Production Core Editor must remain visible.");

for (const required of [
  "Direct-paint workstation shell",
  "#page.core-page-enter::before",
  "content:none!important",
  "min-height:calc(100dvh - 124px)",
  "overflow-anchor:none",
  "scrollbar-gutter:stable",
  'html[data-theme="midnight"] #page',
  'html[data-theme="midnight"] .main'
]) assert(shellStability.includes(required), "Shell stability missing: " + required);
assert(!shellStability.includes("@keyframes"), "Shell stability must not animate page entry.");

for (const required of [
  "legacyNavRender",
  "structureMatches",
  'button.setAttribute("aria-current", "page")',
  "stableNavigationWired",
  "event.stopImmediatePropagation()",
  'root.dataset.stableNavigation = "enabled"',
  "function editorSignature()",
  "stableRender.__coreStableRender = true",
  'root.dataset.stableEditorRender = "enabled"'
]) assert(navigation.includes(required), "Stable navigation/editor render missing: " + required);

assert(hudCss.includes(".premium-hud-layer"), "HUD material layer may exist for Expressive mode.");
assert(hudJs.includes("premiumHudLayer"), "HUD module must remain isolated from workflow logic.");
assert(!hudJs.includes("viral-ai:startup-complete"), "HUD must not depend on removed startup animation.");

for (const required of [
  'html[data-motion="balanced"]',
  ".core-editor-assets-panel::after",
  ".core-editor-inspector::after",
  ".preview.core-player-host::after",
  ".core-timeline-workspace::after",
  "animation:none!important",
  ".hud-reactive-light{display:none!important}",
  ".is-hud-magnet{transform:none!important"
]) assert(motionPolicy.includes(required), "Balanced production motion policy missing: " + required);

for (const required of [
  'html[data-theme="midnight"] .topbar',
  'html[data-theme="midnight"] .sidebar',
  'html.core-editor-premium .preview.core-player-host',
  "text-rendering:optimizeLegibility",
  "text-shadow:none!important"
]) assert(workstation.includes(required), "Workstation hierarchy missing: " + required);
assert(!workstation.includes("@keyframes"), "Workstation hierarchy must not add ambient loops.");

console.log("Core product shell production contract passed");
