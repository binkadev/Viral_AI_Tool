"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "renderer", "core-product-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-product-shell.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const capabilities = fs.readFileSync(path.join(root, "renderer", "core-capabilities.css"), "utf8");

for (const required of [
  "LEGACY_DEMO_NAMES",
  "removeLegacyDemoJobs",
  "current.jobs.filter(job => !job?.isRenderOutput)",
  'data-core-capability="coming-soon"',
  'current.page = hasSourceVideo() ? "ai-video" : "download"',
  '{ id: "download", icon: "⇩", label: "core-import" }',
  '{ id: "ai-video", icon: "◫", label: "core-editor" }',
  'pages.download = function coreImportPage()'
]) {
  assert(shell.includes(required), "Core product shell is missing behavior: " + required);
}

for (const legacyName of [
  "Douyin_Product_042.mp4",
  "UGC_Beauty_118.mp4",
  "Review_Camera_090.mp4",
  "Short_Fashion_031.mp4"
]) {
  assert(shell.includes(legacyName), "Legacy demo cleanup is missing: " + legacyName);
}

assert(index.includes('href="core-product-shell.css"'), "Core product shell CSS must be loaded.");
assert(index.includes('src="core-product-shell.js"'), "Core product shell JS must be loaded.");
assert(css.includes(".core-import-primary"), "Core import UI styles must be present.");
assert(!capabilities.includes('[data-page="ai-video"]'), "Core Editor must not be hidden by capability CSS.");

class FakeElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
  }
}
class FakeButton extends FakeElement {
  addEventListener() {}
}

const elements = {
  nav: new FakeElement(),
  page: new FakeElement(),
  pageTitle: new FakeElement(),
  breadcrumb: new FakeElement(),
  newProjectLabel: new FakeElement()
};

const context = {
  console,
  HTMLButtonElement: FakeButton,
  HTMLElement: FakeElement,
  MutationObserver: class { observe() {} },
  document: {
    readyState: "complete",
    documentElement: { dataset: {} },
    getElementById(id) { return elements[id] || null; },
    addEventListener() {}
  }
};
vm.createContext(context);
vm.runInContext(`
  const state = {
    locale: "vi",
    page: "dashboard",
    jobs: [
      { name: "source.mp4", sourcePath: "C:/source.mp4", isRenderOutput: false },
      { name: "rendered.mp4", outputPath: "C:/rendered.mp4", isRenderOutput: true }
    ]
  };
  const navItems = [];
  const pages = { download: () => "legacy" };
  function t(key) { return key; }
  function save() {}
  function jobsTable(rows) { return "ROWS=" + rows.length; }
  function navRender() {}
  function render() {
    navRender();
    if (pages[state.page]) pages[state.page]();
  }
`, context);
vm.runInContext(shell, context);

assert.strictEqual(vm.runInContext("state.page", context), "ai-video", "A reopened project with a source must land in Core Editor.");
assert.deepStrictEqual(
  Array.from(vm.runInContext("navItems.filter(x => x.id).map(x => x.id)", context)),
  ["download", "ai-video", "library", "accounts", "usage", "billing", "settings"],
  "Core navigation must not expose standalone prototype pages."
);
const importHtml = vm.runInContext("pages.download()", context);
assert(importHtml.includes("ROWS=1"), "Import page must list only source videos, not rendered outputs.");
assert(importHtml.includes("coming-soon"), "Unsupported URL import must be visibly coming soon.");
assert.strictEqual(elements.pageTitle.textContent, "Core Editor");
assert.strictEqual(context.document.documentElement.dataset.coreProductShell, "enabled");

console.log("Core product shell tests passed.");