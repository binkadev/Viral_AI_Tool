"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const automationModel = require("../renderer/core-automation-model");
const voiceModel = require("../renderer/core-automation-voice-model");
const compositionModel = require("../renderer/core-automation-composition-model");
const preview = require("../services/automation/composition-preview");
const devVoice = require("../services/automation/dev-voice-provider");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

async function run() {
  const scenePlan = {
    id: "scene-plan-test",
    outputSignature: "scene-plan-v1:test",
    scenes: [
      { id: "scene-1", order: 1, narration: "Mở đầu video", subtitleText: "Mở đầu video", durationHintSec: 3 },
      { id: "scene-2", order: 2, narration: "Nội dung tiếp theo", subtitleText: "Nội dung tiếp theo", durationHintSec: 4 }
    ]
  };
  const brief = { language: "vi", aspectRatio: "9:16", targetDurationSec: 7 };
  const signature = voiceModel.inputSignature({ brief, scenePlan, voiceId: "default" });
  assert(signature.startsWith("automation-voice-input-v1:"));
  assert.strictEqual(signature, voiceModel.inputSignature({ brief, scenePlan, voiceId: "default" }));
  const editedPlan = JSON.parse(JSON.stringify(scenePlan));
  editedPlan.scenes[0].narration = "Lời đọc đã sửa";
  assert.notStrictEqual(signature, voiceModel.inputSignature({ brief, scenePlan: editedPlan, voiceId: "default" }), "narration edits must invalidate old voice audio");

  const wav = devVoice.wavBuffer(1.25, "scene-1");
  assert.strictEqual(wav.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(wav.toString("ascii", 8, 12), "WAVE");
  assert(wav.length > 44);

  const previousDevFlag = process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER;
  delete process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER;
  assert.strictEqual(devVoice.status().ready, false);
  process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER = "1";
  assert.strictEqual(devVoice.status().provider, "dev-tone");
  assert.strictEqual(devVoice.status().networkUsed, false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-automation-voice-"));
  const generated = await devVoice.startDevVoice({
    operationId: "voice-test-1234",
    inputSignature: signature,
    outputRoot: path.join(tempRoot, "voice"),
    segments: voiceModel.segmentsFromScenePlan(scenePlan)
  });
  assert.strictEqual(generated.cancelled, false);
  assert.strictEqual(generated.result.segments.length, 2);
  assert.strictEqual(generated.result.developmentPreview, true);
  for (const segment of generated.result.segments) {
    assert(fs.existsSync(segment.audioPath));
    assert.strictEqual(path.extname(segment.audioPath), ".wav");
  }

  const normalizedAutomation = automationModel.normalizeAutomationState({
    brief: { topic: "Demo", language: "vi", aspectRatio: "9:16", targetDurationSec: 7 },
    scenePlan,
    voiceSettings: { voiceId: "default", provider: "dev-tone" },
    voiceResult: generated.result,
    stale: {}
  });
  assert.strictEqual(normalizedAutomation.voiceSettings.provider, "dev-tone");
  assert.strictEqual(normalizedAutomation.voiceResult.segments.length, 2, "Automation snapshot normalization must preserve A1 voice result");

  const video1 = path.join(tempRoot, "scene-1.mp4");
  const video2 = path.join(tempRoot, "scene-2.mp4");
  fs.writeFileSync(video1, Buffer.from("video-one"));
  fs.writeFileSync(video2, Buffer.from("video-two"));
  const resolvedAssets = [
    { id: "asset-1", sceneId: "scene-1", localPath: video1, durationSec: 3, checksum: "a", requestSignature: "r1" },
    { id: "asset-2", sceneId: "scene-2", localPath: video2, durationSec: 4, checksum: "b", requestSignature: "r2" }
  ];
  const composition = compositionModel.buildCompositionPlan({
    brief,
    scenePlan,
    resolvedAssets,
    staleAssetIds: [],
    voiceResult: generated.result,
    now: Date.UTC(2026, 9, 11)
  });
  assert.strictEqual(composition.ok, true);
  assert.strictEqual(composition.value.tracks.video.length, 2);
  assert.strictEqual(composition.value.tracks.audio.length, 2, "current voice result must project into A1 clips");
  assert.strictEqual(composition.value.voiceResultId, generated.result.id);

  const normalizedPreview = preview.normalizePayload({ composition: composition.value });
  assert.strictEqual(normalizedPreview.audio.length, 2, "Studio derived preview must accept A1 sources");
  assert(preview.cacheName(normalizedPreview).startsWith("composition-preview-"));

  const providerSource = read("services/automation/dev-voice-provider.js");
  const ipc = read("services/automation/voice-desktop-ipc.js");
  const preload = read("preload.js");
  const mainEntry = read("main-entry.js");
  const stateSource = read("renderer/core-automation-voice-state.js");
  const ui = read("renderer/core-automation-voice-ui.js");
  const compositionState = read("renderer/core-automation-composition-state.js");
  const previewSource = read("services/automation/composition-preview.js");
  const index = read("renderer/index.html");
  const css = read("renderer/core-automation-voice-ui.css");
  const pkg = JSON.parse(read("package.json"));

  for (const required of [
    "VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER",
    "developmentPreview: true",
    "networkUsed: false",
    "cancelDevVoice",
    "cancelAllDevVoice",
    "RIFF",
    "WAVE"
  ]) assert(providerSource.includes(required), "Dev voice provider missing: " + required);

  for (const required of [
    "automation:voice-status",
    "automation:voice-start",
    "automation:voice-cancel",
    "automation:voice-progress"
  ]) assert(ipc.includes(required), "Automation voice IPC missing: " + required);

  for (const required of [
    "getAutomationVoiceStatus",
    "startAutomationVoice",
    "cancelAutomationVoice",
    "onAutomationVoiceProgress"
  ]) assert(preload.includes(required), "Automation voice preload bridge missing: " + required);

  assert(mainEntry.includes("installAutomationVoiceIpc();"));
  assert(mainEntry.includes("cancelAllAutomationVoice();"));
  assert(stateSource.includes("current.voiceResult = result"));
  assert(stateSource.includes("current.stale.composition = true"));
  assert(compositionState.includes("currentVoiceResult()"));
  assert(compositionState.includes("voiceResult: currentVoiceResult()"));
  assert(previewSource.includes("amix=inputs="), "Studio preview must mix A1 audio into the derived preview");
  assert(previewSource.includes("normalized.audio.length"));

  for (const required of [
    "A1 · Giọng đọc",
    "data-automation-voice-action",
    "Tạo giọng đọc",
    "developmentPreview",
    "ViralAutomationCompositionState?.compose?.()"
  ]) assert(ui.includes(required), "Automation voice UI missing: " + required);

  assert(index.includes('href="core-automation-voice-ui.css"'));
  assert(index.includes('src="core-automation-voice-model.js"'));
  assert(index.includes('src="core-automation-voice-state.js"'));
  assert(index.includes('src="core-automation-voice-ui.js"'));
  assert(index.indexOf('src="core-automation-voice-state.js"') < index.indexOf('src="core-automation-composition-state.js"'));
  assert(css.includes(".automation-voice-panel"));
  assert(css.includes(":focus-visible"));
  assert(pkg.scripts["test:core-automation-voice-track"], "package.json must expose Automation voice regression");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-voice-track"), "commercial suite must gate Automation voice");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (previousDevFlag == null) delete process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER;
  else process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER = previousDevFlag;
  console.log("Automation offline voice provider, persisted VoiceResult, A1 composition, Studio audio preview and export pipeline tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
