"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const runtime = read("renderer/core-automation-motion.js");
const css = read("renderer/core-automation-motion.css");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "automation-motion-enter",
  "automation-motion-context",
  "automation-motion-surface",
  "automation-motion-active",
  "automation-motion-artifact",
  "getActiveStage",
  "outputSignature",
  "resolvedAssets",
  "viral-ai:core-state-changed",
  "viral-ai:automation-page-rendered",
  "requestAnimationFrame(scan)",
  "MutationObserver(queue)"
]) assert(runtime.includes(required), "Automation motion runtime missing: " + required);

assert(!runtime.includes("setInterval("), "Automation motion must not poll");
assert(!runtime.includes("setTimeout("), "Automation motion must not add artificial delays");
assert(runtime.includes('dataset.motion === "reduced"'), "Automation motion must honor the in-app reduced motion setting");
assert(runtime.includes("prefers-reduced-motion: reduce"), "Automation motion must honor OS reduced motion");

for (const required of [
  "@keyframes automationMotionEnter",
  "@keyframes automationMotionContext",
  "@keyframes automationMotionSurface",
  "@keyframes automationMotionActive",
  "@keyframes automationMotionRing",
  "@keyframes automationMotionArtifact",
  'html[data-motion="reduced"]',
  "@media(prefers-reduced-motion:reduce)"
]) assert(css.includes(required), "Automation motion CSS missing: " + required);

assert(!/animation[^;]*infinite/i.test(css), "Automation motion must stay state-driven and non-looping");
assert(index.includes('href="core-automation-motion.css"'), "Automation motion stylesheet must be loaded");
assert(index.includes('src="core-automation-motion.js"'), "Automation motion runtime must be loaded");
assert(index.indexOf('href="core-automation-workspace.css"') < index.indexOf('href="core-automation-motion.css"'), "Automation motion CSS must layer after the workspace CSS");
assert(index.indexOf('src="core-automation-workspace.js"') < index.indexOf('src="core-automation-motion.js"'), "Automation motion runtime must load after workspace state ownership");
assert(pkg.scripts["test:core-automation-motion"], "package.json must expose Automation motion regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-motion"), "commercial regression must gate Automation motion");

console.log("Automation commercial motion, stage transition choreography, artifact completion feedback and reduced-motion policy tests passed.");
