"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const layoutJs = fs.readFileSync(path.join(root, "renderer", "core-layout.js"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "renderer", "core-layout.css"), "utf8");
const previewCss = fs.readFileSync(path.join(root, "renderer", "premium-preview.css"), "utf8");
const bottomJs = fs.readFileSync(path.join(root, "renderer", "core-editor-bottom-dock.js"), "utf8");
const bottomCss = fs.readFileSync(path.join(root, "renderer", "core-editor-bottom-dock.css"), "utf8");
const assetsJs = fs.readFileSync(path.join(root, "renderer", "core-editor-assets.js"), "utf8");
const assetsCss = fs.readFileSync(path.join(root, "renderer", "core-editor-assets.css"), "utf8");
const selectionJs = fs.readFileSync(path.join(root, "renderer", "core-editor-selection.js"), "utf8");
const selectionCss = fs.readFileSync(path.join(root, "renderer", "core-editor-selection.css"), "utf8");
const workspacePolishCss = fs.readFileSync(path.join(root, "renderer", "core-editor-workspace-polish.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const required of [
  "core-left-collapsed",
  "core-right-collapsed",
  "core-transcript-dock",
  "localStorage",
  "dockTranscript",
  "ensureRightToggle"
]) {
  assert(layoutJs.includes(required), "Core layout JS missing: " + required);
}

for (const required of [
  "html.core-left-collapsed",
  ".core-editor-layout.core-right-collapsed",
  ".core-transcript-dock",
  "grid-column:1 / -1"
]) {
  assert(layoutCss.includes(required), "Core layout CSS missing: " + required);
}

for (const required of [
  ".preview.core-player-host",
  ".preview-video",
  "object-fit:contain!important",
  ".core-player-timeline",
  ".core-player-controls",
  "cubic-bezier(.22, 1, .36, 1)",
  "prefers-reduced-motion"
]) {
  assert(previewCss.includes(required), "Premium preview CSS missing: " + required);
}
assert(!previewCss.includes("object-fit:cover"), "Premium preview must never crop media with object-fit: cover.");

for (const required of [
  "data-time-ruler",
  "data-track-video",
  "data-track-audio",
  "data-track-subtitle",
  "data-bottom-playhead",
  "data-bottom-zoom",
  "data-bottom-resize",
  "data-bottom-collapse",
  "sourceHasAudio",
  "renderSegments",
  "video.currentTime",
  "viral-ai:bottom-dock-tab"
]) {
  assert(bottomJs.includes(required), "Bottom dock v2 missing: " + required);
}

for (const required of [
  ".core-timeline-workspace",
  ".core-time-ruler",
  ".core-track-lane",
  ".core-source-clip",
  ".core-bottom-segment.is-active",
  ".core-bottom-resize-handle",
  ".core-editor-bottom-dock.is-collapsed",
  "--core-bottom-dock-height"
]) {
  assert(bottomCss.includes(required), "Bottom dock v2 CSS missing: " + required);
}

for (const required of [
  "core-editor-assets-panel",
  "data-source-asset",
  "data-transcript-asset",
  "transcript-list .transcript-row",
  "viral-ai:bottom-dock-tab",
  "localStorage"
]) {
  assert(assetsJs.includes(required), "Assets panel missing: " + required);
}

for (const required of [
  ".core-editor-assets-panel",
  ".core-asset-item",
  ".core-editor-assets-grid",
  "grid-template-columns",
  "prefers-reduced-motion"
]) {
  assert(assetsCss.includes(required), "Assets panel CSS missing: " + required);
}

for (const required of [
  "is-selected",
  "transcript-list .transcript-row",
  "core-bottom-segment",
  "viral-ai:editor-segment-selected",
  "aria-selected"
]) {
  assert(selectionJs.includes(required), "Selection bridge missing: " + required);
}
assert(selectionCss.includes(".core-bottom-segment.is-selected"));
assert(selectionCss.includes(".transcript-row.is-selected"));

for (const required of [
  "100dvh",
  "core-editor-docked-page.core-editor-assets-page",
  "grid-template-columns:clamp(180px,13vw,210px) minmax(0,1fr) clamp(320px,23vw,360px)",
  "--core-bottom-dock-height:176px",
  "height:100%!important",
  "max-height:none!important",
  "max-height:719px"
]) {
  assert(workspacePolishCss.includes(required), "Workspace polish missing: " + required);
}

assert(index.includes('href="core-layout.css"'));
assert(index.includes('href="premium-preview.css"'));
assert(index.includes('href="core-editor-bottom-dock.css"'));
assert(index.includes('href="core-editor-assets.css"'));
assert(index.includes('href="core-editor-selection.css"'));
assert(index.includes('href="core-editor-workspace-polish.css"'));
assert(index.includes('src="core-layout.js"'));
assert(index.includes('src="core-editor-bottom-dock.js"'));
assert(index.includes('src="core-editor-assets.js"'));
assert(index.includes('src="core-editor-selection.js"'));

console.log("Core editor workspace v2 layout, selection and viewport polish tests passed.");
