"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const automation = require("../renderer/core-automation-model");
const snapshotModel = require("../renderer/core-project-snapshot");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const stateBridge = fs.readFileSync(path.join(root, "renderer", "core-automation-state.js"), "utf8");
const architecture = fs.readFileSync(path.join(root, "docs", "ARCHITECTURE_V2.md"), "utf8");
const engine = fs.readFileSync(path.join(root, "docs", "AUTOMATION_ENGINE.md"), "utf8");
const roadmap = fs.readFileSync(path.join(root, "docs", "PHASE_ROADMAP.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.strictEqual(automation.AUTOMATION_SCHEMA_VERSION, 1);
assert.strictEqual(automation.CONTENT_BRIEF_VERSION, 1);
assert.strictEqual(snapshotModel.CURRENT_SCHEMA_VERSION, 2);

const invalid = automation.createContentBrief({ topic: " ", product: "" }, { now: 0 });
assert.strictEqual(invalid.ok, false, "brief must require a topic or product");
assert(invalid.errors.some(error => error.code === "BRIEF_SUBJECT_REQUIRED"));

const created = automation.createContentBrief({
  topic: "  Cách phối đồ nam mùa thu  ",
  objective: "Tạo video short dễ xem",
  audience: "Nam 18-28",
  platform: "tiktok",
  aspectRatio: "9:16",
  targetDurationSec: 35.4,
  language: "VI",
  tone: "tự nhiên",
  callToAction: "Theo dõi để xem phần tiếp theo",
  constraints: ["Không watermark", "Không watermark", "Nhịp nhanh"]
}, { now: Date.UTC(2026, 9, 10, 6, 0, 0) });

assert.strictEqual(created.ok, true);
assert.strictEqual(created.value.topic, "Cách phối đồ nam mùa thu");
assert.strictEqual(created.value.language, "vi");
assert.strictEqual(created.value.targetDurationSec, 35);
assert.deepStrictEqual(created.value.constraints, ["Không watermark", "Nhịp nhanh"]);
assert(created.value.id.startsWith("brief-"));
assert(created.value.inputSignature.startsWith("brief-v1:"));

const sameSemanticBrief = automation.createContentBrief({
  topic: "Cách phối đồ nam mùa thu",
  objective: "Tạo video short dễ xem",
  audience: "Nam 18-28",
  platform: "tiktok",
  aspectRatio: "9:16",
  targetDurationSec: 35,
  language: "vi",
  tone: "tự nhiên",
  callToAction: "Theo dõi để xem phần tiếp theo",
  constraints: ["Không watermark", "Nhịp nhanh"]
}, { now: Date.UTC(2026, 9, 11, 6, 0, 0) });
assert.strictEqual(created.signature, sameSemanticBrief.signature, "timestamps must not change semantic brief identity");

const previousAutomation = automation.emptyAutomationState();
previousAutomation.brief = created.value;
previousAutomation.script = { id: "script-1", body: "old" };
previousAutomation.scenePlan = { id: "scene-plan-1" };
previousAutomation.resolvedAssets = [{ id: "asset-1" }, { id: "asset-2" }];
previousAutomation.composition = { id: "composition-1" };

const changed = automation.withContentBrief(previousAutomation, {
  topic: "Một chủ đề hoàn toàn mới",
  aspectRatio: "9:16",
  targetDurationSec: 30,
  language: "vi"
}, { now: Date.UTC(2026, 9, 10, 7, 0, 0) });
assert.strictEqual(changed.ok, true);
assert.strictEqual(changed.automation.stale.script, true);
assert.strictEqual(changed.automation.stale.scenes, true);
assert.deepStrictEqual(changed.automation.stale.assets, ["asset-1", "asset-2"]);
assert.strictEqual(changed.automation.stale.composition, true);

const automationOnlyState = {
  page: "download",
  output: "",
  jobs: [],
  speech: { mode: "local", language: "auto", job: null, result: null },
  translation: { mode: "cloud", targetLanguage: "en", preserveTone: true, job: null, result: null },
  voice: { mode: "cloud", assignments: {}, job: null, result: null },
  renderOptions: { burnSubtitles: true, mixOriginalAudio: true, originalAudioVolume: 0.12 },
  automation: changed.automation
};
const automationProject = snapshotModel.buildSnapshot(automationOnlyState, { page: "download" }, null, Date.UTC(2026, 9, 10, 8, 0, 0));
assert(automationProject, "automation brief must be able to own a project before source video exists");
assert.strictEqual(automationProject.source, null);
assert.strictEqual(automationProject.projectId, changed.value.id);
assert.strictEqual(automationProject.projectName, "Một chủ đề hoàn toàn mới");
assert.strictEqual(automationProject.automation.brief.inputSignature, changed.signature);

const legacyProjection = snapshotModel.toLegacyState(automationProject, { locale: "vi" });
assert.strictEqual(legacyProjection.locale, "vi");
assert.strictEqual(legacyProjection.automation.brief.id, changed.value.id);

const restored = snapshotModel.migrateSnapshot(JSON.parse(JSON.stringify(automationProject)));
assert(restored.snapshot);
assert.strictEqual(restored.snapshot.automation.brief.id, changed.value.id);
assert.strictEqual(restored.snapshot.source, null);

assert(index.includes('src="core-automation-model.js"'));
assert(index.includes('src="core-automation-state.js"'));
assert(index.indexOf('src="core-automation-model.js"') < index.indexOf('src="core-project-snapshot.js"'));
assert(index.indexOf('src="app.js"') < index.indexOf('src="core-automation-state.js"'));

for (const required of [
  "window.ViralAutomationState",
  "setBrief",
  "automation-brief-updated",
  "ViralCoreProjectPersistence",
  "automationFoundation"
]) {
  assert(stateBridge.includes(required), "automation state bridge is missing: " + required);
}
assert(!stateBridge.includes("fetch("), "A1 must not start provider/network business logic");
assert(!stateBridge.includes("desktopAPI"), "A1 must not add provider IPC yet");

for (const [name, doc] of [["architecture", architecture], ["engine", engine], ["roadmap", roadmap]]) {
  assert(doc.includes("MoneyPrinterTurbo"), name + " doc must preserve the reference-only context");
  assert(doc.includes("ContentBrief"), name + " doc must describe the first Automation domain object");
}
assert(architecture.includes("One Project Model"));
assert(architecture.includes("One Editor"));
assert(architecture.includes("One Playback Clock"));
assert(architecture.includes("One Job System"));
assert(engine.includes("AssetRouter"));
assert(roadmap.includes("No AI-video provider"));

assert(pkg.scripts["test:core-automation-foundation"], "package.json must expose the Automation Foundation regression");

console.log("Automation Foundation ContentBrief domain, project ownership, persistence contracts and architecture gate passed.");
