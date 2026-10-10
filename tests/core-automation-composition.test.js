"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const composition = require("../renderer/core-automation-composition-model");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const brief = { aspectRatio: "9:16", targetDurationSec: 12 };
const scenePlan = {
  id: "scene-plan-1",
  outputSignature: "scene-plan-v1:test",
  scenes: [
    { id: "scene-1", order: 1, durationHintSec: 5, narration: "Hook narration", subtitleText: "Hook subtitle", visualIntent: "Opening" },
    { id: "scene-2", order: 2, durationHintSec: 7, narration: "Body narration", subtitleText: "Body subtitle", visualIntent: "Detail" }
  ]
};
const assets = [
  { id: "asset-1", sceneId: "scene-1", requestSignature: "req-1", localPath: "C:/assets/one.mp4", durationSec: 8, checksum: "sha256:1", provider: "dev-stock", providerAssetId: "one" },
  { id: "asset-2", sceneId: "scene-2", requestSignature: "req-2", localPath: "C:/assets/two.mp4", durationSec: 6, checksum: "sha256:2", provider: "dev-stock", providerAssetId: "two" }
];

assert.strictEqual(composition.VERSION, 1);
const built = composition.buildCompositionPlan({ brief, scenePlan, resolvedAssets: assets, now: Date.UTC(2026, 9, 10, 14, 0, 0) });
assert.strictEqual(built.ok, true);
assert.strictEqual(built.value.tracks.video.length, 2);
assert.strictEqual(built.value.tracks.subtitle.length, 2);
assert.strictEqual(built.value.tracks.audio.length, 0);
assert.strictEqual(built.value.tracks.video[0].startSec, 0);
assert.strictEqual(built.value.tracks.video[0].endSec, 5);
assert.strictEqual(built.value.tracks.video[1].startSec, 5);
assert.strictEqual(built.value.tracks.video[1].endSec, 11, "clip must not exceed a shorter source asset");
assert.strictEqual(built.value.durationSec, 11);
assert.strictEqual(built.value.tracks.subtitle[0].text, "Hook subtitle");
assert.strictEqual(built.value.sourceAssets[1].assetId, "asset-2");
assert(built.value.inputSignature.startsWith("composition-input-v1:"));
assert(built.value.outputSignature.startsWith("composition-plan-v1:"));

const repeat = composition.buildCompositionPlan({ brief, scenePlan, resolvedAssets: assets, now: Date.UTC(2026, 9, 11, 14, 0, 0) });
assert.strictEqual(repeat.value.inputSignature, built.value.inputSignature, "timestamps must not affect composition identity");
assert.strictEqual(repeat.value.outputSignature, built.value.outputSignature, "timestamps must not affect composition output identity");

const staleOldAsset = { ...assets[0], id: "asset-old", localPath: "C:/assets/old.mp4", checksum: "sha256:old" };
const withStaleHistory = composition.buildCompositionPlan({
  brief,
  scenePlan,
  resolvedAssets: [staleOldAsset, ...assets],
  staleAssetIds: ["asset-old"],
  now: Date.UTC(2026, 9, 12, 14, 0, 0)
});
assert.strictEqual(withStaleHistory.ok, true);
assert.strictEqual(withStaleHistory.value.inputSignature, built.value.inputSignature, "stale retained asset history must not change current composition identity");
assert.strictEqual(withStaleHistory.value.tracks.video[0].assetId, "asset-1");

const missing = composition.buildCompositionPlan({
  brief,
  scenePlan,
  resolvedAssets: [assets[0]],
  now: Date.UTC(2026, 9, 10, 14, 0, 0)
});
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.errors[0].code, "COMPOSITION_ASSETS_REQUIRED");
assert.deepStrictEqual(missing.errors[0].sceneIds, ["scene-2"]);

const voice = composition.buildCompositionPlan({
  brief,
  scenePlan,
  resolvedAssets: assets,
  voiceResult: { id: "voice-1", segments: [{ sceneId: "scene-1", audioPath: "C:/voice/scene-1.wav" }] }
});
assert.strictEqual(voice.ok, true);
assert.strictEqual(voice.value.tracks.audio.length, 1);
assert.strictEqual(voice.value.tracks.audio[0].startSec, 0);
assert.strictEqual(voice.value.tracks.audio[0].endSec, 5);

const normalized = composition.normalizeCompositionPlan(JSON.parse(JSON.stringify(built.value)));
assert.strictEqual(normalized.id, built.value.id);
assert.strictEqual(normalized.tracks.video.length, 2);

const stateSource = read("renderer/core-automation-composition-state.js");
const uiSource = read("renderer/core-automation-composition-ui.js");
const uiCss = read("renderer/core-automation-composition-ui.css");
const workspace = read("renderer/core-automation-workspace.js");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "readiness",
  "compose",
  "isCurrent",
  "currentInputSignature",
  "automation-composition-built",
  "ViralAutomationCompositionState"
]) assert(stateSource.includes(required), "Composition state bridge missing: " + required);

for (const required of [
  "automation-composition-host",
  "automationBuildComposition",
  "automation-composition-workbench",
  "data-composition-clip",
  "ViralAutomationCompositionState?.compose",
  "ViralAutomationCompositionUi"
]) assert(uiSource.includes(required), "Composition UI missing: " + required);

for (const required of [
  ".automation-composition-workbench",
  ".automation-composition-sequence",
  ".automation-composition-inspector",
  ".automation-composition-strip",
  "@media(max-width:900px)"
]) assert(uiCss.includes(required), "Composition CSS missing: " + required);

assert(workspace.includes("if (stage === 5) return hasResolvedAssets()"));
assert(workspace.includes("function hasComposition()"));
assert(workspace.includes('data-automation-workspace-go="5"'));
assert(workspace.includes("ViralAutomationCompositionUi?.refresh"));
assert(workspace.includes("composition.hidden = activeStage !== 5"));

for (const required of [
  'href="core-automation-composition-ui.css"',
  'src="core-automation-composition-model.js"',
  'src="core-automation-composition-state.js"',
  'src="core-automation-composition-ui.js"'
]) assert(index.includes(required), "Renderer missing Composition module: " + required);
assert(index.indexOf('src="core-automation-composition-model.js"') < index.indexOf('src="core-automation-composition-state.js"'));
assert(index.indexOf('src="core-automation-composition-state.js"') < index.indexOf('src="core-automation-composition-ui.js"'));
assert(index.indexOf('src="core-automation-composition-ui.js"') < index.indexOf('src="core-automation-workspace.js"'));

assert(pkg.scripts["test:core-automation-composition"], "package.json must expose Composition regression.");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-composition"), "commercial regression must gate Composition.");

console.log("Automation CompositionPlan deterministic timing, stale-asset identity, editable track model and stage-5 workspace contracts passed.");
