"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-creator-home.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-creator-home.css"), "utf8");
const availabilityCss = fs.readFileSync(path.join(root, "renderer", "core-creator-home-availability.css"), "utf8");
const allCreatorCss = css + "\n" + availabilityCss;
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const i18n = fs.readFileSync(path.join(root, "renderer", "i18n.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Creator Home JavaScript must parse.");

for (const token of [
  "pages.download = creatorHomePage",
  'current.page = "download"',
  'typeof addFiles !== "function"',
  "sourceSignature() !== before",
  'current.page = "ai-video"',
  "data-creator-open",
  "data-job-action=\"relink\"",
  'document.addEventListener("drop"',
  'document.documentElement.dataset.motion === "reduced"',
  "function sourceAvailability(job)",
  'fileState === "trashed"',
  'fileState === "missing"',
  'sourceAvailability(source)',
  'sourceAvailability(job)'
]) {
  assert(js.includes(token), "Creator Home behavior missing: " + token);
}

assert(!js.includes("statusBadge"), "Creator Home must not present stale source-job status as project workflow status.");

for (const token of [
  ".creator-home-hero",
  ".creator-import-zone",
  ".creator-current-project",
  ".creator-source-availability",
  ".creator-workspace-preparing",
  ":focus-visible",
  "prefers-reduced-motion",
  'html[data-motion="reduced"]'
]) {
  assert(allCreatorCss.includes(token), "Creator Home style missing: " + token);
}

const relinkRule = css.match(/\.creator-recent-relink\{([^}]*)\}/)?.[1] || "";
assert(relinkRule.includes("min-height:32px"), "Recent-source recovery action must exceed the minimum pointer target floor.");
assert(relinkRule.includes("font-size:13px"), "Recent-source recovery action must meet the control-copy readability floor.");

const recentTitleRule = css.match(/\.creator-recent-copy strong\{([^}]*)\}/)?.[1] || "";
const recentMetaRule = css.match(/(?:^|})\.creator-recent-copy span\{([^}]*)\}/)?.[1] || "";
assert(recentTitleRule.includes("font-size:13px"), "Recent-source title must meet the primary readability floor.");
assert(recentMetaRule.includes("font-size:12px"), "Recent-source metadata must meet the secondary readability floor.");

assert(index.includes('href="core-creator-home.css"'), "Creator Home stylesheet must be loaded.");
assert(index.includes('href="core-creator-home-availability.css"'), "Creator Home availability stylesheet must be loaded.");
assert(index.includes('src="core-creator-home.js"'), "Creator Home script must be loaded.");
assert(!index.includes('core-startup-experience'), "Creator Home must not depend on the removed animated startup module.");
assert(
  index.indexOf('src="core-creator-home.js"') < index.indexOf('src="core-premium-hud.js"'),
  "Creator Home must finish wiring before optional HUD interaction polish."
);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(i18n, context);
const requiredKeys = [
  "dashboard.eyebrow",
  "dashboard.title",
  "dashboard.desc",
  "download.localTitle",
  "download.localDesc",
  "download.dropTitle",
  "download.dropDesc",
  "dashboard.recentJobs",
  "dashboard.recentJobsDesc",
  "aiVideo.editor",
  "media.readingInfo",
  "file.relink",
  "file.missing",
  "file.trashed",
  "common.processing"
];

for (const locale of ["vi", "en"]) {
  for (const key of requiredKeys) {
    const value = context.window.I18N.t(locale, key);
    assert(value && value !== key, `Missing ${locale} translation for ${key}`);
  }
}

assert(!/FFmpeg|ffmpeg|stack trace|shell command/.test(js), "Creator Home must not expose implementation details.");

console.log("Creator Home tests passed.");
