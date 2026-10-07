"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const health = fs.readFileSync(path.join(root, "renderer", "core-job-file-health.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "renderer", "core-dashboard-real-data.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");

assert.doesNotThrow(() => new Function(health), "Job file health JavaScript must parse.");

for (const token of [
  "window.desktopAPI.fileStatus(path)",
  "jobs.filter(shouldCheck).slice(0, 50)",
  'normalizedStatus(job.status) === "completed"',
  'job.fileState = next',
  'reason: "job-file-health"',
  'window.addEventListener("focus", queueCheck)',
  'viral-ai:job-file-health-request',
  "function recoverableOutput(job)",
  'job?.fileState === "missing" || job?.fileState === "trashed"',
  'button.dataset.jobAction = "retry-export"',
  'button.dataset.jobId = id',
  '"Render again" : "Render lại"',
  "syncRecoveryActions",
  "queueRecoveryActions"
]) {
  assert(health.includes(token), "Job file health behavior missing: " + token);
}

assert(!health.includes("setInterval("), "File health must run from startup/focus/events, not polling.");
assert(preload.includes("fileStatus"), "Desktop bridge must expose file status checks.");
assert(dashboard.includes("fileAvailable(job)"), "Dashboard must account for missing render files.");
assert(dashboard.includes('normalizeStatus(job.status) === "completed" && fileAvailable(job)'), "Completed render KPI must exclude missing/trashed output files.");
assert(index.includes('src="core-job-file-health.js"'), "Job file health module must be loaded.");
assert(index.indexOf('src="core-job-file-health.js"') < index.indexOf('src="core-dashboard-real-data.js"'), "File health must initialize before the real dashboard layer.");

console.log("Project/render file health and recovery-action tests passed.");
