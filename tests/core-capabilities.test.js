"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const guard = fs.readFileSync(path.join(root, "renderer", "core-capabilities.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-capabilities.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");

for (const page of ["automation", "workflow", "workflow-builder", "monitor", "editor", "voice"]) {
  assert(guard.includes('"' + page + '"'), "Deferred page must be capability-guarded: " + page);
  assert(css.includes('[data-page="' + page + '"]'), "Deferred page must be hidden from the core UI: " + page);
}

assert(!css.includes('[data-page="ai-video"]'), "The production Core Editor route must remain visible.");

for (const required of [
  'setDatasetIfChanged(button, "coreCapability", capability)',
  'mark(urlAnalyze, "coming-soon")',
  'mark(legacyTts, "coming-soon")',
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

assert(bootstrap.includes("prototypeNames"), "Startup bootstrap must continue removing prototype jobs from persisted state.");
assert(index.includes('href="core-capabilities.css"'));
assert(index.includes('src="core-capabilities.js"'));

console.log("Core capability guard tests passed.");
