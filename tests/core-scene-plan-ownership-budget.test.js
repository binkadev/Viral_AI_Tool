"use strict";

const assert = require("assert");
const model = require("../renderer/core-scene-plan-model");

const malformedPlan = {
  sourceType: "transcript",
  sourceIdentity: "source-budget",
  sourceSignature: "scene-source-v1:budget",
  scenes: Array.from({ length: 12 }, (_, sceneIndex) => ({
    id: "scene-budget-" + sceneIndex,
    order: sceneIndex,
    start: sceneIndex * 10,
    end: sceneIndex * 10 + 5,
    sourceSegmentIds: Array.from(
      { length: 600 },
      (_, segmentIndex) => "segment-" + (sceneIndex * 600 + segmentIndex)
    ),
    sourceText: "Scene " + sceneIndex
  }))
};

const normalized = model.normalizePlan(malformedPlan);
const owned = normalized.scenes.flatMap(scene => scene.sourceSegmentIds);

assert.strictEqual(normalized.scenes.length, malformedPlan.scenes.length, "ownership capping must not discard otherwise valid scene records");
assert.strictEqual(owned.length, model.MAX_SOURCE_SEGMENTS, "source ownership must be capped across the whole plan, not per scene");
assert.strictEqual(new Set(owned.map(id => id.toLowerCase())).size, owned.length, "plan-wide ownership must remain case-insensitively unique");
assert.deepStrictEqual(owned.slice(0, 3), ["segment-0", "segment-1", "segment-2"], "ownership retention must remain deterministic");
assert.strictEqual(owned[owned.length - 1], "segment-4999", "the deterministic transcript-wide budget must retain the first 5,000 ownership IDs");

const singleScene = model.normalizePlan({
  scenes: [{
    id: "single-full-capacity",
    sourceSegmentIds: Array.from({ length: model.MAX_SOURCE_SEGMENTS }, (_, index) => "full-" + index)
  }]
});
assert.strictEqual(singleScene.scenes[0].sourceSegmentIds.length, model.MAX_SOURCE_SEGMENTS, "one valid scene may own the full transcript-wide source capacity");

console.log("Scene Planner transcript-wide ownership budget regression passed.");
