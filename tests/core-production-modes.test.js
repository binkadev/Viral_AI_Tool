"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const model = require("../renderer/core-production-mode-model"), { create } = require("../renderer/core-production-runtime");
const actionModel = require("../renderer/core-scene-orchestration-model"), sceneRuntime = require("../renderer/core-scene-orchestration-runtime");
const { harness, asset, clone, snapshotModel } = require("./helpers/project-media-harness");
const tick = () => new Promise(r => setImmediate(r));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const result = (id = "stock", kind = "video", extra = {}) => ({ provider: "pexels", providerAssetId: id, kind, acquisition: { ticket: "ticket-" + id }, ...extra });
function setup(options = {}) {
  const h = options.h || harness(), searches = [], acquisitions = [], submissions = [], jobs = new Map(), attached = new Set(), attachmentErrors = new Set();
  let sequence = 0, runtime;
  function plan(sceneId, extra = {}) { const scene = h.state.scenePlan.scenes.find(s => s.id === sceneId); Object.assign(scene, { searchQueries: ["planned"], targetKinds: ["video"], orientation: "landscape", generationPrompt: "Exact scene prompt", ...extra }); h.api.flush(); }
  function attach(jobId) {
    const value = jobs.get(jobId); value.status = "completed"; value.provider = "fixture"; value.output = { fileName: value.id + ".mp4" }; value.asset = { ...value.output };
    h.api.attachGeneratedOutput(value, { jobId, projectId: value.projectId, sceneId: value.sceneId, verified: true, fileName: value.output.fileName,
      path: "C:/owned/" + value.output.fileName }, { duration: 2, width: 320, height: 180 });
    attached.add(jobId); runtime?.notify();
  }
  const desktop = {
    searchMedia: async request => { searches.push(request); return options.search ? options.search(request) : { ok: true, data: { results: [result("stock-" + request.query, request.kind)], nextPage: 2 } }; },
    acquireMedia: async request => {
      acquisitions.push(request);
      if (options.acquire) return options.acquire(request);
      const id = request.ticket.slice(7), value = asset(id, "video", "stock"); return { ok: true, data: { asset: value } };
    },
    getGenerationJob: async jobId => options.get ? options.get(jobId, jobs) : { ok: true, value: clone(jobs.get(jobId)) },
    cancelMediaSearch: async value => { h.notices.push({ cancelSearch: value }); },
    cancelMediaAcquisition: async value => { h.notices.push({ cancelAcquisition: value }); }
  };
  const orchestration = sceneRuntime.create({ model: actionModel, persistence: h.api,
    status: async () => ({ ok: true, value: { ready: true, state: "ready", modelIds: [], providers: [{ id: "muse", ready: true }] } }),
    submit: async request => {
      submissions.push(request);
      if (options.submit) return options.submit(request);
      const value = { id: "job-" + request.idempotencyKey, kind: "video", projectId: request.projectId, sceneId: request.sceneId,
        request, idempotencyKey: request.idempotencyKey, status: "running" }; jobs.set(value.id, value); return { ok: true, value };
    },
    track: async value => { h.api.registerGenerationJob(value); if (options.autoAttach) attach(value.id); },
    attachmentStatus: id => attachmentErrors.has(id) ? "error" : attached.has(id) ? "attached" : "pending", id: () => "generation-" + ++sequence });
  const make = () => create({ model, actionModel, persistence: h.api, projectMedia: h.operations, desktop, orchestration,
    attachmentStatus: id => attachmentErrors.has(id) ? "error" : attached.has(id) ? "attached" : "pending", id: () => "production-" + ++sequence });
  runtime = make();
  h.window.addEventListener("viral-ai:project-snapshot-restored", () => { runtime.invalidate(); orchestration.invalidate(); });
  h.window.addEventListener("viral-ai:core-state-changed", () => runtime.notify());
  return { h, runtime, make, desktop, orchestration, plan, searches, acquisitions, submissions, jobs, attach, attached, attachmentErrors,
    slot: sceneId => h.api.snapshot().mediaAssembly.slots.find(s => s.sceneId === sceneId),
    candidate(sceneId, value, select = false) { h.api.addProjectMediaAsset(value, { projectId: "A" }); h.api.addSceneMaterialCandidate(sceneId, value.id, { projectId: "A" }); if (select) h.api.selectSceneMaterial(sceneId, value.id, { projectId: "A" }); },
    async run(mode = "auto") { assert(runtime.start("A", mode)); await runtime.settled(); return runtime.view(); } };
}
function five(options = {}) {
  const f = setup(options); f.h.api.addProjectScene({ id: "A2" }, { projectId: "A" }); f.h.api.addProjectScene({ id: "A3" }, { projectId: "A" }); f.h.api.addProjectScene({ id: "A4" }, { projectId: "A" });
  f.candidate("A0", asset("selected"), true); f.candidate("A1", asset("first")); f.candidate("A1", asset("second")); f.plan("A2", { searchQueries: ["stock"] }); f.plan("A3", { searchQueries: ["empty"] }); return f;
}
test("pure classification, canonical order, no unrelated-library guessing", () => {
  const f = setup(); f.plan("A0"); f.h.api.addProjectMediaAsset(asset("unrelated"), { projectId: "A" });
  const p = f.h.api.snapshot(), before = clone(p);
  assert.equal(model.classify(p, p.scenePlan.scenes[0], actionModel).classification, "needs-sourcing");
  assert.equal(model.classify(p, p.scenePlan.scenes[1], actionModel).classification, "attention-required");
  assert.deepEqual(model.ordered({ scenePlan: { scenes: [{ id: "b", order: 1 }, { id: "a", order: 0 }] } }).map(s => s.id), ["a", "b"]);
  assert.deepEqual(p, before); assert.equal(model.mode("unknown"), "assisted");
});
for (const defect of ["missing", "corrupt", "audio", "remote", "not-enrolled"]) test("explicit broken selection requires attention: " + defect, () => {
  const f = setup(); f.candidate("A0", asset("selected"), true); f.candidate("A0", asset("other")); const p = f.h.api.snapshot();
  if (defect === "missing") p.media.assets = p.media.assets.filter(a => a.id !== "selected");
  if (defect === "corrupt") p.media.assets.find(a => a.id === "selected").status = "failed";
  if (defect === "audio") p.media.assets.find(a => a.id === "selected").kind = "audio";
  if (defect === "remote") p.media.assets.find(a => a.id === "selected").fileState = "remote";
  if (defect === "not-enrolled") p.mediaAssembly.slots.find(s => s.sceneId === "A0").candidateAssetIds = ["other"];
  assert.equal(model.classify(p, p.scenePlan.scenes[0], actionModel).classification, "attention-required");
  assert.equal(model.summarize(p, actionModel, new Map([["A0", { status: "review" }]])).scenes[0].status, "attention");
});
test("Assisted five-scene fixture preserves selection, reviews candidates/stock/generated, reports no source", async () => {
  const f = five({ autoAttach: true, search: async r => ({ ok: true, data: { results: r.query === "empty" ? [] : [result("stock-stock")] } }) });
  const v = await f.run("assisted"); assert.equal(v.state, "needs_attention"); assert.equal(v.summary.ready, 1); assert.equal(v.summary.review, 3); assert.equal(v.summary.attention, 1);
  assert.equal(f.slot("A0").selectedAssetId, "selected"); assert.equal(f.slot("A1").selectedAssetId, null); assert.equal(f.slot("A2").selectedAssetId, null); assert(f.slot("A3").selectedAssetId.startsWith("generation:"));
  assert.equal(f.submissions.length, 1); assert.equal(f.searches.length, 2); assert.equal(f.acquisitions.length, 1);
});
test("Auto five-scene fixture preserves manual, selects first candidate and stock auto, waits AI, keeps partial success", async () => {
  const f = five({ autoAttach: true, search: async r => ({ ok: true, data: { results: r.query === "empty" ? [] : [result("stock-stock")] } }) });
  const v = await f.run(); assert.equal(v.state, "needs_attention"); assert.equal(v.summary.ready, 4); assert.equal(v.summary.attention, 1);
  assert.equal(f.slot("A0").selectionSource, "manual"); assert.equal(f.slot("A1").selectedAssetId, "first");
  for (const s of ["A1", "A2", "A3"]) assert.equal(f.slot(s).selectionSource, "auto");
  await f.run(); assert.equal(f.submissions.length, 1); assert.equal(f.acquisitions.length, 1);
});
test("auto selection API defaults manual, validates source and supports manual replacement/rerun", async () => {
  const f = setup(); f.candidate("A0", asset("first")); f.candidate("A0", asset("second")); await f.run(); assert.equal(f.slot("A0").selectionSource, "auto");
  assert.throws(() => f.h.api.selectSceneMaterial("A0", "second", { projectId: "A", selectionSource: "bogus" }), /PROJECT_SELECTION_SOURCE_INVALID/);
  f.h.api.selectSceneMaterial("A0", "second", { projectId: "A" }); await f.run(); assert.equal(f.slot("A0").selectedAssetId, "second"); assert.equal(f.slot("A0").selectionSource, "manual");
});
test("stock combinations preserve query then kind order, first page only, no synthesis", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [], nextPage: 2 } }), autoAttach: true });
  f.plan("A0", { searchQueries: ["one", "two"], targetKinds: ["image", "video"], orientation: "square" }); await f.run();
  assert.deepEqual(f.searches.map(r => [r.query, r.kind, r.orientation, r.page]), [["one", "image", "square", 1], ["one", "video", "square", 1], ["two", "image", "square", 1], ["two", "video", "square", 1]]);
  assert(f.searches.every(r => r.perPage === 18)); // Same ordinary first page as discovery.
  assert.equal(f.submissions[0].prompt, "Exact scene prompt"); assert.equal(f.submissions[0].providerId, "muse");
  for (const key of ["modelId", "sourceAssetId", "referenceAssetIds", "resolution", "aspectRatio", "durationSeconds", "withAudio"]) assert(!Object.hasOwn(f.submissions[0], key));
});
test("stock chooses first backend eligible result, skipping invalid identity/kind/ticket without ranking", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [result("bad", "image"), result("bad", "video", { provider: "Pexels" }), result("bad", "video", { acquisition: { ticket: "bad\nticket" } }), result("first"), result("second")] } }) });
  f.plan("A0"); await f.run(); assert.equal(f.acquisitions[0].ticket, "ticket-first"); assert.equal(f.slot("A0").selectedAssetId, "first"); assert.equal(f.submissions.length, 0);
});
for (const error of ["MEDIA_AUTH_REQUIRED", "MEDIA_SEARCH_TIMEOUT", "MEDIA_VERIFY_FAILED"]) test("stock infrastructure " + error + " is attention, never AI fallback", async () => {
  const f = setup({ search: async () => ({ ok: false, error: { code: error } }) }); f.plan("A0"); const v = await f.run(); assert.equal(v.state, "needs_attention"); assert.equal(f.submissions.length, 0);
});
for (const mismatch of ["projectId", "jobId", "provider", "providerAssetId", "kind"]) test("stock acquisition exact identity rejects " + mismatch, async () => {
  const f = setup({ acquire: async r => { const data = { jobId: r.jobId, projectId: r.projectId, asset: asset("stock-planned", "video", "stock") }; if (["projectId", "jobId"].includes(mismatch)) data[mismatch] = "wrong"; else data.asset[mismatch] = "wrong"; return { ok: true, data }; } });
  f.plan("A0"); const v = await f.run(); assert.equal(v.state, "needs_attention"); assert.equal(f.h.api.snapshot().media.assets.length, 0); assert.equal(f.submissions.length, 0);
});
test("failed durable admission does not publish or continue to next Scene", async () => {
  const wait = defer(), f = setup({ acquire: async () => wait.promise }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); f.h.fail = true;
  wait.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } }); await f.runtime.settled(); assert.equal(f.h.api.snapshot().media.assets.length, 0); assert.equal(f.searches.length, 1); assert.equal(f.runtime.view().state, "needs_attention");
});
test("manual override during admitted stock remains authoritative", async () => {
  const wait = defer(), f = setup({ acquire: async () => wait.promise }); f.plan("A0"); f.runtime.start("A", "auto"); await tick(); f.candidate("A0", asset("manual"), true);
  wait.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } }); await f.runtime.settled(); assert.equal(f.slot("A0").selectedAssetId, "manual"); assert.equal(f.slot("A0").selectionSource, "manual"); assert(f.slot("A0").candidateAssetIds.includes("stock-planned"));
});
test("selection during search avoids unnecessary acquisition", async () => {
  const wait = defer(), f = setup({ search: async () => wait.promise }); f.plan("A0"); f.runtime.start("A", "auto"); await tick(); f.candidate("A0", asset("manual"), true);
  wait.resolve({ ok: true, data: { results: [result()] } }); await f.runtime.settled(); assert.equal(f.acquisitions.length, 0); assert.equal(f.slot("A0").selectedAssetId, "manual");
});
test("generation admission/completed job alone cannot advance; exact verified attachment unlocks next Muse", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); assert.equal(f.submissions.length, 1);
  const first = [...f.jobs.keys()][0]; f.jobs.get(first).status = "completed"; f.runtime.notify(); await tick(); assert.equal(f.submissions.length, 1); assert.equal(f.runtime.view().state, "running");
  f.attach(first); await tick(); assert.equal(f.submissions.length, 2); f.attach([...f.jobs.keys()][1]); await f.runtime.settled(); assert.equal(f.runtime.view().state, "completed");
});
for (const status of ["failed", "cancelled", "interrupted"]) test("canonical generation " + status + " stops/waits truthfully with no retry", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.runtime.start("A", "auto"); await tick(); const value = [...f.jobs.values()][0]; value.status = status; f.runtime.notify(); await f.runtime.settled();
  assert.equal(f.runtime.view().state, "needs_attention"); assert.equal(f.submissions.length, 1); assert.equal(f.h.api.snapshot().media.assets.length, 0);
});
test("RECOVERY_REQUIRED stops even with a nominally active job", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); [...f.jobs.values()][0].errorCode = "RECOVERY_REQUIRED"; f.runtime.notify(); await f.runtime.settled(); assert.equal(f.submissions.length, 1);
});
test("handoff error never triggers retry or next Scene", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); f.attachmentErrors.add([...f.jobs.keys()][0]); f.runtime.notify(); await f.runtime.settled(); assert.equal(f.submissions.length, 1); assert.equal(f.runtime.view().state, "needs_attention");
});
test("uncertain submission remains blocked across explicit Start and Project switch, without rotating key", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }), submit: async () => ({ ok: false, errorCode: "UNAVAILABLE" }) }); f.plan("A0"); f.plan("A1"); await f.run();
  assert.equal(f.submissions.length, 1); f.h.api.openProject("B"); f.h.api.openProject("A"); await f.run(); assert.equal(f.submissions.length, 1); assert.equal(f.runtime.view().state, "needs_attention");
});
test("existing enrolled pending job is observed, never resubmitted", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0");
  const value = { id: "old", projectId: "A", sceneId: "A0", kind: "video", status: "running" }; f.jobs.set(value.id, value); f.h.api.registerGenerationJob(value); f.runtime.start("A", "auto"); await tick(); assert.equal(f.submissions.length, 0); f.attach("old"); await f.runtime.settled(); assert.equal(f.submissions.length, 0); assert(f.slot("A0").selectedAssetId);
});
for (const status of ["failed", "interrupted"]) test("existing " + status + " record forbids invisible generation retry", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); const value = { id: "old", projectId: "A", sceneId: "A0", kind: "video", status }; f.jobs.set(value.id, value); f.h.api.registerGenerationJob(value); await f.run(); assert.equal(f.submissions.length, 0);
});
test("an earlier Scene pending job blocks another Scene's Muse admission", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.candidate("A0", asset("manual"), true); f.plan("A1"); const old = { id: "old", projectId: "A", sceneId: "A0", kind: "video", status: "running" }; f.jobs.set("old", old); f.h.api.registerGenerationJob(old);
  f.runtime.start("A", "auto"); await tick(); assert.equal(f.submissions.length, 0); f.attach("old"); await tick(); assert.equal(f.submissions.length, 1); f.attach([...f.jobs.keys()][1]); await f.runtime.settled(); assert.equal(f.slot("A0").selectedAssetId, "manual");
});
test("event arriving during canonical job read is coalesced, never lost", async () => {
  const gate = defer(); let hold = false;
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }), get: async (id, jobs) => { const value = clone(jobs.get(id)); if (hold) { hold = false; await gate.promise; } return { ok: true, value }; } }); f.plan("A0"); hold = true; f.runtime.start("A", "auto"); await tick(); f.attach([...f.jobs.keys()][0]); gate.resolve(); await f.runtime.settled(); assert(f.slot("A0").selectedAssetId);
});
for (const phase of ["search", "acquire", "generation"]) test("Project switch invalidates " + phase + " and never mutates B or starts next A", async () => {
  const gate = defer(), f = setup({ search: phase === "search" ? async () => gate.promise : phase === "generation" ? async () => ({ ok: true, data: { results: [] } }) : undefined, acquire: phase === "acquire" ? async () => gate.promise : undefined });
  f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); f.h.api.openProject("B"); const before = f.h.api.snapshot();
  if (phase === "search") gate.resolve({ ok: true, data: { results: [result()] } });
  if (phase === "acquire") gate.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } });
  if (phase === "generation") f.attach([...f.jobs.keys()][0]);
  await f.runtime.settled(); assert.deepEqual(f.h.api.snapshot(), before); assert.equal(f.searches.length, 1); assert.equal(f.runtime.view().state, "idle");
});
test("Scene reorder preserves current ID and re-reads next canonical order", async () => {
  const gate = defer(); let first = true;
  const f = setup({ search: async r => first ? (first = false, gate.promise) : ({ ok: true, data: { results: [result("stock-" + r.query)] } }) }); f.h.api.addProjectScene({ id: "A2" }, { projectId: "A" });
  f.plan("A0", { searchQueries: ["zero"] }); f.plan("A1", { searchQueries: ["one"] }); f.plan("A2", { searchQueries: ["two"] });
  f.runtime.start("A", "auto"); await tick(); f.h.api.moveProjectScene("A2", 1, { projectId: "A" }); gate.resolve({ ok: true, data: { results: [result("stock-zero")] } }); await f.runtime.settled(); assert.deepEqual(f.searches.map(r => r.query), ["zero", "two", "one"]); assert.equal(f.slot("A0").selectedAssetId, "stock-zero");
});
test("Scene deleted during acquisition may leave Library asset, never retargets/recreates", async () => {
  const gate = defer(), f = setup({ acquire: async () => gate.promise }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); f.h.api.removeProjectScene("A0", { projectId: "A" }); gate.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } }); await f.runtime.settled(); assert.equal(f.h.api.snapshot().media.assets.length, 1); assert(!f.slot("A0")); assert(!f.slot("A1")); assert.equal(f.searches.length, 1);
});
test("Scene deleted during generation stops without retargeting or cancellation", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); f.h.api.removeProjectScene("A0", { projectId: "A" }); await f.runtime.settled(); assert.equal(f.runtime.view().state, "needs_attention"); assert.equal(f.submissions.length, 1); assert(!f.slot("A1"));
});
for (const phase of ["stock", "generation"]) test("Pause admits no next Scene; Resume rescans without duplicating " + phase, async () => {
  const gate = defer(), f = setup({ acquire: phase === "stock" ? async () => gate.promise : undefined, search: phase === "generation" ? async () => ({ ok: true, data: { results: [] } }) : undefined });
  f.plan("A0"); f.plan("A1", { searchQueries: [], targetKinds: [], generationPrompt: null }); f.runtime.start("A", "auto"); await tick(); assert(f.runtime.pause());
  if (phase === "stock") gate.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } }); else f.attach([...f.jobs.keys()][0]);
  await f.runtime.settled(); assert.equal(f.runtime.view().state, "paused"); assert.equal(f.searches.length, 1); assert(f.runtime.resume()); await f.runtime.settled(); assert.equal(f.searches.length, 1); assert.equal(f.acquisitions.length + f.submissions.length, 1);
});
test("Pause during search prevents acquisition; explicit Resume rescans", async () => {
  const gate = defer(), f = setup({ search: async () => gate.promise }); f.plan("A0"); f.runtime.start("A", "auto"); await tick(); f.runtime.pause(); gate.resolve({ ok: true, data: { results: [result("stock-planned")] } }); await f.runtime.settled(); assert.equal(f.acquisitions.length, 0); f.runtime.resume(); await f.runtime.settled(); assert.equal(f.acquisitions.length, 1);
});
test("Stop during generation keeps job ownership and allows handoff, late events cannot restart", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick(); assert(f.runtime.stop()); await f.runtime.settled(); f.attach([...f.jobs.keys()][0]); await tick(); assert.equal(f.runtime.view().state, "cancelled"); assert.equal(f.submissions.length, 1); assert(f.slot("A0").selectedAssetId); assert.equal(f.h.notices.length, 0);
});
test("Stop cancels only owned acquisition and blocks its late admission", async () => {
  const gate = defer(), f = setup({ acquire: async () => gate.promise }); f.plan("A0"); f.runtime.start("A", "auto"); await tick(); f.runtime.stop(); assert.equal(f.h.notices[0].cancelAcquisition, f.acquisitions[0].jobId); assert(!f.runtime.start("A", "auto")); gate.resolve({ ok: true, data: { asset: asset("stock-planned", "video", "stock") } }); await f.runtime.settled(); assert.equal(f.h.api.snapshot().media.assets.length, 0);
});
test("duplicate Start is rejected and generation uses one Scene intent", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); assert(f.runtime.start("A", "auto")); assert(!f.runtime.start("A", "auto")); await tick(); for (let i = 0; i < 10; i++) f.runtime.notify(); await tick(); assert.equal(f.submissions.length, 1); f.attach([...f.jobs.keys()][0]); await f.runtime.settled();
});
test("restart has no execution authority, keeps schemas/state and new Start skips ready Scenes", async () => {
  const f = setup(); f.plan("A0"); await f.run(); const durable = f.h.data.get("viral-ai-core-project-registry-v1");
  const restored = setup({ h: harness(f.h.data) }); assert.equal(restored.runtime.view().state, "idle"); assert.equal(restored.searches.length, 0); assert.equal(restored.submissions.length, 0); await restored.run(); assert.equal(restored.searches.length, 0);
  const p = restored.h.api.snapshot(); assert.deepEqual([p.schemaVersion, p.scenePlan.schemaVersion, p.mediaAssembly.schemaVersion, p.media.schemaVersion], [5, 1, 1, 1]);
  for (const key of ["runId", "currentSceneIndex", "production progress", "pause state"]) assert(!durable.includes(key)); assert.equal(snapshotModel.CURRENT_SCHEMA_VERSION, 5);
});
test("image-only no stock is attention without inventing generator", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0", { targetKinds: ["image"] }); await f.run(); assert.equal(f.submissions.length, 0); assert.equal(f.runtime.view().state, "needs_attention");
});
test("missing plan never uses source/title/global brief fallback", async () => {
  const f = setup(); f.plan("A0", { searchQueries: [], generationPrompt: null, sourceText: "source", title: "title", visualIntent: "intent" }); await f.run(); assert.equal(f.searches.length, 0); assert.equal(f.submissions.length, 0);
});
test("VI/EN production copy has matching keys, accessible controls, no runtime polling or second pipeline", () => {
  const c = { window: {} }; vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), c); const a = c.window.I18N.messages;
  assert.deepEqual(Object.keys(a.vi.productionModes), Object.keys(a.en.productionModes));
  for (const locale of ["vi", "en"]) for (const text of Object.values(a[locale].productionModes)) assert(typeof text === "string" && text && !text.includes("\ufffd"));
  const runtime = fs.readFileSync("renderer/core-production-runtime.js", "utf8"), ui = fs.readFileSync("renderer/core-production-modes.js", "utf8");
  assert(!/setInterval|submitGeneration|recoverGeneration|prepareGeneration/.test(runtime)); assert(ui.includes('aria-live="polite"')); assert(ui.includes("selectProjectScene")); assert(ui.includes("localStorage.setItem(KEY, mode)")); assert(!/localStorage/.test(runtime));
});
test("image stock is admitted and selected auto through the same acquisition path", async () => {
  const f = setup({ acquire: async () => ({ ok: true, data: { asset: asset("stock-planned", "image", "stock") } }) });
  f.plan("A0", { targetKinds: ["image"] }); await f.run(); assert.equal(f.slot("A0").selectedAssetId, "stock-planned"); assert.equal(f.slot("A0").selectionSource, "auto"); assert.equal(f.submissions.length, 0);
});
test("manual override during generation survives locked selectIfEmpty handoff and Auto completion", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.runtime.start("A", "auto"); await tick();
  f.candidate("A0", asset("manual"), true); f.attach([...f.jobs.keys()][0]); await f.runtime.settled(); assert.equal(f.slot("A0").selectedAssetId, "manual"); assert.equal(f.slot("A0").selectionSource, "manual"); assert.equal(f.slot("A0").candidateAssetIds.length, 2);
});
test("wrong generation Project/Scene identity fails closed without progression", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.plan("A1"); f.runtime.start("A", "auto"); await tick();
  [...f.jobs.values()][0].sceneId = "A1"; f.runtime.notify(); await f.runtime.settled(); assert.equal(f.submissions.length, 1); assert.equal(f.runtime.view().state, "needs_attention");
});
test("completed attachment mapping must resolve exact usable Scene candidate", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }) }); f.plan("A0"); f.runtime.start("A", "auto"); await tick();
  const jobId = [...f.jobs.keys()][0]; f.jobs.get(jobId).status = "completed"; f.attached.add(jobId);
  const original = f.h.api.generationOutputJobs; f.h.api.generationOutputJobs = () => original().map(e => ({ ...e, assetId: "not-enrolled" }));
  f.runtime.notify(); await f.runtime.settled(); assert.equal(f.runtime.view().state, "needs_attention"); assert(!f.slot("A0"));
});
test("uncertain Scene blocks another Scene's Muse admission even after reorder/new Start", async () => {
  const f = setup({ search: async () => ({ ok: true, data: { results: [] } }), submit: async () => ({ ok: false, errorCode: "UNAVAILABLE" }) }); f.plan("A0"); f.plan("A1"); await f.run();
  f.h.api.moveProjectScene("A1", 0, { projectId: "A" }); await f.run(); assert.equal(f.submissions.length, 1);
});
test("an outstanding Block 5 submit reservation cannot become a second production intent", async () => {
  const gate = defer(), f = setup({ search: async () => ({ ok: true, data: { results: [] } }), submit: async () => gate.promise });
  f.plan("A0"); f.plan("A1"); const pending = f.orchestration.generate("A", "A0"); await tick();
  await f.run(); assert.equal(f.submissions.length, 1); assert.equal(f.runtime.view().state, "needs_attention"); gate.resolve({ ok: false, errorCode: "UNAVAILABLE" }); await pending;
});
test("non-safety no-source attention continues independent later Scene", async () => {
  const f = setup(); f.plan("A1"); const v = await f.run(); assert.equal(v.state, "needs_attention"); assert.equal(f.searches.length, 1); assert.equal(f.slot("A1").selectionSource, "auto");
});
test("broken explicit selection is preserved rather than silently substituted", async () => {
  const f = setup(); f.candidate("A0", asset("selected"), true); f.candidate("A0", asset("other"));
  f.h.api.updateProjectMediaAsset("selected", { fileState: "missing" }, { projectId: "A" }); await f.run(); assert.equal(f.slot("A0").selectedAssetId, "selected"); assert.equal(f.searches.length, 0);
});
