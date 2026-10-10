"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const snapshotModel = require("../renderer/core-project-snapshot");
const {
  sanitizeBaseName,
  uniqueOutputPath
} = require("../services/automation/composition-export");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

assert.strictEqual(sanitizeBaseName('  Demo: Video / 01  '), "Demo Video 01");
assert.strictEqual(sanitizeBaseName('A'.repeat(100)).length, 80);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-composition-export-"));
const fixed = new Date("2026-10-11T00:00:00Z");
const firstOutput = uniqueOutputPath(tempRoot, "Campaign", fixed);
assert(firstOutput.endsWith("Campaign-20261011-000000.mp4"));
fs.writeFileSync(firstOutput, Buffer.from("existing-output"));
const secondOutput = uniqueOutputPath(tempRoot, "Campaign", fixed);
assert(secondOutput.endsWith("Campaign-20261011-000000-2.mp4"), "export must never silently overwrite an existing output");

const exportJob = {
  id: "composition-export-test",
  isRenderOutput: true,
  isAutomationCompositionExport: true,
  outputPath: secondOutput,
  status: "completed"
};
const realSource = {
  id: "real-source",
  sourcePath: "C:/media/source.mp4",
  name: "source.mp4",
  status: "completed"
};
assert.strictEqual(snapshotModel.latestSourceJob({ jobs: [exportJob, realSource] }).id, "real-source", "composition export must never replace the project source");

const service = read("services/automation/composition-export.js");
const ipc = read("services/automation/composition-export-ipc.js");
const preload = read("preload.js");
const mainEntry = read("main-entry.js");
const renderer = read("renderer/core-automation-composition-export.js");
const assetRefresh = read("renderer/core-automation-asset-refresh.js");
const assetState = read("renderer/core-automation-asset-state.js");
const index = read("renderer/index.html");
const css = read("renderer/core-automation-composition-export.css");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "MIN_FREE_BYTES",
  "assertOutputDirectory",
  "LOW_DISK_SPACE",
  "DUPLICATE_ACTIVE",
  "uniqueOutputPath",
  "'-n'",
  "concat=n=",
  "subtitles=filename=",
  "amix=inputs=",
  "removePartial(outputPath)",
  "cancelCompositionExport",
  "cancelAllCompositionExports",
  "getActiveCompositionExportCount"
]) assert(service.includes(required), "Composition export service missing guardrail: " + required);

for (const required of [
  "automation:composition-export-start",
  "automation:composition-export-cancel",
  "automation:composition-export-status",
  "automation:composition-export-progress"
]) assert(ipc.includes(required), "Composition export IPC missing: " + required);

for (const required of [
  "startAutomationCompositionExport",
  "cancelAutomationCompositionExport",
  "getAutomationCompositionExportStatus",
  "onAutomationCompositionExportProgress"
]) assert(preload.includes(required), "Preload export bridge missing: " + required);

assert(mainEntry.includes("installAutomationCompositionExportIpc();"));
assert(mainEntry.includes("cancelAllAutomationCompositionExports();"));

for (const required of [
  'tr("common.export")',
  'tr("common.cancel")',
  'tr("media.renderDone")',
  'tr("media.showFile")',
  'tr("export.lowSpaceTitle"',
  'tr("export.folderTitle"',
  'tr("export.sourceTitle"',
  "isRenderOutput: true",
  "isAutomationCompositionExport: true",
  "compositionSignature",
  "outputPath",
  "failureCode",
  "cancelAutomationCompositionExport",
  "recoverInterruptedJobs"
]) assert(renderer.includes(required), "Composition export renderer missing: " + required);

assert(!renderer.includes("FFmpeg"), "Commercial renderer copy must not expose implementation engine names");
assert(assetRefresh.includes('data-asset-resolve'), "resolved asset refresh must reuse the canonical asset resolution path");
assert(assetRefresh.includes('tr("common.choose")'), "asset refresh label must use the locale layer");
assert(assetState.includes("automation.stale.composition = Boolean(automation.composition)"), "re-resolving a scene asset must invalidate an existing composition");

assert(index.includes('href="core-automation-composition-export.css"'));
assert(index.includes('src="core-automation-asset-refresh.js"'));
assert(index.includes('src="core-automation-composition-export.js"'));
assert(index.indexOf('src="core-automation-assets-ui.js"') < index.indexOf('src="core-automation-asset-refresh.js"'));
assert(index.indexOf('src="core-automation-studio-projection.js"') < index.indexOf('src="core-automation-composition-export.js"'));
assert(css.includes(".automation-composition-export-status"));
assert(css.includes(".automation-asset-refresh-actions"));
assert(css.includes(":focus-visible"));

assert(pkg.scripts["test:core-automation-composition-export"], "package.json must expose composition export regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-composition-export"), "commercial regression must gate composition export");

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("Automation composition asset refresh, safe export, cancellation, output isolation and commercial UI tests passed.");
