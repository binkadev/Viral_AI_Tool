"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sceneModel = require("../renderer/core-scene-plan-model");
const snapshot = require("../renderer/core-project-scene-plan");

assert.strictEqual(snapshot.CURRENT_SCHEMA_VERSION, 3, "scene-plan projects must use snapshot schema v3");

const sourcePath = "C:/media/Wildlife.mp4";
const sourceJob = {
  id: "source-wildlife",
  name: "Wildlife.mp4",
  sourcePath,
  fileState: "available",
  status: "completed",
  meta: { duration: 48, width: 1080, height: 1920 }
};
const transcript = {
  sourcePath,
  segments: [
    { id: "s1", start: 0, end: 4.2, text: "A lion approaches the river." },
    { id: "s2", start: 4.2, end: 8.4, text: "The crocodile stays hidden below." },
    { id: "s3", start: 8.4, end: 13.1, text: "The lion steps closer to the water." }
  ]
};
const acceptedPlan = sceneModel.createPlanFromTranscript(transcript, {
  sourceIdentity: sourceJob.id,
  now: Date.UTC(2026, 9, 13, 8, 0, 0)
});
acceptedPlan.scenes[0] = sceneModel.updateScene(acceptedPlan, acceptedPlan.scenes[0].id, {
  visualIntent: "Tense wildlife close-up near the water",
  lockedFields: ["visualIntent"]
}, Date.UTC(2026, 9, 13, 8, 1, 0)).scenes[0];
acceptedPlan.plannerJob = {
  id: "planner-1",
  status: "planning",
  progress: 61,
  startedAt: "2026-10-13T08:02:00.000Z",
  updatedAt: "2026-10-13T08:03:00.000Z"
};

const liveState = {
  projectName: "Wildlife Story",
  jobs: [sourceJob],
  media: { schemaVersion: 1, assets: [], selectedAssetId: null },
  speech: { mode: "local", language: "en", job: null, result: transcript },
  translation: { mode: "cloud", targetLanguage: "vi", preserveTone: true },
  voice: { mode: "cloud", assignments: {} },
  renderOptions: {},
  scenePlan: acceptedPlan
};

const liveSnapshot = snapshot.buildSnapshot(liveState, {}, null, Date.UTC(2026, 9, 13, 8, 4, 0));
assert(liveSnapshot, "a source-backed project must produce a snapshot");
assert.strictEqual(liveSnapshot.schemaVersion, 3);
assert.strictEqual(liveSnapshot.scenePlan.scenes.length, acceptedPlan.scenes.length);
assert.strictEqual(liveSnapshot.scenePlan.plannerJob.status, "planning", "normal in-session autosave must not interrupt live planner work");
assert(liveSnapshot.scenePlan.scenes[0].lockedFields.includes("visualIntent"), "manual field locks must survive autosave");

const boot = snapshot.migrateSnapshot(liveSnapshot, { restartSafeMedia: true });
assert.strictEqual(boot.snapshot.scenePlan.plannerJob.status, "interrupted", "bootstrap restore must never resurrect stale planner work");
assert.strictEqual(boot.snapshot.scenePlan.plannerJob.progress, 61);
assert.strictEqual(boot.migrated, true, "restart-state normalization must be durably backfilled");
assert.strictEqual(boot.snapshot.scenePlan.scenes[0].visualIntent, "Tense wildlife close-up near the water");
assert(boot.snapshot.scenePlan.scenes[0].lockedFields.includes("visualIntent"));

const projected = snapshot.toLegacyState(boot.snapshot, { locale: "vi", appearance: "midnight" });
assert.strictEqual(projected.locale, "vi");
assert.strictEqual(projected.scenePlan.plannerJob.status, "interrupted");
assert.strictEqual(projected.scenePlan.scenes.length, acceptedPlan.scenes.length, "legacy runtime projection must retain the accepted project plan");

const schemaV2 = {
  ...liveSnapshot,
  schemaVersion: 2
};
delete schemaV2.scenePlan;
const upgradedV2 = snapshot.migrateSnapshot(schemaV2);
assert.strictEqual(upgradedV2.migrated, true, "schema-v2 projects must migrate to scene-plan-aware schema v3");
assert.strictEqual(upgradedV2.snapshot.schemaVersion, 3);
assert.strictEqual(upgradedV2.snapshot.scenePlan.status, "empty", "migration must not invent scenes for older projects");
assert.deepStrictEqual(upgradedV2.snapshot.scenePlan.scenes, []);

const restoredState = {
  ...liveState,
  scenePlan: projected.scenePlan
};
const reopened = snapshot.buildSnapshot(restoredState, {}, boot.snapshot, Date.UTC(2026, 9, 13, 8, 5, 0));
assert.strictEqual(reopened.projectId, liveSnapshot.projectId);
assert.strictEqual(reopened.projectName, liveSnapshot.projectName);
assert.strictEqual(reopened.scenePlan.scenes[0].id, liveSnapshot.scenePlan.scenes[0].id);
assert.strictEqual(reopened.scenePlan.scenes[0].visualIntent, liveSnapshot.scenePlan.scenes[0].visualIntent);

const sameContentLater = { ...reopened, updatedAt: "2099-01-01T00:00:00.000Z" };
assert.strictEqual(
  snapshot.semanticSignature(sameContentLater),
  snapshot.semanticSignature(reopened),
  "snapshot updatedAt must not create an autosave loop"
);

const future = snapshot.migrateSnapshot({ schemaVersion: 99, source: liveSnapshot.source, workflow: liveSnapshot.workflow });
assert.strictEqual(future.snapshot, null);
assert.strictEqual(future.unsupportedVersion, 99, "future project schemas must never be silently downgraded");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "renderer", "core-scene-plan-runtime.js"), "utf8");
assert(index.includes('src="core-scene-plan-model.js"'));
assert(index.includes('src="core-project-scene-plan.js"'));
assert(index.includes('src="core-scene-plan-runtime.js"'));
assert(index.indexOf('src="core-scene-plan-model.js"') < index.indexOf('src="core-project-snapshot.js"'));
assert(index.indexOf('src="core-project-scene-plan.js"') < index.indexOf('src="core-project-persistence.js"'));
assert(index.indexOf('src="app.js"') < index.indexOf('src="core-scene-plan-runtime.js"'));
assert(runtime.includes('current.scenePlan = model.normalizePlan(snapshot.scenePlan || {})'));
assert(runtime.includes('viral-ai:scene-plan-changed'));
assert(runtime.includes('persistence.schedule?.("viral-ai:scene-plan-changed")'));

console.log("Scene Plan snapshot v3 migration, restart safety, runtime hydration and round-trip persistence tests passed.");
