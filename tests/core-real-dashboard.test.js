"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

console.log("Real dashboard data and stable workflow tests passed.");
