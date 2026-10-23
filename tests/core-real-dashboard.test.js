"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const dashboardJs = fs.readFileSync(path.join(root, "renderer", "core-dashboard-real-data.js"), "utf8");
const dashboardCss = fs.readFileSync(path.join(root, "renderer", "core-dashboard-real-data.css"), "utf8");
const workflowCss = fs.readFileSync(path.join(root, "renderer", "core-workflow-workstation.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(dashboardJs), "Real dashboard JavaScript must parse.");

for (const token of [
  "pages.dashboard = dashboardPage",
  "sourceJobs()",
  "renderJobs()",
  "activeJobCount()",
  "remainingMinutes",
  "totalMinutes",
  "usedMinutes",
  "window.ViralCoreWorkflowModel?.derive",
  'data-core-placeholder="account-usage"',
  'data-core-placeholder="account-profile"',
  "viral-ai:core-state-changed"
]) {
  assert(dashboardJs.includes(token), "Real dashboard behavior missing: " + token);
}

assert(!dashboardJs.includes('"24"'), "Production dashboard must not ship the old fake daily-video count.");
assert(!dashboardJs.includes('"218"'), "Production dashboard must not ship the old fake completed-video count.");
assert(!dashboardJs.includes('"1,482"'), "Production dashboard must not ship the old fake AI-minute count.");
assert(!dashboardJs.includes('"2,480"'), "Production dashboard must not ship the old fake quota count.");
assert(!dashboardJs.includes("setInterval("), "Dashboard state must be event-driven, not polled.");

for (const token of [
  ".core-real-dashboard",
  ".core-real-stats",
  ".core-real-dashboard-grid",
  '[data-core-placeholder="account-usage"]'
]) {
  assert(dashboardCss.includes(token), "Real dashboard CSS missing: " + token);
}

for (const token of [
  "#page.core-page-enter::before",
  "content:none!important",
  ".core-stage-spinner",
  "animation:none!important",
  ".core-workflow-rail::after",
  "transition:none!important"
]) {
  assert(workflowCss.includes(token), "Stable workflow override missing: " + token);
}

assert(index.includes('href="core-dashboard-real-data.css"'));
assert(index.includes('href="core-workflow-workstation.css"'));
assert(index.includes('src="core-dashboard-real-data.js"'));
assert(index.indexOf('href="core-workflow-workstation.css"') > index.indexOf('href="core-premium-interactions.css"'), "Stable workflow layer must load after interaction styling.");

function sidebarHarness({ locale = "vi", jobs = [], activeId = null, projects = [], registryAvailable = true } = {}) {
  const workspace = { textContent: "", title: "" };
  const listeners = new Map();
  const frames = [];
  const registry = { activeId, projects };
  const window = {
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  if (registryAvailable) window.ViralCoreProjectPersistence = {
    activeProjectId: () => registry.activeId,
    listProjects: () => registry.projects
  };
  const state = { page: "ai-create", locale, jobs };
  const document = {
    readyState: "complete",
    documentElement: { dataset: {} },
    querySelector: selector => selector === ".workspace strong" ? workspace : null,
    getElementById: () => null
  };
  vm.runInNewContext(dashboardJs, {
    window, document, state, pages: {}, HTMLElement: class {},
    requestAnimationFrame(callback) { frames.push(callback); }
  });
  return {
    workspace, registry, state,
    stateChanged() {
      listeners.get("viral-ai:core-state-changed")();
      while (frames.length) frames.shift()();
    }
  };
}

function assertSidebar(harness, expected) {
  assert.strictEqual(harness.workspace.textContent, expected);
  assert.strictEqual(harness.workspace.title, expected);
}

// A: a valid source-less AI project is still the active workspace.
assertSidebar(sidebarHarness({ activeId: "ai-1", projects: [
  { projectId: "ai-1", projectName: "Dự án AI mới", projectKind: "ai", hasSource: false }
] }), "Dự án AI mới");

// B: registry names remain authoritative even with an imported source filename.
assertSidebar(sidebarHarness({ activeId: "imported-1", projects: [
  { projectId: "imported-1", projectName: "Named campaign", hasSource: true }
], jobs: [{ name: "source.mp4", sourcePath: "C:/video/source.mp4" }] }), "Named campaign");

// C: missing/unmatched registry entries preserve both legacy name/path fallbacks.
assertSidebar(sidebarHarness({ registryAvailable: false, jobs: [
  { name: "Legacy project", sourcePath: "C:/video/source.mp4" }
] }), "Legacy project");
assertSidebar(sidebarHarness({ activeId: "missing", projects: [
  { projectId: "other", projectName: "Inactive project" }
], jobs: [{ sourcePath: "C:\\video\\legacy.mp4" }] }), "legacy.mp4");

// D: only a truly empty workspace uses the localized empty label.
assertSidebar(sidebarHarness(), "Chưa có dự án");
assertSidebar(sidebarHarness({ locale: "en" }), "No project");

// E: project switching updates the label/title through the existing state event.
const switching = sidebarHarness({ activeId: "a", projects: [
  { projectId: "a", projectName: "Project A", hasSource: true },
  { projectId: "b", projectName: "Project B", hasSource: false }
], jobs: [{ name: "old-source.mp4", sourcePath: "C:/video/old-source.mp4" }] });
assertSidebar(switching, "Project A");
switching.registry.activeId = "b";
switching.state.jobs = [];
switching.stateChanged();
assertSidebar(switching, "Project B");

console.log("Sidebar identity regressions A–E passed: AI, imported, legacy, empty VI/EN, and event-driven switch.");
console.log("Real dashboard data and stable workflow tests passed.");
