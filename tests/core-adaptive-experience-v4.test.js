"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const navigation = read("renderer/core-navigation-stability.js");
const workspace = read("renderer/core-automation-workspace.js");
const mpt = read("renderer/core-automation-mpt-ux.js");
const workflowMotion = read("renderer/core-workflow-motion.js");
const css = read("renderer/core-adaptive-experience-v4.css");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

for (const [name, source] of [
  ["navigation", navigation],
  ["workspace", workspace],
  ["mpt", mpt],
  ["workflow motion", workflowMotion]
]) assert.doesNotThrow(() => new Function(source), `${name} JavaScript must parse`);

for (const token of [
  "function navigateToPage(nextPage",
  "document.startViewTransition",
  "function syncPageEnhancers()",
  "ViralAutomationWorkspace?.syncNow",
  "ViralAutomationMptUx?.syncNow",
  "event.stopImmediatePropagation()",
  'root.dataset.routeTransition = "running"',
  "viral-ai:navigation-committed",
  "ViralNavigationStability"
]) assert(navigation.includes(token), "Navigation handoff missing: " + token);

for (const token of [
  "function ensureStructuralPlaceholders(creator)",
  "automation-engine-strip",
  "automation-mvp-placeholder",
  "syncNow: scan",
  "creator.dataset.activeStage",
  "creator.dataset.progressStage"
]) assert(workspace.includes(token), "Synchronous Automation hydration missing: " + token);

assert(mpt.includes("syncNow: enhance"), "Automation MPT layout must expose synchronous enhancement");

for (const token of [
  "function syncStageViewport(rail)",
  'rail.dataset.progress = next.toFixed(4)',
  'rail.dataset.live = stage.classList.contains("is-processing") ? "true" : "false"',
  "scrollIntoView",
  "viral-ai:navigation-committed",
  'window.addEventListener("resize"'
]) assert(workflowMotion.includes(token), "Workflow motion logic missing: " + token);

for (const token of [
  "view-transition-name:viral-route-page",
  "::view-transition-old(viral-route-page)",
  ".core-workflow-rail::after",
  "transition:transform 480ms",
  '.core-workflow-rail[data-live="true"]::after',
  "@media(max-width:1540px)",
  "@media(max-width:1380px)",
  "@media(max-width:1120px)",
  "@media(max-width:820px)",
  "@media(max-height:760px)",
  "--sidebar:82px",
  "overflow:auto!important",
  "scroll-snap-type:x proximity"
]) assert(css.includes(token), "Adaptive experience CSS missing: " + token);

const adaptiveLink = 'href="core-adaptive-experience-v4.css"';
const v3Link = 'href="core-automation-experience-v3.css"';
assert(index.includes(adaptiveLink), "Adaptive experience stylesheet must be loaded");
assert(index.indexOf(v3Link) < index.indexOf(adaptiveLink), "Adaptive experience must load after Automation V3");

assert(pkg.scripts["test:core-adaptive-experience-v4"], "package.json must expose adaptive experience regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-adaptive-experience-v4"), "commercial suite must gate adaptive experience v4");

console.log("Route flicker handoff, workflow progress motion, Automation synchronous hydration and compact-window fit tests passed.");
