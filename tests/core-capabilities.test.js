"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const guard = fs.readFileSync(path.join(root, "renderer", "core-capabilities.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-capabilities.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");
const commandJs = fs.readFileSync(path.join(root, "renderer", "core-command-palette.js"), "utf8");
const commandCss = fs.readFileSync(path.join(root, "renderer", "core-command-surface.css"), "utf8");

for (const page of ["automation", "workflow", "workflow-builder", "monitor", "editor", "voice"]) {
  assert(guard.includes('"' + page + '"'), "Deferred page must be capability-guarded: " + page);
  assert(css.includes('[data-page="' + page + '"]'), "Deferred page must be hidden from the core UI: " + page);
}

assert(!css.includes('[data-page="ai-video"]'), "The production Core Editor route must remain visible.");

for (const required of [
  'setDatasetIfChanged(button, "coreCapability", capability)',
  'mark(urlAnalyze, "coming-soon")',
  'mark(legacyTts, "coming-soon")',
  'button.matches(".command-palette")',
  'mark(button, "functional")',
  'document.querySelectorAll(".nav-badge").forEach(node => node.remove())',
  'button.disabled || button.getAttribute("aria-disabled") === "true"',
  'data-job-action',
  'data-core-play',
  'data-core-fullscreen',
  'new MutationObserver(queueScan)',
  'observer.observe(page, { childList: true, subtree: true })',
  'requestAnimationFrame(() => {'
]) {
  assert(guard.includes(required), "Capability guard is missing behavior: " + required);
}

assert(!guard.includes('mark(search, "coming-soon")'), "Command palette must no longer be classified as coming soon.");
assert(!guard.includes('attributeFilter: ["disabled", "aria-disabled"]'),
  "Capability guard must not observe the attributes it mutates; that can freeze the renderer.");
assert(!guard.includes("new MutationObserver(scan)"),
  "Capability observer must be scheduled/coalesced instead of recursively scanning synchronously.");

assert.doesNotThrow(() => new Function(commandJs), "Command palette JS must parse.");
for (const required of [
  'window.I18N?.t(locale(), key)',
  'event.ctrlKey || event.metaKey',
  'String(event.key).toLowerCase() === "k"',
  'event.key === "ArrowDown"',
  'event.key === "ArrowUp"',
  'event.key === "Enter"',
  'document.querySelectorAll("#nav .nav-item[data-page]")',
  'node.querySelector(".nav-icon + span")',
  'role="combobox"',
  'aria-controls="coreCommandList"',
  'input.setAttribute("aria-activedescendant"',
  'tabindex="-1"',
  'if (event.key === "Tab")',
  'new MutationObserver(syncTriggerText).observe(root, { attributes: true, attributeFilter: ["lang"] })',
  'dataset.coreCapability = "functional"'
]) {
  assert(commandJs.includes(required), "Command palette behavior missing: " + required);
}
assert(!commandJs.includes("Search commands…"), "Command palette copy must come from central I18N, not a feature-local English catalog.");
assert(!commandJs.includes("Tìm chức năng…"), "Command palette copy must come from central I18N, not a feature-local Vietnamese catalog.");
for (const required of [
  ".core-command-overlay",
  ".core-command-dialog",
  ".core-command-item.is-active",
  "coreCommandDialogIn",
  'html[data-theme="midnight"] .topbar',
  "@media(max-width:1180px)",
  '.command-palette{display:flex!important;width:44px!important',
  '.command-copy{color:#9aa5b8;font-size:13px',
  '.core-command-item-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px'
]) {
  assert(commandCss.includes(required), "Command surface styles missing: " + required);
}

assert(bootstrap.includes("prototypeNames"), "Startup bootstrap must continue removing prototype jobs from persisted state.");
assert(index.includes('href="core-capabilities.css"'));
assert(index.includes('src="core-capabilities.js"'));
assert(index.includes('href="core-command-surface.css"'), "Command surface CSS must be loaded.");
assert(index.includes('src="core-command-palette.js"'), "Command palette JS must be loaded.");

console.log("Core capability guard tests passed.");
