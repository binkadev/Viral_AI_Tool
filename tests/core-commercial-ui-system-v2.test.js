"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const ui = read("renderer/core-commercial-ui-system-v2.css");
const automation = read("renderer/core-automation-mpt-ux.css");
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

assert(agents.includes('"Segoe UI Variable Text"'), "Project typography contract must keep Segoe UI Variable Text");
assert(agents.includes('"Segoe UI Variable Display"'), "Project typography contract must keep Segoe UI Variable Display");
assert(agents.includes("body/control copy should normally be 13px or larger"), "Project readability floor must remain documented");
assert(agents.includes("secondary/meta copy should normally be 12px or larger"), "Project metadata readability floor must remain documented");
assert(agents.includes("tiny helper text should not fall below 11px"), "Project helper readability floor must remain documented");

const uiLink = 'href="core-commercial-ui-system-v2.css"';
const motionLink = 'href="core-motion-policy.css"';
assert(index.includes(uiLink), "Commercial UI system stylesheet must be loaded");
assert(index.indexOf(motionLink) < index.indexOf(uiLink), "Commercial UI system must load after previous visual layers so it owns final hierarchy");

assert(pkg.scripts.pack.includes("signAndEditExecutable=false"), "Local unpacked smoke build must keep the Windows symlink-safe path");
assert(pkg.scripts["pack:full"] === "electron-builder --dir", "Full Windows resource-editing pack path must remain available");
assert(pkg.scripts.dist === "electron-builder --win nsis --publish never", "Production installer command must remain unchanged");

console.log("Commercial UI system typography, readability, shell, Automation, Studio, accessibility and smoke-pack contracts passed.");
