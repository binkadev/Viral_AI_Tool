"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const runtime = read("renderer/core-automation-mvp-controller.js");
const css = read("renderer/core-automation-mvp-controller.css");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "ViralAutomationCreator?.generateScript",
  "ViralAutomationSceneState?.generatePlan",
  "ViralAutomationAssetState?.syncRequests",
  "ViralAutomationAssetState?.resolveAll",
  "ViralAutomationAssetState?.validateLocalAssets",
  "ViralAutomationVoiceState?.generate",
  "ViralAutomationCompositionState?.compose",
  "ViralAutomationStudioProjection?.openStudio",
  "ViralAutomationWorkspace?.setStage",
  "AbortController",
  "data-automation-mvp-action",
  "ViralAutomationMvpController",
  "viral-ai:core-state-changed",
  "MutationObserver(queue)",
  "lastFailure",
  "failureCode",
  "failureMessage",
  "NETWORK_ERROR",
  "PROVIDER_NOT_CONFIGURED",
  "RATE_LIMITED",
  "NO_RESULTS",
  "Thử lại",
  "Retry"
]) assert(runtime.includes(required), "Automation MVP controller missing: " + required);

assert(!runtime.includes("setInterval("), "Automation MVP controller must not poll");
assert(!runtime.includes("setTimeout("), "Automation MVP controller must not add artificial delays");
assert(!runtime.includes("current.page ="), "Automation MVP controller must use existing navigation ownership instead of mutating page state");
assert(runtime.includes("runNext"), "Automation MVP must expose resumable next-step orchestration");
assert(runtime.includes("cancel"), "Automation MVP must expose cancellation for long-running checkpoints");
assert(runtime.includes("compositionReady"), "Automation MVP must derive completion from current editable composition state");
assert(runtime.indexOf('action.kind === "script"') < runtime.indexOf('action.kind === "scenes"'));
assert(runtime.indexOf('action.kind === "scenes"') < runtime.indexOf('action.kind === "assets-sync"'));
assert(runtime.indexOf('action.kind === "assets-resolve"') < runtime.indexOf('action.kind === "voice"'));
assert(runtime.indexOf('action.kind === "voice"') < runtime.indexOf('action.kind === "composition"'));
assert(runtime.indexOf('action.kind === "composition"') < runtime.indexOf('action.kind === "studio"'));

for (const required of [
  ".automation-mvp-controller",
  ".automation-mvp-progress",
  ".automation-mvp-controller.is-running",
  ".automation-mvp-controller.is-complete",
  ".automation-mvp-controller.is-failed"
]) assert(css.includes(required), "Automation MVP controller CSS missing: " + required);

assert(index.includes('href="core-automation-mvp-controller.css"'), "Automation MVP controller stylesheet must be loaded");
assert(index.includes('src="core-automation-mvp-controller.js"'), "Automation MVP controller runtime must be loaded");
assert(index.indexOf('src="core-automation-workspace.js"') < index.indexOf('src="core-automation-mvp-controller.js"'), "MVP controller must reuse workspace stage ownership");
assert(pkg.scripts["test:core-automation-mvp-controller"], "package.json must expose Automation MVP controller regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-mvp-controller"), "commercial regression must gate Automation MVP controller");

console.log("Automation MVP resumable checkpoints, cancellation, friendly retry states and existing-pipeline ownership tests passed.");
