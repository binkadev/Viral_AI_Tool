"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const policy = fs.readFileSync(path.join(root, "renderer", "core-motion-policy.css"), "utf8");
const hud = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.js"), "utf8");
const entry = fs.readFileSync(path.join(root, "renderer", "core-commercial-entry.js"), "utf8");
const entryCss = fs.readFileSync(path.join(root, "renderer", "core-commercial-entry.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(hud), "Premium HUD JavaScript must parse.");
assert.doesNotThrow(() => new Function(entry), "Commercial entry choreography JavaScript must parse.");

for (const token of [
  'root.dataset.motion !== "expressive"',
  "interactiveMotion()",
  "clearInteractiveState()",
  "syncPointerTracking()",
  "let pointerTracking = false",
  'document.addEventListener("pointermove", onPointerMove',
  'document.removeEventListener("pointermove", onPointerMove)',
  'attributeFilter: ["data-motion"]'
]) {
  assert(hud.includes(token), "HUD motion guard missing: " + token);
}

for (const token of [
  'html[data-motion="balanced"] .premium-hud-scan',
  'html[data-motion="balanced"] .premium-hud-orbit',
  'html[data-motion="balanced"] .premium-hud-trace',
  'html[data-motion="balanced"] .hud-reactive-light',
  'html[data-motion="balanced"] .is-hud-magnet',
  "animation:none!important"
]) {
  assert(policy.includes(token), "Balanced motion policy missing: " + token);
}

for (const token of [
  "function activeSourceKey()",
  "function reducedMotion()",
  "function detachSettleListener()",
  "function armEditorCleanup(key, token)",
  "new MutationObserver(queue)",
  "{ childList: true, subtree: true }",
  'root.dataset.creatorEntry = reduced ? "ready" : "pending"',
  'root.dataset.editorEntry = reduced ? "ready" : "pending"',
  'root.dataset.creatorEntry = "ready"',
  'root.dataset.editorEntry = "ready"',
  'event.propertyName !== "translate"',
  "delete root.dataset.editorEntry",
  "requestAnimationFrame(() => {",
  "viral-ai:core-state-changed"
]) {
  assert(entry.includes(token), "Commercial entry choreography missing: " + token);
}

for (const token of [
  'html[data-creator-entry="pending"] .creator-home-hero',
  'html[data-creator-entry="pending"] .creator-start-grid',
  'html[data-editor-entry] #page .core-editor-assets-panel',
  'html[data-editor-entry="pending"] #page .core-editor-assets-panel',
  'html[data-editor-entry="pending"] #page .core-editor-focus-section',
  'html[data-editor-entry="pending"] #page .core-editor-inspector',
  'html[data-editor-entry="pending"] #page .core-editor-bottom-dock',
  "prefers-reduced-motion:reduce",
  'html[data-motion="reduced"]'
]) {
  assert(entryCss.includes(token), "Commercial entry style missing: " + token);
}

assert(!entry.includes("setInterval("), "Commercial entry choreography must not poll.");
assert(!entry.includes("setTimeout("), "Commercial entry choreography must not fake loading time.");
assert(!entryCss.includes("@keyframes"), "Commercial entry choreography must remain non-looping and state-driven.");
assert(!entryCss.includes("position:fixed"), "Commercial entry choreography must not reintroduce a full-screen preparing layer.");
assert(!entryCss.includes("\n#page .core-editor-assets-panel,#page .core-editor-focus-section"), "Entry-only transitions must not permanently override editor panel transitions.");

assert(index.includes('data-motion="balanced"'), "Balanced must be the static first-paint motion mode.");
assert(index.includes('saved.motion = "balanced"'), "New users must initialize to balanced motion.");
assert(index.includes('href="core-commercial-entry.css"'), "Commercial entry stylesheet must be loaded.");
assert(index.includes('src="core-commercial-entry.js"'), "Commercial entry choreography must be loaded.");
assert(index.includes('href="core-motion-policy.css"'), "Motion policy stylesheet must be loaded.");
assert(index.indexOf('href="core-commercial-entry.css"') < index.indexOf('href="core-motion-policy.css"'), "Reduced/balanced motion policy must retain final authority over entry polish.");
assert(index.indexOf('src="core-creator-home.js"') < index.indexOf('src="core-commercial-entry.js"'), "Entry choreography must observe surfaces only after Creator Home is installed.");
assert(index.indexOf('src="core-commercial-entry.js"') < index.indexOf('src="core-premium-hud.js"'), "Entry choreography must settle before optional HUD interaction polish.");
assert(index.indexOf('href="core-motion-policy.css"') > index.indexOf('href="core-premium-hud.css"'), "Motion policy must load after HUD styling so balanced mode can disable ambient loops.");

console.log("Balanced production motion policy and commercial entry tests passed.");
