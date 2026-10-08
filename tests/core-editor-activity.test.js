const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-activity.js");
const css = read("renderer/core-editor-activity.css");
const index = read("renderer/index.html");
const preload = read("preload.js");
const i18n = read("renderer/i18n.js");

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
  "beforeunload",
  "commercialCopy()",
  'tr("common.export")',
  'tr("media.renderStarted")',
  "window.I18N?.t?.(locale(), key, vars)"
]) {
  assert(js.includes(required), "Activity JS missing: " + required);
}

assert(!js.includes("setInterval("), "Editor activity must update from real progress signals instead of polling every few hundred milliseconds.");
for (const progressApi of ["onSpeechProgress", "onTranslationProgress", "onVoiceProgress", "onRenderProgress"]) {
  assert(preload.includes(progressApi), "Desktop bridge must expose activity signal: " + progressApi);
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(i18n, context);
for (const locale of ["vi", "en"]) {
  for (const key of ["common.export", "media.renderStarted"]) {
    const value = context.window.I18N.t(locale, key);
    assert(typeof value === "string" && value && value !== key, `Missing ${locale} activity catalog entry for ${key}`);
  }
}
assert(!/\brender\b/i.test(context.window.I18N.t("vi", "media.renderStarted")), "Vietnamese export activity copy must not expose render jargon.");
assert(!/\brendering\b/i.test(context.window.I18N.t("en", "media.renderStarted")), "English export activity copy must stay customer-facing.");

for (const required of [
  ".core-editor-activity",
  '.core-editor-activity[data-state="failed"]',
  ".core-editor-activity-progress.is-indeterminate",
  ".core-editor-activity-button.is-retry",
  ".core-editor-activity-button:focus-visible",
  "font-size:var(--type-control)!important",
  "font-size:var(--type-body)!important",
  "font-size:var(--type-meta)!important",
  "font-size:var(--type-caption)!important",
  'html[data-motion="reduced"].core-editor-premium'
]) {
  assert(css.includes(required), "Activity CSS missing: " + required);
}
assert(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/.test(css),
  "Activity CSS must respect prefers-reduced-motion regardless of formatting.");
assert(!/font-size:(?:9|10)px/.test(css), "Activity bar copy must respect the commercial readability floor.");
assert(css.includes("outline-offset:2px"), "Activity actions need visible keyboard focus.");

assert(index.includes('href="core-editor-activity.css"'), "Activity CSS must be loaded.");
assert(index.includes('src="core-editor-activity.js"'), "Activity JS must be loaded.");

console.log("core-editor-activity commercial export activity tests passed");
