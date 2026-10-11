"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const ui = read("renderer/core-commercial-ui-system-v2.css");
const pages = read("renderer/core-commercial-pages-v2.css");
const management = read("renderer/core-management-commercial-v2.css");
const automation = read("renderer/core-automation-mpt-ux.css");
const automationWorkstation = read("renderer/core-automation-commercial-v2.css");
const studio = read("renderer/core-studio-commercial-v2.css");
const index = read("renderer/index.html");
const agents = read("AGENTS.md");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "font-family:var(--font)",
  "font-family:var(--font-display)",
  "var(--type-caption)",
  "var(--type-meta)",
  "var(--type-body)",
  "var(--type-control)",
  "var(--type-card-title)",
  "var(--type-section)",
  "var(--type-page)",
  ".sidebar",
  ".topbar",
  ".button",
  ".input",
  ".automation-mpt-inspired",
  "html.core-editor-premium",
  ":focus-visible",
  "html[data-motion=\"reduced\"]",
  "@media(prefers-reduced-motion:reduce)",
  "@media(max-width:1280px)"
]) assert(ui.includes(required), "Commercial UI system missing: " + required);

assert(!ui.includes("@keyframes"), "Commercial UI system must not add decorative animation loops");
assert(!ui.includes("Inter,"), "Commercial UI system must use the approved Windows system typography stack");

for (const required of [
  ".creator-home-hero",
  ".creator-start-grid",
  ".core-real-dashboard-hero",
  ".core-real-stats",
  ".setting-row",
  ".settings-select-row",
  ".voice-meta b",
  ".toast",
  ".modal-backdrop",
  ".modal h3",
  ".dragging::after",
  "font-size:var(--type-caption)",
  "font-size:var(--type-meta)",
  "font-size:var(--type-body)",
  "@media(max-width:1280px)",
  "@media(max-width:700px)",
  "@media(prefers-reduced-motion:reduce)"
]) assert(pages.includes(required), "Commercial page polish missing: " + required);

assert(pages.includes("animation:none!important"), "Commercial page polish must disable decorative drag-overlay animation");

for (const required of [
  ".hero",
  ".stat-card",
  ".tool-card",
  ".dropzone",
  ".data-table th",
  ".workflow",
  ".wf-step",
  "font-size:var(--type-caption)",
  "font-size:var(--type-meta)",
  "font-size:var(--type-body)",
  "animation:none!important",
  "@media(max-width:1180px)",
  "@media(prefers-reduced-motion:reduce)"
]) assert(management.includes(required), "Commercial management/workflow polish missing: " + required);

assert(!management.includes("heroGlow"), "Final management layer must not reintroduce hero glow loops");
assert(!management.includes("workflowSweep"), "Final management layer must not reintroduce workflow sweep loops");
assert(!management.includes("uploadFloat"), "Final management layer must not reintroduce upload float loops");

for (const required of [
  "font-size:var(--type-caption)",
  "font-size:var(--type-meta)",
  "font-size:var(--type-body)",
  "font-size:var(--type-control)",
  "font-size:var(--type-card-title)",
  "font-size:var(--type-section)",
  "min-height:40px"
]) assert(automation.includes(required), "Automation production console typography missing: " + required);

for (const tooSmall of [
  "font-size:7px",
  "font-size:7.5px",
  "font-size:8px",
  "font-size:8.5px",
  "font-size:9px",
  "font-size:9.5px",
  "font-size:10px",
  "font-size:10.5px"
]) assert(!automation.includes(tooSmall), "Automation production UI reintroduced unreadable fixed type: " + tooSmall);

for (const required of [
  ".automation-scenes-workbench",
  ".automation-assets-workbench",
  ".automation-composition-workbench",
  ".automation-scene-nav-copy b",
  ".automation-asset-nav-copy b",
  ".automation-composition-clip-copy b",
  ".automation-voice-panel",
  ".automation-composition-export-status",
  ".automation-scenes-empty",
  "font-size:var(--type-caption)",
  "font-size:var(--type-meta)",
  "font-size:var(--type-body)",
  "font-size:var(--type-control)",
  "font-size:var(--type-card-title)",
  "@media(max-width:900px)",
  "@media(prefers-reduced-motion:reduce)"
]) assert(automationWorkstation.includes(required), "Automation workstation polish missing: " + required);

for (const required of [
  ".core-editor-bottom-dock",
  ".core-bottom-time",
  ".core-timeline-workspace",
  ".core-track-label b",
  ".core-source-clip span",
  ".core-transcript-workstation-head",
  ".core-transcript-time",
  ".core-transcript-source p",
  ".core-editor-inspector",
  ".core-inspector-tab",
  ".core-player-time",
  "font-size:var(--type-caption)",
  "font-size:var(--type-meta)",
  "font-size:var(--type-body)",
  "font-family:var(--font)",
  "@media(max-width:1180px)",
  "@media(prefers-reduced-motion:reduce)"
]) assert(studio.includes(required), "Studio commercial workstation missing: " + required);

assert(agents.includes('"Segoe UI Variable Text"'), "Project typography contract must keep Segoe UI Variable Text");
assert(agents.includes('"Segoe UI Variable Display"'), "Project typography contract must keep Segoe UI Variable Display");
assert(agents.includes("body/control copy should normally be 13px or larger"), "Project readability floor must remain documented");
assert(agents.includes("secondary/meta copy should normally be 12px or larger"), "Project metadata readability floor must remain documented");
assert(agents.includes("tiny helper text should not fall below 11px"), "Project helper readability floor must remain documented");

const uiLink = 'href="core-commercial-ui-system-v2.css"';
const pagesLink = 'href="core-commercial-pages-v2.css"';
const managementLink = 'href="core-management-commercial-v2.css"';
const automationLink = 'href="core-automation-commercial-v2.css"';
const studioLink = 'href="core-studio-commercial-v2.css"';
const motionLink = 'href="core-motion-policy.css"';
assert(index.includes(uiLink), "Commercial UI system stylesheet must be loaded");
assert(index.includes(pagesLink), "Commercial page polish stylesheet must be loaded");
assert(index.includes(managementLink), "Commercial management/workflow stylesheet must be loaded");
assert(index.includes(automationLink), "Automation workstation stylesheet must be loaded");
assert(index.includes(studioLink), "Studio workstation stylesheet must be loaded");
assert(index.indexOf(motionLink) < index.indexOf(uiLink), "Commercial UI system must load after previous visual layers so it owns final hierarchy");
assert(index.indexOf(uiLink) < index.indexOf(pagesLink), "Page polish must load after the shared commercial UI system");
assert(index.indexOf(pagesLink) < index.indexOf(managementLink), "Management/workflow polish must load after general page polish");
assert(index.indexOf(managementLink) < index.indexOf(automationLink), "Automation workstation layer must load after generic management/workflow polish");
assert(index.indexOf(automationLink) < index.indexOf(studioLink), "Studio workstation layer must load last among final visual overrides");

assert(pkg.scripts.pack.includes("signAndEditExecutable=false"), "Local unpacked smoke build must keep the Windows symlink-safe path");
assert(pkg.scripts["pack:full"] === "electron-builder --dir", "Full Windows resource-editing pack path must remain available");
assert(pkg.scripts.dist === "electron-builder --win nsis --publish never", "Production installer command must remain unchanged");
assert(pkg.scripts["test:core-commercial-ui-system-v2"], "package.json must expose the commercial UI system regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-commercial-ui-system-v2"), "commercial regression suite must gate the final UI system");

console.log("Commercial UI system typography, management/workflow pages, Automation workstation, Studio timeline/transcript/inspector, creator home, dashboard, settings, dialogs and smoke-pack contracts passed.");
