const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-activity.js");
const css = read("renderer/core-editor-activity.css");
const index = read("renderer/index.html");
const preload = read("preload.js");

assert.doesNotThrow(() => new Function(js), "Activity JS must parse.");

for (const required of [
  "Current activity",
  "Hoạt động hiện tại",
  "progressFor(job)",
  "failureCopy(job, meta, labels)",
  "data-activity-progress",
  "data-activity-stop",
  "data-activity-retry",
  "jobModel?.describe",
  "latestRenderJob(current)",
  "renderCanStop(active)",
  'typeof cancelExportJob === "function"',
  "await cancelExportJob(active.job)",
  "wireProgressSignals()",
  "progressUnsubscribers",
  '"onSpeechProgress"',
  '"onTranslationProgress"',
  '"onVoiceProgress"',
  '"onRenderProgress"',
  "beforeunload"
]) {
  assert(js.includes(required), "Activity JS missing: " + required);
}

assert(!js.includes("setInterval("), "Editor activity must update from real progress signals instead of polling every few hundred milliseconds.");
for (const progressApi of ["onSpeechProgress", "onTranslationProgress", "onVoiceProgress", "onRenderProgress"]) {
  assert(preload.includes(progressApi), "Desktop bridge must expose activity signal: " + progressApi);
}

for (const required of [
  ".core-editor-activity",
  '.core-editor-activity[data-state="failed"]',
  ".core-editor-activity-progress.is-indeterminate",
  ".core-editor-activity-button.is-retry",
  "@media (prefers-reduced-motion:reduce)"
]) {
  assert(css.includes(required), "Activity CSS missing: " + required);
}

assert(index.includes('href="core-editor-activity.css"'), "Activity CSS must be loaded.");
assert(index.includes('src="core-editor-activity.js"'), "Activity JS must be loaded.");

console.log("core-editor-activity tests passed");
