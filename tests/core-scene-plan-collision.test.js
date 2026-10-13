"use strict";

const assert = require("assert");
const model = require("../renderer/core-scene-plan-model");

const reservedCaseVariant = "A~d00000001";
const normalized = model.normalizeTranscriptSegments({
  segments: [
    { id: "a", start: 0, end: 1, text: "first" },
    { id: "a", start: 1, end: 2, text: "duplicate" },
    { id: reservedCaseVariant, start: 2, end: 3, text: "reserved case variant" }
  ]
});

assert.strictEqual(normalized.length, 3);
assert.strictEqual(new Set(normalized.map(segment => segment.id.toLowerCase())).size, 3, "normalized transcript IDs must remain unique under downstream case-insensitive ownership semantics");

const plan = model.createPlanFromTranscript({ segments: normalized }, {
  minDuration: 12,
  targetDuration: 20,
  maxDuration: 30,
  maxGap: 5
});
const owned = plan.scenes.flatMap(scene => scene.sourceSegmentIds);
assert.strictEqual(owned.length, 3, "case-variant collision handling must preserve every source segment");
assert.strictEqual(new Set(owned.map(id => id.toLowerCase())).size, 3);

console.log("Scene Planner case-insensitive source collision regression passed.");
