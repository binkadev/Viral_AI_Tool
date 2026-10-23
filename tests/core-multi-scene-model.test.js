"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const m = require("../renderer/core-scene-plan-model"), assembly = require("../renderer/core-media-assembly-model");
const now = Date.UTC(2026, 9, 22), copy = v => JSON.parse(JSON.stringify(v));
function plan() { return m.normalizePlan({ scenes: ["A", "B", "C", "D"].map((id, order) => ({ id, order,
  start: 20 - order * 3, end: 22 - order * 3, sourceSegmentIds: ["source-" + id], sourceText: "Text " + id,
  visualIntent: "Intent " + id, createdAt: new Date(now).toISOString() })), selectedSceneId: "B" }, { now }); }
function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const ids = p => p.scenes.map(s => s.id);
const dense = p => assert.deepEqual(p.scenes.map(s => s.order), p.scenes.map((_, i) => i));
test("add first manual Scene is deterministic, empty, selected and caller-owned", () => {
  const a = m.addScene({}, { id: "stable" });
  assert.deepEqual(a, m.addScene({}, { id: "stable" })); assert.equal(a.selectedSceneId, "stable");
  const s = a.scenes[0]; assert.equal(s.provenance.origin, "manual"); assert.equal(s.sceneState, "draft");
  assert.equal(s.start, 0); assert.equal(s.end, 0); assert.equal(s.sourceText, ""); assert.deepEqual(s.sourceSegmentIds, []);
  for (const key of ["visualIntent", "generationPrompt", "title"]) assert.equal(s[key], null);
  assert.deepEqual(s.searchQueries, []); assert.equal(a.schemaVersion, 1); dense(a);
});
test("append and insert normalize dense order and preserve existing content", () => {
  const p = freeze(plan()), a = m.addScene(p, { id: "E" }, { now });
  assert.deepEqual(ids(a), ["A", "B", "C", "D", "E"]); assert.equal(a.selectedSceneId, "E");
  const b = m.addScene(p, { id: "E" }, { index: 1, select: false, now });
  assert.deepEqual(ids(b), ["A", "E", "B", "C", "D"]); assert.equal(b.selectedSceneId, "B"); dense(b);
  assert.equal(b.scenes[2].sourceText, p.scenes[1].sourceText);
});
test("missing, oversized, duplicate IDs and invalid insertion indices fail closed", () => {
  const p = plan(); for (const id of [undefined, "", " ", "x".repeat(513), "A"]) assert.deepEqual(m.addScene(p, { id }), p);
  for (const index of [-1, 5, 0.5, NaN]) assert.deepEqual(m.addScene(p, { id: "E" }, { index }), p);
});
test("MAX_SCENES permits the final slot and rejects overflow", () => {
  const p = m.normalizePlan({ scenes: Array.from({ length: m.MAX_SCENES - 1 }, (_, i) => ({ id: "s" + i, order: i })) }, { now });
  const full = m.addScene(p, { id: "last" }); assert.equal(full.scenes.length, m.MAX_SCENES);
  assert.deepEqual(m.addScene(full, { id: "overflow" }), full);
});
test("selection only changes editing context; invalid and repeated selection are no-ops", () => {
  const p = freeze(plan()), n = m.selectScene(p, "D", { now });
  assert.equal(n.selectedSceneId, "D"); assert.deepEqual(n.scenes, p.scenes);
  assert.deepEqual(m.selectScene(p, "missing"), p); assert.deepEqual(m.selectScene(n, "D"), n);
});
for (const [id, index, expected] of [["A", 3, ["B", "C", "D", "A"]], ["D", 0, ["D", "A", "B", "C"]],
  ["B", 2, ["A", "C", "B", "D"]], ["C", 1, ["A", "C", "B", "D"]]]) {
  test("move " + id + " to " + index + " preserves identity, timing, source and visual fields", () => {
    const p = freeze(plan()), n = m.moveScene(p, id, index, { now }); assert.deepEqual(ids(n), expected); dense(n);
    for (const s of n.scenes) assert.deepEqual({ ...s, order: 0 }, { ...p.scenes.find(v => v.id === s.id), order: 0 });
    assert.equal(n.selectedSceneId, "B"); assert.deepEqual(m.moveScene(n, id, index), n);
  });
}
test("invalid and same-index moves are idempotent", () => {
  const p = plan(); for (const i of [-1, 4, 1.5, NaN, "1"]) assert.deepEqual(m.moveScene(p, "B", i), p);
  assert.deepEqual(m.moveScene(p, "missing", 0), p); assert.deepEqual(m.moveScene(p, "B", 1), p);
});
test("remove selected chooses successor at same index, otherwise previous final Scene", () => {
  const p = freeze(plan()); let n = m.removeScene(p, "B", { now });
  assert.deepEqual(ids(n), ["A", "C", "D"]); assert.equal(n.selectedSceneId, "C"); dense(n);
  n = m.removeScene(m.selectScene(p, "D"), "D"); assert.equal(n.selectedSceneId, "C");
  assert.deepEqual(m.removeScene(n, "D"), n);
});
test("remove nonselected keeps selection and final Scene cannot be removed", () => {
  const p = plan(); assert.equal(m.removeScene(p, "A").selectedSceneId, "B");
  const single = m.addScene({}, { id: "only" }); assert.deepEqual(m.removeScene(single, "only"), single);
});
test("all operations are immutable, detached and deterministic", () => {
  const p = freeze(plan()), before = copy(p);
  for (const fn of [() => m.addScene(p, { id: "E" }), () => m.selectScene(p, "A"), () => m.moveScene(p, "C", 0), () => m.removeScene(p, "B")]) {
    const a = fn(); assert.deepEqual(a, fn()); a.scenes[0].sourceSegmentIds.push("new"); assert.deepEqual(p, before);
  }
});
test("assembly follows Scene ID through reorder; deletion drops only its slot and preserves shared asset", () => {
  const p = plan(), assets = ["X", "Y"].map(id => ({ id, kind: "video" }));
  let a = assembly.addCandidate(assembly.emptyAssembly(), "A", "X", { scenes: p.scenes, assets, now });
  a = assembly.selectCandidate(a, "A", "X", { scenes: p.scenes, assets, now, selectionSource: "manual" });
  a = assembly.addCandidate(a, "B", "X", { scenes: p.scenes, assets, now });
  a = assembly.addCandidate(a, "B", "Y", { scenes: p.scenes, assets, now });
  const reordered = m.moveScene(p, "A", 3), stable = assembly.normalizeAssembly(a, { scenes: reordered.scenes, assets });
  assert.deepEqual(stable, a); assert.equal(assembly.sceneSlot(stable, "A").selectionSource, "manual");
  const removed = assembly.normalizeAssembly(stable, { scenes: m.removeScene(reordered, "A").scenes, assets });
  assert.equal(assembly.sceneSlot(removed, "A"), null); assert.deepEqual(assembly.sceneSlot(removed, "B").candidateAssetIds, ["X", "Y"]);
  assert.equal(assembly.sceneSlot(removed, "B").selectedAssetId, null); assert.equal(assets.length, 2);
});
