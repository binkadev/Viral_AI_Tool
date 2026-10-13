"use strict";

const assert = require("assert");
const model = require("../renderer/core-scene-plan-model");

assert.strictEqual(model.SCENE_PLAN_SCHEMA_VERSION, 1);
assert.strictEqual(model.MAX_SCENES, 2000);
assert(model.PLANNER_STATES.includes("planning"));
assert(model.PLANNER_STATES.includes("interrupted"));
assert(model.LOCKABLE_FIELDS.includes("visualIntent"));

const source = {
  sourcePath: "C:/video.mp4",
  segments: [
    { id: "s1", start: 0, end: 2, text: "A lion approaches the river." },
    { id: "s2", start: 2.1, end: 4.8, text: "It pauses near the water." },
    { id: "s3", start: 5, end: 7.4, text: "A crocodile remains hidden below." },
    { id: "s4", start: 10.2, end: 12.8, text: "The lion suddenly steps back." }
  ]
};

const signature = model.sourceSignature(source);
assert(signature.startsWith("scene-source-v1:"));
assert.strictEqual(signature, model.sourceSignature(JSON.parse(JSON.stringify(source))), "same transcript must have a stable signature");
assert.notStrictEqual(
  signature,
  model.sourceSignature({ ...source, segments: source.segments.map((segment, index) => index === 1 ? { ...segment, text: "Edited source" } : segment) }),
  "source text edits must invalidate the scene-plan signature"
);

const plan = model.createPlanFromTranscript(source, {
  sourceIdentity: "source-1",
  minDuration: 2,
  targetDuration: 5,
  maxDuration: 8,
  maxGap: 1.25,
  now: Date.UTC(2026, 9, 13, 8, 0, 0)
});

assert.strictEqual(plan.schemaVersion, 1);
assert.strictEqual(plan.sourceType, "transcript");
assert.strictEqual(plan.sourceIdentity, "source-1");
assert.strictEqual(plan.sourceSignature, signature);
assert.strictEqual(plan.status, "ready");
assert(plan.scenes.length >= 2, "meaningful transcript gap should produce multiple deterministic scenes");
assert.strictEqual(plan.selectedSceneId, plan.scenes[0].id);
assert.strictEqual(plan.scenes[0].provenance.origin, "deterministic");
assert.strictEqual(plan.scenes[0].visualIntent, null, "deterministic fallback must not invent creative direction");
assert.deepStrictEqual(plan.scenes[0].searchQueries, [], "deterministic fallback must not fabricate search queries");
assert.strictEqual(plan.scenes[0].generationPrompt, null);
assert.deepStrictEqual(plan.scenes[0].targetKinds, ["video"]);

const ownedIds = plan.scenes.flatMap(scene => scene.sourceSegmentIds);
assert.deepStrictEqual(ownedIds, source.segments.map(segment => segment.id), "every transcript segment must belong to exactly one scene");
assert.strictEqual(new Set(ownedIds).size, ownedIds.length, "deterministic segmentation must not duplicate source ownership");

for (let index = 0; index < plan.scenes.length; index += 1) {
  const scene = plan.scenes[index];
  assert.strictEqual(scene.order, index);
  assert(scene.end >= scene.start);
  assert.strictEqual(scene.duration, scene.end - scene.start);
  assert(scene.id.startsWith("scene:"));
}

const edited = model.updateScene(plan, plan.scenes[0].id, {
  visualIntent: "Tense wildlife close-up near the river",
  searchQueries: ["lion river close up", "lion drinking water", "lion river close up"],
  generationPrompt: "A tense documentary close-up of a lion beside a river.",
  orientation: "portrait",
  shotType: "close-up",
  motion: "slow push-in",
  mood: "suspense",
  lockedFields: ["visualIntent", "searchQueries", "generationPrompt", "motion"]
}, Date.UTC(2026, 9, 13, 8, 5, 0));
const editedScene = edited.scenes[0];
assert.strictEqual(editedScene.sceneState, "locked");
assert.strictEqual(editedScene.provenance.origin, "manual");
assert.strictEqual(editedScene.visualIntent, "Tense wildlife close-up near the river");
assert.deepStrictEqual(editedScene.searchQueries, ["lion river close up", "lion drinking water"], "queries must be normalized and deduplicated");
assert(editedScene.lockedFields.includes("visualIntent"));
assert(editedScene.lockedFields.includes("motion"));
assert.strictEqual(editedScene.id, plan.scenes[0].id, "manual edit must not replace stable scene identity");
assert.strictEqual(editedScene.createdAt, plan.scenes[0].createdAt, "manual edit must preserve scene creation time");

const changedSource = {
  ...source,
  segments: source.segments.map((segment, index) => index === 2 ? { ...segment, text: segment.text + " It begins to move." } : segment)
};
assert.strictEqual(model.isStale(edited, changedSource), true, "source edits must make accepted plan stale");
assert.strictEqual(model.isStale(edited, source), false);

const interrupted = model.restartSafePlan({
  ...edited,
  plannerJob: {
    id: "planner-job-1",
    status: "planning",
    progress: 62,
    startedAt: "2026-10-13T08:00:00.000Z"
  }
});
assert.strictEqual(interrupted.plannerJob.status, "interrupted", "active planner work must not resurrect after restart");
assert.strictEqual(interrupted.plannerJob.progress, 62);
assert.strictEqual(interrupted.scenes[0].visualIntent, editedScene.visualIntent, "accepted plan must survive interrupted re-planning");

const completed = model.normalizePlan({
  ...edited,
  plannerJob: { status: "completed" }
});
assert.strictEqual(completed.plannerJob.status, "completed");
assert.strictEqual(completed.plannerJob.progress, 100);

const unsafe = model.normalizeScene({
  id: "unsafe-scene",
  start: -10,
  end: -20,
  orientation: "unsupported",
  targetKinds: ["video", "audio", "image"],
  searchQueries: Array.from({ length: 20 }, (_, index) => "query " + index),
  confidence: 10,
  lockedFields: ["visualIntent", "not-a-field"]
});
assert.strictEqual(unsafe.start, 0);
assert.strictEqual(unsafe.end, 0);
assert.strictEqual(unsafe.orientation, "any");
assert.deepStrictEqual(unsafe.targetKinds, ["video", "image"]);
assert.strictEqual(unsafe.searchQueries.length, model.MAX_SEARCH_QUERIES);
assert.strictEqual(unsafe.confidence, 1);
assert.deepStrictEqual(unsafe.lockedFields, ["visualIntent"]);

const duplicateSourceIds = model.normalizeTranscriptSegments({
  segments: [
    { id: "dup", start: 0, end: 1, text: "One" },
    { id: "dup", start: 1, end: 2, text: "Two" },
    { id: "dup~2", start: 2, end: 3, text: "Three" }
  ]
});
assert.strictEqual(duplicateSourceIds.length, 3);
assert.strictEqual(new Set(duplicateSourceIds.map(segment => segment.id)).size, 3, "duplicate upstream segment IDs must be deterministically disambiguated");
const duplicateIdPlan = model.createPlanFromTranscript({ segments: duplicateSourceIds });
assert.strictEqual(duplicateIdPlan.scenes.flatMap(scene => scene.sourceSegmentIds).length, 3, "duplicate provider IDs must not drop source ownership");

const overlapScenes = model.segmentTranscript({
  segments: [
    { id: "outer", start: 0, end: 10, text: "Outer" },
    { id: "inner-1", start: 1, end: 2, text: "Inner one" },
    { id: "inner-2", start: 3, end: 4, text: "Inner two" }
  ]
}, { minDuration: 12, targetDuration: 20, maxDuration: 30, maxGap: 5 });
assert.strictEqual(overlapScenes.length, 1);
assert.strictEqual(overlapScenes[0].end, 10, "scene end must cover the furthest end of every owned overlapping segment");
assert.strictEqual(overlapScenes[0].duration, 10);

const oneLargeGroup = model.segmentTranscript({
  segments: Array.from({ length: 600 }, (_, index) => ({
    id: "same-time-" + index,
    start: 0,
    end: 0,
    text: "Beat " + index
  }))
});
assert.strictEqual(oneLargeGroup.length, 1);
assert.strictEqual(oneLargeGroup[0].sourceSegmentIds.length, 600, "a valid scene group must retain ownership beyond the old 500-id cap");
assert.strictEqual(new Set(oneLargeGroup[0].sourceSegmentIds).size, 600);

const overSceneCapacity = {
  segments: Array.from({ length: model.MAX_SCENES + 1 }, (_, index) => ({
    id: "gapped-" + index,
    start: index * 10,
    end: index * 10 + 1,
    text: "Separated beat " + index
  }))
};
const compactedScenes = model.segmentTranscript(overSceneCapacity, { maxGap: 1.25 });
const compactedOwned = compactedScenes.flatMap(scene => scene.sourceSegmentIds);
assert.strictEqual(compactedScenes.length, model.MAX_SCENES, "scene capacity must compact rather than truncate valid source groups");
assert.strictEqual(compactedOwned.length, model.MAX_SCENES + 1, "scene compaction must preserve every source segment");
assert.strictEqual(compactedOwned[compactedOwned.length - 1], "gapped-" + model.MAX_SCENES);
assert.strictEqual(new Set(compactedOwned).size, model.MAX_SCENES + 1);

const longSource = {
  segments: Array.from({ length: 1800 }, (_, index) => ({
    id: "long-" + index,
    start: index * 3,
    end: (index + 1) * 3,
    text: "Segment " + index
  }))
};
const longSegments = model.normalizeTranscriptSegments(longSource);
assert.strictEqual(longSegments.length, 1800, "long transcript normalization must not impose demo-sized truncation");
const longScenes = model.segmentTranscript(longSegments, {
  minDuration: 2,
  targetDuration: 6,
  maxDuration: 9,
  maxGap: 1.25
});
assert(longScenes.length > 100, "long transcript must produce the complete scene sequence, not a demo subset");
assert(longScenes.length <= model.MAX_SCENES, "project scene plan must enforce its explicit commercial capacity");
const longOwned = longScenes.flatMap(scene => scene.sourceSegmentIds);
assert.strictEqual(longOwned[0], "long-0");
assert.strictEqual(longOwned[longOwned.length - 1], "long-1799", "long-form segmentation must retain the final transcript segment");
assert.strictEqual(longOwned.length, 1800, "long-form segmentation must own every source segment exactly once");
assert.strictEqual(new Set(longOwned).size, 1800, "long-form segmentation must not duplicate source ownership");

console.log("Scene Planner schema, deterministic segmentation, source ownership, staleness, manual locks and restart safety tests passed.");
