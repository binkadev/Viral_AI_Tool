"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const assembly = require('../renderer/core-media-assembly-model');
const json = value => JSON.parse(JSON.stringify(value));
function harness(locale = 'en') {
  const calls = [], data = new Map([['viral-ai-tool-state', JSON.stringify({ locale })]]);
  const state = { projectId: 'project', media: { selectedAssetId: 'library', assets: [
    { id: 'A', kind: 'video', origin: 'generated', name: 'Video A' }, { id: 'B', kind: 'image', origin: 'stock', name: 'Image B' },
    { id: 'audio', kind: 'audio', name: 'Audio' }, { id: 'library', kind: 'video', origin: 'local', name: 'Library video' }] },
    scenePlan: { selectedSceneId: 'scene-a', scenes: [{ id: 'scene-a', title: 'Opening' }, { id: 'scene-b' }] },
    mediaAssembly: assembly.emptyAssembly() };
  const options = () => ({ scenes: state.scenePlan.scenes, assets: state.media.assets, now: 0 });
  state.mediaAssembly = assembly.addCandidate(state.mediaAssembly, 'scene-a', 'A', options());
  state.mediaAssembly = assembly.addCandidate(state.mediaAssembly, 'scene-a', 'B', options());
  const persistence = { activeProjectId: () => state.projectId,
    selectSceneMaterial: (scene, id, opts) => { calls.push(['use', scene, id, opts]); state.mediaAssembly = assembly.selectCandidate(state.mediaAssembly, scene, id, { ...options(), selectionSource: 'manual' }); },
    addSceneMaterialCandidate: (scene, id, opts) => { calls.push(['add', scene, id, opts]); state.mediaAssembly = assembly.addCandidate(state.mediaAssembly, scene, id, options()); },
    removeSceneMaterialCandidate: (scene, id, opts) => { calls.push(['remove', scene, id, opts]); state.mediaAssembly = assembly.removeCandidate(state.mediaAssembly, scene, id, options()); },
    clearSceneMaterialSelection: (scene, opts) => { calls.push(['clear', scene, opts]); state.mediaAssembly = assembly.clearSelection(state.mediaAssembly, scene, options()); } };
  class Element {
    constructor() { this.dataset = {}; this.listeners = {}; this.classList = { toggle() {}, contains: () => false }; }
    setAttribute() {} querySelector() { return null; } addEventListener(name, fn) { this.listeners[name] = fn; }
    contains() { return true; }
  }
  let created = 0;
  const c = { state, window: { ViralCoreMediaAssemblyModel: assembly, ViralCoreProjectPersistence: persistence },
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
    document: { readyState: 'loading', activeElement: null, addEventListener() {}, createElement: () => { created++; return new Element(); } },
    HTMLElement: Element, HTMLButtonElement: class extends Element {}, URL, requestAnimationFrame() {} };
  vm.createContext(c); vm.runInContext(fs.readFileSync('renderer/i18n.js', 'utf8'), c);
  const source = fs.readFileSync('renderer/core-editor-assets.js', 'utf8').replace('  const start = () => {',
    '  window.__assetsTest = {materialsMarkup,materialAction,ensurePanel,updateMaterials};\n  const start = () => {');
  vm.runInContext(source, c);
  const section = new Element(); section.contains = () => false;
  const panel = new Element(); panel.querySelector = selector => selector === '[data-scene-materials]' ? section : selector === '[data-scene-material-picker]' ? { value: 'library' } : null;
  const api = c.window.__assetsTest;
  function click(action, assetId = '', projectId = state.projectId) {
    const button = { dataset: { sceneMaterialAction: action, sceneId: state.scenePlan.selectedSceneId, assetId, projectId } };
    api.materialAction({ target: { closest: () => button } }, panel);
  }
  return { api, state, calls, persistence, section, click, c, get created() { return created; } };
}
for (const locale of ['vi', 'en']) test(locale + ' Scene Materials uses externalized copy and canonical candidate references', () => {
  const h = harness(locale), copy = h.c.window.I18N.messages[locale].sceneMaterials, markup = h.api.materialsMarkup();
  assert(markup.includes(copy.title)); assert(markup.includes(copy.noSelection)); assert(markup.includes('Opening'));
  assert(markup.includes('Video A')); assert(markup.includes('Image B')); assert(!markup.includes('Audio'));
  assert(markup.includes(copy.kind.video)); assert(markup.includes(copy.origin.generated));
  h.state.scenePlan.selectedSceneId = 'scene-b'; const other = h.api.materialsMarkup();
  assert(other.includes(copy.empty)); assert(!other.includes('<li>')); assert(!other.includes('data-scene-material-action="use"'));
});
test('Use invokes persistence selection with captured project identity and renders In use', () => {
  const h = harness(), library = json(h.state.media); h.click('use', 'B');
  assert.deepEqual(json(h.calls), [['use', 'scene-a', 'B', { projectId: 'project' }]]);
  assert(h.section.innerHTML.includes('In use')); assert.deepEqual(h.state.media, library);
});
test('Add from project lists only existing visual assets not already candidates', () => {
  const h = harness(), markup = h.api.materialsMarkup();
  assert(markup.includes('<option value="library">Library video</option>'));
  assert(!markup.includes('<option value="audio">')); assert(!markup.includes('<option value="A">'));
  h.click('add'); assert.equal(h.calls[0][0], 'add'); assert.equal(h.calls[0][2], 'library');
});
test('selected scene drives actions and stale project UI cannot retarget', () => {
  const h = harness(); h.state.scenePlan.selectedSceneId = 'scene-b'; h.click('add'); assert.equal(h.calls[0][1], 'scene-b');
  const before = json(h.state.mediaAssembly); h.click('use', 'A', 'old-project');
  assert.equal(h.calls.length, 1); assert.deepEqual(h.state.mediaAssembly, before);
});
test('failed durable selection shows an error and preserves the prior selection', () => {
  const h = harness(); const before = json(h.state.mediaAssembly);
  h.persistence.selectSceneMaterial = () => { throw Error('quota'); }; h.click('use', 'B');
  assert.deepEqual(h.state.mediaAssembly, before); assert(h.section.innerHTML.includes('Your selection has not changed'));
});
test('missing selected scene displays a localized prompt without actions', () => {
  const h = harness(); h.state.scenePlan.selectedSceneId = 'deleted';
  const markup = h.api.materialsMarkup(); assert(markup.includes('Select a scene')); assert(!markup.includes('<button'));
});
test('candidate names and IDs are escaped before rendering', () => {
  const h = harness(); h.state.media.assets[0].name = '<img src=x onerror=alert(1)>';
  const markup = h.api.materialsMarkup(); assert(!markup.includes('<img')); assert(markup.includes('&lt;img'));
});
test('existing Assets panel is reused with one section and unchanged source/discovery actions', () => {
  const h = harness(); let panel; const grid = { querySelector: () => panel || null, prepend: value => { panel = value; } };
  assert.equal(h.api.ensurePanel(grid), h.api.ensurePanel(grid)); assert.equal(h.created, 1);
  assert.equal((panel.innerHTML.match(/data-scene-materials/g) || []).length, 1);
  for (const selector of ['data-source-asset', 'data-find-media', 'data-transcript-asset']) assert(panel.innerHTML.includes(selector));
});
test('scene selection does not access a player, provider, acquisition or library selection API', () => {
  const h = harness(), before = json(h.state.media), source = fs.readFileSync('renderer/core-editor-assets.js', 'utf8');
  h.c.window.desktopAPI = new Proxy({}, { get() { throw Error('NO_PROVIDER_CALL'); } });
  h.click('use', 'A'); assert.deepEqual(h.state.media, before);
  const handler = source.slice(source.indexOf('  function materialAction('), source.indexOf('  function ensurePanel('));
  for (const forbidden of ['video.', '.src', 'selectedAssetId =', 'submitGeneration', 'desktopAPI', 'render(']) assert(!handler.includes(forbidden));
});
test('keyboard focus, text expansion and explicit native selection remain supported', () => {
  const css = fs.readFileSync('renderer/core-editor-assets.css', 'utf8'), h = harness();
  assert(h.api.materialsMarkup().includes('<select')); assert(css.includes('.core-scene-materials button:focus-visible'));
  assert(css.includes('min-block-size:36px')); assert(css.includes('flex-wrap:wrap')); assert(css.includes('white-space:normal'));
  assert(fs.readFileSync('renderer/core-editor-assets.js', 'utf8').includes('window.addEventListener("viral-ai:scene-plan-changed", queue)'));
});
test('architecture-safe load order is additive and all new copy exists in both locales', () => {
  const index = fs.readFileSync('renderer/index.html', 'utf8');
  const scripts = ['core-media-library-model.js', 'core-scene-plan-model.js', 'core-media-assembly-model.js', 'core-project-snapshot.js', 'core-project-scene-plan.js', 'core-project-media-assembly.js', 'core-project-persistence.js'];
  for (let i = 1; i < scripts.length; i++) assert(index.indexOf('src="' + scripts[i - 1] + '"') < index.indexOf('src="' + scripts[i] + '"'));
  const messages = harness().c.window.I18N.messages;
  const keys = value => Object.entries(value).flatMap(([key, v]) => typeof v === 'object' ? keys(v).map(k => key + '.' + k) : [key]);
  assert.deepEqual(keys(messages.vi.sceneMaterials), keys(messages.en.sceneMaterials));
  assert(!JSON.stringify(messages.vi.sceneMaterials).includes('?'));
});
