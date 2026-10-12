"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const index = read("renderer/index.html");
const assets = read("renderer/core-editor-assets.js");
const discovery = read("renderer/core-media-discovery.js");
const locale = read("renderer/core-media-i18n.js");
const css = read("renderer/core-media-discovery.css");
const assetCss = read("renderer/core-editor-assets.css");

assert(index.includes('href="core-media-discovery.css"'), "media discovery stylesheet must be loaded");
assert(index.includes('src="core-media-i18n.js"'), "media locale catalog must be loaded until consolidated into the central catalog");
assert(index.includes('src="core-media-discovery.js"'), "media discovery controller must be loaded");
assert(
  index.indexOf('src="core-media-i18n.js"') < index.indexOf('src="core-editor-assets.js"'),
  "media locale must load before the assets rail"
);
assert(
  index.indexOf('src="core-media-discovery.js"') < index.indexOf('src="core-editor-assets.js"'),
  "media discovery event listener must be ready before assets rail interactions"
);

for (const marker of ["project", "media", "discover", "generated", "favorites"]) {
  assert(assets.includes(`sectionLabel("${marker}")`), `assets rail must include ${marker} section`);
}
assert(assets.includes('data-find-media'), "assets rail must expose Find media action");
assert(assets.includes('viral-ai:media-discovery-open'), "Find media must open the discovery surface through a product event");
assert(assets.includes('current?.media?.assets'), "asset counts must come from project-owned media state");

assert(discovery.includes('window.desktopAPI?.searchMedia'), "online search must go through the narrow desktop bridge");
assert(discovery.includes('window.ViralCoreMediaLibraryModel'), "project insertion must use the media domain model");
assert(discovery.includes('model.addAssets(current.media, [candidate])'), "duplicate protection must be enforced through domain addAssets");
assert(discovery.includes('model.MAX_PROJECT_ASSETS'), "project capacity must be enforced from the domain model rather than a UI magic number alone");
assert(discovery.includes('renderState("capacity", "libraryFullTitle", "libraryFullBody")'), "capacity rejection must be visible and localized");
assert(discovery.includes('fileState: "remote"'), "selected remote stock must remain explicitly remote before download/cache");
assert(discovery.includes('origin: "stock"'), "selected search media must retain stock origin");
assert(discovery.includes('attribution: result.attribution || {}'), "selected media must retain attribution/license metadata");
assert(discovery.includes('typeof window.desktopAPI?.searchMedia !== "function"'), "missing bridge must produce an unavailable state rather than fake results");
assert(!/mock|fixture|sampleResults|fakeResults/i.test(discovery), "production discovery controller must not contain fake stock result fixtures");
assert(!discovery.includes("PEXELS_API_KEY") && !discovery.includes("PIXABAY_API_KEY"), "provider credentials must never appear in renderer code");

const requestIncrement = discovery.indexOf("const requestId = ++activeRequest;");
const queryValidation = discovery.indexOf("if (query.length < 2)");
assert(requestIncrement >= 0 && requestIncrement < queryValidation, "each submit must invalidate older async results before early validation returns");
assert(discovery.includes('currentView === "results" && lastResults.length'), "semantic state changes must only refresh an active results view");
assert(discovery.includes('lastResults = [];'), "non-results states must clear stale result cache");

assert(discovery.includes("FOCUSABLE_SELECTOR"), "discovery dialog must define its keyboard focus boundary");
assert(discovery.includes("makeBackgroundInert(drawer)"), "background application surfaces must be inert while the modal drawer is open");
assert(discovery.includes("restoreBackground();"), "background inert state must be restored on close");
assert(discovery.includes('if (event.key === "Escape")'), "Escape must close the modal drawer");
assert(discovery.includes('if (event.key !== "Tab") return false;'), "Tab and Shift+Tab must be trapped inside the modal drawer");
assert(discovery.includes("opener = document.activeElement"), "opening the drawer must capture the keyboard return target");
assert(discovery.includes("target.focus()"), "closing the drawer must restore focus to the opener");

for (const language of ["vi", "en"]) {
  assert(locale.includes(`window.I18N.messages.${language}.mediaWorkbench`), `${language} media workbench copy must exist`);
}
for (const key of ["discoveryTitle", "searchPlaceholder", "unavailableTitle", "signInTitle", "failedTitle", "libraryFullTitle", "libraryFullBody", "addProject"]) {
  assert(locale.includes(`${key}:`), `media locale must define ${key}`);
}

assert(css.includes("prefers-reduced-motion:reduce"), "media discovery must respect reduced motion");
assert(css.includes("core-media-state"), "discovery must style empty/loading/error states");
assert(css.includes("font-size:13px"), "essential discovery controls/body copy must reach the 13px readability floor");
assert(css.includes("font-size:12px"), "secondary discovery copy must reach the 12px readability floor");
assert(css.includes("font-size:11px"), "tiny discovery metadata must not fall below the 11px floor");
assert(!/font-size:(?:8|9|10)px/.test(css), "media discovery must not introduce sub-11px text");
assert(!/font-size:(?:8|9|10)px/.test(assetCss), "media asset rail must not introduce sub-11px text");
assert(assetCss.includes("core-discover-action"), "Find media must have a deliberate rail treatment");
assert(assetCss.includes("core-asset-stat.has-items"), "real project media counts must have a visible populated state");

console.log("Commercial media workbench hierarchy, recovery, accessibility, readability, bridge boundary and no-fake-data contracts passed.");
