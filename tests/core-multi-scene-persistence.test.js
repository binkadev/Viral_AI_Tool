"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const model = require("../renderer/core-project-media-assembly"), scenes = require("../renderer/core-scene-plan-model");
const KEY = "viral-ai-core-project-registry-v1", json = v => JSON.parse(JSON.stringify(v));
function draft(id, count) {
  const p = model.createDraftProject({ projectId: id, projectName: id }, {}, {}, 0);
  p.scenePlan = scenes.normalizePlan({ scenes: Array.from({ length: count }, (_, i) => ({ id: id + "-" + i, order: i,
    start: i * 3, end: i * 3 + 2, sourceText: "Source " + i, sourceSegmentIds: [id + "-segment-" + i] })), selectedSceneId: id + "-0" }, { now: 0 });
  p.media = { schemaVersion: 1, selectedAssetId: "X", assets: ["X", "Y", "Z"].map(id => ({ id, kind: "video", origin: "local", name: id, localPath: "C:/" + id + ".mp4", createdAt: new Date(0).toISOString() })) };
  return model.migrateSnapshot(p).snapshot;
}
function harness(data = new Map([[KEY, JSON.stringify({ schemaVersion: 1, activeProjectId: "A", projects: [draft("A", 4), draft("B", 2)] })]])) {
  let fail = false, writes = 0, inspect;
  const events = [], listeners = {};
  class Storage {
    getItem(k) { return data.get(k) ?? null; }
    setItem(k, v) { if (k === KEY) { writes++; inspect?.(); if (fail) throw Error("quota"); } data.set(k, String(v)); }
    removeItem(k) { data.delete(k); }
  }
  const state = { page: "home", jobs: [], projectId: "A", locale: "en" };
  const window = { ViralCoreProjectSnapshot: model, ViralCoreScenePlanModel: scenes, crypto,
    addEventListener: (n, f) => (listeners[n] ||= []).push(f), dispatchEvent: e => { events.push(e); for (const f of listeners[e.type] || []) f(e); } };
  const c = { window, state, Storage, localStorage: new Storage(), crypto, console,
    document: { readyState: "loading", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    HTMLElement: class {}, HTMLVideoElement: class {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {} };
  vm.runInNewContext(fs.readFileSync("renderer/core-project-persistence.js", "utf8"), c);
  const api = window.ViralCoreProjectPersistence;
  if (api.snapshot()) Object.assign(state, json(model.toLegacyState(api.snapshot())), { projectId: api.activeProjectId(), page: api.snapshot().editor.page });
  return { api, state, data, events, c, window, get writes() { return writes; }, set fail(v) { fail = v; }, set inspect(v) { inspect = v; } };
}
const options = { projectId: "A" };
const BRIEF_KEY = "viral-ai-generation-brief";
const sceneMutations = [["add", h => h.api.addProjectScene({ id: "new" }, options)], ["select", h => h.api.selectProjectScene("A-2", options)],
  ["move", h => h.api.moveProjectScene("A-0", 3, options)], ["remove", h => h.api.removeProjectScene("A-0", options)]];
for (const [label, mutate] of sceneMutations) {
  test(label + " preserves a brief written before the debounce flush, including after restart", () => {
    const h = harness(); h.c.localStorage.setItem(BRIEF_KEY, "old brief"); h.api.flush();
    assert.equal(h.api.snapshot().workflow.generationBrief, "old brief");
    h.c.localStorage.setItem(BRIEF_KEY, "new unsaved brief");
    assert.equal(h.api.snapshot().workflow.generationBrief, "old brief", "debounced save has not run");
    const writes = h.writes; mutate(h);
    assert.equal(h.writes, writes + 1, "one authoritative write for pending state and Scene mutation");
    assert.equal(JSON.parse(h.data.get(KEY)).projects.find(p => p.projectId === "A").workflow.generationBrief, "new unsaved brief");
    assert.equal(h.c.localStorage.getItem(BRIEF_KEY), "new unsaved brief");
    const restarted = harness(h.data); assert.equal(restarted.api.snapshot().workflow.generationBrief, "new unsaved brief");
    assert.equal(restarted.c.localStorage.getItem(BRIEF_KEY), "new unsaved brief");
  });
  test(label + " failed durable write preserves pending brief and unrelated live/editor state", () => {
    const h = harness(); h.c.localStorage.setItem(BRIEF_KEY, "old brief"); h.api.flush();
    h.c.localStorage.setItem(BRIEF_KEY, "new unsaved brief");
    h.c.localStorage.setItem(model.LEGACY_UI_KEYS.timelineZoom, "1.75"); h.state.translation.targetLanguage = "vi";
    const state = json(h.state), snapshot = h.api.snapshot(), registry = h.data.get(KEY), events = h.events.length, writes = h.writes;
    h.fail = true; assert.throws(() => mutate(h), /quota/);
    assert.equal(h.writes, writes + 1); assert.equal(h.data.get(KEY), registry); assert.deepEqual(h.api.snapshot(), snapshot);
    assert.deepEqual(json(h.state), state); assert.equal(h.c.localStorage.getItem(BRIEF_KEY), "new unsaved brief");
    assert.equal(h.c.localStorage.getItem(model.LEGACY_UI_KEYS.timelineZoom), "1.75");
    assert(!h.events.slice(events).some(e => e.type === "viral-ai:core-state-changed"));
  });
}
test("stale live Scene Plan and assembly cannot overwrite canonical state while pending brief survives", () => {
  const h = harness(); h.api.addSceneMaterialCandidate("A-0", "X", options); h.api.selectSceneMaterial("A-0", "X", options);
  h.c.localStorage.setItem(BRIEF_KEY, "old brief"); h.api.flush(); const canonical = h.api.snapshot();
  h.state.scenePlan.scenes.reverse(); h.state.scenePlan.scenes[0].sourceText = "bogus";
  h.state.scenePlan.selectedSceneId = "gone"; h.state.scenePlan.scenes.push({ id: "bogus" });
  h.state.mediaAssembly.slots[0].selectedAssetId = "Z"; h.state.mediaAssembly.slots[0].candidateAssetIds = ["Z"];
  h.c.localStorage.setItem(BRIEF_KEY, "new unsaved brief"); const writes = h.writes;
  h.api.selectProjectScene("A-2", options); const after = h.api.snapshot();
  assert.equal(h.writes, writes + 1); assert.deepEqual(after.scenePlan.scenes, canonical.scenePlan.scenes);
  assert.equal(after.scenePlan.selectedSceneId, "A-2"); assert.deepEqual(after.mediaAssembly, canonical.mediaAssembly);
  assert.equal(after.workflow.generationBrief, "new unsaved brief"); assert.equal(h.c.localStorage.getItem(BRIEF_KEY), "new unsaved brief");
});
test("Scene commit captures pending non-Scene semantics and compatibility editor values like normal flush", () => {
  const h = harness(), expected = harness(new Map(h.data));
  for (const item of [h, expected]) {
    item.c.localStorage.setItem(BRIEF_KEY, "new unsaved brief");
    item.c.localStorage.setItem(model.LEGACY_UI_KEYS.timelineZoom, "1.75");
    item.c.localStorage.setItem(model.LEGACY_UI_KEYS.timelineSelection, "audio");
    item.c.localStorage.setItem(model.LEGACY_UI_KEYS.bottomHeight, "360");
    item.c.localStorage.setItem(model.LEGACY_UI_KEYS.inspectorTab, "voice");
    item.state.page = "ai-create"; item.state.output = "C:/pending-output";
    item.state.translation.targetLanguage = "vi"; item.state.voice.assignments = { speaker: "pending-voice" };
    item.state.renderOptions.mixOriginalAudio = false; item.state.media.selectedAssetId = "Y";
  }
  expected.api.flush(); const normal = expected.api.snapshot(), writes = h.writes;
  const live = json(h.state); h.inspect = () => assert.deepEqual(json(h.state), live, "no temporary live state projection");
  h.api.moveProjectScene("A-0", 3, options); h.inspect = null; const after = h.api.snapshot();
  assert.equal(h.writes, writes + 1);
  for (const key of ["workflow", "editor", "media", "source"]) assert.deepEqual(after[key], normal[key], key);
  assert.equal(after.editor.timeline.zoom, 1.75); assert.equal(after.editor.timeline.selection, "audio");
  assert.equal(h.c.localStorage.getItem(model.LEGACY_UI_KEYS.timelineZoom), "1.75");
  const restarted = harness(h.data); for (const key of ["workflow", "editor", "media"]) assert.deepEqual(restarted.api.snapshot()[key], after[key]);
});
for (const [label, mutate] of [["add", h => h.api.addProjectScene({ id: "new" }, options)], ["select", h => h.api.selectProjectScene("A-2", options)],
  ["move", h => h.api.moveProjectScene("A-0", 3, options)], ["remove", h => h.api.removeProjectScene("A-0", options)]]) {
  test(label + " writes before publishing live state/event and restores exactly on restart", () => {
    const h = harness(), before = json(h.state), saved = h.api.snapshot(), count = h.events.length;
    h.inspect = () => { assert.deepEqual(json(h.state), before); assert.deepEqual(h.api.snapshot(), saved); assert.equal(h.events.length, count); };
    mutate(h); h.inspect = null;
    assert(h.events.slice(count).some(e => e.type === "viral-ai:core-state-changed" && e.detail.reason === "project-scene"));
    const restarted = harness(h.data); assert.deepEqual(restarted.api.snapshot().scenePlan, h.api.snapshot().scenePlan);
    assert.deepEqual(json(restarted.state.mediaAssembly), json(h.state.mediaAssembly)); assert.equal(h.api.snapshot().schemaVersion, 5);
    assert.equal(h.api.snapshot().scenePlan.schemaVersion, 1); assert.equal(h.api.snapshot().mediaAssembly.schemaVersion, 1);
  });
  test(label + " durable write failure keeps registry/snapshot/live order/selection/assembly and emits no change", () => {
    const h = harness(); h.api.addSceneMaterialCandidate("A-0", "X", options); h.api.selectSceneMaterial("A-0", "X", options);
    const before = json(h.state), snapshot = h.api.snapshot(), stored = h.data.get(KEY), count = h.events.length; h.fail = true;
    assert.throws(() => mutate(h), /quota/); assert.deepEqual(json(h.state), before); assert.deepEqual(h.api.snapshot(), snapshot);
    assert.equal(h.data.get(KEY), stored); assert(!h.events.slice(count).some(e => e.type === "viral-ai:core-state-changed"));
  });
}
test("explicit identity is mandatory and stale Project A mutations cannot affect B", () => {
  const h = harness(); h.api.openProject("B"); const before = h.data.get(KEY), snapshot = h.api.snapshot();
  for (const fn of [() => h.api.addProjectScene({}), () => h.api.addProjectScene({}, options), () => h.api.selectProjectScene("A-0", options),
    () => h.api.moveProjectScene("A-0", 1, options), () => h.api.removeProjectScene("A-0", options)]) assert.throws(fn, /PROJECT_MISMATCH/);
  assert.equal(h.data.get(KEY), before); assert.deepEqual(h.api.snapshot(), snapshot);
});
test("A/B switching repeatedly and restart retain exact independent content/materials/selection", () => {
  let h = harness();
  for (const id of ["A", "B"]) {
    h.api.openProject(id); const opt = { projectId: id };
    h.api.addSceneMaterialCandidate(id + "-0", id === "A" ? "X" : "Y", opt);
    h.api.selectSceneMaterial(id + "-0", id === "A" ? "X" : "Y", opt);
    h.api.selectProjectScene(id + "-1", opt); h.api.moveProjectScene(id + "-0", 1, opt);
  }
  const expected = Object.fromEntries(JSON.parse(h.data.get(KEY)).projects.map(p => [p.projectId, p]));
  for (let boot = 0; boot < 2; boot++) {
    for (const id of ["A", "B", "A", "B"]) { h.api.openProject(id); const p = h.api.snapshot();
      assert.deepEqual(p.scenePlan, expected[id].scenePlan); assert.deepEqual(p.mediaAssembly, expected[id].mediaAssembly); assert.deepEqual(p.media, expected[id].media); }
    h = harness(h.data);
  }
});
test("remove reconciles only deleted slot; shared canonical media and other references survive", () => {
  const h = harness(), media = json(h.state.media);
  for (const id of ["A-0", "A-1"]) { h.api.addSceneMaterialCandidate(id, "X", options); h.api.selectSceneMaterial(id, "X", options); }
  h.api.moveProjectScene("A-0", 3, options); assert.equal(h.state.mediaAssembly.slots.find(s => s.sceneId === "A-0").selectedAssetId, "X");
  h.api.removeProjectScene("A-0", options);
  assert(!h.state.mediaAssembly.slots.some(s => s.sceneId === "A-0")); assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, "X");
  assert.deepEqual(json(h.state.media), media);
});
test("final Scene removal, bad index, duplicate ID and unknown Scene reject before writing", () => {
  const h = harness(); for (const id of ["A-1", "A-2", "A-3"]) h.api.removeProjectScene(id, options);
  const writes = h.writes;
  assert.throws(() => h.api.removeProjectScene("A-0", options), /PROJECT_FINAL_SCENE/);
  assert.throws(() => h.api.selectProjectScene("gone", options), /PROJECT_SCENE_NOT_FOUND/);
  assert.throws(() => h.api.moveProjectScene("A-0", 1, options), /PROJECT_SCENE_INDEX_INVALID/);
  assert.throws(() => h.api.addProjectScene({ id: "A-0" }, options), /PROJECT_SCENE_DUPLICATE/); assert.equal(h.writes, writes);
});
test("default ID is UUID; no-op selection and reorder cause no write/event", () => {
  const h = harness(), writes = h.writes, count = h.events.length;
  h.api.selectProjectScene("A-0", options); h.api.moveProjectScene("A-0", 0, options);
  assert.equal(h.writes, writes); assert.equal(h.events.length, count);
  const p = h.api.addProjectScene({}, options); assert.match(p.scenePlan.selectedSceneId, /^[0-9a-f-]{36}$/);
  assert.equal(p.scenePlan.scenes.at(-1).provenance.origin, "manual");
});
test("scene selection does not change global media, source, playback, jobs or generation mappings", () => {
  const h = harness(), before = h.api.snapshot(); h.api.selectProjectScene("A-3", options);
  const after = h.api.snapshot(); for (const k of ["media", "source", "editor", "workflow"]) assert.deepEqual(after[k], before[k]);
});
test("jobs retain exact Scene ID through reorder and never attach to selection or deleted Scene", () => {
  const h = harness(), job = { id: "job", projectId: "A", sceneId: "A-0", kind: "video", provider: "fixture", status: "completed",
    output: { fileName: "job.mp4" }, asset: { fileName: "job.mp4" } };
  h.api.registerGenerationJob(job); h.api.moveProjectScene("A-0", 3, options); h.api.selectProjectScene("A-2", options);
  const output = { verified: true, jobId: "job", projectId: "A", sceneId: "A-0", fileName: "job.mp4", path: "C:/outputs/job.mp4" };
  h.api.attachGeneratedOutput(job, output, { duration: 1, width: 320, height: 180 });
  assert.equal(h.api.snapshot().mediaAssembly.slots.find(s => s.sceneId === "A-0").selectedAssetId, "generation:job");
  assert(!h.api.snapshot().mediaAssembly.slots.some(s => s.sceneId === "A-2"));
  h.api.removeProjectScene("A-0", options); const before = h.data.get(KEY);
  assert.throws(() => h.api.attachGeneratedOutput(job, output, { duration: 1 }), /PROJECT_GENERATION_MISMATCH/); assert.equal(h.data.get(KEY), before);
  assert(h.api.snapshot().media.assets.some(a => a.id === "generation:job"));
});
test("uncommitted live Scene changes cannot replace authoritative plan during mutation", () => {
  const h = harness(); h.state.scenePlan.scenes.reverse(); h.state.scenePlan.selectedSceneId = "gone";
  h.api.selectProjectScene("A-2", options); assert.deepEqual(h.state.scenePlan.scenes.map(s => s.id), ["A-0", "A-1", "A-2", "A-3"]);
});
test("bootstrap without legacy runtime Project ID uses captured registry identity; a conflicting ID rejects", () => {
  const h = harness(); delete h.state.projectId;
  h.api.selectProjectScene("A-2", options); assert.equal(h.api.snapshot().scenePlan.selectedSceneId, "A-2");
  h.state.projectId = "B"; const before = h.data.get(KEY);
  assert.throws(() => h.api.removeProjectScene("A-0", options), /PROJECT_STATE_UNAVAILABLE/); assert.equal(h.data.get(KEY), before);
});
test("scene capacity and active planner reject mutations before writing", () => {
  const h = harness(), registry = JSON.parse(h.data.get(KEY));
  registry.projects[0].scenePlan = scenes.normalizePlan({ scenes: Array.from({ length: scenes.MAX_SCENES }, (_, i) => ({ id: "s" + i, order: i })) }, { now: 0 });
  h.data.set(KEY, JSON.stringify(registry)); const full = harness(h.data), writes = full.writes;
  assert.throws(() => full.api.addProjectScene({}, options), /PROJECT_SCENE_LIMIT/); assert.equal(full.writes, writes);
  registry.projects[0].scenePlan.plannerJob.status = "planning";
  // A job already running in this session is protected (bootstrap itself makes stale jobs interrupted).
  full.state.scenePlan.plannerJob.status = "planning"; full.api.flush(); const count = full.writes;
  assert.throws(() => full.api.selectProjectScene("s1", options), /PROJECT_SCENE_BUSY/); assert.equal(full.writes, count);
});

function uiHarness(locale = "en") {
  const h = harness(), handlers = {};
  h.state.locale = locale;
  h.c.document.addEventListener = (type, fn) => { handlers[type] = fn; };
  vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), h.c);
  vm.runInNewContext(fs.readFileSync("renderer/core-project-scenes.js", "utf8"), h.c);
  h.click = async (operation, sceneId, projectId = "A") => handlers.click({ target: { closest: () => ({
    dataset: { projectId, sceneId, projectSceneAction: operation }, disabled: false
  }) } });
  return h;
}
for (const locale of ["vi", "en"]) test(locale + " Scene UI uses canonical state, selected status, counts and localized actions", async () => {
  const h = uiHarness(locale); h.api.addSceneMaterialCandidate("A-0", "X", options); h.api.selectSceneMaterial("A-0", "X", options);
  const markup = h.window.ViralCoreProjectScenes.surface(), copy = h.window.I18N.messages[locale].projectScenes;
  assert(markup.includes(copy.title)); assert(markup.includes(copy.add)); assert(markup.includes(copy.inUse));
  assert.equal((markup.match(/data-project-scene-row=/g) || []).length, 4); assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 1);
  await h.click("select", "A-2"); assert.equal(h.api.snapshot().scenePlan.selectedSceneId, "A-2");
  await h.click("down", "A-0"); assert.equal(h.api.snapshot().scenePlan.scenes[1].id, "A-0");
  await h.click("add", ""); assert.equal(h.api.snapshot().scenePlan.scenes.length, 5);
});
test("stale DOM click carries captured Project identity and cannot mutate B", async () => {
  const h = uiHarness(); h.api.openProject("B"); const before = h.data.get(KEY);
  for (const op of ["add", "select", "delete", "up", "down"]) await h.click(op, "A-0", "A");
  assert.equal(h.data.get(KEY), before);
});
test("meaningful deletion requires product confirmation; stale confirmation cannot retarget another Project", async () => {
  const h = uiHarness(); let finish, asked = false;
  h.c.confirmAction = () => { asked = true; return new Promise(resolve => { finish = resolve; }); };
  h.c.document.querySelector = () => ({ setAttribute() {}, querySelector: () => ({ focus() {}, click() {} }) });
  h.c.document.removeEventListener = () => {};
  const deleting = h.click("delete", "A-0"); assert(asked);
  h.api.openProject("B"); const before = h.data.get(KEY); finish(true); await deleting;
  assert.equal(h.data.get(KEY), before); assert.equal(h.api.activeProjectId(), "B");
});
test("UI cancels meaningful deletion and deletes an empty manual Scene without a dialog", async () => {
  const h = uiHarness(); h.c.confirmAction = () => Promise.resolve(false);
  h.c.document.querySelector = () => ({ setAttribute() {}, querySelector: () => ({ focus() {} }) });
  h.c.document.removeEventListener = () => {};
  const before = h.data.get(KEY); await h.click("delete", "A-0"); assert.equal(h.data.get(KEY), before);
  h.api.addProjectScene({ id: "empty" }, options); h.c.confirmAction = () => { throw Error("UNEXPECTED_DIALOG"); };
  await h.click("delete", "empty"); assert(!h.api.snapshot().scenePlan.scenes.some(s => s.id === "empty"));
});
test("UI failed write shows localized error and preserves authoritative selection", async () => {
  const h = uiHarness(), before = h.data.get(KEY); h.fail = true; await h.click("select", "A-2");
  assert.equal(h.data.get(KEY), before); assert(h.window.ViralCoreProjectScenes.surface().includes(h.window.I18N.messages.en.projectScenes.saveFailed));
});
test("UI escapes Scene names and IDs and has parity in every new locale key", () => {
  const h = uiHarness(); h.api.addProjectScene({ id: '<bad"id>', title: '<img src=x onerror=alert(1)>' }, options);
  const html = h.window.ViralCoreProjectScenes.surface(); assert(!html.includes("<img")); assert(html.includes("&lt;img"));
  const { vi, en } = h.window.I18N.messages; assert.deepEqual(Object.keys(vi.projectScenes), Object.keys(en.projectScenes));
  const index = fs.readFileSync("renderer/index.html", "utf8"); assert(index.includes('src="core-project-scenes.js"'));
});
