const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-timeline-interactions.js");
const css = read("renderer/core-editor-timeline-interactions.css");
const index = read("renderer/index.html");

assert.doesNotThrow(() => new Function(js), "Timeline interaction JS must parse.");

for (const required of [
  "activeVideo(page = editorPage())",
  "pointerTime(stage, video, clientX)",
  "commercialTimelineWired",
  "setPointerCapture",
  "pointermove",
  "pointercancel",
  "revealPlayhead",
  "revealSelectedClip",
  "viral-ai:editor-segment-selected",
  "panDuringScrub",
  "lastManualScrollAt",
  "is-zooming",
  "event.ctrlKey || event.metaKey",
  "segmentTime(event.target)",
  "stopImmediatePropagation",
  "Home",
  "End"
]) {
  assert(js.includes(required), "Timeline interaction JS missing: " + required);
}

for (const required of [
  ".core-editor-bottom-dock.is-scrubbing",
  ".core-timeline-stage.is-zooming",
  ".core-bottom-segment.is-selected",
  ".core-bottom-segment.is-active.is-selected",
  "cursor:ew-resize",
  "prefers-reduced-motion"
]) {
  assert(css.includes(required), "Timeline interaction CSS missing: " + required);
}

assert(index.includes('href="core-editor-timeline-interactions.css"'), "Timeline interaction CSS must be loaded.");
assert(index.includes('src="core-editor-timeline-interactions.js"'), "Timeline interaction JS must be loaded.");

console.log("core-editor-timeline-interactions tests passed");
