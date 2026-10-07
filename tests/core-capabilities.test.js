"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const guard = fs.readFileSync(path.join(root, "renderer", "core-capabilities.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-capabilities.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");
const commandPalette = fs.readFileSync(path.join(root, "renderer", "core-command-palette.js"), "utf8");
const commandSurface = fs.readFileSync(path.join(root, "renderer", "core-command-surface.css"), "utf8");
const workflow = fs.readFileSync(path.join(root, "renderer", "core-workflow.js"), "utf8");

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

assert(!guard.includes('attributeFilter: ["disabled", "aria-disabled"]'),
  "Capability guard must not observe the attributes it mutates; that can freeze the renderer.");
assert(!guard.includes("new MutationObserver(scan)"),
  "Capability observer must be scheduled/coalesced instead of recursively scanning synchronously.");

for (const required of [
  'role="combobox"',
  'role="listbox"',
  'aria-activedescendant',
  'event.key === "ArrowDown"',
  'event.key === "ArrowUp"',
  'event.key === "Enter"',
  'event.key === "Tab"',
  'empty: "No matching feature found"',
  'empty: "Không tìm thấy chức năng phù hợp"',
  'trigger: "Go to a feature"',
  'trigger: "Đi tới chức năng"',
  'trigger.dataset.coreCapability = "functional"'
]) {
  assert(commandPalette.includes(required), "Command palette is missing behavior: " + required);
}

assert(!commandPalette.includes("Search anything"),
  "Command palette must not overpromise global search when it only navigates production features.");
assert(!workflow.includes("markComingSoon"),
  "Workflow refresher must not disable the functional command palette.");
assert(!workflow.includes('document.querySelector(".command-palette")'),
  "Workflow gating must not own the command palette anymore.");

assert(commandSurface.includes('@media(max-width:1180px){.command-palette{display:flex!important'),
  "Compact command trigger must remain visible on narrower windows in every theme.");
assert(commandSurface.includes('@media(prefers-reduced-motion:reduce)'),
  "Command palette must respect reduced-motion preferences.");

assert(bootstrap.includes("prototypeNames"), "Startup bootstrap must continue removing prototype jobs from persisted state.");
assert(index.includes('href="core-capabilities.css"'));
assert(index.includes('src="core-capabilities.js"'));
assert(index.includes('href="core-premium-workstation.css"'), "Existing workstation refinement must remain loaded.");
assert(index.includes('href="core-command-surface.css"'), "Command surface styles must be loaded.");
assert(index.includes('src="core-command-palette.js"'), "Functional command palette must be loaded.");
assert(index.indexOf('href="core-command-surface.css"') > index.indexOf('href="core-premium-workstation.css"'),
  "Command surface should load after the workstation layer so its control styling wins.");

console.log("Core capability guard tests passed.");
