"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const planner = require("../renderer/core-automation-scene-planner");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const stateSource = read("renderer/core-automation-scene-state.js");
const uiSource = read("renderer/core-automation-scenes-ui.js");
const uiCss = read("renderer/core-automation-scenes-ui.css");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

assert.strictEqual(planner.VERSION, 1);
assert.strictEqual(planner.TARGET_SCENE_SEC, 4.5);
assert(planner.MAX_SCENES >= 10);

const brief = {
  topic: "5 cách phối đồ nam phong cách Hàn",
  product: "",
  targetDurationSec: 30,
  aspectRatio: "9:16",
  platform: "tiktok",
  language: "vi"
};
const script = {
  id: "script-demo",
  outputSignature: "script-v1:demo",
  narrationText: "Bạn mặc đúng nhưng vẫn chưa nổi bật? Bắt đầu với một chiếc áo vừa form. Giữ bảng màu gọn và dễ phối. Thêm một lớp ngoài để tạo chiều sâu. Chọn giày đơn giản để tổng thể sạch hơn. Cuối cùng, chỉ giữ một điểm nhấn. Theo dõi để xem phần tiếp theo."
};

const result = planner.planScenes({ brief, script, now: Date.UTC(2026, 9, 10, 10, 0, 0) });
assert.strictEqual(result.ok, true);
assert(result.value);
assert.strictEqual(result.value.inputSignature, script.outputSignature);
assert(result.value.outputSignature.startsWith("scene-plan-v1:"));
assert(result.value.scenes.length >= 4, "30-second narration should split into multiple editable scenes");
assert(result.value.scenes.length <= planner.MAX_SCENES);
assert.strictEqual(result.value.scenes[0].order, 1);
assert.strictEqual(result.value.scenes[0].startHintSec, 0);
assert(result.value.scenes.every(scene => scene.id.startsWith("scene-")));
assert(result.value.scenes.every(scene => scene.durationHintSec >= planner.MIN_SCENE_SEC));
assert(result.value.scenes.every(scene => Array.isArray(scene.searchTerms) && scene.searchTerms.length > 0));
assert(result.value.scenes.every(scene => scene.assetStrategy === "stock"));
assert(result.value.scenes[0].visualIntent.toLowerCase().includes("opening"));
assert(result.value.scenes[result.value.scenes.length - 1].visualIntent.toLowerCase().includes("closing"));

const last = result.value.scenes[result.value.scenes.length - 1];
const coveredDuration = Number((last.startHintSec + last.durationHintSec).toFixed(2));
assert(Math.abs(coveredDuration - brief.targetDurationSec) <= 0.02, "scene timing must cover the target duration");

const repeated = planner.planScenes({ brief, script, now: Date.UTC(2026, 9, 10, 10, 5, 0) });
assert.deepStrictEqual(
  repeated.value.scenes.map(scene => scene.id),
  result.value.scenes.map(scene => scene.id),
  "scene IDs must remain stable for the same script"
);
assert.strictEqual(repeated.value.outputSignature, result.value.outputSignature, "timestamps must not change scene semantic identity");

const changedScript = { ...script, outputSignature: "script-v1:changed", narrationText: script.narrationText + " Đây là một ý mới." };
const changed = planner.planScenes({ brief, script: changedScript, now: 0 });
assert.notStrictEqual(changed.value.outputSignature, result.value.outputSignature);

assert.strictEqual(planner.planScenes({ brief, script: { outputSignature: "x", narrationText: "" } }).ok, false);
assert.strictEqual(planner.planScenes({ brief, script: { narrationText: "Có nội dung" } }).ok, false);

for (const required of [
  "function acceptPlan",
  "function generatePlan",
  "function editScene",
  "markAssetsAndCompositionStale(current)",
  'current.automation.stale.scenes = false',
  'emit("automation-scene-plan-accepted")',
  'emit("automation-scene-edited")'
]) {
  assert(stateSource.includes(required), "Scene state bridge missing: " + required);
}

for (const required of [
  "automationGenerateScenes",
  "automationSceneQuickAction",
  "automationSceneQuickButton",
  "function ensureQuickAction()",
  "function scrollToScenes()",
  "data-scene-save",
  "ViralAutomationSceneState?.generatePlan",
  "ViralAutomationSceneState?.editScene",
  "automation-scenes-list",
  "function ensureHost()",
  'legacyNext.replaceWith(host)',
  'host.dataset.scenePlannerMount = "true"',
  'new MutationObserver(queueScan).observe(page, { childList: true, subtree: true })',
  "automationScenePlanner",
  "ViralAutomationScenesUi"
]) {
  assert(uiSource.includes(required), "Scene Planner UI missing: " + required);
}
assert(!uiSource.includes("setInterval("), "Scene Planner UI must remain event-driven.");
assert(!uiSource.includes("fetch("), "Scene Planner MVP must not require a provider or network call.");
assert(uiCss.includes(".automation-scene-quick"));
assert(uiCss.includes(".automation-scenes-list"));
assert(uiCss.includes(".automation-scene-card"));

for (const required of [
  'href="core-automation-scenes-ui.css"',
  'src="core-automation-scene-planner.js"',
  'src="core-automation-scene-state.js"',
  'src="core-automation-scenes-ui.js"'
]) {
  assert(index.includes(required), "Renderer missing Scene Planner asset: " + required);
}
assert(index.indexOf('src="core-automation-scene-planner.js"') < index.indexOf('src="core-automation-scene-state.js"'));
assert(index.indexOf('src="core-automation-scene-state.js"') < index.indexOf('src="core-automation-scenes-ui.js"'));

assert(pkg.scripts["test:core-automation-scene-planner"], "package.json must expose Scene Planner regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-scene-planner"), "commercial regression must gate Scene Planner");

console.log("Automation Scene Planner deterministic timing, editable scenes, stable IDs, stale propagation, resilient mount and above-fold action tests passed.");
