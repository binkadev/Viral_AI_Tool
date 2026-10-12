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
assert(index.includes('src="core-media-i18n.js"'), "media locale catalog must be loaded");
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
assert(discovery.includes('fileState: "remote"'), "selected remote stock must remain explicitly remote before download/cache");
assert(discovery.includes('origin: "stock"'), "selected search media must retain stock origin");
assert(discovery.includes('attribution: result.attribution || {}'), "selected media must retain attribution/license metadata");
assert(discovery.includes('typeof window.desktopAPI?.searchMedia !== "function"'), "missing bridge must produce an unavailable state rather than fake results");
assert(!/mock|fixture|sampleResults|fakeResults/i.test(discovery), "production discovery controller must not contain fake stock result fixtures");
assert(!discovery.includes("PEXELS_API_KEY") && !discovery.includes("PIXABAY_API_KEY"), "provider credentials must never appear in renderer code");

for (const language of ["vi", "en"]) {
  assert(locale.includes(`window.I18N.messages.${language}.mediaWorkbench`), `${language} media workbench copy must exist`);
}
for (const key of ["discoveryTitle", "searchPlaceholder", "unavailableTitle", "signInTitle", "failedTitle", "addProject"]) {
  assert(locale.includes(`${key}:`), `media locale must define ${key}`);
}

assert(css.includes("prefers-reduced-motion:reduce"), "media discovery must respect reduced motion");
assert(css.includes("core-media-state"), "discovery must style empty/loading/error states");
assert(assetCss.includes("core-discover-action"), "Find media must have a deliberate rail treatment");
assert(assetCss.includes("core-asset-stat.has-items"), "real project media counts must have a visible populated state");

console.log("Commercial media workbench hierarchy, bridge boundary, persistence intent, locale and no-fake-data contracts passed.");
