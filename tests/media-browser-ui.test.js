"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "renderer", "core-editor-assets.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor-assets.css"), "utf8");

for (const required of [
  "messages.vi.mediaLibrary",
  "messages.en.mediaLibrary",
  '"mediaLibrary." + key',
  'label: t("video")',
  'label: t("images")',
  'label: t("audio")',
  'label: t("findMedia")',
  'label: t("generateAi")',
  'label: t("saved")',
  "window.desktopAPI?.getMediaSearchStatus?.()",
  "window.desktopAPI?.searchMedia?.({",
  "window.desktopAPI?.cancelMediaSearch?.(id)",
  "body.dataset.dynamicAssetsSignature",
  "if (body.dataset.dynamicAssetsSignature === signature) return;",
  "if (submit instanceof HTMLButtonElement && !activeSearchRequestId)",
  'kind: "video"',
  'provider: "auto"',
  'orientation.value = "portrait"',
  "result?.attribution?.sourceUrl",
  "result?.attribution?.creatorName",
  'locked.textContent = t("projectAddLocked")'
]) {
  assert(source.includes(required), "media browser contract is missing: " + required);
}

assert(!source.includes("PEXELS_API_KEY"), "renderer media UI must not contain provider credentials");
assert(!source.includes("api.pexels.com"), "renderer media UI must not call providers directly");
assert(!source.includes("ViralCoreMediaLibraryModel.addAssets"), "transient search results must not be persisted before acquisition/download exists");
assert(!source.includes("model.addAssets("), "search results must not bypass the acquisition lifecycle");
assert(!source.includes("function copy()"), "new media browser copy must use the locale-backed message system");

for (const required of [
  ".core-assets-nav-item",
  ".core-media-browser",
  ".core-media-search-bar",
  ".core-media-browser-workspace",
  ".core-media-results-list",
  ".core-media-result-preview",
  'html[data-theme="midnight"] .core-media-browser',
  ":focus-visible",
  "@media(prefers-reduced-motion:reduce)",
  "@media(max-width:1120px)"
]) {
  assert(css.includes(required), "media browser styling contract is missing: " + required);
}

assert(css.includes("pointer-events:none"), "closed media browser must not intercept editor input");
assert(css.includes("pointer-events:auto"), "open media browser must restore interaction");
assert(css.includes("backdrop-filter"), "media browser should retain the workstation glass hierarchy");

console.log("Commercial Media Library rail, real discovery states, transient-result safety, VI/EN copy and Premium Dark UX contract passed.");
