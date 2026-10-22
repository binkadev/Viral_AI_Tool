"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { harness, asset, KEY, clone, library, assembly, snapshotModel } = require("./helpers/project-media-harness");
const { registerProjectMediaPicker } = require("../services/media/local-picker");
const opts = { projectId: "A" }, slot = (h, id = "A0") => h.api.snapshot().mediaAssembly.slots.find(s => s.sceneId === id);
const begin = (h, more = {}) => h.operations.begin({ projectId: "A", sceneId: "A0", intent: "candidate", ...more });

for (const kind of ["video", "image", "audio"]) test("local " + kind + " normalized, durably imported, detached, stable after restart", () => {
  const h = harness(), raw = asset("x", kind), before = clone(raw), count = h.writes;
  const out = h.api.addProjectMediaAsset(raw, opts);
  assert.equal(h.writes, count + 1); assert.equal(out.assets[0].kind, kind); assert.deepEqual(raw, before);
  out.assets[0].name = "mutated"; assert.equal(h.api.snapshot().media.assets[0].name, "x");
  const restarted = harness(h.data); assert.deepEqual(restarted.api.snapshot().media, h.api.snapshot().media);
});
test("one atomic batch deduplicates canonical local paths and returns existing IDs", () => {
  const h = harness(), x = asset("x"), same = { ...x, id: "different", localPath: x.localPath.toUpperCase().replaceAll("/", "\\") };
  const r = h.api.addProjectMediaAssets([x, same], opts); assert.equal(r.added.length, 1); assert.equal(r.duplicates.length, 1);
  assert.deepEqual(r.assets.map(a => a.id), ["x", "x"]); const n = h.writes; h.api.addProjectMediaAsset(same, opts); assert.equal(h.writes, n);
});
test("stock identity/attribution persist, duplicate provider media is Project scoped", () => {
  const h = harness(), a = asset("stock", "image", "stock"); a.attribution.creatorName = "Creator"; a.attribution.sourceUrl = "https://example.com/photo";
  h.api.addProjectMediaAssets([a, { ...a, id: "other", localPath: "C:/other.png" }], opts);
  assert.equal(h.api.snapshot().media.assets.length, 1); h.api.openProject("B"); assert.equal(h.api.snapshot().media.assets.length, 0);
  h.api.addProjectMediaAsset(a, { projectId: "B" }); h.api.openProject("A"); const restarted = harness(h.data);
  assert.equal(restarted.api.snapshot().media.assets[0].attribution.creatorName, "Creator"); assert.equal(restarted.api.snapshot().media.assets[0].providerAssetId, "stock");
});
test("durable write sees unchanged live/snapshot/events; only success publishes", () => {
  const h = harness(), live = clone(h.state), saved = h.api.snapshot(), n = h.events.length;
  h.inspect = () => { assert.deepEqual(clone(h.state), live); assert.deepEqual(h.api.snapshot(), saved); assert.equal(h.events.length, n); };
  h.api.addProjectMediaAsset(asset("x"), opts); h.inspect = null;
  assert(h.events.slice(n).some(e => e.type === "viral-ai:core-state-changed" && e.detail.reason === "project-media"));
});
for (const action of ["add", "update", "remove"]) test(action + " persistence failure publishes no live ghost/candidate/success", () => {
  const h = harness(); h.api.addProjectMediaAsset(asset("x"), opts); h.api.addSceneMaterialCandidate("A0", "x", opts); h.api.selectSceneMaterial("A0", "x", opts);
  const live = clone(h.state), saved = h.api.snapshot(), stored = h.data.get(KEY), n = h.events.length; h.fail = true;
  assert.throws(() => action === "add" ? h.api.addProjectMediaAsset(asset("y"), opts) : action === "update" ? h.api.updateProjectMediaAsset("x", { favorite: true }, opts) : h.api.removeProjectMediaAsset("x", opts), /quota/);
  assert.deepEqual(clone(h.state), live); assert.deepEqual(h.api.snapshot(), saved); assert.equal(h.data.get(KEY), stored);
  assert(!h.events.slice(n).some(e => e.type === "viral-ai:core-state-changed"));
});
test("pending brief/editor/workflow/Scene/assembly survive media mutation; optimistic media cannot overwrite canonical", () => {
  const h = harness(); h.api.addProjectMediaAsset(asset("x"), opts); h.api.addSceneMaterialCandidate("A0", "x", opts); h.api.selectSceneMaterial("A0", "x", opts);
  const canonical = h.api.snapshot(); h.c.localStorage.setItem("viral-ai-generation-brief", "pending brief");
  h.c.localStorage.setItem(snapshotModel.LEGACY_UI_KEYS.timelineZoom, "2"); h.state.translation.targetLanguage = "vi";
  h.state.scenePlan.scenes[0].sourceText = "pending Scene text"; h.state.mediaAssembly.slots[0].selectedAssetId = null;
  h.state.mediaAssembly.slots[0].selectionSource = null; const pendingPlan = clone(h.state.scenePlan), pendingAssembly = clone(h.state.mediaAssembly);
  h.state.media.assets = []; const n = h.writes;
  h.api.addProjectMediaAsset(asset("y"), opts); const r = h.api.snapshot();
  assert.equal(h.writes, n + 1); assert.equal(r.workflow.generationBrief, "pending brief"); assert.equal(r.workflow.translation.targetLanguage, "vi"); assert.equal(r.editor.timeline.zoom, 2);
  assert.deepEqual(r.scenePlan, pendingPlan); assert.deepEqual(r.mediaAssembly, pendingAssembly); assert.equal(r.media.assets.length, 2);
  assert.deepEqual(harness(h.data).api.snapshot().workflow, r.workflow);
});
test("explicit Project ID required; mismatches and transitioning Project reject without writes", async () => {
  const h = harness(), n = h.writes; for (const o of [{}, { projectId: "B" }]) assert.throws(() => h.api.addProjectMediaAsset(asset("x"), o), /PROJECT_MISMATCH/);
  assert.equal(h.writes, n); let checked = false;
  h.window.addEventListener("viral-ai:project-snapshot-restored", () => { assert.throws(() => h.api.addProjectMediaAsset(asset("x"), { projectId: h.api.activeProjectId() }), /PROJECT_TRANSITION_PENDING/); checked = true; });
  h.api.openProject("B"); assert(checked);
});
test("capacity 500 rejects entire new batch, permits duplicates without eviction", () => {
  const h = harness(); h.api.addProjectMediaAssets(Array.from({ length: 499 }, (_, i) => asset("x" + i)), opts); const saved = h.api.snapshot();
  assert.throws(() => h.api.addProjectMediaAssets([asset("a"), asset("b")], opts), /PROJECT_MEDIA_LIMIT/); assert.deepEqual(h.api.snapshot(), saved);
  h.api.addProjectMediaAsset(asset("last"), opts); const n = h.writes; const r = h.api.addProjectMediaAsset({ ...asset("last"), id: "duplicate" }, opts);
  assert.equal(r.duplicates.length, 1); assert.equal(h.writes, n); assert.equal(h.api.snapshot().media.assets.length, 500);
});
test("ID collisions and update-to-duplicate identity fail before durable save", () => {
  const h = harness(); h.api.addProjectMediaAssets([asset("x"), asset("y")], opts); const saved = h.api.snapshot();
  assert.throws(() => h.api.addProjectMediaAsset({ ...asset("z"), id: "x" }, opts), /PROJECT_MEDIA_ID_CONFLICT/);
  assert.throws(() => h.api.updateProjectMediaAsset("y", { localPath: asset("x").localPath }, opts), /PROJECT_MEDIA_ID_CONFLICT/); assert.deepEqual(h.api.snapshot(), saved);
});
test("update preserves stable ID/created time and missing references; restart retains truthful state", () => {
  const h = harness(); h.api.addProjectMediaAsset(asset("x"), opts); h.api.addSceneMaterialCandidate("A0", "x", opts); h.api.selectSceneMaterial("A0", "x", opts);
  const before = h.api.snapshot().media.assets[0]; h.api.updateProjectMediaAsset("x", { id: "bad", fileState: "missing", favorite: true }, opts);
  const a = h.api.snapshot().media.assets[0]; assert.equal(a.id, "x"); assert.equal(a.createdAt, before.createdAt); assert(a.favorite); assert.equal(slot(h).selectedAssetId, "x");
  assert.equal(harness(h.data).api.snapshot().media.assets[0].fileState, "missing");
});
test("remove reconciles every shared Scene reference; no substitute or resurrection", () => {
  const h = harness(); h.api.addProjectMediaAssets([asset("x"), asset("y")], opts);
  for (const sceneId of ["A0", "A1"]) { h.api.addSceneMaterialCandidate(sceneId, "x", opts); h.api.addSceneMaterialCandidate(sceneId, "y", opts); h.api.selectSceneMaterial(sceneId, "x", opts); }
  h.api.removeProjectMediaAsset("x", opts); for (const s of h.api.snapshot().mediaAssembly.slots) { assert.deepEqual(s.candidateAssetIds, ["y"]); assert.equal(s.selectedAssetId, null); assert.equal(s.selectionSource, null); }
  h.api.addProjectMediaAsset(asset("x"), opts); assert(h.api.snapshot().mediaAssembly.slots.every(s => !s.candidateAssetIds.includes("x")));
});
for (const origin of ["local", "stock", "generated"]) test(origin + " uses canonical candidates; Add does not replace selection and Use is manual", () => {
  const h = harness(); h.api.addProjectMediaAsset(asset("old"), opts); h.api.addSceneMaterialCandidate("A0", "old", opts); h.api.selectSceneMaterial("A0", "old", opts);
  const c = begin(h), a = asset("new", "image", origin); const r = h.operations.admit(c, [a]); assert.equal(r.enrolled.length, 1); assert.equal(slot(h).selectedAssetId, "old");
  const use = begin(h, { intent: "use" }); h.operations.admit(use, [a]); assert.equal(slot(h).selectedAssetId, "new"); assert.equal(slot(h).selectionSource, "manual");
  h.operations.admit(use, [a]); assert.deepEqual(slot(h).candidateAssetIds, ["old", "new"]);
});
test("audio is library-only and fails direct visual enrollment", () => {
  const h = harness(), c = begin(h); const r = h.operations.admit(c, [asset("audio", "audio")]); assert.equal(r.status, "library-only");
  assert.equal(h.api.snapshot().media.assets[0].kind, "audio"); assert.equal(slot(h), undefined); assert.throws(() => h.api.addSceneMaterialCandidate("A0", "audio", opts), /PROJECT_ASSET_NOT_FOUND/);
});
test("candidate capacity 64 retains new library asset, reports failure, never evicts", () => {
  const h = harness(); h.api.addProjectMediaAssets(Array.from({ length: 64 }, (_, i) => asset("x" + i)), opts);
  for (let i = 0; i < 64; i++) h.api.addSceneMaterialCandidate("A0", "x" + i, opts);
  const before = slot(h), r = h.operations.admit(begin(h), [asset("new")]); assert.equal(r.status, "scene-failed"); assert.equal(r.errors[0].code, "PROJECT_CANDIDATE_LIMIT");
  assert.deepEqual(slot(h), before); assert(h.api.snapshot().media.assets.some(a => a.id === "new"));
});
test("Scene changed during acquisition enrolls captured A0, never new editing A1", () => {
  const h = harness(), c = begin(h); assert(Object.isFrozen(c)); h.api.selectProjectScene("A1", opts);
  h.operations.admit(c, [asset("stock", "video", "stock")]); assert.deepEqual(slot(h).candidateAssetIds, ["stock"]); assert.equal(slot(h, "A1"), undefined); assert.equal(slot(h).selectedAssetId, null);
});
test("Scene deleted before completion retains durable Project asset with no retarget", () => {
  const h = harness(), c = begin(h); h.api.removeProjectScene("A0", opts); const r = h.operations.admit(c, [asset("x")]);
  assert.equal(r.status, "scene-failed"); assert.equal(r.errors[0].code, "PROJECT_SCENE_NOT_FOUND"); assert.equal(h.api.snapshot().media.assets.length, 1); assert.equal(slot(h, "A1"), undefined);
});
test("candidate save failure keeps valid Project asset, no candidate or selection ghost", () => {
  const h = harness(); h.failAt = h.writes + 2; const r = h.operations.admit(begin(h), [asset("x")]);
  assert.equal(r.status, "scene-failed"); assert.equal(h.api.snapshot().media.assets.length, 1); assert.equal(slot(h), undefined);
  assert.equal(harness(h.data).api.snapshot().media.assets.length, 1);
});
test("asset save failure never attempts Scene enrollment", () => {
  const h = harness(), c = begin(h); h.fail = true; const n = h.writes; assert.throws(() => h.operations.admit(c, [asset("x")]), /quota/);
  assert.equal(h.writes, n + 1); assert.equal(h.api.snapshot().media.assets.length, 0); assert.equal(slot(h), undefined);
});
for (const switchBack of [false, true]) test("late A stock completion cannot retarget B or survive A→B→A epoch " + switchBack, () => {
  const h = harness(), expected = asset("stock", "video", "stock"), c = begin(h, { expected }); h.api.openProject("B"); if (switchBack) h.api.openProject("A");
  const saved = h.data.get(KEY); assert(!h.operations.current(c)); assert.throws(() => h.operations.admit(c, [expected]), /PROJECT_CHANGED/); assert.equal(h.data.get(KEY), saved);
});
test("stock return must match captured provider, ID and kind; tickets/URLs never persisted", () => {
  const h = harness(), a = asset("stock", "video", "stock"), c = begin(h, { expected: a });
  for (const patch of [{ provider: "pixabay" }, { providerAssetId: "other" }, { kind: "image" }, { status: "downloading" }]) assert.throws(() => h.operations.admit(c, [{ ...a, ...patch }]), /PROJECT_MEDIA_INVALID/);
  h.operations.admit(c, [{ ...a, previewUrl: "https://example.com/preview", remoteUrl: "https://example.com/raw", acquisition: { ticket: "secret" }, token: "secret" }]);
  const saved = h.data.get(KEY); assert(!saved.includes("secret")); assert.equal(h.api.snapshot().media.assets[0].previewUrl, null); assert.equal(h.api.snapshot().media.assets[0].remoteUrl, null);
});
test("cancelled/superseded operation cannot admit even a valid result", () => {
  const h = harness(), c = begin(h); h.operations.finish(c); assert.throws(() => h.operations.admit(c, [asset("x")]), /PROJECT_CHANGED/); assert.equal(h.api.snapshot().media.assets.length, 0);
});
test("local picker cancellation and duplicate clicks leave registry untouched", async () => {
  const h = harness(); let done; h.picker = () => new Promise(r => { done = r; }); const n = h.writes, p = h.operations.importLocal(opts);
  assert.equal((await h.operations.importLocal(opts)).status, "busy"); done({ ok: true, canceled: true }); assert.equal((await p).status, "cancelled"); assert.equal(h.writes, n); assert(!h.operations.importing());
  assert(h.notices.some(n => n.status === "cancelled")); assert(!h.notices.some(n => n.status === "failed" || n.status === "added"));
});
test("local picker late completion after Project switch cannot leak", async () => {
  const h = harness(); let done; h.picker = () => new Promise(r => { done = r; }); const p = h.operations.importLocal({ ...opts, sceneId: "A0", intent: "candidate" });
  h.api.openProject("B"); const saved = h.data.get(KEY); done({ ok: true, assets: [asset("x")] }); assert.equal((await p).code, "PROJECT_CHANGED"); assert.equal(h.data.get(KEY), saved);
});
test("mixed local import retains valid audio/video/image and reports partial file failures", async () => {
  const h = harness(); h.picker = async () => ({ ok: true, assets: [asset("v"), asset("i", "image"), asset("a", "audio")], errors: [{ code: "MEDIA_TYPE_UNSUPPORTED" }] });
  const r = await h.operations.importLocal({ ...opts, sceneId: "A0", intent: "candidate" }); assert.equal(r.status, "partial-import"); assert.equal(h.api.snapshot().media.assets.length, 3);
  assert.deepEqual(slot(h).candidateAssetIds, ["v", "i"]); assert.equal(slot(h).selectedAssetId, null);
});
function picker(dialog, other = {}) {
  let handler; registerProjectMediaPicker({ ipcMain: { handle(n, f) { assert.equal(n, "media:select-local"); handler = f; } }, dialog,
    parent: () => "window", trusted: e => e.trusted === true, ...other }); return (...args) => handler({ trusted: true }, ...args);
}
test("native IPC rejects arbitrary args/untrusted frames before opening picker", async () => {
  let handler; registerProjectMediaPicker({ ipcMain: { handle(n, f) { handler = f; } }, trusted: e => e.trusted, dialog: { showOpenDialog() { assert.fail(); } } });
  assert.equal((await handler({ trusted: false })).ok, false); assert.equal((await handler({ trusted: true }, "C:/arbitrary")).ok, false);
});
test("native picker multi-file descriptors, supported filters and no original file modification", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "block4-picker-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = ["v.mp4", "i.png", "a.wav"].map(name => path.join(dir, name)); files.forEach(f => fs.writeFileSync(f, "original"));
  const run = picker({ async showOpenDialog(parent, options) { assert.equal(parent, "window"); assert(options.properties.includes("multiSelections")); assert(options.filters[0].extensions.includes("wav")); return { filePaths: files }; } });
  const out = await run(); assert(out.ok); assert.deepEqual(out.assets.map(a => a.kind), ["video", "image", "audio"]); assert(!out.assets.some(a => "native" in a));
  for (const f of files) assert.equal(fs.readFileSync(f, "utf8"), "original");
});
test("native cancel, unsupported/missing/unreadable files and raw errors sanitized", async () => {
  assert.equal((await picker({ showOpenDialog: async () => ({ canceled: true }) })()).canceled, true);
  const run = picker({ showOpenDialog: async () => ({ filePaths: [path.resolve("not-supported.exe"), path.resolve("missing.mp4")] }) });
  assert.deepEqual((await run()).errors.map(e => e.code), ["MEDIA_TYPE_UNSUPPORTED", "MEDIA_FILE_MISSING"]);
  const denied = picker({ showOpenDialog: async () => ({ filePaths: [path.resolve("denied.mp4")] }) }, { describe: file => ({ ...asset("x"), localPath: file }), readable: () => { throw Error("C:/secret EACCES"); } });
  const r = await denied(); assert.equal(r.errors[0].code, "MEDIA_FILE_UNREADABLE"); assert(!JSON.stringify(r).includes("secret"));
});
test("native concurrent dialogs coalesce by rejecting second request; picker failures unlock", async () => {
  let done; const run = picker({ showOpenDialog: () => new Promise(r => { done = r; }) }); const first = run(); assert.equal((await run()).error.code, "MEDIA_IMPORT_BUSY"); done({ canceled: true }); await first;
  const broken = picker({ showOpenDialog: async () => { throw Error("C:/private detail"); } }); assert.equal((await broken()).error.code, "MEDIA_FILE_UNAVAILABLE"); assert.equal((await broken()).error.code, "MEDIA_FILE_UNAVAILABLE");
});
test("schemas, existing model contracts and bilingual product copy remain valid", () => {
  const vm = require("node:vm"), c = { window: {} }; vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), c);
  const { vi, en } = c.window.I18N.messages; assert.deepEqual(Object.keys(vi.projectMedia), Object.keys(en.projectMedia));
  assert.equal(snapshotModel.CURRENT_SCHEMA_VERSION, 5); assert.equal(assembly.MEDIA_ASSEMBLY_SCHEMA_VERSION, 1); assert.equal(library.LIBRARY_SCHEMA_VERSION, 1);
  assert.equal(library.MAX_PROJECT_ASSETS, 500); assert.equal(assembly.MAX_CANDIDATES_PER_SLOT, 64);
});
