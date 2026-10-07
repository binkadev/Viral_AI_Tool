"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-creator-home.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-creator-home.css"), "utf8");
const availabilityCss = fs.readFileSync(path.join(root, "renderer", "core-creator-home-availability.css"), "utf8");
const shellStability = fs.readFileSync(path.join(root, "renderer", "core-shell-stability.css"), "utf8");
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
  'requestAnimationFrame(() => {',
  "function sourceAvailability(job)",
  "function cloudStatus()",
  "creator-status-strip",
  "creator-home-professional",
  "creator-recent-open",
  'fileState === "trashed"',
  'fileState === "missing"',
  'sourceAvailability(source)',
  'sourceAvailability(job)'
]) {
  assert(js.includes(token), "Creator Home behavior missing: " + token);
}

assert(!js.includes("statusBadge"), "Creator Home must not present stale source-job status as project workflow status.");
assert(!js.includes('class="creator-home-visual"'), "The removed orbit/workflow demo visual must not be rendered.");
assert(!js.includes("creatorWorkspacePreparing"), "Opening the editor must not use a full-screen preparing animation.");
assert(!js.includes("workflowRail()"), "The removed five-step orbit demo must not remain in the Creator Home render path.");
assert(js.includes("current?.cloud?.accountOffline"), "Cloud status must reflect offline runtime state.");
assert(js.includes("current?.cloud?.auth?.authenticated === true"), "Cloud connected state must require authenticated runtime state.");
assert(!js.includes("current?.cloud?.account || current?.cloud?.auth"), "A truthy auth object alone must never imply a connected cloud session.");

for (const token of [
  ".creator-home-hero",
  ".creator-home-professional",
  ".creator-home-actions",
  ".creator-status-strip",
  ".creator-status-chip",
  ".creator-import-zone",
  ".creator-import-symbol",
  ".creator-current-project",
  ".creator-recent-open",
  ".creator-source-availability",
  ":focus-visible",
  "prefers-reduced-motion",
  'html[data-motion="reduced"]'
]) {
  assert(allCreatorCss.includes(token), "Creator Home style missing: " + token);
}

assert(!css.includes("@keyframes"), "Creator Home must not reintroduce decorative looping animations.");
assert(!css.includes("creator-drop-orbit"), "Import surface must use a static commercial icon instead of an orbit visual.");
assert(!css.includes("creator-home-visual"), "Removed hero demo visual styles must not remain in the active Creator Home stylesheet.");

for (const token of [
  ".creator-home-hero",
  "grid-template-columns:minmax(0,1fr)!important",
  ".creator-home-visual",
  ".creator-workspace-preparing",
  "display:none!important"
]) {
  assert(shellStability.includes(token), "Creator Home stability override missing: " + token);
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
  "download.localTitle",
  "download.localDesc",
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
