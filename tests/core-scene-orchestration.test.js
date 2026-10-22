"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const model = require("../renderer/core-scene-orchestration-model"), { create } = require("../renderer/core-scene-orchestration-runtime");
const sceneModel = require("../renderer/core-scene-plan-model"), { normalizeRequest } = require("../services/generation/generation-request");
const { harness, asset, clone } = require("./helpers/project-media-harness");
const scene = extra => sceneModel.normalizeScene({ id: "A0", searchQueries: ["city night traffic", "city skyline"], targetKinds: ["video", "image"], orientation: "landscape", generationPrompt: "Cinematic nighttime traffic moving through a modern city", ...extra }, 0, 0);
const ready = { ok: true, value: { ready: true, state: "ready", modelIds: [], providers: [{ id: "muse", ready: true }] } };
const drain = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup(options = {}) {
  const h = harness(); h.state.scenePlan.scenes[0] = scene(); h.api.flush();
  const calls = [], tracked = [], opened = [], changes = []; let ids = 0;
  const runtime = create({ model, persistence: h.api, status: options.status || (async () => ready), id: () => "intent-" + ++ids,
    preferences: () => options.preferences || {}, submit: async request => { calls.push(request); return options.submit ? options.submit(request) : { ok: true, value: job(request) }; },
    track: async value => { tracked.push(value); if (options.track) await options.track(value, h); }, attachmentStatus: options.attachmentStatus,
    openProgress: async id => { opened.push(id); if (options.openProgress) await options.openProgress(id); }, changed: value => changes.push(value) });
  h.window.addEventListener("viral-ai:project-snapshot-restored", () => runtime.invalidate());
  return { ...h, runtime, calls, tracked, opened, changes, get ids() { return ids; } };
}
function job(request) { return { id: "job-" + request.idempotencyKey, projectId: request.projectId, sceneId: request.sceneId, kind: "video", idempotencyKey: request.idempotencyKey, request, status: "queued" }; }
test("derived plan retains exact Scene ID/query order/prompt/kinds/orientation and deep freezes only derived data", () => {
  const input = scene(), before = clone(input), plan = model.buildSceneActionPlan(input);
  assert.equal(plan.sceneId, "A0"); assert.deepEqual(plan.search.queries, input.searchQueries); assert.deepEqual(plan.search.targetKinds, ["video", "image"]);
  assert.equal(plan.search.orientation, "landscape"); assert.equal(plan.generation.prompt, input.generationPrompt); assert(plan.search.available && plan.generation.available);
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.search) && Object.isFrozen(plan.search.queries) && Object.isFrozen(plan.generation)); assert.deepEqual(input, before); assert(!Object.isFrozen(input));
});
test("Scene model owns normalized duplicate queries/limits; projection never synthesizes a mega-query", () => {
  const input = scene({ searchQueries: [" city night traffic ", "CITY NIGHT TRAFFIC", "second", ...Array.from({ length: 20 }, (_, i) => "q" + i)] });
  const p = model.buildSceneActionPlan(input); assert.equal(p.search.queries.length, 8); assert.equal(p.search.queries[0], "city night traffic"); assert.equal(p.search.queries[1], "second");
  assert.equal(model.buildSceneActionPlan(scene({ generationPrompt: "p".repeat(2000) })).generation.prompt.length, 1600);
});
for (const fallback of ["sourceText", "visualIntent", "title"]) test("no " + fallback + " or global brief fallback when planned inputs missing", () => {
  const p = model.buildSceneActionPlan(scene({ searchQueries: [], generationPrompt: null, [fallback]: "Never execute this", brief: "global" }));
  assert.equal(p.search.available, false); assert.equal(p.generation.available, false); assert.deepEqual(p.search.queries, []); assert.equal(p.generation.prompt, null);
});
test("image-only Scene searches image but cannot generate video; absent Scene/kinds fail closed", () => {
  const p = model.buildSceneActionPlan(scene({ targetKinds: ["image"] })); assert(p.search.available); assert(!p.generation.available);
  assert(!model.buildSceneActionPlan(null).search.available); assert(!model.buildSceneActionPlan({ id: "x", targetKinds: [], searchQueries: ["x"] }).search.available);
});
for (const orientation of ["any", "portrait", "landscape", "square"]) test("orientation is existing Scene value " + orientation, () => assert.equal(model.buildSceneActionPlan(scene({ orientation })).search.orientation, orientation));
test("stock begin captures exact query/kind/orientation/IDs and preserves Scene after edits", () => {
  const h = setup(), c = h.runtime.beginSearch("A", "A0", { query: "city skyline", kind: "image" });
  assert(Object.isFrozen(c)); assert.equal(c.query, "city skyline"); assert.equal(c.kind, "image"); assert.equal(c.orientation, "landscape"); assert.equal(c.sceneId, "A0"); assert(h.runtime.acceptsSearch(c));
  h.state.scenePlan.scenes[0].searchQueries = ["new query"]; h.api.flush(); assert.equal(c.query, "city skyline"); assert(h.runtime.acceptsSearch(c));
  assert(!h.runtime.acceptsSearch({ ...c })); assert.throws(() => h.runtime.beginSearch("A", "A0", { query: "global brief" }), /SCENE_ACTION_INVALID/);
});
for (const race of ["select", "reorder", "delete", "switch"]) test("stock action and Block 4 admission remain Scene-ID scoped through " + race, () => {
  const h = setup(), context = h.runtime.beginSearch("A", "A0"), c = h.operations.begin({ projectId: "A", sceneId: context.sceneId, intent: "candidate" });
  if (race === "select") h.api.selectProjectScene("A1", { projectId: "A" });
  if (race === "reorder") h.api.moveProjectScene("A0", 1, { projectId: "A" });
  if (race === "delete") h.api.removeProjectScene("A0", { projectId: "A" });
  if (race === "switch") { h.api.openProject("B"); const before = h.data.get("viral-ai-core-project-registry-v1"); assert(!h.runtime.acceptsSearch(context)); assert.throws(() => h.operations.admit(c, [asset("stock", "video", "stock")]), /PROJECT_CHANGED/); assert.equal(h.data.get("viral-ai-core-project-registry-v1"), before); return; }
  const result = h.operations.admit(c, [asset("stock", "video", "stock")]);
  if (race === "delete") { assert.equal(result.status, "scene-failed"); assert(!h.runtime.acceptsSearch(context)); assert.equal(h.api.snapshot().media.assets.length, 1); }
  else { assert.deepEqual(h.api.snapshot().mediaAssembly.slots.find(s => s.sceneId === "A0").candidateAssetIds, ["stock"]); assert.equal(h.api.snapshot().mediaAssembly.slots.find(s => s.sceneId === "A0").selectedAssetId, null); }
  assert(!h.api.snapshot().mediaAssembly.slots.some(s => s.sceneId === "A1"));
});
test("Scene Generate uses exact captured prompt, never global brief, and tracks exact admitted job", async () => {
  const h = setup(); h.c.localStorage.setItem("viral-ai-generation-brief", "Never use global prompt"); const before = h.data.get("viral-ai-core-project-registry-v1");
  const result = await h.runtime.generate("A", "A0"); assert(result.ok); assert.equal(h.calls.length, 1);
  const r = h.calls[0]; assert.equal(r.prompt, scene().generationPrompt); assert.equal(r.projectId, "A"); assert.equal(r.sceneId, "A0"); assert.equal(r.mode, "text-to-video"); assert.equal(r.kind, "video");
  assert.strictEqual(h.tracked[0].request, r); assert.deepEqual(h.opened, ["job-intent-1"]); assert.equal(h.data.get("viral-ai-core-project-registry-v1"), before, "runtime never persists loading/progress or fabricates assets");
});
test("Muse request excludes model/source/references/specs and satisfies locked normalization", async () => {
  const h = setup({ preferences: { duration: "10", aspect: "16:9", goal: "quality", modelId: "bad", resolution: "8k" } }); await h.runtime.generate("A", "A0"); const r = h.calls[0];
  assert.equal(r.providerId, "muse"); for (const name of ["modelId", "sourceAssetId", "referenceAssetIds", "resolution", "durationSeconds", "aspectRatio", "withAudio"]) assert(!Object.hasOwn(r, name));
  assert.equal(normalizeRequest(r).providerId, "muse");
});
test("non-Muse uses only existing AI Create preferences, never Scene duration/orientation", async () => {
  const h = setup({ status: async () => ({ ok: true, value: { ready: true, state: "ready", modelIds: ["local:wan"], providers: [{ id: "local", ready: true }] } }), preferences: { aspect: "16:9", duration: "10", goal: "quality" } });
  await h.runtime.generate("A", "A0"); const r = h.calls[0]; assert(!Object.hasOwn(r, "providerId")); assert.equal(r.durationSeconds, 10); assert.equal(r.aspectRatio, "16:9"); assert.equal(r.goal, "quality"); assert.equal(normalizeRequest(r).mode, "text-to-video");
});
test("invalid preferences use existing bounded defaults rather than invented duration", () => {
  const r = model.buildGenerationRequest({ projectId: "A", sceneId: "A0", prompt: "P", idempotencyKey: "key" }, { ready: true, state: "ready", modelIds: ["local:wan"] }, { duration: "23", aspect: "square", goal: "auto" });
  assert.equal(r.durationSeconds, 5); assert.equal(r.aspectRatio, "9:16"); assert.equal(r.goal, "balanced"); assert.doesNotThrow(() => normalizeRequest(r));
});
test("duplicate calls/rerender share one pending intent; later explicit action gets fresh key", async () => {
  const wait = deferred(), h = setup({ submit: async r => { await wait.promise; return { ok: true, value: job(r) }; } });
  const a = h.runtime.generate("A", "A0"), b = h.runtime.generate("A", "A0"); assert.strictEqual(a, b); await drain(); assert.equal(h.calls.length, 1); assert.equal(h.ids, 1);
  h.api.selectProjectScene("A1", { projectId: "A" }); h.api.selectProjectScene("A0", { projectId: "A" }); assert.strictEqual(h.runtime.generate("A", "A0"), a);
  wait.resolve(); await a; assert(!h.runtime.busy("A", "A0")); await h.runtime.generate("A", "A0"); assert.equal(h.calls.length, 2); assert.notEqual(h.calls[0].idempotencyKey, h.calls[1].idempotencyKey);
});
for (const mode of ["reject", "failure", "busy", "not-ready"]) test("submission " + mode + " is truthful and never auto-retries or creates candidate", async () => {
  const h = setup({ status: mode === "not-ready" ? async () => ({ ok: true, value: { ready: false, state: "not_configured" } }) : undefined,
    submit: mode === "reject" ? async () => { throw Error("private network failure"); } : async () => ({ ok: false, errorCode: mode === "busy" ? "DUPLICATE_JOB" : "REQUEST_FAILED" }) });
  const result = await h.runtime.generate("A", "A0"); await drain(); assert(!result.ok); assert.equal(h.calls.length, mode === "not-ready" ? 0 : 1); assert.equal(h.ids, 1); assert.equal(h.tracked.length, 0);
  assert.equal(h.api.snapshot().media.assets.length, 0); assert(!JSON.stringify(h.runtime.state("A", "A0")).includes("private")); assert.equal(h.runtime.state("A", "A0").state, "failed");
  if (mode === "reject" || mode === "failure") assert.equal(result.reason, "SCENE_SUBMIT_UNCERTAIN");
});
test("uncertain result needs a new explicit action for a new key, never a readiness tick", async () => {
  const h = setup({ submit: async () => { throw Error("lost response"); } }); await h.runtime.generate("A", "A0"); await drain(); assert.equal(h.calls.length, 1);
  await h.runtime.generate("A", "A0"); assert.equal(h.calls.length, 2); assert.notEqual(h.calls[0].idempotencyKey, h.calls[1].idempotencyKey);
});
test("generic IPC UNAVAILABLE after submit is uncertain, not proof that no request was accepted", async () => {
  const h = setup({ submit: async () => ({ ok: false, errorCode: "UNAVAILABLE" }) });
  assert.equal((await h.runtime.generate("A", "A0")).reason, "SCENE_SUBMIT_UNCERTAIN");
  await drain(); assert.equal(h.calls.length, 1); assert.equal(h.ids, 1); assert.equal(h.tracked.length, 0);
});
for (const race of ["select", "reorder", "delete", "edit", "switch", "switch-back"]) test("generation captured identity/prompt survive " + race + " without opening unrelated progress", async () => {
  const wait = deferred(), h = setup({ submit: async r => { await wait.promise; return { ok: true, value: job(r) }; } });
  const p = h.runtime.generate("A", "A0"); await drain(); const r = h.calls[0];
  if (race === "select") h.api.selectProjectScene("A1", { projectId: "A" });
  if (race === "reorder") h.api.moveProjectScene("A0", 1, { projectId: "A" });
  if (race === "delete") h.api.removeProjectScene("A0", { projectId: "A" });
  if (race === "edit") { h.state.scenePlan.scenes[0].generationPrompt = "Edited later"; h.api.flush(); }
  if (race.startsWith("switch")) { h.api.openProject("B"); if (race === "switch-back") h.api.openProject("A"); }
  const before = h.data.get("viral-ai-core-project-registry-v1"); wait.resolve(); assert((await p).ok); assert.equal(h.tracked[0].sceneId, "A0"); assert.equal(h.tracked[0].request.prompt, r.prompt); assert.equal(h.tracked.length, 1);
  assert.equal(h.data.get("viral-ai-core-project-registry-v1"), before); assert.equal(h.opened.length, ["select", "delete", "switch", "switch-back"].includes(race) ? 0 : 1); assert(!h.runtime.busy("A", "A0"));
});
test("Project switch during readiness prevents unsubmitted work, no request on B", async () => {
  const wait = deferred(), h = setup({ status: () => wait.promise }), p = h.runtime.generate("A", "A0"); await drain(); h.api.openProject("B"); wait.resolve(ready); assert(!(await p).ok); assert.equal(h.calls.length, 0); assert.equal(h.tracked.length, 0);
});
test("handoff failure is reported without resubmission or deleted Scene recreation", async () => {
  const h = setup({ track: async (j, state) => state.api.registerGenerationJob(j) });
  const wait = deferred(); const h2 = setup({ submit: async r => { await wait.promise; return { ok: true, value: job(r) }; }, track: async (j, state) => state.api.registerGenerationJob(j) });
  const p = h2.runtime.generate("A", "A0"); await drain(); h2.api.removeProjectScene("A0", { projectId: "A" }); wait.resolve(); const result = await p;
  assert.equal(result.reason, "SCENE_ATTACHMENT_FAILED"); assert.equal(h2.calls.length, 1); assert.equal(h2.api.snapshot().scenePlan.scenes.length, 1); assert.equal(h2.api.snapshot().scenePlan.scenes[0].id, "A1");
  assert((await h.runtime.generate("A", "A0")).ok); assert.equal(h.api.generationOutputJobs()[0].sceneId, "A0");
});
test("observer-reported attachment error and progress failure are not fake resubmission", async () => {
  const h = setup({ attachmentStatus: () => "error" }); assert.equal((await h.runtime.generate("A", "A0")).reason, "SCENE_ATTACHMENT_FAILED"); assert.equal(h.opened.length, 0); assert.equal(h.calls.length, 1);
  const h2 = setup({ openProgress: async () => { throw Error("DOM unavailable"); } }); assert((await h2.runtime.generate("A", "A0")).ok); assert.equal(h2.runtime.state("A", "A0").reason, "SCENE_PROGRESS_UNAVAILABLE"); assert.equal(h2.calls.length, 1);
});
test("mismatched returned job never tracks unrelated Project/Scene/prompt/key", async () => {
  for (const patch of [{ projectId: "B" }, { sceneId: "A1" }, { idempotencyKey: "other" }, { request: { prompt: "other" } }, { kind: "image" }]) {
    const h = setup({ submit: async r => ({ ok: true, value: { ...job(r), ...patch } }) }); assert(!(await h.runtime.generate("A", "A0")).ok); assert.equal(h.tracked.length, 0); assert.equal(h.opened.length, 0);
  }
});
test("manual Scene and image-only unavailable generation do not consume intent or readiness", async () => {
  const h = setup(); for (const s of [scene({ searchQueries: [], generationPrompt: null }), scene({ targetKinds: ["image"] })]) { h.state.scenePlan.scenes[0] = s; h.api.flush(); assert(!(await h.runtime.generate("A", "A0")).ok); }
  assert.equal(h.calls.length, 0); assert.equal(h.ids, 0); assert.throws(() => h.runtime.beginSearch("B", "A0"), /SCENE_PROJECT_CHANGED/);
});
test("restart creates no actions/search/submit and no orchestration state is persisted", async () => {
  const h = setup(); await h.runtime.generate("A", "A0"); const restarted = harness(h.data); let submissions = 0;
  const runtime = create({ model, persistence: restarted.api, id: () => "unused", status: () => { assert.fail(); }, submit: () => submissions++, track: () => assert.fail() });
  await drain(); assert.equal(runtime.state("A", "A0").state, "idle"); assert.equal(submissions, 0); assert(!h.data.get("viral-ai-core-project-registry-v1").includes("generating"));
});
test("UI/discovery contracts use existing drawer/handoff and matching centralized VI/EN keys", () => {
  const c = { window: {} }; vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), c);
  assert.deepEqual(Object.keys(c.window.I18N.messages.vi.sceneActions), Object.keys(c.window.I18N.messages.en.sceneActions));
  const ui = fs.readFileSync("renderer/core-scene-orchestration.js", "utf8"), discovery = fs.readFileSync("renderer/core-media-discovery.js", "utf8");
  assert(discovery.includes("runtime.acceptsSearch(detail.context)")); assert(discovery.includes("projectMedia().admit(context, [acquired])")); assert(discovery.includes("plannedSearch.queries.includes(query)"));
  for (const forbidden of ["state.media =", "generation-brief", "setInterval(", "createMuseProvider", "attachGeneratedOutput("]) assert(!ui.includes(forbidden));
  assert(ui.includes("submit: request => window.desktopAPI.submitGeneration(request)")); assert(ui.includes("track: job => window.ViralCoreGeneratedMedia.track(job)"));
  assert(ui.includes("data-scene-action-status role=\"status\" aria-live=\"polite\"")); assert(ui.includes("Video") === false);
});
