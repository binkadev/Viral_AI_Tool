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
const shellStabilityCss = fs.readFileSync(path.join(root, "renderer", "core-shell-stability.css"), "utf8");
const navigationStability = fs.readFileSync(path.join(root, "renderer", "core-navigation-stability.js"), "utf8");
const hudJs = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.js"), "utf8");
const hudCss = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.css"), "utf8");
const workstationCss = fs.readFileSync(path.join(root, "renderer", "core-premium-workstation.css"), "utf8");
const brandMark = fs.readFileSync(path.join(root, "renderer", "brand-mark.svg"), "utf8");

for (const required of [
  "LEGACY_DEMO_NAMES",
  "removeLegacyDemoJobs",
  "current.jobs.filter(job => !job?.isRenderOutput)",
  'data-core-capability="coming-soon"',
  'const startupPage = hasSourceVideo() ? "ai-video" : "download"',
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

const themeBootstrap = 'localStorage.getItem(stateKey)';
const firstStylesheet = 'href="styles.css"';
assert(index.includes('data-theme="midnight"'), "Premium Dark must be the static first-paint theme.");
assert(index.includes('data-motion="balanced"'), "Balanced motion must be the new first-paint motion default.");
assert(index.includes(themeBootstrap), "Saved appearance must be restored during head bootstrap.");
assert(index.includes('if (!saved.appearance)'), "Premium Dark must only initialize when no appearance preference exists.");
assert(index.includes('if (!saved.motion)'), "Balanced motion must only initialize when no motion preference exists.");
assert(!index.includes('saved.appearance === "aurora-light"'), "Explicit Aurora Light preferences must never be silently migrated.");
assert(!index.includes('saved.motion === "expressive"'), "Explicit Expressive motion preferences must never be silently migrated.");
assert(index.includes('new Set(["aurora-light", "pearl-light", "midnight"])'), "Theme bootstrap must accept only supported appearances.");
assert(index.includes('root.dataset.theme = themes.has(saved.appearance) ? saved.appearance : "midnight"'), "Theme bootstrap must safely resolve to Premium Dark.");
assert(index.includes('root.dataset.motion = motions.has(saved.motion) ? saved.motion : "balanced"'), "Motion bootstrap must safely resolve to Balanced.");
assert(
  index.indexOf(themeBootstrap) < index.indexOf(firstStylesheet),
  "Theme bootstrap must execute before the first stylesheet to prevent light/dark first-paint switching."
);

assert.doesNotThrow(() => new Function(navigationStability), "Navigation stability JS must parse.");
assert.doesNotThrow(() => new Function(hudJs), "Premium HUD JS must parse.");
assert(!index.includes('data-startup="booting"'), "The app must not enter the removed animated startup state.");
assert(!index.includes('id="appStartup"'), "The removed startup splash must not be rendered.");
assert(!index.includes('core-startup-experience.css'), "Removed startup CSS must not be loaded.");
assert(!index.includes('core-startup-experience.js'), "Removed startup JS must not be loaded.");
assert(index.includes('href="core-shell-stability.css"'), "Direct-paint shell stability CSS must be loaded.");
assert(index.includes('src="core-navigation-stability.js"'), "Stable navigation behavior must be loaded.");
assert(index.indexOf('src="core-navigation-stability.js"') > index.indexOf('src="core-product-shell.js"'), "Navigation stability must wrap the final core navigation renderer.");
assert(index.includes('href="core-premium-hud.css"'), "Premium HUD CSS must be loaded.");
assert(index.includes('src="core-premium-hud.js"'), "Premium HUD JS must be loaded.");
assert(index.includes('href="core-premium-workstation.css"'), "Premium workstation shell CSS must be loaded.");
assert(index.indexOf('href="core-premium-workstation.css"') > index.indexOf('href="core-premium-interactions.css"'), "Premium workstation refinement must load after motion/interactions so its material hierarchy wins.");
assert(index.indexOf('href="core-shell-stability.css"') > index.indexOf('href="core-command-surface.css"'), "Shell stability must load last so removed page-entry motion cannot leak back in.");
assert(index.includes('src="brand-mark.svg"'), "The product shell must use the shared brand mark.");
assert(brandMark.includes('linearGradient id="bg"'), "Brand mark must use the production gradient artwork.");

for (const required of [
  "Direct-paint workstation shell",
  ".viral-brand-icon",
  ".viral-brand-mark",
  "contain:layout style",
  "#page.core-page-enter::before",
  "content:none!important",
  "transition-property:background-color,border-color,color,box-shadow!important"
]) {
  assert(shellStabilityCss.includes(required), "Shell stability CSS missing: " + required);
}
assert(!shellStabilityCss.includes("@keyframes"), "Direct shell paint must not introduce another startup/page animation.");

for (const required of [
  "legacyNavRender",
  "structureMatches",
  "buttons.forEach",
  'button.setAttribute("aria-current", "page")',
  "stableNavigationWired",
  "event.stopImmediatePropagation()",
  'root.dataset.stableNavigation = "enabled"'
]) {
  assert(navigationStability.includes(required), "Stable navigation behavior missing: " + required);
}

for (const required of [
  ".premium-hud-layer{display:none;",
  'html[data-theme="midnight"] .premium-hud-layer{display:block}',
  ".premium-hud-grid",
  "hudGlobalScan",
  "hudOrbitSpin",
  "hudPreviewScan",
  "hudTimelineSweep",
  ".hud-reactive-light",
  ".is-hud-hover>.hud-reactive-light",
  '--hud-magnet-x',
  ':has([data-core-job-state="processing"])',
  '.button.primary:is(:hover,:focus-visible)::after',
  'html[data-motion="reduced"]'
]) {
  assert(hudCss.includes(required), "Premium HUD CSS missing: " + required);
}
for (const required of [
  'id = "premiumHudLayer"',
  'root.dataset.premiumHud = "enabled"',
  'root.classList.add("premium-hud-ready")',
  'document.addEventListener("pointermove"',
  "SURFACE_SELECTOR",
  "MAGNET_SELECTOR",
  "ensureReactiveLight",
  "syncSurface",
  "syncMagnet",
  "clearInteractiveState"
]) {
  assert(hudJs.includes(required), "Premium HUD behavior missing: " + required);
}
assert(!hudJs.includes('viral-ai:startup-complete'), "HUD must not depend on the removed startup animation event.");
assert(hudCss.includes('.button.primary::after{animation:none'), "Primary button shimmer must be interaction-triggered, not permanently looping.");
assert(hudCss.includes('.core-editor-assets-panel::after,\nhtml.core-editor-premium .core-editor-inspector::after{animation:none'), "Editor panel sweeps must stay dormant outside processing.");

for (const required of [
  'html[data-theme="midnight"] .topbar',
  'html[data-theme="midnight"] .command-palette',
  'html[data-theme="midnight"] #quickProject',
  'html[data-theme="midnight"] .sidebar',
  'html.core-editor-premium .core-workflow-shell',
  'html.core-editor-premium .preview.core-player-host',
  'text-rendering:optimizeLegibility',
  'text-shadow:none!important',
  'html[data-motion="reduced"] .command-palette'
]) {
  assert(workstationCss.includes(required), "Premium workstation refinement missing: " + required);
}
assert(!workstationCss.includes('@keyframes'), "Workstation hierarchy layer must not introduce another ambient animation loop.");

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
    page: "library",
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

assert.strictEqual(
  vm.runInContext("state.page", context),
  "ai-video",
  "A reopened project with a source must land in Core Editor even when the previous page was passive."
);
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
