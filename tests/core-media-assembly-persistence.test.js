"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const model = require('../renderer/core-project-media-assembly');
const m = require('../renderer/core-media-assembly-model');
const KEY = 'viral-ai-core-project-registry-v1';
const json = value => JSON.parse(JSON.stringify(value));
function draft(id) {
  const p = model.createDraftProject({ projectId: id, projectName: id }, {}, {}, 0);
  p.scenePlan = model.scenePlanFromState({ scenePlan: { scenes: [{ id: 'scene' }, { id: 'other' }], selectedSceneId: 'scene' } });
  p.media = { schemaVersion: 1, selectedAssetId: 'A', assets: ['A', 'B', 'C'].map(id => ({ id, kind: 'video', origin: 'local', name: id, localPath: 'C:/' + id + '.mp4', createdAt: '1970-01-01T00:00:00.000Z' })) };
  return model.migrateSnapshot(p).snapshot;
}
function seed() { return new Map([[KEY, JSON.stringify({ schemaVersion: 1, activeProjectId: 'project-a', projects: [draft('project-a'), draft('project-b')] })]]); }
function harness(data = seed()) {
  let fail = false, attempts = 0, inspectWrite;
  const events = [];
  class Storage {
    getItem(key) { return data.get(key) ?? null; }
    setItem(key, value) { if (key === KEY) { attempts++; inspectWrite?.(); if (fail) throw Error('quota'); } data.set(key, String(value)); }
    removeItem(key) { data.delete(key); }
  }
  const state = { page: 'home', jobs: [], projectId: 'project-a' };
  const window = { ViralCoreProjectSnapshot: model, ViralCoreScenePlanModel: require('../renderer/core-scene-plan-model'),
    crypto, addEventListener() {}, dispatchEvent: event => events.push(event) };
  const c = { window, state, Storage, localStorage: new Storage(), crypto,
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null },
    HTMLElement: class {}, HTMLVideoElement: class {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {} };
  vm.runInNewContext(fs.readFileSync('renderer/core-project-persistence.js', 'utf8'), c);
  const api = window.ViralCoreProjectPersistence;
  if (api.snapshot()) Object.assign(state, json(model.toLegacyState(api.snapshot())), { projectId: api.activeProjectId() });
  return { api, state, data, events, get attempts() { return attempts; }, set fail(value) { fail = value; }, set inspect(value) { inspectWrite = value; } };
}
test('manual selection commits before live state changes, then survives restart', () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A'); h.api.addSceneMaterialCandidate('scene', 'B');
  const before = json(h.state.mediaAssembly);
  h.inspect = () => assert.deepEqual(json(h.state.mediaAssembly), before);
  h.api.selectSceneMaterial('scene', 'B'); h.inspect = null;
  assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, 'B');
  assert.equal(h.state.mediaAssembly.slots[0].selectionSource, 'manual');
  assert.deepEqual(json(harness(h.data).state.mediaAssembly), json(h.state.mediaAssembly));
  assert(h.events.some(e => e.type === 'viral-ai:core-state-changed' && e.detail.reason === 'scene-material'));
});
test('project switch keeps A assembly out of B and restores each independent selection', () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A'); h.api.selectSceneMaterial('scene', 'A');
  h.api.openProject('project-b'); assert.deepEqual(json(h.state.mediaAssembly), m.emptyAssembly());
  h.api.addSceneMaterialCandidate('scene', 'B'); h.api.selectSceneMaterial('scene', 'B');
  h.api.openProject('project-a'); assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, 'A');
  h.api.openProject('project-b'); assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, 'B');
});
test('new AI Project and ensureProject retain an empty independent assembly', async () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A');
  await h.api.createProject({ kind: 'ai', projectName: 'New' });
  assert.deepEqual(json(h.state.mediaAssembly), m.emptyAssembly());
  assert.deepEqual(json(h.api.ensureProject().mediaAssembly), m.emptyAssembly());
  assert.equal(h.api.snapshot().schemaVersion, 5);
});
test('missing scene and missing asset reject before any durable write', () => {
  const h = harness(), writes = h.attempts;
  assert.throws(() => h.api.addSceneMaterialCandidate('gone', 'A'), /PROJECT_SCENE_NOT_FOUND/);
  assert.throws(() => h.api.selectSceneMaterial('scene', 'missing'), /PROJECT_ASSET_NOT_FOUND/);
  assert.equal(h.attempts, writes);
});
test('active Project identity rejects stale UI actions and mismatched runtime identity', () => {
  const h = harness(), before = h.data.get(KEY);
  assert.throws(() => h.api.addSceneMaterialCandidate('scene', 'A', { projectId: 'project-b' }), /PROJECT_MISMATCH/);
  h.state.projectId = 'project-b'; assert.throws(() => h.api.addSceneMaterialCandidate('scene', 'A'), /PROJECT_STATE_UNAVAILABLE/);
  assert.equal(h.data.get(KEY), before);
});
test('failed durable write leaves registry, snapshot and live selection unchanged', () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A'); h.api.addSceneMaterialCandidate('scene', 'B'); h.api.selectSceneMaterial('scene', 'A');
  const state = json(h.state), snapshot = json(h.api.snapshot()), stored = h.data.get(KEY); h.fail = true;
  assert.throws(() => h.api.selectSceneMaterial('scene', 'B'), /quota/);
  assert.deepEqual(json(h.state), state); assert.deepEqual(json(h.api.snapshot()), snapshot); assert.equal(h.data.get(KEY), stored);
  assert(h.events.some(e => e.type === 'viral-ai:project-snapshot-save-failed'));
});
test('assembly selection leaves library selection, source and playback untouched', () => {
  const h = harness(), before = json(h.api.snapshot());
  h.api.addSceneMaterialCandidate('scene', 'B'); h.api.selectSceneMaterial('scene', 'B');
  assert.equal(h.state.media.selectedAssetId, 'A'); assert.deepEqual(json(h.api.snapshot().source), before.source);
  assert.deepEqual(json(h.api.snapshot().editor), before.editor);
});
test('remove and clear selection are durable and duplicate operations are no-ops', () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A'); h.api.selectSceneMaterial('scene', 'A');
  h.api.clearSceneMaterialSelection('scene'); const writes = h.attempts; h.api.clearSceneMaterialSelection('scene'); assert.equal(h.attempts, writes);
  h.api.removeSceneMaterialCandidate('scene', 'A'); assert.deepEqual(json(harness(h.data).state.mediaAssembly.slots[0].candidateAssetIds), []);
});
test('snapshot flush reconciles removed assets and scenes without replacement', () => {
  const h = harness(); h.api.addSceneMaterialCandidate('scene', 'A'); h.api.addSceneMaterialCandidate('other', 'B'); h.api.selectSceneMaterial('scene', 'A');
  h.state.media.assets = h.state.media.assets.filter(a => a.id !== 'A'); h.api.flush();
  assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, null);
  h.state.scenePlan.scenes = h.state.scenePlan.scenes.filter(s => s.id !== 'scene'); h.api.flush();
  assert.equal(h.state.mediaAssembly.slots.length, 1); assert.equal(h.state.mediaAssembly.slots[0].sceneId, 'other');
});
test('future Project registry is protected against scene-material mutation', () => {
  const data = seed(), registry = JSON.parse(data.get(KEY)); registry.projects[0].schemaVersion = 6; data.set(KEY, JSON.stringify(registry));
  const before = data.get(KEY), h = harness(data); assert.throws(() => h.api.addSceneMaterialCandidate('scene', 'A'), /PROJECT_STORAGE_PROTECTED/);
  assert.equal(data.get(KEY), before);
});
test('v4 registry exact mapping migration persists once and survives restart', () => {
  const data = seed(), registry = JSON.parse(data.get(KEY)), p = registry.projects[0];
  p.schemaVersion = 4; delete p.mediaAssembly; p.media.assets[0].id = 'generation:first';
  p.workflow.generationOutputs = [{ jobId: 'first', sceneId: 'scene', assetId: 'generation:first' }]; data.set(KEY, JSON.stringify(registry));
  const h = harness(data); assert.equal(h.state.mediaAssembly.slots[0].selectedAssetId, 'generation:first');
  const persisted = data.get(KEY); assert.equal(JSON.parse(persisted).projects[0].schemaVersion, 5);
  harness(data); assert.equal(data.get(KEY), persisted);
});
