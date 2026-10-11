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
const stability = read("renderer/core-automation-stability-v5.css");
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
  "function sourceKey()",
  "function contiguousCompleted(stages)",
  "function workflowMode(stage, completed, total)",
  "function ensureFlow(rail)",
  "function syncFlowGeometry(rail, stages, stage, completed, mode)",
  "function syncStageViewport(rail, stage)",
  "function celebrateCompletion(rail, mode, completed)",
  "function resetForSource(rail, nextSourceKey)",
  'rail.dataset.mode = mode',
  'rail.dataset.live = mode === "processing" ? "true" : "false"',
  'rail.dataset.progress = completedProgress.toFixed(4)',
  "scrollIntoView",
  "viral-ai:navigation-committed",
  'window.addEventListener("resize"'
]) assert(workflowMotion.includes(token), "Workflow motion logic missing: " + token);

for (const token of [
  "container-name:viral-workpage",
  "view-transition-name:viral-route-page",
  "::view-transition-old(viral-route-page)",
  ".core-workflow-rail::after",
  ".core-workflow-flow",
  '.core-workflow-rail[data-mode="ready"] .core-workflow-flow',
  '.core-workflow-rail[data-mode="processing"] .core-workflow-flow',
  ".core-workflow-rail.is-completing::after",
  "@keyframes viralWorkflowReady",
  "@keyframes viralWorkflowProcessing",
  "@keyframes viralWorkflowComplete",
  "transition:transform 480ms",
  "@container viral-workpage (max-width:1180px)",
  "@container viral-workpage (max-width:960px)",
  "@container viral-workpage (max-width:720px)",
  "@media(max-width:1540px)",
  "@media(max-width:1380px)",
  "@media(max-width:1120px)",
  "@media(max-width:820px)",
  "@media(max-height:760px)",
  "--sidebar:82px",
  "overflow:auto!important",
  "scroll-snap-type:x proximity"
]) assert(css.includes(token), "Adaptive experience CSS missing: " + token);

for (const token of [
  ".automation-script-actions",
  "position:static!important",
  ".automation-script-card",
  "height:auto!important",
  "overflow:visible!important",
  "@media(max-width:1500px)",
  "@container viral-workpage (max-width:1320px)",
  "@container viral-workpage (max-width:980px)",
  "grid-template-columns:repeat(5,minmax(0,1fr))",
  "display:block!important",
  "overflow-y:auto!important"
]) assert(stability.includes(token), "Automation stability layer missing: " + token);

assert(css.includes("grid-template-columns:1fr!important"), "Narrow Automation workbenches must collapse to one column");
assert(css.includes("overflow:visible!important"), "Narrow workbenches must not trap vertical content");
assert(css.includes("touch-action:pan-x pan-y"), "Scrollable workflow rail must remain pointer/touch navigable");

const adaptiveLink = 'href="core-adaptive-experience-v4.css"';
const stabilityLink = 'href="core-automation-stability-v5.css"';
const v3Link = 'href="core-automation-experience-v3.css"';
assert(index.includes(adaptiveLink), "Adaptive experience stylesheet must be loaded");
assert(index.includes(stabilityLink), "Automation stability stylesheet must be loaded");
assert(index.indexOf(v3Link) < index.indexOf(adaptiveLink), "Adaptive experience must load after Automation V3");
assert(index.indexOf(adaptiveLink) < index.indexOf(stabilityLink), "Automation stability layer must load after adaptive experience");

assert(pkg.scripts["test:core-adaptive-experience-v4"], "package.json must expose adaptive experience regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-adaptive-experience-v4"), "commercial suite must gate adaptive experience v4");

console.log("Route handoff, stateful workflow motion and Automation compact-layout stability tests passed.");
