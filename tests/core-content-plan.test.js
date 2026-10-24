"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const planner = require("../renderer/core-content-plan"), sceneModel = require("../renderer/core-scene-plan-model");
const action = require("../renderer/core-scene-orchestration-model"), production = require("../renderer/core-production-mode-model");
const { harness, KEY, clone } = require("./helpers/project-media-harness"), { script } = require("./fixtures/content-plan");
const IDEA = "  Nước hoa nam phong cách sang trọng\n", BRIEF = "viral-ai-generation-brief";
async function setup(adapter = { generate: async () => script() }) {
  const h = harness(); h.window.ViralContentPlan = planner;
  await h.api.createProject({ kind: "ai", projectName: "Idea plan" });
  h.c.localStorage.setItem(BRIEF, IDEA); h.api.flush();
  h.runtime = planner.create({ persistence: h.api, sceneModel, adapter });
  return h;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
test("ContentBrief preserves verbatim VI/EN, neutral defaults and bounded validated options", () => {
  for (const idea of [IDEA, "A luxury men's perfume", "x".repeat(8000)]) {
    const brief = planner.createBrief(idea);
    assert.equal(brief.originalIdea, idea); assert.equal(brief.audience, "general"); assert.equal(brief.duration, 30);
    assert.equal(brief.subject.length, Math.min(idea.trim().length, 500));
  }
  for (const idea of ["", "  ", null, {}, "x".repeat(8001), "bad\u0000"]) assert.throws(() => planner.createBrief(idea));
  for (const duration of [-1, 0, NaN, Infinity, "30", 181]) assert.throws(() => planner.createBrief(IDEA, { duration }));
});
test("Script rejects malformed, empty, excessive, inconsistent and unsafe production annotations", () => {
  assert.equal(planner.validateScript(script()).beats.length, 5);
  assert.equal(planner.validateScript(script()).narration, script().beats.map(b => b.text).join("\n\n"));
  for (const invalid of [null, {}, "text", { ...script(), hook: "" }, { ...script(), body: "wrong" }, script(2), script(13)]) assert.throws(() => planner.validateScript(invalid));
  const patches = [{ text: "x".repeat(2001) }, { visualIntent: "" }, { visualIntent: "x".repeat(1201) },
    { generationPrompt: "x".repeat(1601) }, { generationPrompt: "https://example.com" },
    { searchQueries: [] }, { searchQueries: Array(9).fill("a") }, { searchQueries: ["a", " A "] },
    { searchQueries: ["Ａ", "a"] }, { searchQueries: ["https://example.com"] }, { searchQueries: ["API key secret"] },
    { searchQueries: ["x".repeat(181)] }, { targetKinds: ["audio"] }, { targetKinds: ["video", "video"] }, { purpose: "invalid" }];
  for (const patch of patches) { const input = script(); Object.assign(input.beats[1], patch); assert.throws(() => planner.validateScript(input), JSON.stringify(patch)); }
});
test("Canonical materialization has variable Scene count, bounded IDs and deterministic exact contiguous timing", () => {
  for (const count of [3, 4, 5, 6, 12]) for (const duration of [3, 5, 10, 30, 180]) {
    const authoring = { version: 1, origin: "ai", contentBrief: planner.createBrief(IDEA, { duration }), script: script(count) };
    const build = () => { let id = 0; return planner.materialize(authoring, { sceneModel, id: () => "scene-" + ++id, now: 0 }); };
    const plan = build(); assert.deepEqual(plan, build()); assert.equal(plan.scenes.length, count);
    assert.equal(plan.scenes[0].start, 0); assert.equal(plan.scenes.at(-1).end, duration);
    for (const [i, scene] of plan.scenes.entries()) {
      assert.equal(scene.order, i); assert(scene.end > scene.start); assert.equal(scene.start, i ? plan.scenes[i - 1].end : 0);
      assert.deepEqual(scene.targetKinds, ["video", "image"]); assert.equal(scene.purpose, authoring.script.beats[i].purpose);
      assert(scene.sourceText && scene.visualIntent && scene.generationPrompt && scene.searchQueries.length);
      assert.equal(scene.provenance.origin, "ai");
    }
  }
});
test("Generated data commits once through canonical Registry, stays editable and survives fresh runtime restore", async () => {
  const h = await setup(), writes = h.writes, result = await h.runtime.generate(IDEA);
  assert(result.ok, result.code); assert.equal(h.writes, writes + 1);
  const snapshot = clone(h.api.snapshot()), opts = { projectId: snapshot.projectId };
  assert.equal(snapshot.scenePlan.authoring.contentBrief.originalIdea, IDEA);
  const stored = JSON.parse(h.data.get(KEY)).projects.find(p => p.projectId === snapshot.projectId);
  assert.deepEqual(stored, snapshot); assert.equal(snapshot.scenePlan.sourceType, "script");
  const restart = harness(h.data); restart.window.ViralContentPlan = planner;
  assert.deepEqual(clone(restart.api.snapshot()), snapshot);
  const selected = snapshot.scenePlan.scenes[2].id;
  restart.api.selectProjectScene(selected, opts); restart.api.moveProjectScene(selected, 0, opts);
  restart.api.updateProjectScene(selected, { title: "Cảnh đã sửa", sourceText: "Lời dẫn đã sửa" }, opts);
  assert.equal(restart.api.snapshot().scenePlan.scenes[0].title, "Cảnh đã sửa");
  assert.equal(restart.api.snapshot().scenePlan.scenes[0].sourceText, "Lời dẫn đã sửa");
  assert.equal(restart.api.snapshot().scenePlan.scenes[0].sceneState, "edited");
  const beforeFailedEdit = h.data.get(KEY); restart.fail = true;
  assert.throws(() => restart.api.updateProjectScene(selected, { title: "Do not save" }, opts));
  assert.equal(h.data.get(KEY), beforeFailedEdit); restart.fail = false;
  assert.throws(() => restart.api.updateProjectScene(selected, { id: "changed" }, opts));
  restart.api.addProjectScene({ title: "New" }, opts); restart.api.removeProjectScene(selected, opts);
  assert.equal(restart.api.snapshot().scenePlan.scenes.length, 5);
  const again = harness(h.data); assert.deepEqual(clone(again.api.snapshot()), clone(restart.api.snapshot()));
});
test("Atomicity: malformed provider, write failure, readonly state and existing content cannot partially replace Scenes", async () => {
  for (const mode of ["malformed", "quota", "readonly", "existing", "pending-edit"]) {
    const h = await setup({ generate: async () => mode === "malformed" ? {} : script() });
    if (mode === "existing") { h.state.scenePlan.scenes[0].sourceText = "User text"; h.api.flush(); }
    if (mode === "pending-edit") h.state.scenePlan.scenes[0].title = "Unsaved user title";
    const before = h.data.get(KEY), snapshot = clone(h.api.snapshot());
    if (mode === "quota") h.fail = true;
    if (mode === "readonly") Object.defineProperty(h.state, "scenePlan", { writable: false });
    const result = await h.runtime.generate(IDEA);
    assert.equal(result.ok, false, mode); assert.equal(h.data.get(KEY), before, mode); assert.deepEqual(clone(h.api.snapshot()), snapshot, mode);
  }
  const h = await setup(); assert((await h.runtime.generate(IDEA)).ok);
  const before = h.data.get(KEY); assert.equal((await h.runtime.generate(IDEA)).code, "PLAN_EXISTING_CONTENT"); assert.equal(h.data.get(KEY), before);
});
test("No provider is truthful, makes no write, and cannot produce fake AI output", async () => {
  const h = await setup(null), before = h.data.get(KEY);
  assert.equal(h.runtime.ready(), false); assert.equal((await h.runtime.generate(IDEA)).code, "PLAN_UNAVAILABLE");
  assert.equal(h.data.get(KEY), before);
});
test("Provider/resource errors stay structured, retain the draft and do not retry", async () => {
  let calls = 0;
  const h = await setup({ generate: async () => { calls++; throw Error("PRIVATE_PROVIDER_KEY_AND_NETWORK_DETAILS"); } });
  const before = h.data.get(KEY), result = await h.runtime.generate(IDEA);
  assert.deepEqual(result, { ok: false, code: "PLAN_FAILED" }); assert.equal(calls, 1);
  assert.equal(h.data.get(KEY), before); assert.equal(h.runtime.busy(), false);
});
test("The persistence boundary independently rejects malformed input, stale identity and duplicate IDs", async () => {
  const authoring = { version: 1, origin: "ai", contentBrief: planner.createBrief(IDEA), script: script() };
  for (const mode of ["malformed", "stale", "wrong-project", "duplicate-id", "invalid-id"]) {
    const h = await setup(), snapshot = h.api.snapshot(), before = h.data.get(KEY);
    const options = { projectId: snapshot.projectId, expectedSignature: JSON.stringify(snapshot), idea: IDEA };
    const candidate = clone(authoring);
    if (mode === "malformed") candidate.script.beats[1].generationPrompt = "";
    if (mode === "stale") options.expectedSignature = "stale";
    if (mode === "wrong-project") options.projectId = "B";
    if (mode === "duplicate-id") h.window.crypto = { randomUUID: () => "duplicate" };
    if (mode === "invalid-id") h.window.crypto = { randomUUID: () => "" };
    assert.throws(() => h.api.commitContentPlan(candidate, options), mode);
    assert.equal(h.data.get(KEY), before, mode); assert.deepEqual(clone(h.api.snapshot()), clone(snapshot));
  }
});
test("Cancellation at a state publication boundary cannot invoke the provider", async () => {
  let calls = 0, runtime;
  const h = await setup();
  runtime = planner.create({ persistence: h.api, sceneModel, adapter: { generate: async () => { calls++; return script(); } },
    changed: status => { if (status === "planning") runtime.cancel(); } });
  const before = h.data.get(KEY);
  assert.equal((await runtime.generate(IDEA)).code, "PLAN_CANCELLED"); assert.equal(calls, 0); assert.equal(h.data.get(KEY), before);
});
test("Duplicate protection, cancellation and late provider resolution are safe, with no automatic retry", async () => {
  const pending = deferred(); let calls = 0;
  const h = await setup({ generate: async ({ signal }) => { calls++; assert.equal(signal.aborted, false); return pending.promise; } });
  const before = h.data.get(KEY), running = h.runtime.generate(IDEA); await tick();
  assert.equal((await h.runtime.generate(IDEA)).code, "PLAN_BUSY"); h.runtime.cancel();
  assert.equal((await running).code, "PLAN_CANCELLED"); assert.equal(h.runtime.state(), "cancelled");
  pending.resolve(script()); await tick(); assert.equal(h.data.get(KEY), before); assert.equal(calls, 1);
});
test("Concurrent Project switch or brief/Scene edits reject the awaited result", async () => {
  for (const edit of [h => h.api.openProject("B"), h => h.c.localStorage.setItem(BRIEF, "changed"), h => { h.state.scenePlan.scenes[0].title = "User edit"; }]) {
    const pending = deferred(), h = await setup({ generate: () => pending.promise });
    const running = h.runtime.generate(IDEA); await tick(); await edit(h); const before = h.data.get(KEY);
    pending.resolve(script()); assert.equal((await running).ok, false); assert.equal(h.data.get(KEY), before);
  }
});
test("Current material orchestration crosses no-source with generated queries and prompt, without any asset calls", async () => {
  const h = await setup(), initial = h.api.snapshot();
  assert.equal(production.classify(initial, initial.scenePlan.scenes[0], action).reason, "no-source");
  assert((await h.runtime.generate(IDEA)).ok);
  const snapshot = h.api.snapshot();
  for (const scene of snapshot.scenePlan.scenes) {
    const classified = production.classify(snapshot, scene, action);
    assert.equal(classified.classification, "needs-sourcing"); assert.equal(classified.reason, null);
    assert.deepEqual([...classified.plan.search.queries], [...scene.searchQueries]);
    assert.equal(classified.plan.generation.prompt, scene.generationPrompt);
    assert(classified.plan.search.available && classified.plan.generation.available);
  }
});
test("GATE-001 and BASE-VOICE-RESTORE on an authored plan", async () => {
  const h = await setup(); h.state.renderOptions = { ...h.state.renderOptions, voiceEnabled: false }; h.api.flush();
  assert((await h.runtime.generate(IDEA)).ok); const before = clone(h.api.snapshot());
  for (const page of ["home", "settings", "ai-create", "library"]) { h.state.page = page; h.api.flush(); assert.equal(h.api.snapshot().updatedAt, before.updatedAt); }
  const restart = harness(h.data); assert.equal(restart.api.snapshot().workflow.renderOptions.voiceEnabled, false);
  assert.deepEqual(clone(restart.api.snapshot().scenePlan), before.scenePlan);
});
