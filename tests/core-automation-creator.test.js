"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-automation-creator.js");
const css = read("renderer/core-automation-creator.css");
const stateBridge = read("renderer/core-automation-script-state.js");
const bootstrap = read("renderer/core-bootstrap.js");
const shell = read("renderer/core-product-shell.js");
const capabilities = read("renderer/core-capabilities.js");
const capabilitiesCss = read("renderer/core-capabilities.css");
const index = read("renderer/index.html");
const preload = read("preload.js");
const pkg = JSON.parse(read("package.json"));

assert.doesNotThrow(() => new Function(js), "Automation Creator JavaScript must parse.");

for (const required of [
  "pages.automation = creatorPage",
  "automationGenerateScript",
  "automationStopScript",
  "automationSaveScript",
  "ViralAutomationState?.setBrief",
  "getAutomationScriptStatus",
  "startAutomationScript",
  "cancelAutomationScript",
  "onAutomationScriptProgress",
  "ViralAutomationScriptState?.acceptScript",
  "ViralAutomationScriptState?.editScript",
  "automation-script-progress",
  "runtime.runningJobId",
  "captureDraft()",
  "refreshProviderStatus",
  "Scene Planner",
  "A3"
]) {
  assert(js.includes(required), "Automation Creator is missing: " + required);
}

for (const forbidden of [
  "OPENAI_API_KEY=",
  "sk-",
  "fetch(\"https://api.openai.com",
  "ipcRenderer",
  "child_process"
]) {
  assert(!js.includes(forbidden), "Automation Creator must not contain desktop/provider secret plumbing: " + forbidden);
}

for (const required of [
  ".automation-creator",
  ".automation-stage-rail",
  ".automation-brief-card",
  ".automation-script-card",
  ".automation-progress",
  ".automation-next-card",
  "height:clamp(520px,calc(100vh - 415px),690px)",
  "@media(max-width:1450px)",
  ".automation-grid{grid-template-columns:1fr}",
  "scrollbar-gutter:stable"
]) {
  assert(css.includes(required), "Automation Creator CSS missing: " + required);
}

for (const required of [
  "function editScript",
  "automation-script-edited",
  "markDownstreamStale(current)",
  "outputSignature: \"script-edit:\""
]) {
  assert(stateBridge.includes(required), "Editable ScriptDocument state contract missing: " + required);
}

assert(bootstrap.includes("const hasAutomationProject = Boolean(saved.automation?.brief)"), "Startup must recognize Automation-only projects.");
assert(bootstrap.includes('saved.page = "automation"'), "Startup must restore Automation projects into their workspace.");
assert(shell.includes('{ id: "automation", icon: "✦", label: "core-automation" }'), "Commercial nav must expose Automation Creator.");
assert(shell.includes('current.page === "automation"'), "Product shell must preserve Automation routing.");
assert(!capabilities.includes('new Set(["automation", "workflow"'), "Automation route must not remain deferred in the capability runtime.");
assert(!capabilitiesCss.includes('[data-page="automation"]'), "Automation route must not be hidden by the production capability stylesheet.");

assert(index.includes('href="core-automation-creator.css"'));
assert(index.includes('src="core-automation-creator.js"'));
assert(index.indexOf('src="core-automation-script-state.js"') < index.indexOf('src="core-automation-creator.js"'));
assert(index.indexOf('src="core-automation-creator.js"') < index.indexOf('src="core-capabilities.js"'));

for (const required of [
  "getAutomationScriptStatus",
  "startAutomationScript",
  "cancelAutomationScript",
  "onAutomationScriptProgress"
]) {
  assert(preload.includes(required), "Automation Creator needs preload contract: " + required);
}

assert(pkg.scripts["test:core-automation-creator"], "package.json must expose the Automation Creator regression.");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-creator"), "Commercial regression must gate Automation Creator.");

console.log("Automation Creator brief, ScriptEngine runner, editable result, responsive workspace, visible production route, navigation and restart-recovery contracts passed.");
