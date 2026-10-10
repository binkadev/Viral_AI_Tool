"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const snapshotModel = require("../renderer/core-project-snapshot");
const {
  dimensionsFor,
  normalizePayload,
  cacheName
} = require("../services/automation/composition-preview");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

assert.deepStrictEqual(dimensionsFor("9:16"), { width: 720, height: 1280 });
assert.deepStrictEqual(dimensionsFor("16:9"), { width: 1280, height: 720 });
assert.deepStrictEqual(dimensionsFor("1:1"), { width: 1080, height: 1080 });

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-composition-projection-"));
const first = path.join(tempRoot, "scene-1.mp4");
const second = path.join(tempRoot, "scene-2.mp4");
fs.writeFileSync(first, Buffer.from("scene-one"));
fs.writeFileSync(second, Buffer.from("scene-two"));

const composition = {
  id: "composition-test",
  outputSignature: "composition-plan-v1:test",
  aspectRatio: "9:16",
  durationSec: 8,
  tracks: {
    video: [
      { id: "v1", sourcePath: first, sourceInSec: 0, sourceOutSec: 4, durationSec: 4, startSec: 0, endSec: 4 },
      { id: "v2", sourcePath: second, sourceInSec: 0, sourceOutSec: 4, durationSec: 4, startSec: 4, endSec: 8 }
    ]
  }
};
const normalized = normalizePayload({ composition });
assert.strictEqual(normalized.clips.length, 2);
assert.strictEqual(normalized.totalDuration, 8);
assert.strictEqual(normalized.aspectRatio, "9:16");
assert(cacheName(normalized).startsWith("composition-preview-"));
assert(cacheName(normalized).endsWith(".mp4"));
assert.strictEqual(cacheName(normalized), cacheName(normalized), "derived preview cache identity must be deterministic");

const previewJob = {
  id: "automation-composition-preview-composition-test",
  sourcePath: path.join(tempRoot, "derived-preview.mp4"),
  previewUrl: "file://derived-preview.mp4",
  isAutomationCompositionPreview: true,
  status: "completed"
};
const realSource = {
  id: "source-real",
  sourcePath: "C:/media/original.mp4",
  name: "original.mp4",
  status: "completed"
};
assert.strictEqual(snapshotModel.latestSourceJob({ jobs: [previewJob, realSource] }).id, "source-real", "derived preview must never become the project source");
assert.strictEqual(snapshotModel.sourceFromState({ jobs: [previewJob] }), null, "derived preview alone must not create source ownership");
assert.strictEqual(snapshotModel.workflowFromState({ jobs: [previewJob, realSource] }).jobs.length, 1, "derived preview must not persist as a workflow job");
assert.strictEqual(snapshotModel.workflowFromState({ jobs: [previewJob, realSource] }).jobs[0].id, "source-real");

const service = read("services/automation/composition-preview.js");
const ipc = read("services/automation/composition-preview-ipc.js");
const preload = read("preload.js");
const mainEntry = read("main-entry.js");
const projection = read("renderer/core-automation-studio-projection.js");
const projectionCss = read("renderer/core-automation-studio-projection.css");
const index = read("renderer/index.html");
const snapshotSource = read("renderer/core-project-snapshot.js");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "filter_complex",
  "concat=n=",
  "force_original_aspect_ratio=increase",
  "cacheName(normalized)",
  "cancelCompositionPreview",
  "cancelAllCompositionPreviews"
]) assert(service.includes(required), "Composition preview service missing: " + required);

for (const required of [
  "automation:composition-preview-build",
  "automation:composition-preview-cancel",
  "automation:composition-preview-progress",
  "app.getPath('userData')"
]) assert(ipc.includes(required), "Composition preview IPC missing: " + required);

for (const required of [
  "buildAutomationCompositionPreview",
  "cancelAutomationCompositionPreview",
  "onAutomationCompositionPreviewProgress"
]) assert(preload.includes(required), "Preload composition bridge missing: " + required);

assert(mainEntry.includes("installAutomationCompositionPreviewIpc();"));
assert(mainEntry.includes("cancelAllAutomationCompositionPreviews();"));

for (const required of [
  "data-composition-open-studio",
  "isAutomationCompositionPreview",
  "automation-composition-timeline-clip",
  "automation-composition-subtitle-clip",
  "video.currentTime =",
  "data-automation-back",
  "ViralAutomationStudioProjection",
  "removePreviewJobs()"
]) assert(projection.includes(required), "Studio projection runtime missing: " + required);

assert(projection.includes("operationId !== localOperationId"), "cancelled preview builds must not reopen Studio after cancellation");
assert(!projection.includes("setInterval("), "Studio projection must not create a second playback clock");
assert(projectionCss.includes("#page.automation-studio-projection"));
assert(projectionCss.includes(".automation-composition-timeline-clip"));
assert(projectionCss.includes(".automation-composition-subtitle-clip"));
assert(index.includes('href="core-automation-studio-projection.css"'));
assert(index.includes('src="core-automation-studio-projection.js"'));
assert(index.indexOf('src="core-automation-composition-ui.js"') < index.indexOf('src="core-automation-studio-projection.js"'));
assert(snapshotSource.includes("job?.isAutomationCompositionPreview !== true"));
assert(snapshotSource.includes("job.isAutomationCompositionPreview !== true"));
assert(pkg.scripts["test:core-automation-studio-projection"], "package.json must expose Studio projection regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-studio-projection"), "commercial regression must gate Automation Studio projection");

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("Automation Composition derived preview, one-clock Studio projection, timeline overlays and project-source isolation tests passed.");
