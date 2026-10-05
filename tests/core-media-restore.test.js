"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const restore = fs.readFileSync(path.join(root, "renderer", "core-media-restore.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");

for (const required of [
  "window.desktopAPI?.fileStatus",
  "window.desktopAPI?.getVideoUrl",
  'source.fileState = "missing"',
  'source.mediaState = "missing"',
  'source.mediaState = "ready"',
  'rerender("preview-restored"',
  'rerender("source-missing-on-reopen"',
  'window.addEventListener("focus", schedule)',
  "viral-ai:core-state-changed"
]) {
  assert(restore.includes(required), "Media restore bridge is missing: " + required);
}

assert(app.includes('jobs: state.jobs.slice(0, 50).map(({ thumbnail, previewUrl, ...job }) => job)'), "Ephemeral preview URLs must not be persisted.");
assert(index.includes('src="core-media-restore.js"'));
assert(!restore.includes("setInterval("), "Media restore must be event-driven, not a polling loop.");

console.log("Project reopen preview and missing-file recovery tests passed.");
