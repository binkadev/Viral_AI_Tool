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
const startupJs = fs.readFileSync(path.join(root, "renderer", "core-startup-experience.js"), "utf8");
const startupCss = fs.readFileSync(path.join(root, "renderer", "core-startup-experience.css"), "utf8");
const hudJs = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.js"), "utf8");
const hudCss = fs.readFileSync(path.join(root, "renderer", "core-premium-hud.css"), "utf8");
const workstationCss = fs.readFileSync(path.join(root, "renderer", "core-workstation-shell.css"), "utf8");
const commandJs = fs.readFileSync(path.join(root, "renderer", "core-command-palette.js"), "utf8");
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
assert(index.includes('data-motion="expressive"'), "Expressive motion must be the new first-paint motion default.");
assert(index.includes(themeBootstrap), "Saved appearance must be restored during head bootstrap.");
assert(index.includes('if (!saved.appearance)'), "Premium Dark must only initialize when no appearance preference exists.");
assert(index.includes('if (!saved.motion)'), "Expressive motion must only initialize when no motion preference exists.");
assert(!index.includes('saved.appearance === "aurora-light"'), "Explicit Aurora Light preferences must never be silently migrated.");
assert(!index.includes('saved.motion === "balanced"'), "Explicit Balanced motion preferences must never be silently migrated.");
assert(index.includes('new Set(["aurora-light", "pearl-light", "midnight"])'), "Theme bootstrap must accept only supported appearances.");
assert(index.includes('root.dataset.theme = themes.has(saved.appearance) ? saved.appearance : "midnight"'), "Theme bootstrap must safely resolve to Premium Dark.");
assert(index.includes('root.dataset.motion = motions.has(saved.motion) ? saved.motion : "expressive"'), "Motion bootstrap must safely resolve to Expressive.");
assert(
  index.indexOf(themeBootstrap) < index.indexOf(firstStylesheet),
  "Theme bootstrap must execute before the first stylesheet to prevent light/dark first-paint switching."
);

assert.doesNotThrow(() => new Function(startupJs), "Premium startup JS must parse.");
assert.doesNotThrow(() => new Function(hudJs), "Premium HUD JS must parse.");
assert.doesNotThrow(() => new Function(commandJs), "Core command palette JS must parse.");
assert(index.includes('data-startup="booting"'), "The document must begin in a protected startup state.");
assert(index.includes('id="appStartup"'), "Premium startup overlay must be present in the shell.");
assert(index.includes('href="core-startup-experience.css"'), "Premium startup CSS must be loaded.");
assert(index.includes('src="core-startup-experience.js"'), "Premium startup JS must be loaded.");
assert(index.includes('href="core-premium-hud.css"'), "Premium HUD CSS must be loaded.");
assert(index.includes('src="core-premium-hud.js"'), "Premium HUD JS must be loaded.");
assert(index.includes('href="core-workstation-shell.css"'), "Premium workstation shell CSS must be loaded after the interaction layers.");
assert(index.includes('src="core-command-palette.js"'), "Functional command palette JS must be loaded.");
assert(index.indexOf('href="core-workstation-shell.css"') > index.indexOf('href="core-premium-interactions.css"'), "Workstation refinement must be the final shell style layer.");
assert(index.includes('src="brand-mark.svg"'), "The product shell must use the shared brand mark.");
assert(brandMark.includes('linearGradient id="bg"'), "Brand mark must use the production gradient artwork.");

const startupStart = index.indexOf('id="appStartup"');
const startupEnd = index.indexOf('<div class="ambient-layer"');
const startupMarkup = index.slice(startupStart, startupEnd);
assert(!startupMarkup.includes("CREATOR STUDIO"), "Startup splash must not introduce an English-only subtitle.");

for (const required of [
  'root.dataset.startup = "booting"',
  'root.dataset.startup = "revealing"',
  'root.dataset.startup = "ready"',
  'startup-reveal-once',
  'window.setTimeout(reveal, 2800)',
  'prefers-reduced-motion: reduce',
  'viral-ai:startup-complete',
  'core-page-enter'
]) {
  assert(startupJs.includes(required) || startupCss.includes(required), "Premium startup behavior missing: " + required);
}

for (const required of [
  ".app-startup",
  "startupLogoReveal",
  "startupAuroraA",
  "startupSidebarIn",
  "startupNavItemIn",
  'html[data-startup="ready"].startup-reveal-once .nav-item',
  "prefers-reduced-motion",
  'html[data-motion="reduced"]'
]) {
  assert(startupCss.includes(required), "Premium startup CSS missing: " + required);
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
  'document.addEventListener("pointermove"',
  'window.addEventListener("viral-ai:startup-complete"',
  "SURFACE_SELECTOR",
  "MAGNET_SELECTOR",
  "ensureReactiveLight",
  "syncSurface",
  "syncMagnet",
  "clearInteractiveState"
]) {
  assert(hudJs.includes(required), "Premium HUD behavior missing: " + required);
}
assert(hudCss.includes('.button.primary::after{animation:none'), "Primary button shimmer must be interaction-triggered, not permanently looping.");
assert(hudCss.includes('.core-editor-assets-panel::after,\nhtml.core-editor-premium .core-editor-inspector::after{animation:none'), "Editor panel sweeps must stay dormant outside processing.");

for (const required of [
  '.main>.topbar',
  '.core-editor-focus-section .editor-grid.core-editor-assets-grid',
  '.core-command-backdrop',
  '.core-command-dialog',
  '.core-command-option.is-active',
  '@keyframes studioCommandIn',
  'html[data-motion="reduced"]'
]) {
  assert(workstationCss.includes(required), "Workstation shell refinement missing: " + required);
}
for (const required of [
  'document.querySelector(".command-palette")',
  'document.querySelectorAll("#nav .nav-item[data-page]")',
  'event.ctrlKey||event.metaKey',
  'String(event.key).toLowerCase()==="k"',
  'event.key==="ArrowDown"',
  'event.key==="ArrowUp"',
  'event.key==="Enter"',
  'event.key==="Escape"',
  'requestAnimationFrame(()=>item.node.click())',
  'aria-haspopup','dialog'
]) {
  assert(commandJs.includes(required), "Functional command palette missing: " + required);
}
assert(!commandJs.includes('state.page='), "Command palette must navigate through the existing nav controls instead of bypassing product routing.");

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
