"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sceneModel = require("../renderer/core-scene-plan-model");
const snapshotModel = require("../renderer/core-project-snapshot");

const root = path.resolve(__dirname, "..");
const persistence = fs.readFileSync(path.join(root, "renderer", "core-project-persistence.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.strictEqual(snapshotModel.CURRENT_SCHEMA_VERSION, 3, "Scene Planner persistence must advance project schema to v3");

const sourcePath = "C:/media/Wildlife.mp4";
const transcript = {
  sourcePath,
  text: "A lion approaches the river. A crocodile waits below.",
  segments: [
    { id: "s1", start: 0, end: 3, text: "A lion approaches the river." },
    { id: "s2", start: 3, end: 6, text: "A crocodile waits below." }
  ]
};
const scenePlan = sceneModel.createPlanFromTranscript(transcript, {
  sourceIdentity: "source-1",
  now: Date.UTC(2026, 9, 13, 9, 0, 0)
});
const editedPlan = sceneModel.updateScene(scenePlan, scenePlan.scenes[0].id, {
  visualIntent: "Tense wildlife documentary shot",
  searchQueries: ["lion river wildlife"],
  lockedFields: ["visualIntent", "searchQueries"]
}, Date.UTC(2026, 9, 13, 9, 5, 0));

const appState = {
  page: "ai-video",
  jobs: [{
    id: "source-1",
    name: "Wildlife.mp4",
    sourcePath,
    fileState: "available",
    status: "completed",
    meta: { duration: 60, width: 1920, height: 1080 }
  }],
  media: { schemaVersion: 1, assets: [], selectedAssetId: null },
  scenePlan: editedPlan,
  speech: { mode: "local", language: "en", job: null, result: transcript },
  translation: { mode: "cloud", targetLanguage: "vi", preserveTone: true, job: null, result: null },
  voice: { mode: "cloud", assignments: {}, job: null, result: null },
  renderOptions: { burnSubtitles: true, mixOriginalAudio: true, originalAudioVolume: 0.12 },
  jobs: [{ id: "source-1", name: "Wildlife.mp4", sourcePath, fileState: "available", status: "completed" }]
};

const snapshot = snapshotModel.buildSnapshot(appState, {}, null, Date.UTC(2026, 9, 13, 9, 10, 0));
assert(snapshot, "project with a source must produce a snapshot");
assert.strictEqual(snapshot.schemaVersion, 3);
assert.strictEqual(snapshot.scenePlan.scenes.length, editedPlan.scenes.length);
assert.strictEqual(snapshot.scenePlan.scenes[0].visualIntent, "Tense wildlife documentary shot");
assert.deepStrictEqual(snapshot.scenePlan.scenes[0].lockedFields, ["visualIntent", "searchQueries"]);
assert.strictEqual(snapshot.scenePlan.sourceSignature, editedPlan.sourceSignature);

const legacyProjection = snapshotModel.toLegacyState(snapshot, { locale: "vi" });
assert.strictEqual(legacyProjection.locale, "vi");
assert.strictEqual(legacyProjection.scenePlan.scenes[0].visualIntent, "Tense wildlife documentary shot", "legacy runtime projection must retain the project-owned scene plan");

const reopened = snapshotModel.migrateSnapshot(JSON.parse(JSON.stringify(snapshot)), { restartSafeScenePlan: true });
assert.strictEqual(reopened.migrated, false, "stable completed scene plans must reopen without semantic migration");
assert.strictEqual(reopened.snapshot.scenePlan.scenes[0].visualIntent, "Tense wildlife documentary shot");

const planningSnapshot = JSON.parse(JSON.stringify(snapshot));
planningSnapshot.scenePlan.plannerJob = {
  id: "planner-job-1",
  status: "planning",
  progress: 48,
  startedAt: "2026-10-13T09:11:00.000Z"
};
const interrupted = snapshotModel.migrateSnapshot(planningSnapshot, { restartSafeScenePlan: true });
assert.strictEqual(interrupted.snapshot.scenePlan.plannerJob.status, "interrupted", "active planner jobs must become interrupted after restart");
assert.strictEqual(interrupted.snapshot.scenePlan.plannerJob.progress, 48);
assert.strictEqual(interrupted.migrated, true, "restart-safe planner normalization must be durably backfilled");
assert.strictEqual(interrupted.snapshot.scenePlan.scenes[0].visualIntent, "Tense wildlife documentary shot", "accepted scene data must survive interrupted replanning");

const v2 = { ...snapshot, schemaVersion: 2 };
delete v2.scenePlan;
const migratedV2 = snapshotModel.migrateSnapshot(v2);
assert.strictEqual(migratedV2.migrated, true);
assert.strictEqual(migratedV2.snapshot.schemaVersion, 3);
assert.strictEqual(migratedV2.snapshot.scenePlan.status, "empty");
assert.deepStrictEqual(migratedV2.snapshot.scenePlan.scenes, [], "v2 migration must not invent scenes");
assert.strictEqual(migratedV2.snapshot.scenePlan.createdAt, null, "empty migrated scene plan must remain semantically stable");
assert.strictEqual(migratedV2.snapshot.scenePlan.updatedAt, null);

const v1 = { ...snapshot, schemaVersion: 1 };
delete v1.scenePlan;
delete v1.media;
const migratedV1 = snapshotModel.migrateSnapshot(v1);
assert.strictEqual(migratedV1.snapshot.schemaVersion, 3);
assert.deepStrictEqual(migratedV1.snapshot.scenePlan.scenes, []);
assert.deepStrictEqual(migratedV1.snapshot.media.assets, []);

const emptyA = sceneModel.normalizePlan({});
const emptyB = sceneModel.normalizePlan({});
assert.deepStrictEqual(emptyA, emptyB, "normalizing an empty plan must not introduce time-based autosave churn");
assert.strictEqual(emptyA.createdAt, null);
assert.strictEqual(emptyA.updatedAt, null);

const laterTimestampOnly = { ...snapshot, updatedAt: "2099-01-01T00:00:00.000Z" };
assert.strictEqual(
  snapshotModel.semanticSignature(laterTimestampOnly),
  snapshotModel.semanticSignature(snapshot),
  "project updatedAt alone must not cause autosave loops"
);

assert(persistence.includes("restartSafeScenePlan: true"), "bootstrap must explicitly request restart-safe Scene Planner normalization");
assert(persistence.includes("if (!current.scenePlan && currentSnapshot.scenePlan)"), "runtime hydration must restore project scenePlan before autosave");
assert(
  persistence.indexOf("hydrateRetainedState();") < persistence.indexOf("const next = model.buildSnapshot(current, editorState(current), currentSnapshot)"),
  "scene plan hydration must happen before snapshot rebuild"
);

assert(index.includes('src="core-scene-plan-model.js"'), "Scene Planner model must load in renderer runtime");
assert(
  index.indexOf('src="core-scene-plan-model.js"') < index.indexOf('src="core-project-snapshot.js"'),
  "Scene Planner normalization must load before project snapshot restoration"
);

console.log("Scene Planner schema-v3 migration, reopen, interruption, hydration and autosave stability tests passed.");
