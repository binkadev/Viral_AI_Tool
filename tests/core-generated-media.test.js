"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const model = require("../renderer/core-project-scene-plan");
const media = require("../renderer/core-media-library-model");
const scenes = require("../renderer/core-scene-plan-model");
const KEY = "viral-ai-core-project-registry-v1";
const json = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const app = fs.readFileSync("renderer/app.js", "utf8");
const job = { id: "fixture-generation", kind: "video", provider: "fixture", projectId: "project-a", sceneId: "scene-a",
  status: "completed", asset: { fileName: "fixture-generation.mp4" }, output: { fileName: "fixture-generation.mp4" } };
const output = { jobId: job.id, projectId: job.projectId, sceneId: job.sceneId, verified: true,
  fileName: job.output.fileName, path: "C:/app-owned/fixture-generation.mp4" };
const meta = { duration: 3, width: 320, height: 180 };
function draft(id) {
  return { ...model.createDraftProject({ projectId: "project-" + id, projectName: "Project " + id }),
    scenePlan: scenes.normalizePlan({ scenes: [{ id: "scene-" + id }], selectedSceneId: "scene-" + id }) };
}
function initial() {
  return new Map([[KEY, JSON.stringify({ schemaVersion: 1, activeProjectId: "project-a", projects: [draft("a"), draft("b")] })]]);
}
function harness(data = initial(), options = {}) {
  const events = {}, timers = [], calls = [], notifications = [];
  let fail = false, currentJob = json(job), currentOutput = json(output), currentMeta = json(meta), probeWait;
  let sourceIds = 0, markup = "";
  class Storage {
    getItem(key) { return data.get(key) ?? null; }
    setItem(key, value) { if (fail && key === KEY) throw Error("quota"); data.set(key, String(value)); }
    removeItem(key) { data.delete(key); }
  }
  const localStorage = new Storage();
  const state = { page: "home", locale: "en", jobs: [], cloud: { global: true }, appearance: "dark" };
  const listen = (name, fn) => { (events[name] ||= []).push(fn); };
  const window = { ViralCoreProjectSnapshot: model, ViralCoreMediaLibraryModel: media, ViralCoreScenePlanModel: scenes,
    crypto: { randomUUID: () => "unused-draft" }, addEventListener: listen,
    dispatchEvent: event => { notifications.push(event); for (const fn of events[event.type] || []) fn(event); },
    desktopAPI: {
      onGenerationChanged: fn => { listen("generation", fn); return () => {}; },
      getGenerationJob: async id => { calls.push(["get", id]); return { ok: true, value: json(currentJob) }; },
      getGenerationOutput: async id => { calls.push(["output", id]); return { ok: !!currentOutput, value: json(currentOutput) }; },
      probeVideo: async () => { calls.push(["probe"]); if (probeWait) await probeWait; return currentMeta; },
      fileStatus: async () => ({ exists: true }),
      createThumbnail: async () => ({ metadata: meta, dataUrl: "fixture-thumbnail" }),
      getVideoUrl: async path => { calls.push(["preview", path]); return "fixture-preview://local-video"; }
    } };
  for (const name of ["submitGeneration", "recoverGeneration", "cancelGeneration", "acquireGenerationResult", "prepareGeneration"]) {
    window.desktopAPI[name] = () => { calls.push([name]); throw Error("FORBIDDEN_EXECUTION"); };
  }
  const c = { window, state, Storage, localStorage,
    document: { readyState: "loading", addEventListener: listen, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    HTMLVideoElement: class {}, HTMLElement: class {}, MutationObserver: class { observe() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: (fn, ms) => { if (ms === 0) timers.push(fn); return 1; }, clearTimeout() {}, requestAnimationFrame() {},
    console, t: key => key, escapeHtml: String, mediaMetaText: () => "metadata", toast() {},
    makeJobId: () => "source-" + (++sourceIds),
    save() { window.ViralCoreProjectPersistence.flush("fixture-save"); },
    render() { if (state.page === "ai-video") markup = c.studioPreview().preview; }
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync("renderer/core-project-persistence.js", "utf8"), c);
  const api = window.ViralCoreProjectPersistence;
  Object.assign(state, model.toLegacyState(api.snapshot()), { projectId: api.activeProjectId() });
  // Execute the real Studio source resolver and preview template, not a
  // generation-only player or a fabricated preview renderer.
  const sourceStart = app.indexOf("function latestSourceJob()");
  vm.runInContext(app.slice(sourceStart, app.indexOf("\n}", sourceStart) + 2), c);
  const previewStart = app.indexOf("  const sourceName =", app.indexOf("function aiVideoPage()"));
  const previewEnd = app.indexOf("  const localSelected =", previewStart);
  vm.runInContext("function studioPreview(){const source=latestSourceJob();" + app.slice(previewStart, previewEnd) + "return {sourceName,preview};}", c);
  const enrichStart = app.indexOf("async function enrichJob(");
  vm.runInContext(app.slice(enrichStart, app.indexOf("\nasync function addFiles", enrichStart)), c);
  const importStart = app.indexOf("function addSourceFiles(");
  vm.runInContext(app.slice(importStart, app.indexOf("\nfunction updateProgressElements", importStart)), c);
  vm.runInContext(fs.readFileSync("renderer/core-media-restore.js", "utf8"), c);
  if (options.controller !== false) vm.runInContext(fs.readFileSync("renderer/core-generated-media.js", "utf8"), c);
  for (const fn of events.DOMContentLoaded || []) fn();
  return { api, window, state, data, calls, c, notifications,
    change: () => { for (const fn of events.generation || []) fn({ id: job.id, status: currentJob.status }); },
    async drain() { for (let i = 0; i < 6; i++) { while (timers.length) await timers.shift()(); await tick(); } },
    get markup() { return markup; },
    set fail(value) { fail = value; }, set job(value) { currentJob = value; },
    set output(value) { currentOutput = value; }, set meta(value) { currentMeta = value; },
    set probeWait(value) { probeWait = value; }
  };
}

test("completed video registers canonical generated asset and Studio source before ordinary navigation", async () => {
  const data = initial(), registry = JSON.parse(data.get(KEY));
  registry.projects[0].editor.panels.leftCollapsed = true;
  registry.projects[0].editor.timeline.zoom = 3;
  data.set(KEY, JSON.stringify(registry));
  const h = harness(data); await h.window.ViralCoreGeneratedMedia.track(job); await h.drain();
  const saved = h.api.snapshot();
  assert.equal(saved.projectId, job.projectId);
  assert.equal(saved.media.assets.length, 1);
  const asset = saved.media.assets[0];
  assert.deepEqual(asset, media.normalizeAsset(asset));
  assert.equal(asset.origin, "generated"); assert.equal(asset.localPath, output.path);
  assert.equal(asset.providerAssetId, job.id); assert.equal(saved.media.selectedAssetId, asset.id);
  assert.equal(saved.source.path, output.path);
  assert.equal(saved.workflow.jobs[0].generationJobId, job.id);
  assert.equal(saved.workflow.jobs[0].projectId, job.projectId); assert.equal(saved.workflow.jobs[0].sceneId, job.sceneId);
  assert.equal(saved.scenePlan.selectedSceneId, job.sceneId);
  assert.equal(saved.editor.panels.leftCollapsed, true); assert.equal(saved.editor.timeline.zoom, 3);
  assert.equal(saved.editor.playback.position, 0); assert.equal(saved.editor.playback.sourcePath, output.path);
  assert.equal(saved.workflow.generationOutputs[0].assetId, asset.id);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "attached");
  h.state.page = "ai-video"; h.c.render();
  assert(h.markup.includes('<video class="preview-video"')); assert(h.markup.includes("fixture-preview://local-video"));
  assert(h.calls.some(call => call[0] === "preview" && call[1] === output.path));
});

test("notifications, concurrent observation, rerenders, restart and restores do not duplicate records", async () => {
  const h = harness(); await h.window.ViralCoreGeneratedMedia.track(job);
  for (let i = 0; i < 8; i++) { h.change(); h.c.render(); }
  await Promise.all([h.window.ViralCoreGeneratedMedia.observe(job.id), h.window.ViralCoreGeneratedMedia.track(job)]);
  await h.drain();
  const original = h.api.snapshot();
  const restarted = harness(h.data); await restarted.drain();
  // Fresh app state may omit additive fields: hydration must retain enrollment.
  delete restarted.state.generationOutputs; restarted.api.flush("restart");
  assert.equal(restarted.api.snapshot().workflow.generationOutputs.length, 1);
  assert.equal(restarted.api.snapshot().media.assets.length, 1); assert.equal(restarted.state.jobs.length, 1);
  assert.equal(restarted.api.snapshot().source.path, output.path);
  assert.equal(restarted.api.snapshot().media.assets[0].id, original.media.assets[0].id);
  restarted.state.page = "ai-video"; restarted.c.render(); assert(restarted.markup.includes("<video"));
  assert(!restarted.calls.some(call => call[0] === "output"), "attached entries need no historical output lookup");
});

test("pending admitted output resumes after restart without scanning generation history", async () => {
  const h = harness(); h.job = { ...job, status: "running" };
  await h.window.ViralCoreGeneratedMedia.track({ ...job, status: "running" });
  const restarted = harness(h.data); await restarted.drain();
  assert.equal(restarted.api.snapshot().media.assets.length, 1);
  assert(restarted.calls.some(call => call[0] === "get" && call[1] === job.id));
  assert(!restarted.calls.some(call => call[0] === "list"));
});

test("the real Create AI submit handler enrolls the admitted job and ordinary Studio navigation plays it", async () => {
  const h = harness(); let submitted = 0, opened = 0;
  vm.runInContext(fs.readFileSync("renderer/i18n.js", "utf8"), h.c);
  h.window.ViralGenerationProgress = { open: async id => { assert.equal(id, job.id); opened++; } };
  h.window.desktopAPI.submitGeneration = async request => {
    submitted++; assert.equal(request.projectId, job.projectId); assert.equal(request.sceneId, job.sceneId);
    assert.equal(h.api.snapshot().projectId, request.projectId);
    return { ok: true, value: json(job) }; // Fixture admission only; no provider.
  };
  const ai = fs.readFileSync("renderer/core-ai-create.js", "utf8");
  vm.runInContext(`
    let submitting=false, submissionKey='fixture-key', feedback='', museSession=false;
    const canGenerate=()=>!submitting, currentBrief=()=>'fixture prompt', updateGenerationControls=()=>{};
    const copy=()=>window.I18N.messages.en.aiCreate, selectedGoal=()=>'balanced', selectedOption=(_n,_v,f)=>f;
    const projectIdentity=()=>({projectId:window.ViralCoreProjectPersistence.activeProjectId()});
  ` + ai.slice(ai.indexOf("  async function generate()"), ai.indexOf("  function format(")), h.c);
  await h.c.generate(); await h.drain();
  assert.equal(submitted, 1); assert.equal(opened, 1);
  assert.equal(h.api.snapshot().workflow.generationOutputs[0].jobId, job.id);
  assert.equal(h.api.snapshot().media.assets.length, 1);
  h.state.page = "ai-video"; h.c.render(); assert(h.markup.includes("<video"));
});

test("an attached reference is retained after explicit removal, so restart does not silently reimport it", async () => {
  const h = harness(); await h.window.ViralCoreGeneratedMedia.track(job); await h.drain();
  h.state.media.assets = []; h.state.media.selectedAssetId = null; h.state.jobs = [];
  h.api.flush("explicit-user-removal");
  const restarted = harness(h.data); await restarted.drain(); restarted.change(); await restarted.drain();
  assert.equal(restarted.state.media.assets.length, 0); assert.equal(restarted.state.jobs.length, 0);
  assert(!restarted.calls.some(call => call[0] === "output"));
});

test("scene removal while output is being observed cannot retarget or publish the asset", async () => {
  const h = harness(); let finish; h.probeWait = new Promise(resolve => { finish = resolve; });
  const pending = h.window.ViralCoreGeneratedMedia.track(job); await tick();
  h.state.scenePlan.scenes = []; h.state.scenePlan.selectedSceneId = null; h.api.flush("scene-removed");
  finish(); await pending; await h.drain();
  assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(h.state.jobs.length, 0);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
});

test("local-path collision cannot create a second asset under a different canonical identity", async () => {
  const h = harness();
  h.state.media = media.addAssets(h.state.media, [{ id: "explicit-import", origin: "local", kind: "video",
    localPath: output.path.replace(/\//g, "\\"), status: "ready" }]).library;
  h.api.flush("explicit-import");
  await h.window.ViralCoreGeneratedMedia.track(job); await h.drain();
  assert.equal(h.api.snapshot().media.assets.length, 1); assert.equal(h.state.jobs.length, 0);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
});

test("completion after a project switch attaches to original inactive project without changing current UI", async () => {
  const h = harness(); let finish;
  h.probeWait = new Promise(resolve => { finish = resolve; });
  const pending = h.window.ViralCoreGeneratedMedia.track(job); await tick();
  h.api.openProject("project-b"); const currentBefore = json(h.state);
  finish(); await pending; await h.drain();
  assert.equal(h.api.activeProjectId(), "project-b"); assert.deepEqual(json(h.state), currentBefore);
  assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(h.state.jobs.length, 0);
  h.api.openProject(job.projectId); await h.drain();
  assert.equal(h.state.media.assets.length, 1); assert.equal(h.state.jobs[0].sceneId, job.sceneId);
  h.state.page = "ai-video"; h.c.render(); assert(h.markup.includes("<video"));
});

for (const status of ["queued", "preparing", "submitting", "running", "verifying", "interrupted", "failed", "cancelled"]) {
  test(status + " output cannot attach", async () => {
    const h = harness(); h.job = { ...job, status };
    await h.window.ViralCoreGeneratedMedia.track({ ...job, status }); await h.drain();
    assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(h.state.jobs.length, 0);
    assert(!h.calls.some(call => call[0] === "output"));
  });
}

for (const scenario of ["unverified", "missing", "unusable", "wrong-project", "wrong-scene", "wrong-job", "no-asset"]) {
  test("rejects " + scenario + " output without publishing project media", async () => {
    const h = harness();
    if (scenario === "unverified") h.output = { ...output, verified: false };
    if (scenario === "missing") h.output = null;
    if (scenario === "unusable") h.meta = { duration: 0 };
    if (scenario === "wrong-project") h.output = { ...output, projectId: "project-b" };
    if (scenario === "wrong-scene") h.output = { ...output, sceneId: "scene-b" };
    if (scenario === "wrong-job") h.output = { ...output, jobId: "someone-else" };
    if (scenario === "no-asset") h.job = { ...job, asset: null };
    await h.window.ViralCoreGeneratedMedia.track(job); await h.drain();
    assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(h.state.jobs.length, 0);
    assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
  });
}

test("failed durable attachment write preserves runtime and pending evidence; local observation can retry", async () => {
  const h = harness(); let finish; h.probeWait = new Promise(resolve => { finish = resolve; });
  const pending = h.window.ViralCoreGeneratedMedia.track(job); await tick();
  const before = h.data.get(KEY); h.fail = true; finish(); await pending;
  assert.equal(h.data.get(KEY), before); assert.equal(h.state.jobs.length, 0); assert.equal(h.state.media.assets.length, 0);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
  h.fail = false; await h.window.ViralCoreGeneratedMedia.observe(job.id); await h.drain();
  assert.equal(h.api.snapshot().media.assets.length, 1); assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "attached");
});

test("real progress UI reports a handoff write failure without an automatic observation/retry loop", async () => {
  const h = harness(); h.job = { ...job, status: "running" };
  await h.window.ViralCoreGeneratedMedia.track({ ...job, status: "running" });
  h.job = job; h.fail = true; let lists = 0, html = "";
  h.window.ViralGenerationProgressModel = require("../renderer/core-generation-progress-model");
  h.window.desktopAPI.listGenerationJobs = async () => {
    if (++lists > 10) throw Error("UNBOUNDED_REFRESH");
    return { ok: true, value: [json(job)] };
  };
  h.window.desktopAPI.getGenerationStatus = async () => ({ ok: true, value: { state: "ready", ready: true } });
  h.c.pages = {}; h.c.pageMeta = {}; h.c.Element = class {};
  h.c.document.readyState = "complete"; h.c.document.activeElement = null;
  h.c.document.getElementById = () => ({ scrollTop: 0, querySelector: () => null });
  h.c.render = () => { html = h.c.pages[h.state.page]?.() || ""; };
  vm.runInContext(fs.readFileSync("renderer/i18n.js", "utf8"), h.c);
  vm.runInContext(fs.readFileSync("renderer/core-generation-progress.js", "utf8"), h.c);
  await h.window.ViralGenerationProgress.open(job.id); await h.drain();
  assert(html.includes(h.window.I18N.messages.en.generationProgress.attachmentError));
  assert.equal(lists, 1); assert.equal(h.state.media.assets.length, 0);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
});

test("failed enrollment and missing project/scene cannot attach or claim success", async () => {
  for (const variant of ["quota", "project", "scene"]) {
    const h = harness(); h.fail = variant === "quota";
    await h.window.ViralCoreGeneratedMedia.track({ ...job, projectId: variant === "project" ? "missing" : job.projectId,
      sceneId: variant === "scene" ? "missing" : job.sceneId });
    assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "error");
    assert.equal(h.state.media.assets.length, 0); assert.equal(h.state.jobs.length, 0);
    assert(!h.calls.some(call => call[0] === "output"));
    if (variant === "quota") {
      h.fail = false; await h.window.ViralCoreGeneratedMedia.observe(job.id); await h.drain();
      assert.equal(h.api.snapshot().media.assets.length, 1);
    }
  }
});

test("historical completed jobs are not enrolled by notifications, navigation or restart", async () => {
  const h = harness(); h.change(); await h.window.ViralCoreGeneratedMedia.observe(job.id); await h.drain();
  assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.window.ViralCoreGeneratedMedia.status(job.id), "untracked");
});

test("ordinary imported video still uses the shared source registration, enrichment and Studio preview", async () => {
  const h = harness(); const path = "C:/existing/import.mp4";
  const returned = h.c.addSourceFiles([{ name: "import.mp4", path }]); await h.drain();
  assert.equal(returned.length, 1); assert.equal(h.state.jobs[0].sourcePath, path);
  assert.equal(h.state.jobs[0].previewUrl, "fixture-preview://local-video");
  assert.equal(h.api.snapshot().source.path, path);
  h.state.page = "ai-video"; h.c.render(); assert(h.markup.includes("<video"));
  const count = h.state.jobs.length;
  await h.window.ViralCoreGeneratedMedia.track(job); await h.drain();
  assert.equal(h.state.jobs.length, count + 1); assert.equal(h.state.jobs[0].sourcePath, path);
  assert.equal(h.api.snapshot().source.path, path, "attachment preserves existing Studio selection");
});

test("handoff has no provider execution, byte copy, historical scanner or parallel player API", () => {
  const runtime = fs.readFileSync("renderer/core-generated-media.js", "utf8");
  for (const name of ["submitGeneration(", "prepareGeneration(", "recoverGeneration(", "inspectGeneration(",
    "acquireGenerationResult(", "listGenerationJobs(", "copyFile", "writeFile", "setInterval", "<video"]) assert(!runtime.includes(name), name);
  const index = fs.readFileSync("renderer/index.html", "utf8");
  assert(index.includes('src="core-generated-media.js"'));
  assert(fs.readFileSync("renderer/core-ai-create.js", "utf8").includes("ViralCoreGeneratedMedia?.track(result.value)"));
});
