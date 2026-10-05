"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-player-model");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor.css"), "utf8");
const player = fs.readFileSync(path.join(root, "renderer", "core-player.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.strictEqual(model.parseTimeLabel("01:30"), 90);
assert.strictEqual(model.parseTimeLabel("1:02:03"), 3723);
assert.strictEqual(model.formatClock(0), "00:00");
assert.strictEqual(model.formatClock(65.9), "01:05");
assert.strictEqual(model.clampTime(-4, 10), 0);
assert.strictEqual(model.clampTime(14, 10), 10);
assert.strictEqual(model.seekRatio(5, 20), 0.25);

for (const media of [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [3840, 1600]
]) {
  const fitted = model.fitContain(media[0], media[1], 960, 540);
  assert(fitted.width <= 960 + 0.001, "contain width must remain inside preview");
  assert(fitted.height <= 540 + 0.001, "contain height must remain inside preview");
  assert(Math.abs((fitted.width / fitted.height) - (media[0] / media[1])) < 0.0001, "contain fit must preserve aspect ratio");
}

const segments = model.normalizeSegments([
  { id: "a", start: 0, end: 2, text: "A", translatedText: "AA", speaker: "S1", voice: "alloy", status: "ready" },
  { id: "b", start: 2, text: "B" },
  { id: "c", start: 5, end: 8, text: "C" }
], 8);
assert.strictEqual(segments[1].end, 5);
assert.strictEqual(segments[0].translatedText, "AA");
assert.strictEqual(segments[0].speaker, "S1");
assert.strictEqual(segments[0].voice, "alloy");
assert.strictEqual(model.activeSegmentIndex(segments, 0), 0);
assert.strictEqual(model.activeSegmentIndex(segments, 1.99), 0);
assert.strictEqual(model.activeSegmentIndex(segments, 2), 1);
assert.strictEqual(model.activeSegmentIndex(segments, 7.9), 2);

for (const required of [
  "object-fit:contain!important",
  "aspect-ratio:auto!important",
  "transform:none!important",
  ":fullscreen",
  ".transcript-row.is-active",
  "max-height:min(42vh,420px)"
]) {
  assert(css.includes(required), "Core editor CSS is missing: " + required);
}

for (const eventName of ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended"]) {
  assert(player.includes('"' + eventName + '"'), "Player must subscribe to " + eventName);
}
for (const required of [
  "video.currentTime =",
  "model.activeSegmentIndex",
  "scrollIntoView",
  "contenteditable",
  "requestFullscreen",
  "video.controls = false",
  "viral-ai:transcript-edit"
]) {
  assert(player.includes(required), "Core player is missing behavior: " + required);
}

assert(index.includes('href="core-editor.css"'));
assert(index.includes('src="core-player-model.js"'));
assert(index.includes('src="core-player.js"'));

console.log("Core player geometry and synchronization tests passed.");
