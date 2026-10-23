"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { harness: projectHarness, draft, KEY, clone } = require("./helpers/project-media-harness");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ empty = false, muse = false, ready = true, error = false, hold = null, fail = false, locale = "en" } = {}) {
  const project = draft("A"); project.scenePlan.scenes[1].title = "Opening <shot>"; project.scenePlan.selectedSceneId = "A1";
  const h = projectHarness(new Map([[KEY, JSON.stringify({ schemaVersion: 1, activeProjectId: "A", projects: [project, draft("B")] })]]));
  if (empty) {
    h.data.clear(); h.c.state = { jobs: [], page: "ai-create", locale };
    vm.runInNewContext(fs.readFileSync("renderer/core-project-persistence.js", "utf8"), h.c);
    h.api = h.window.ViralCoreProjectPersistence;
  }
  const documentEvents = {}, submissions = [], tracked = [], opened = [];
  const { c, window, api, data } = h;
  c.state.page = "ai-create"; c.state.locale = locale;
  class Element {
    constructor(selector, dataset = {}) { this.selector = selector; this.dataset = dataset; this.attrs = {}; this.disabled = false; }
    closest(selector) { return selector === this.selector ? this : null; }
    matches(selector) { return selector === this.selector; }
    setAttribute(key, value) { this.attrs[key] = value; }
    focus() { this.focused = true; }
  }
  class TextArea extends Element { dispatchEvent(event) { emit(event.type, this); } }
  class Select extends Element {}
  const button = new Element("[data-ai-generate]"), label = { textContent: "" }, brief = new TextArea("[data-ai-brief]", { aiBrief: "" });
  button.querySelector = () => label;
  const context = {}, summary = {}, feedback = {}, readiness = {}, sceneSurface = { focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; } };
  const nodes = { "[data-ai-generate]": button, "[data-ai-scene-context]": context, "[data-ai-settings-summary]": summary, "[data-ai-generation-feedback]": feedback, "[data-ai-readiness]": readiness, "[data-ai-brief]": brief, "[data-project-scenes]": sceneSurface };
  c.document.addEventListener = (name, fn) => (documentEvents[name] ||= []).push(fn);
  c.document.querySelector = selector => nodes[selector] || null;
  c.document.querySelectorAll = () => [];
  c.document.documentElement = { dataset: {} };
  Object.assign(c, { Element, HTMLButtonElement: Element, HTMLTextAreaElement: TextArea, HTMLSelectElement: Select, Event: class { constructor(type) { this.type = type; } }, pages: {}, pageMeta: {}, render() {} });
  let readinessCalls = 0;
  window.desktopAPI = {
    async getGenerationStatus() { readinessCalls++; if (error) throw Error("private worker failure"); return { ok: true, value: { state: ready ? "ready" : "not_configured", ready, providers: muse ? [{ id: "muse", ready: true }] : [], modelIds: muse ? [] : ["local:wan"] } }; },
    async submitGeneration(payload) { submissions.push(clone(payload)); if (hold) await hold; return fail ? { ok: false, error: "private stack" } : { ok: true, value: { id: "job-1", projectId: payload.projectId } }; }
  };
  window.ViralCoreGeneratedMedia = { track: async job => tracked.push(job.id) };
  window.ViralGenerationProgress = { open: async id => opened.push(id) };
  vm.createContext(c);
  for (const file of ["i18n.js", "core-project-scenes.js", "core-ai-create.js"]) vm.runInContext(fs.readFileSync("renderer/" + file, "utf8"), c);
  function emit(type, target, extra = {}) { for (const handler of documentEvents[type] || []) handler({ target, detail: 1, ...extra }); }
  documentEvents.DOMContentLoaded.forEach(fn => fn());
  const click = (selector, dataset) => emit("click", new Element(selector, dataset));
  return { h, api, data, c, window, button, label, context, summary, feedback, readiness, brief, sceneSurface, submissions, tracked, opened, click,
    html: () => c.pages["ai-create"](), get readinessCalls() { return readinessCalls; },
    input(value) { brief.value = value; emit("input", brief); },
    setting(name, value) { const select = new Select("[data-ai-setting]", { aiSetting: name }); select.value = value; emit("change", select); }
  };
}

test("composer precedes canonical Scene surface and planning; recent projects use secondary native disclosure", async () => {
  const h = harness(); await tick(); const html = h.html();
  assert(html.indexOf("data-ai-active-project") < html.indexOf('class="core-ai-composer"'));
  assert(html.indexOf('class="core-ai-composer"') < html.indexOf('class="core-ai-project-plan"'));
  assert(html.indexOf('class="core-ai-project-plan"') < html.indexOf("data-project-scenes"));
  assert(html.indexOf("data-project-scenes") < html.indexOf('<details class="core-ai-recent"'));
  assert.equal((html.match(/data-project-scenes /g) || []).length, 1);
  assert(html.includes("Scene 02 · Opening &lt;shot&gt;")); assert(!html.includes('data-ai-scene-select'));
});
test("canonical Scene selection updates context in place without prompt reset, readiness query or admission rotation", async () => {
  const h = harness(); await tick(); h.input("Exact prompt\nwith whitespace  "); h.click("[data-ai-generate]"); await tick();
  assert.equal(h.submissions[0].sceneId, "A1"); const key = h.submissions[0].idempotencyKey, calls = h.readinessCalls;
  h.api.selectProjectScene("A0", { projectId: "A" });
  assert.equal(h.context.textContent, "Scene 01"); assert.equal(h.data.get("viral-ai-generation-brief"), "Exact prompt\nwith whitespace  "); assert.equal(h.readinessCalls, calls);
  h.click("[data-ai-generate]"); await tick(); assert.equal(h.submissions[1].idempotencyKey, key);
  h.window.dispatchEvent(new h.c.CustomEvent("viral-ai:generation-new-request", { detail: { projectId: "A" } }));
  h.click("[data-ai-generate]"); await tick(); assert.notEqual(h.submissions[2].idempotencyKey, key); assert.equal(h.submissions[2].sceneId, "A0");
});
for (const muse of [false, true]) test("exact " + (muse ? "Muse" : "non-Muse") + " payload, explicit click and exact admitted progress routing", async () => {
  const h = harness({ muse }); await tick(); h.input("User prompt unchanged  ");
  h.click("[data-ai-example]", { aiExample: "1" }); assert(h.brief.focused); assert.equal(h.data.get("viral-ai-generation-brief"), h.window.I18N.messages.en.aiCreate.examples[1].prompt);
  for (const [name, value] of [["aspect", "16:9"], ["duration", "10"], ["goal", "quality"]]) h.setting(name, value);
  assert.equal(h.submissions.length, 0); h.click("[data-ai-generate]"); await tick();
  const p = h.submissions[0]; assert.equal(p.projectId, "A"); assert.equal(p.sceneId, "A1"); assert.equal(p.prompt, h.brief.value); assert.equal(p.goal, "quality"); assert.equal(p.kind, "video"); assert.equal(p.mode, "text-to-video"); assert(p.idempotencyKey);
  assert.deepEqual(Object.keys(p).sort(), ["projectId", "sceneId", "idempotencyKey", "kind", "mode", "prompt", "goal", ...(muse ? ["providerId"] : ["aspectRatio", "durationSeconds"])].sort());
  if (muse) { assert.equal(p.providerId, "muse"); for (const name of ["aspect", "duration", "goal"]) assert(!h.html().includes('data-ai-setting="' + name + '"')); assert(h.html().includes("Using the current Muse settings")); }
  else { assert.equal(p.aspectRatio, "16:9"); assert.equal(p.durationSeconds, 10); assert(h.summary.innerHTML.includes("16:9") && h.summary.innerHTML.includes("10 seconds") && h.summary.innerHTML.includes("Quality")); }
  assert.deepEqual(h.tracked, ["job-1"]); assert.deepEqual(h.opened, ["job-1"]);
});
test("empty workspace permits drafting, creates no Project on paint and uses existing ensureProject only on Generate", async () => {
  const h = harness({ empty: true }); await tick(); const html = h.html();
  assert.equal(h.api.snapshot(), null); assert(html.includes("A project will be created when you start.")); assert(html.includes("The first scene will be created automatically")); assert(!html.includes('data-ai-route="ai-video"'));
  h.input("A".repeat(8000)); h.html(); assert.equal(h.api.snapshot(), null); assert(!h.button.disabled);
  h.click("[data-ai-generate]"); await tick(); assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].prompt.length, 8000); assert.equal(h.submissions[0].sceneId, h.api.snapshot().scenePlan.selectedSceneId);
  assert.match(h.api.snapshot().projectName, /^AI Project · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
test("readiness blocking and error leave drafting and Settings accessible without raw details", async () => {
  for (const options of [{ ready: false }, { error: true }]) {
    const h = harness(options); await tick(); h.input("Saved draft"); h.click("[data-ai-generate]"); await tick();
    assert(h.button.disabled); assert.equal(h.brief.disabled, false); assert.equal(h.submissions.length, 0); assert(h.html().includes('data-ai-action="settings"')); assert(!h.html().includes("private worker"));
    assert.equal(h.readiness.textContent, options.error ? h.window.I18N.messages.en.aiCreate.aiStatusError : "AI isn't ready");
  }
});
test("pending admission disables Generate, announces submitting and suppresses rapid clicks; failed feedback is localized", async () => {
  let finish; const h = harness({ hold: new Promise(resolve => finish = resolve), fail: true }); await tick(); h.input("Draft");
  h.click("[data-ai-generate]"); await tick(); h.click("[data-ai-generate]"); h.html();
  assert.equal(h.submissions.length, 1); assert(h.button.disabled); assert.equal(h.button.attrs["aria-busy"], "true"); assert.equal(h.label.textContent, "Submitting…");
  finish(); await tick(); assert.equal(h.button.attrs["aria-busy"], "false"); assert.equal(h.feedback.textContent, h.window.I18N.messages.en.aiCreate.generationError); assert(!h.feedback.textContent.includes("private stack"));
});
test("Change scene navigates only to the existing focusable Scene surface", async () => {
  const h = harness(); await tick(); const before = h.api.snapshot(), writes = h.h.writes;
  h.click("[data-ai-action]", { aiAction: "change-scene" }); assert(h.sceneSurface.focused && h.sceneSurface.scrolled);
  assert.deepEqual(h.api.snapshot(), before); assert.equal(h.h.writes, writes); assert.equal(h.submissions.length, 0);
});
test("Customize uses native details without preference storage, while real settings retain exactly existing keys", async () => {
  const h = harness(); await tick(); const before = [...h.data];
  h.click("[data-ai-customize-trigger]"); assert.deepEqual([...h.data], before);
  for (const [name, value] of [["aspect", "1:1"], ["duration", "10"], ["goal", "economy"]]) { h.setting(name, value); assert.equal(h.data.get("viral-ai-generation-" + name), value); }
  assert.equal(h.submissions.length, 0); assert(![...h.data.keys()].some(k => /disclosure|customize/.test(k)));
});
test("both locales contain every referenced Create string and preserve Unicode/escaped long names and prompt", async () => {
  for (const locale of ["vi", "en"]) {
    const h = harness({ locale }); await tick(); const c = h.window.I18N.messages[locale].aiCreate;
    const source = fs.readFileSync("renderer/core-ai-create.js", "utf8");
    for (const [, key] of source.matchAll(/\bc\.([a-zA-Z]\w*)/g)) assert(c[key] !== undefined, locale + ".aiCreate." + key);
    h.api.renameProject("A", "Long <project> & ".repeat(100)); h.input("<script>".repeat(1000));
    const html = h.html(); assert(!html.includes("undefined")); assert(html.includes("Long &lt;project&gt; &amp;")); assert(html.includes('maxlength="8000"')); assert(html.includes("&lt;script&gt;"));
    if (locale === "vi") assert(html.includes("Mô tả video bạn muốn tạo"));
  }
});
