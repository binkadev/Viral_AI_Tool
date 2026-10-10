"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-automation-workspace.js");
const css = read("renderer/core-automation-workspace.css");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

assert.doesNotThrow(() => new Function(js), "Automation workspace JavaScript must parse.");

for (const required of [
  "function initialStage()",
  "function stageAvailable(stage)",
  "function setStage(stage",
  "function ensureStepContext",
  "function decorateStages",
  "function applyPanelVisibility",
  "workspace-active",
  "workspace-completed",
  "workspace-locked",
  "data-automation-workspace-go",
  "aria-current",
  "ViralAutomationScenesUi?.refresh",
  "delete document.documentElement.dataset.automationWorkspace",
  "c.locked",
  "c.complete",
  "c.current",
  "ViralAutomationWorkspace"
]) {
  assert(js.includes(required), "Guided Automation workspace missing: " + required);
}

assert(!js.includes("setInterval("), "Workspace must remain event-driven.");
assert(!js.includes("fetch("), "Workspace must not introduce provider/network coupling.");
assert(js.includes('new MutationObserver(queueScan).observe(page, { childList: true, subtree: true })'));

for (const required of [
  '.automation-workspace-v2',
  '.automation-step-context',
  '.workspace-active',
  '.workspace-completed',
  '.workspace-locked',
  '>.automation-grid[hidden]',
  '>.automation-scenes-host[hidden]',
  'grid-template-columns:repeat(5',
  'max-width:1240px',
  'html[data-automation-workspace="guided"] #page>.core-editor-activity',
  'html[data-automation-workspace="guided"] #page>.core-workflow-shell'
]) {
  assert(css.includes(required), "Guided Automation workspace CSS missing: " + required);
}

assert(!css.includes('max-width:1120px'), "Automation workspace must not keep the narrow prototype canvas.");
assert(index.includes('href="core-automation-workspace.css"'));
assert(index.includes('src="core-automation-workspace.js"'));
assert(index.indexOf('src="core-automation-scenes-ui.js"') < index.indexOf('src="core-automation-workspace.js"'), "guided workspace must enhance the Scene Planner after it mounts");

assert(pkg.scripts["test:core-automation-workspace"], "package.json must expose guided Automation workspace regression.");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-workspace"), "commercial regression must gate guided Automation workspace.");

console.log("Guided Automation workspace stage navigation, editor-surface isolation, wide canvas and single-task workflow tests passed.");
