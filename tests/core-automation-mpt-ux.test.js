"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const runtime = read("renderer/core-automation-mpt-ux.js");
const css = read("renderer/core-automation-mpt-ux.css");
const creator = read("renderer/core-automation-creator.js");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

assert.doesNotThrow(() => new Function(runtime), "MoneyPrinter-inspired Automation UX runtime must parse");

for (const required of [
  "automation-setup-grid",
  "automation-setup-content",
  "automation-setup-video",
  "automation-setup-audio",
  "automation-engine-strip",
  "automation-runbar",
  "automationTopic",
  "automationProduct",
  "automationObjective",
  "automationAudience",
  "automationTone",
  "automationCta",
  "automationPlatform",
  "automationDuration",
  "automationLanguage",
  "automationGenerateScript",
  "automationStopScript",
  "ViralAutomationStockStatus",
  "ViralAutomationVoiceState",
  "MutationObserver(queue)",
  "ViralAutomationMptUx"
]) assert(runtime.includes(required), "Automation production console missing: " + required);

assert(!runtime.includes("setInterval("), "Automation production console must not poll");
assert(!runtime.includes("innerHTML = creator"), "UX layer must decorate the canonical Automation DOM instead of creating a second workflow");
assert(creator.includes('event.target.closest(".automation-brief-card")'), "Canonical Brief event ownership must remain in Automation Creator");
assert(creator.includes("captureDraft()"), "Canonical Brief persistence must remain in Automation Creator");

for (const required of [
  ".automation-setup-grid",
  "grid-template-columns:minmax(0,1.22fr) minmax(260px,.82fr) minmax(260px,.82fr)",
  ".automation-engine-strip",
  ".automation-runbar",
  ".automation-mpt-script-card",
  ".automation-mpt-inspired .automation-stage-rail",
  "@media(max-width:1280px)",
  "@media(max-width:900px)",
  "@media(prefers-reduced-motion:reduce)"
]) assert(css.includes(required), "Automation production console CSS missing: " + required);

assert(index.includes('href="core-automation-mpt-ux.css"'), "MoneyPrinter-inspired Automation CSS must be loaded");
assert(index.includes('src="core-automation-mpt-ux.js"'), "MoneyPrinter-inspired Automation runtime must be loaded");
assert(index.indexOf('src="core-automation-workspace.js"') < index.indexOf('src="core-automation-mpt-ux.js"'), "UX layer must decorate the existing workspace after canonical stage ownership loads");
assert(index.indexOf('src="core-automation-mvp-controller.js"') < index.indexOf('src="core-automation-mpt-ux.js"'), "UX layer must not replace MVP controller ownership");

assert(pkg.scripts.pack.includes("signAndEditExecutable=false"), "Local unpacked smoke build must avoid the Windows signing-tool symlink privilege trap");
assert(pkg.scripts["pack:full"] === "electron-builder --dir", "Full resource-editing pack path must remain available separately");
assert(pkg.scripts.dist === "electron-builder --win nsis --publish never", "Production installer path must remain unchanged");
assert(pkg.scripts["test:core-automation-mpt-ux"], "package.json must expose Automation production-console regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-mpt-ux"), "commercial regression must gate Automation production-console UX");

console.log("MoneyPrinter-inspired Automation configuration console, canonical workflow ownership and Windows smoke-pack policy tests passed.");
