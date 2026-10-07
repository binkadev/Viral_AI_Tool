"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const policy = fs.readFileSync(path.join(root, "renderer", "core-motion-policy.css"), "utf8");
const hud = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(hud), "Premium HUD JavaScript must parse.");

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

assert(index.includes('data-motion="balanced"'), "Balanced must be the static first-paint motion mode.");
assert(index.includes('saved.motion = "balanced"'), "New users must initialize to balanced motion.");
assert(index.includes('href="core-motion-policy.css"'), "Motion policy stylesheet must be loaded.");
assert(index.indexOf('href="core-motion-policy.css"') > index.indexOf('href="core-premium-hud.css"'), "Motion policy must load after HUD styling so balanced mode can disable ambient loops.");

console.log("Balanced production motion policy tests passed.");
