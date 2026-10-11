"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const automationModel = require("../renderer/core-automation-model");
const scenePlanner = require("../renderer/core-automation-scene-planner");
const assetModel = require("../renderer/core-automation-asset-model");
const voiceModel = require("../renderer/core-automation-voice-model");
const compositionModel = require("../renderer/core-automation-composition-model");
const projectSnapshot = require("../renderer/core-project-snapshot");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const briefResult = automationModel.createContentBrief({
  topic: "Automation acceptance",
  objective: "Create an editable short-form video",
  audience: "Creators",
  platform: "short-video",
  aspectRatio: "9:16",
  targetDurationSec: 12,
  language: "vi",
  tone: "clear",
  callToAction: "Follow for more"
}, { now: Date.UTC(2026, 9, 11, 10, 0, 0) });
assert.strictEqual(briefResult.ok, true);

const brief = briefResult.value;
const script = {
  version: 1,
  id: "script-acceptance",
  hook: "Bắt đầu bằng một ý tưởng rõ ràng.",
  body: "Chia nội dung thành các cảnh ngắn và dùng tư liệu phù hợp.",
  callToAction: "Kiểm tra kết quả trong Studio.",
  narrationText: "Bắt đầu bằng một ý tưởng rõ ràng. Chia nội dung thành các cảnh ngắn và dùng tư liệu phù hợp. Kiểm tra kết quả trong Studio.",
  outputSignature: "script-v1:acceptance"
};

const planned = scenePlanner.planScenes({
  brief,
  script,
  now: Date.UTC(2026, 9, 11, 10, 1, 0)
});
assert.strictEqual(planned.ok, true);
assert(planned.value.scenes.length >= 2, "Acceptance flow should create multiple editable scenes");

const requests = assetModel.buildAssetRequests({
  brief,
  scenePlan: planned.value,
  now: Date.UTC(2026, 9, 11, 10, 2, 0)
});
assert.strictEqual(requests.ok, true);
assert.strictEqual(requests.value.length, planned.value.scenes.length);
assert(requests.value.every(request => request.strategy === "stock"));
assert(requests.value.every(request => request.requestSignature.startsWith("asset-request-v1:")));

const resolvedAssets = requests.value.map((request, index) => assetModel.normalizeAssetRef({
  provider: "acceptance-stock",
  providerAssetId: `asset-${index + 1}`,
  type: "video",
  localPath: `C:/automation-acceptance/scene-${index + 1}.mp4`,
  width: 1080,
  height: 1920,
  durationSec: Math.max(request.desiredDurationSec, 5),
  checksum: `sha256:${index + 1}`,
  cacheKey: `acceptance-${index + 1}`
}, request));
assert(resolvedAssets.every(Boolean));

const voiceInputSignature = voiceModel.inputSignature({
  brief,
  scenePlan: planned.value,
  voiceId: "acceptance-voice"
});
const voiceResult = voiceModel.normalizeResult({
  id: "voice-acceptance",
  provider: "acceptance-voice",
  inputSignature: voiceInputSignature,
  segments: planned.value.scenes.map((scene, index) => ({
    id: scene.id,
    sceneId: scene.id,
    text: scene.narration,
    audioPath: `C:/automation-acceptance/voice-${index + 1}.wav`,
    duration: scene.durationHintSec,
    provider: "acceptance-voice"
  }))
});
assert(voiceResult);
assert.strictEqual(voiceResult.segments.length, planned.value.scenes.length);
assert.strictEqual(voiceModel.isCurrent(voiceResult, {
  brief,
  scenePlan: planned.value,
  voiceId: "acceptance-voice"
}), true);

const composition = compositionModel.buildCompositionPlan({
  brief,
  scenePlan: planned.value,
  resolvedAssets,
  staleAssetIds: [],
  voiceResult,
  now: Date.UTC(2026, 9, 11, 10, 3, 0)
});
assert.strictEqual(composition.ok, true);
assert.strictEqual(composition.value.tracks.video.length, planned.value.scenes.length);
assert.strictEqual(composition.value.tracks.subtitle.length, planned.value.scenes.length);
assert.strictEqual(composition.value.tracks.audio.length, planned.value.scenes.length);
assert(composition.value.outputSignature.startsWith("composition-plan-v1:"));

const automation = automationModel.normalizeAutomationState({
  brief,
  script,
  scenePlan: planned.value,
  assetRequests: requests.value,
  resolvedAssets,
  voiceSettings: { voiceId: "acceptance-voice", provider: "acceptance-voice" },
  voiceResult,
  composition: composition.value,
  stale: { script: false, scenes: false, assets: [], composition: false }
});

const snapshot = projectSnapshot.buildSnapshot({
  page: "automation",
  projectName: "Automation acceptance",
  automation,
  jobs: [],
  output: "C:/automation-acceptance/output"
}, {}, null, Date.UTC(2026, 9, 11, 10, 4, 0));
assert(snapshot, "Automation-only project must persist without requiring an imported source video");
assert.strictEqual(snapshot.automation.scenePlan.scenes.length, planned.value.scenes.length);
assert.strictEqual(snapshot.automation.resolvedAssets.length, resolvedAssets.length);
assert.strictEqual(snapshot.automation.voiceResult.segments.length, voiceResult.segments.length);
assert.strictEqual(snapshot.automation.composition.tracks.audio.length, planned.value.scenes.length);

const restored = projectSnapshot.toLegacyState(snapshot, { page: "download", jobs: [] });
assert(restored.automation, "Automation subtree must restore into app state");
assert.strictEqual(restored.automation.composition.outputSignature, composition.value.outputSignature);

const editedBrief = automationModel.withContentBrief(automation, {
  ...brief,
  topic: "Automation acceptance edited"
}, { now: Date.UTC(2026, 9, 11, 10, 5, 0) });
assert.strictEqual(editedBrief.ok, true);
assert.strictEqual(editedBrief.automation.stale.script, true, "Editing upstream brief must invalidate Script");
assert.strictEqual(editedBrief.automation.stale.scenes, true, "Editing upstream brief must invalidate Scenes");
assert.strictEqual(editedBrief.automation.stale.composition, true, "Editing upstream brief must invalidate Composition");
assert.strictEqual(editedBrief.automation.script.id, script.id, "Accepted Script must remain available for inspection after becoming stale");

const controller = read("renderer/core-automation-mvp-controller.js");
const recovery = read("renderer/core-automation-recovery.js");
const compositionExport = read("renderer/core-automation-composition-export.js");
const studioProjection = read("renderer/core-automation-studio-projection.js");
const index = read("renderer/index.html");
const roadmap = read("docs/PHASE_ROADMAP.md");
const finalReport = read("docs/FINAL_AUTOMATION_MVP_REPORT.md");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "generateScript",
  "generatePlan",
  "resolveAll",
  "ViralAutomationVoiceState?.generate",
  "ViralAutomationCompositionState?.compose",
  "ViralAutomationStudioProjection?.openStudio",
  "retry",
  "cancel"
]) assert(controller.includes(required), `MVP controller missing acceptance contract: ${required}`);

for (const required of [
  "recoverInterruptedScriptJob",
  "validateLocalAssets",
  "validateLocalAudio",
  "validateExportOutputs",
  "failureCode = \"INTERRUPTED\"",
  "retryable = true"
]) assert(recovery.includes(required), `Recovery missing acceptance contract: ${required}`);

for (const required of [
  "DUPLICATE_ACTIVE",
  "LOW_DISK_SPACE",
  "removePartial(outputPath)",
  "cancelCompositionExport",
  "uniqueOutputPath"
]) assert(compositionExport.includes(required), `Composition export missing acceptance guard: ${required}`);

for (const required of [
  "data-automation-studio-back",
  "video.currentTime",
  "isAutomationCompositionPreview"
]) assert(studioProjection.includes(required), `Studio projection missing acceptance invariant: ${required}`);

for (const required of [
  'src="core-automation-mvp-controller.js"',
  'src="core-automation-recovery.js"',
  'src="core-automation-studio-projection.js"',
  'src="core-automation-composition-export.js"'
]) assert(index.includes(required), `Renderer missing final Automation module: ${required}`);

assert(roadmap.includes("Final Automation MVP Report"));
assert(finalReport.includes("A8: BLOCKED UNTIL EXPLICIT APPROVAL"));
assert(finalReport.includes("Packaged Windows runtime: PENDING"));
assert(finalReport.includes("Final desktop acceptance checklist"));
assert(pkg.scripts["test:core-automation-mvp-acceptance"], "package.json must expose final Automation MVP acceptance gate");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-mvp-acceptance"), "commercial regression must include final Automation MVP acceptance gate");

console.log("Automation MVP domain flow, persistence, stale propagation, recovery, Studio projection and export acceptance contracts passed.");
