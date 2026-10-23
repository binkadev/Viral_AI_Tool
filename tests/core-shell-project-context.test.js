"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "renderer", name), "utf8");

// Load the real competing modules in production order, with shared DOM nodes,
// event handlers, mutation callbacks, and animation frames. No provider is called.
function harness(locale) {
  const documentEvents = new Map(), windowEvents = new Map(), observers = [], frames = [];
  const counts = { creates: 0, opens: 0, ensures: 0, submissions: 0 };
  class Element {
    constructor() { this.dataset = {}; this.style = {}; this.writes = []; this._text = ""; }
    set textContent(value) { this._text = value; this.writes.push(value); }
    get textContent() { return this._text; }
    setAttribute() {}
    removeAttribute() {}
  }
  class Button extends Element {}
  const nodes = Object.fromEntries(["page", "nav", "pageTitle", "breadcrumb", "newProjectLabel", "workspaceLabel", "workspace", "source"].map(id => [id, new Element()]));
  const projects = [
    { projectId: "a", projectName: "AI campaign <A>", projectKind: "ai", hasSource: false },
    { projectId: "b", projectName: "Named imported campaign", projectKind: "imported", hasSource: true }
  ];
  const registry = { activeId: "a", projects };
  const state = { locale, page: "ai-create", jobs: [] };
  const source = { sourcePath: "C:/media/source.mp4", name: "source.mp4", fileState: "available" };
  nodes.source.textContent = source.name; // editor-assets owns source text.
  const pages = {}, storage = new Map();
  const add = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const document = {
    readyState: "loading", documentElement: new Element(), head: { appendChild() {} },
    addEventListener: (name, fn) => add(documentEvents, name, fn),
    createElement: () => ({ remove() {} }),
    getElementById: id => nodes[id] || null,
    querySelector(selector) {
      if (selector === ".workspace strong") return nodes.workspace;
      if (selector === "#page .core-editor-assets-panel [data-source-name]") return state.page === "ai-video" ? nodes.source : null;
      if (/^(script|link)\[/.test(selector)) return {}; // already installed overrides
      return null;
    },
    querySelectorAll: () => []
  };
  const window = {
    addEventListener: (name, fn) => add(windowEvents, name, fn),
    ViralCoreProjectPersistence: {
      activeProjectId: () => registry.activeId,
      listProjects: () => registry.projects,
      createProject() { counts.creates++; throw Error("Unexpected creation during navigation"); },
      openProject() { counts.opens++; throw Error("Unexpected switch during navigation"); },
      ensureProject() { counts.ensures++; throw Error("Unexpected generation admission"); }
    },
    desktopAPI: {
      getGenerationStatus: async () => ({ ok: true, value: { state: "ready", ready: true } }),
      submitGeneration() { counts.submissions++; throw Error("Submission forbidden"); }
    }
  };
  function mutate() { observers.forEach(observer => observer.callback()); }
  function render() {
    nodes.page.innerHTML = pages[state.page]?.() || "";
    mutate();
  }
  const context = vm.createContext({
    window, document, state, pages, pageMeta: {}, navItems: [], navRender() {},
    HTMLElement: Element, HTMLButtonElement: Button, Element,
    console, render, save() {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: fn => frames.push(fn),
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() { if (!observers.includes(this)) observers.push(this); } }
  });
  for (const file of ["i18n.js", "core-bootstrap.js", "core-product-shell.js", "core-ai-create.js", "core-project-context.js", "core-dashboard-real-data.js"]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  documentEvents.get("DOMContentLoaded").forEach(fn => fn());
  async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    let limit = 100;
    while (frames.length && limit-- > 0) frames.shift()();
    assert(limit > 0, "Shell must settle without a rewrite loop");
  }
  return {
    nodes, state, registry, source, counts, settle,
    async navigate(page) { state.page = page; render(); await settle(); },
    mutate,
    async switchProject(id) {
      registry.activeId = id;
      state.jobs = id === "b" ? [source] : [];
      for (const fn of windowEvents.get("viral-ai:core-state-changed") || []) fn();
      await settle();
    },
    createPage: () => pages["ai-create"]()
  };
}

function assertWorkspace(h, name) {
  assert.equal(h.nodes.workspace.textContent, name);
  assert.equal(h.nodes.workspace.title, name);
}

(async () => {
  // Guard all shipped renderer scripts, including first-paint bootstrap, against
  // reintroducing an additional direct workspace-name writer.
  const writers = fs.readdirSync(path.join(root, "renderer"))
    .filter(name => name.endsWith(".js") && read(name).includes(".workspace strong"));
  assert.deepEqual(writers, ["core-dashboard-real-data.js"]);
  assert(!read("core-project-context.js").includes("breadcrumb"));

  for (const locale of ["vi", "en"]) {
    const h = harness(locale);
    await h.settle();
    // A: AI identity stays fixed across navigation, even in Studio without source.
    for (const page of ["ai-create", "ai-video", "ai-create"]) {
      await h.navigate(page);
      assertWorkspace(h, "AI campaign <A>");
    }
    // B/D: explicit project switch updates once; subsequent shell scans cannot
    // overwrite the project with a page title or source filename.
    const before = h.nodes.workspace.writes.length;
    await h.switchProject("b");
    assertWorkspace(h, "Named imported campaign");
    assert.equal(h.nodes.workspace.writes.length, before + 1);
    for (const page of ["ai-video", "ai-create", "ai-video"]) {
      await h.navigate(page);
      assertWorkspace(h, "Named imported campaign");
    }
    // C: run mutation observers after the canonical owner has written.
    h.mutate(); await h.settle();
    assertWorkspace(h, "Named imported campaign");
    assert.equal(h.nodes.workspace.writes.length, before + 1);
    // E: navigation owns breadcrumb; source health remains on editor metadata.
    assert.equal(h.nodes.breadcrumb.textContent, locale === "vi" ? "Tạo video / Studio" : "Create video / Studio");
    assert.equal(h.nodes.pageTitle.textContent, locale === "vi" ? "Studio video" : "Video studio");
    assert.equal(h.nodes.source.textContent, "source.mp4");
    assert.equal(h.nodes.source.dataset.sourceState, "ready");
    h.source.fileState = "missing";
    h.mutate(); await h.settle();
    assert.equal(h.nodes.source.dataset.sourceState, "needs-action");
    assert(!h.nodes.breadcrumb.textContent.includes("source.mp4"));
    // F/G: registry name/type + open state in both locales; only inactive rows open.
    for (const id of ["a", "b"]) {
      await h.switchProject(id);
      await h.navigate("ai-create");
      const html = h.createPage();
      const ai = locale === "vi" ? "Dự án AI" : "AI project";
      const imported = locale === "vi" ? "Dự án từ video" : "Imported project";
      const activeType = id === "a" ? ai : imported;
      const name = id === "a" ? "AI campaign &lt;A&gt;" : "Named imported campaign";
      assert(html.includes('title="' + name + '"') && html.includes('>' + name + '</strong>'), "The active identity strip exposes the escaped canonical name and full title");
      assert(html.includes('data-ai-active-project="' + id + '"'));
      const identity = html.slice(html.indexOf('data-ai-active-project="' + id + '"'), html.indexOf('<div class="core-ai-project-actions">'));
      assert(!identity.includes('<span>' + activeType + '</span>'), "Create header shows one canonical name; Project type remains in Recent Projects");
      assert(!html.includes('class="core-ai-heading"'), "The shell already owns the Create page title");
      assert(html.indexOf('data-ai-active-project="' + id + '"') < html.indexOf('<section class="core-ai-composer"'), "Project identity remains before the creation action");
      assert(html.includes('<span>' + activeType + (locale === "vi" ? " · Đang mở" : " · Open") + '</span>'));
      assert(html.includes('<span>' + (id === "a" ? imported : ai) + '</span>'));
      assert(!html.includes('data-ai-open-project="' + id + '"'));
      assert(html.includes('data-ai-open-project="' + (id === "a" ? "b" : "a") + '"'));
      assert.equal(h.registry.activeId, id, "Navigation must not select a different project");
      assert.equal(h.nodes.breadcrumb.textContent, locale === "vi" ? "Tạo video / Tạo bằng AI" : "Create video / Create with AI");
    }
    // A project originating from AI retains its type after receiving source media.
    h.registry.projects[0].hasSource = true;
    await h.switchProject("a");
    assert(h.createPage().includes(locale === "vi" ? "Dự án AI · Đang mở" : "AI project · Open"));
    // H: no registry and no source yields localized empty identity.
    h.registry.projects = [];
    await h.switchProject(null);
    assertWorkspace(h, locale === "vi" ? "Chưa có dự án" : "No project");
    assert(!h.createPage().includes('data-ai-active-project='));
    assert.deepEqual(h.counts, { creates: 0, opens: 0, ensures: 0, submissions: 0 });
  }
  console.log("Integrated shell project context A–H passed in VI/EN: single workspace owner, navigation, source health, registry target/type/open state. No submission.");
})().catch(error => { console.error(error); process.exitCode = 1; });
