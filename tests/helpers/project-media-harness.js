"use strict";
const fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const snapshotModel = require("../../renderer/core-project-media-assembly"), scenes = require("../../renderer/core-scene-plan-model");
const library = require("../../renderer/core-media-library-model"), assembly = require("../../renderer/core-media-assembly-model");
const { create } = require("../../renderer/core-project-media");
const KEY = "viral-ai-core-project-registry-v1", clone = v => JSON.parse(JSON.stringify(v));
function asset(id, kind = "video", origin = "local") {
  return library.normalizeAsset({ id, kind, origin, provider: origin === "stock" ? "pexels" : "local", providerAssetId: origin === "stock" ? id : null,
    name: id, localPath: "C:/media/" + id + (kind === "video" ? ".mp4" : kind === "image" ? ".png" : ".wav"), status: "ready", fileState: "available", meta: { duration: 2 } }, 0, 0);
}
function draft(id) {
  const p = snapshotModel.createDraftProject({ projectId: id, projectName: id }, {}, {}, 0);
  p.scenePlan = scenes.normalizePlan({ scenes: [0, 1].map(i => ({ id: id + i, order: i, start: i * 2, end: i * 2 + 2 })), selectedSceneId: id + "0" }, { now: 0 });
  return snapshotModel.migrateSnapshot(p).snapshot;
}
function harness(data = new Map([[KEY, JSON.stringify({ schemaVersion: 1, activeProjectId: "A", projects: [draft("A"), draft("B")] })]])) {
  let writes = 0, fail = false, inspect, failAt = Infinity, selectLocal = async () => ({ ok: true, canceled: true });
  const events = [], listeners = {};
  class Storage {
    getItem(k) { return data.get(k) ?? null; }
    setItem(k, v) { if (k === KEY) { writes++; inspect?.(); if (fail || writes === failAt) throw Error("quota"); } data.set(k, String(v)); }
    removeItem(k) { data.delete(k); }
  }
  const state = { page: "home", jobs: [], projectId: "A", locale: "en" };
  const window = { ViralCoreProjectSnapshot: snapshotModel, ViralCoreScenePlanModel: scenes, ViralCoreMediaLibraryModel: library, crypto,
    addEventListener(n, f) { (listeners[n] ||= []).push(f); }, dispatchEvent(e) { events.push(e); for (const f of listeners[e.type] || []) f(e); } };
  const c = { window, state, Storage, localStorage: new Storage(), crypto, console,
    document: { readyState: "loading", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    HTMLElement: class {}, HTMLVideoElement: class {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {} };
  vm.runInNewContext(fs.readFileSync("renderer/core-project-persistence.js", "utf8"), c);
  const api = window.ViralCoreProjectPersistence;
  Object.assign(state, clone(snapshotModel.toLegacyState(api.snapshot())), { projectId: api.activeProjectId(), page: api.snapshot().editor.page });
  const notices = []; let operationId = 0;
  const operations = create({ persistence: api, model: library, selectLocal: () => selectLocal(), id: () => "operation-" + ++operationId, notify: d => notices.push(d) });
  window.addEventListener("viral-ai:project-snapshot-restored", () => operations.invalidate());
  return { api, state, data, events, c, window, operations, notices, get writes() { return writes; }, set fail(v) { fail = v; },
    set failAt(v) { failAt = v; }, set inspect(v) { inspect = v; }, set picker(v) { selectLocal = v; } };
}
module.exports = { harness, asset, draft, KEY, clone, library, assembly, snapshotModel };
