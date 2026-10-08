"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const stability = fs.readFileSync(path.join(root, "renderer", "core-editor-stability.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const required of [
  "legacyRender",
  "previewSnapshot",
  "replacementVideoFor",
  "sameMedia",
  "preserveEditorPreview",
  'state?.page === "ai-video"',
  "replacementVideo.replaceWith(snapshot.video)",
  'replacement.dataset.corePersistentPreview = "true"',
  'snapshot.video.dataset.corePersistentMedia = "true"',
  "snapshot.currentTime",
  "snapshot.paused",
  "snapshot.volume",
  "snapshot.playbackRate",
  "viral-ai:editor-preview-preserved",
  "window.render = stableRender"
]) {
  assert(stability.includes(required), "Persistent editor layer is missing: " + required);
}

assert(
  stability.includes("snapshot.src === nextSrc"),
  "Preview preservation must only happen when the source URL is unchanged."
);
assert(
  !stability.includes("replacement.replaceWith(snapshot.preview)"),
  "Persistent media must never restore the stale preview shell."
);
assert(
  !stability.includes("innerHTML = snapshot"),
  "Persistent preview must retain the existing media DOM node, not clone/recreate it."
);
assert(index.includes('src="core-editor-stability.js"'));
assert(
  index.indexOf('src="core-editor-stability.js"') < index.indexOf('src="core-player.js"'),
  "Editor stability must wrap render before the player enhancement layer starts."
);

console.log("Core Editor persistent preview lifecycle tests passed.");