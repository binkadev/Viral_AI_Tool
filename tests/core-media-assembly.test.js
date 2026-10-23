"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../renderer/core-media-assembly-model');
const project = require('../renderer/core-project-media-assembly');
const v4 = require('../renderer/core-project-scene-plan');
const scenes = [{ id: 'a' }, { id: 'b' }];
const assets = ['A', 'B', 'C'].map(id => ({ id, kind: 'video', origin: 'local', name: id, localPath: 'C:/media/' + id + '.mp4' }));
const context = { scenes, assets, now: 1000 };
const json = v => JSON.parse(JSON.stringify(v));
const add = (value, id = 'A', options = {}) => m.addCandidate(value, 'a', id, { ...context, ...options });
function candidates() { return add(add(m.emptyAssembly()), 'B'); }
function selected() { return m.selectCandidate(candidates(), 'a', 'B', { ...context, selectionSource: 'manual' }); }
function draft() {
  const p = project.createDraftProject({ projectId: 'project', projectName: 'Project' }, {}, {}, 0);
  p.scenePlan = project.scenePlanFromState({ scenePlan: { scenes, selectedSceneId: 'a' } });
  p.media = { schemaVersion: 1, assets, selectedAssetId: 'C' };
  return project.migrateSnapshot(p).snapshot;
}
test('empty and unsupported assemblies normalize safely', () => {
  for (const input of [null, {}, { schemaVersion: 99, slots: [] }]) assert.deepEqual(m.normalizeAssembly(input, context), m.emptyAssembly());
});
test('deterministic primary identity and unsupported roles', () => {
  assert.equal(m.slotId('a'), 'scene:a:primary'); assert.equal(m.slotId('a', 'audio'), null);
});
test('one slot per existing scene and unique candidates retain first stable occurrence', () => {
  const slot = add(m.emptyAssembly()).slots[0];
  const result = m.normalizeAssembly({ schemaVersion: 1, slots: [{ ...slot, id: 'forged', candidateAssetIds: ['B', 'A', 'B', 'missing'] }, slot, { ...slot, sceneId: 'gone' }] }, context);
  assert.equal(result.slots.length, 1); assert.equal(result.slots[0].id, m.slotId('a'));
  assert.deepEqual(result.slots[0].candidateAssetIds, ['B', 'A']);
});
test('duplicate add is idempotent including timestamps', () => {
  const value = candidates(); assert.deepEqual(add(value, 'A', { now: 9999 }), value);
});
test('same canonical asset can serve independent scenes', () => {
  const value = m.addCandidate(add(m.emptyAssembly()), 'b', 'A', context);
  assert.equal(value.slots.length, 2); assert.deepEqual(value.slots.map(s => s.candidateAssetIds), [['A'], ['A']]);
});
test('unknown scenes, unknown assets and audio never create a slot', () => {
  assert.deepEqual(m.addCandidate(m.emptyAssembly(), 'missing', 'A', context), m.emptyAssembly());
  assert.deepEqual(add(m.emptyAssembly(), 'missing'), m.emptyAssembly());
  assert.deepEqual(add(m.emptyAssembly(), 'sound', { assets: [...assets, { id: 'sound', kind: 'audio' }] }), m.emptyAssembly());
});
test('selection requires an enrolled candidate and an explicit valid source', () => {
  const value = add(m.emptyAssembly());
  assert.deepEqual(m.selectCandidate(value, 'a', 'B', { ...context, selectionSource: 'manual' }), value);
  assert.deepEqual(m.selectCandidate(value, 'a', 'A', context), value);
});
test('manual selection records its source', () => assert.equal(selected().slots[0].selectionSource, 'manual'));
test('first automatic selection is explicit and later candidates preserve it', () => {
  const first = add(m.emptyAssembly(), 'A', { selectIfEmpty: true, selectionSource: 'auto' });
  const second = add(first, 'B', { selectIfEmpty: true, selectionSource: 'auto' });
  assert.equal(second.slots[0].selectedAssetId, 'A'); assert.equal(second.slots[0].selectionSource, 'auto');
});
test('later automatic candidate preserves manual selection', () => assert.equal(add(selected(), 'C', { selectIfEmpty: true, selectionSource: 'auto' }).slots[0].selectedAssetId, 'B'));
test('removing selected candidate clears selection without substitution', () => {
  const slot = m.removeCandidate(selected(), 'a', 'B', context).slots[0];
  assert.deepEqual(slot.candidateAssetIds, ['A']); assert.equal(slot.selectedAssetId, null); assert.equal(slot.selectionSource, null);
});
test('removing unselected candidate preserves selection', () => assert.equal(m.removeCandidate(selected(), 'a', 'A', context).slots[0].selectedAssetId, 'B'));
test('clear selection is immutable and idempotent', () => {
  const value = selected(), copy = json(value), next = m.clearSelection(value, 'a', context);
  assert.deepEqual(value, copy); assert.equal(next.slots[0].selectedAssetId, null);
  assert.deepEqual(m.clearSelection(next, 'a', { ...context, now: 9999 }), next);
});
test('deleted asset is removed from every scene without auto selection', () => {
  const both = m.addCandidate(selected(), 'b', 'B', context);
  const next = m.reconcileAssembly(both, { scenes, assets: assets.filter(a => a.id !== 'B') });
  assert(next.slots.every(s => !s.candidateAssetIds.includes('B') && s.selectedAssetId === null));
  assert.deepEqual(m.removeAssetReferences(both, 'B', context), next);
});
test('deleted scene drops its slot without retargeting by order', () => {
  assert.deepEqual(m.reconcileAssembly(selected(), { scenes: [scenes[1]], assets }), m.emptyAssembly());
});
test('dangling selection and invalid selection source fail closed', () => {
  for (const patch of [{ selectedAssetId: 'C' }, { selectionSource: 'guessed' }]) {
    const value = selected(); Object.assign(value.slots[0], patch);
    const slot = m.normalizeAssembly(value, context).slots[0]; assert.equal(slot.selectedAssetId, null); assert.equal(slot.selectionSource, null);
  }
});
test('capacity is 64; overflow never evicts or changes selection', () => {
  const options = { ...context, assets: Array.from({ length: 65 }, (_, i) => ({ id: 'asset-' + i, kind: 'image' })), selectIfEmpty: true, selectionSource: 'auto' };
  let value = m.emptyAssembly(); for (let i = 0; i < 64; i++) value = m.addCandidate(value, 'a', 'asset-' + i, options);
  const before = json(value); value = m.addCandidate(value, 'a', 'asset-64', { ...options, now: 9999 });
  assert.deepEqual(value, before); assert.equal(value.slots[0].candidateAssetIds.length, 64);
});
test('operations never mutate frozen input or context, and returned references are detached', () => {
  const value = selected(), copy = json(value);
  Object.freeze(value.slots[0].candidateAssetIds); Object.freeze(value.slots[0]); Object.freeze(value.slots); Object.freeze(value);
  for (const run of [() => add(value, 'C'), () => m.selectCandidate(value, 'a', 'A', { ...context, selectionSource: 'manual' }),
    () => m.removeCandidate(value, 'a', 'B', context), () => m.reconcileAssembly(value, context)]) run();
  const slot = m.sceneSlot(value, 'a'); slot.candidateAssetIds.push('outside'); assert.deepEqual(value, copy);
});
test('v4 migrates to additive v5 with empty assembly and stable identity', () => {
  const old = v4.createDraftProject({ projectId: 'project', projectName: 'Project' }, {}, {}, 0);
  const migrated = project.migrateSnapshot(old); assert.equal(migrated.migrated, true);
  assert.equal(migrated.snapshot.schemaVersion, 5); assert.equal(migrated.snapshot.projectId, old.projectId);
  assert.equal(migrated.snapshot.source, null); assert.deepEqual(migrated.snapshot.mediaAssembly, m.emptyAssembly());
});
test('v5 round-trip preserves manual selection and signature ignores only snapshot save time', () => {
  const p = draft(); p.mediaAssembly = selected();
  assert.deepEqual(project.migrateSnapshot(json(p)).snapshot, p);
  assert.equal(project.migrateSnapshot(p).migrated, false);
  assert.equal(project.semanticSignature(p), project.semanticSignature({ ...p, updatedAt: '2026-10-22T00:00:00.000Z' }));
  assert.notEqual(project.semanticSignature(p), project.semanticSignature({ ...p, mediaAssembly: candidates() }));
});
test('future Project versions are protected', () => {
  assert.deepEqual(project.migrateSnapshot({ ...draft(), schemaVersion: 6 }), { snapshot: null, migrated: false, unsupportedVersion: 6 });
  assert.equal(project.buildSnapshot({ jobs: [{ id: 'source', sourcePath: 'C:/source.mp4' }] }, {}, { ...draft(), schemaVersion: 6 }), null);
});
test('new imported Project identity cannot inherit the previous Project assembly', () => {
  const state = project.toLegacyState(draft()); state.mediaAssembly = selected();
  state.jobs = [{ id: 'old-source', sourcePath: 'C:/old.mp4' }];
  const previous = project.fromLegacy(state, {}, 0);
  state.jobs = [{ id: 'new-source', sourcePath: 'C:/new.mp4' }];
  const next = project.buildSnapshot(state, {}, previous, 1000);
  assert.notEqual(next.projectId, previous.projectId); assert.deepEqual(next.mediaAssembly, m.emptyAssembly());
});
test('v4 exact generation mapping backfill uses stable order and preserves mappings', () => {
  const p = draft(); p.schemaVersion = 4; delete p.mediaAssembly;
  const ids = ['first', 'second']; p.media.assets = ids.map(id => ({ ...assets[0], id: 'generation:' + id, localPath: 'C:/media/' + id + '.mp4' }));
  p.workflow.generationOutputs = ids.map(jobId => ({ jobId, sceneId: 'a', assetId: 'generation:' + jobId }));
  const next = project.migrateSnapshot(p).snapshot;
  assert.deepEqual(next.workflow.generationOutputs, p.workflow.generationOutputs);
  assert.deepEqual(next.mediaAssembly.slots[0].candidateAssetIds, ['generation:first', 'generation:second']);
  assert.equal(next.mediaAssembly.slots[0].selectedAssetId, 'generation:first'); assert.equal(next.mediaAssembly.slots[0].selectionSource, 'auto');
});
test('missing mapping assets/scenes and pending outputs are never backfilled or heuristically reassigned', () => {
  const p = draft(); p.schemaVersion = 4; delete p.mediaAssembly;
  p.media.assets.push({ ...assets[0], id: 'generation:gone-scene', name: 'a.mp4', provider: 'muse' });
  p.workflow.generationOutputs = [{ jobId: 'missing', sceneId: 'a', assetId: 'generation:missing' },
    { jobId: 'gone-scene', sceneId: 'deleted', assetId: 'generation:gone-scene' }, { jobId: 'pending', sceneId: 'a', assetId: null }];
  assert.deepEqual(project.migrateSnapshot(p).snapshot.mediaAssembly, m.emptyAssembly());
});
test('v5 clear selection stays cleared across reload, without historical re-enrollment', () => {
  const p = draft(); p.mediaAssembly = m.clearSelection(selected(), 'a', context);
  assert.equal(project.migrateSnapshot(p).snapshot.mediaAssembly.slots[0].selectedAssetId, null);
});
test('buildSnapshot, legacy projections and imported sources round-trip assembly', () => {
  const p = draft(); p.mediaAssembly = selected();
  const state = project.toLegacyState(p); assert.deepEqual(state.mediaAssembly, p.mediaAssembly);
  const next = project.buildSnapshot(state, p.editor, p, 1000); assert.deepEqual(next.mediaAssembly, p.mediaAssembly); assert.equal(next.source, null);
  state.jobs = [{ id: 'source', name: 'input.mp4', sourcePath: 'C:/input.mp4' }];
  const imported = project.fromLegacy(state, {}, 1000); assert.equal(imported.schemaVersion, 5);
  assert.equal(imported.source.path, 'C:/input.mp4'); assert.deepEqual(imported.mediaAssembly, p.mediaAssembly);
});
function generated(p, id, sceneId = 'a') {
  const job = { id, projectId: p.projectId, sceneId, kind: 'video', provider: 'fixture', status: 'completed', asset: { fileName: id + '.mp4' }, output: { fileName: id + '.mp4' } };
  const output = { jobId: id, projectId: p.projectId, sceneId, verified: true, fileName: id + '.mp4', path: 'C:/generated/' + id + '.mp4' };
  const enrolled = json(p); if (!enrolled.workflow.generationOutputs.some(e => e.jobId === id)) enrolled.workflow.generationOutputs.push({ jobId: id, sceneId, assetId: null });
  return project.attachGeneratedOutput(enrolled, job, output, { width: 160, height: 90, duration: 2 });
}
test('first generated asset is canonical, auto-selected and retains existing source handoff', () => {
  const next = generated(draft(), 'first'); assert.equal(next.mediaAssembly.slots[0].selectedAssetId, 'generation:first');
  assert.equal(next.mediaAssembly.slots[0].selectionSource, 'auto'); assert.equal(next.source.identity, 'generation-source:first');
  assert.equal(next.media.selectedAssetId, 'generation:first'); assert.equal(next.editor.playback.sourcePath, next.source.path);
});
test('later generated asset preserves first selection, source, playback and library selection', () => {
  const first = generated(draft(), 'first'), next = generated(first, 'second');
  assert.deepEqual(next.mediaAssembly.slots[0].candidateAssetIds, ['generation:first', 'generation:second']);
  assert.equal(next.mediaAssembly.slots[0].selectedAssetId, 'generation:first');
  for (const key of ['source', 'editor']) assert.deepEqual(next[key], first[key]); assert.equal(next.media.selectedAssetId, first.media.selectedAssetId);
});
test('manual B survives generated C and independent scene B generation', () => {
  let p = generated(generated(draft(), 'first'), 'second');
  p.mediaAssembly = m.selectCandidate(p.mediaAssembly, 'a', 'generation:second', { scenes: p.scenePlan.scenes, assets: p.media.assets, selectionSource: 'manual' });
  p = generated(generated(p, 'third'), 'other', 'b');
  assert.equal(m.sceneSlot(p.mediaAssembly, 'a').selectedAssetId, 'generation:second'); assert.equal(m.sceneSlot(p.mediaAssembly, 'b').selectedAssetId, 'generation:other');
});
test('duplicate generated replay creates no duplicate asset or candidate and respects cleared selection', () => {
  const p = generated(draft(), 'first'); p.mediaAssembly = m.clearSelection(p.mediaAssembly, 'a', { scenes: p.scenePlan.scenes, assets: p.media.assets });
  const next = generated(p, 'first'); assert.deepEqual(next, p);
});
