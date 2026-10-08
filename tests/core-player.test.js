"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-player-model");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor.css"), "utf8");
const player = fs.readFileSync(path.join(root, "renderer", "core-player.js"), "utf8");
const rebind = fs.readFileSync(path.join(root, "renderer", "core-player-rebind.js"), "utf8");
const interactions = fs.readFileSync(path.join(root, "renderer", "core-player-interactions.js"), "utf8");
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
  [3840, 1600],
  [720, 1280],
  [2560, 1080]
]) {
  for (const box of [
    [960, 540],
    [540, 960],
    [720, 720],
    [1230, 480],
    [420, 240],
    [240, 420],
    [1600, 900]
  ]) {
    const fitted = model.fitContain(media[0], media[1], box[0], box[1]);
    assert(fitted.width <= box[0] + 0.001, "contain width must remain inside preview");
    assert(fitted.height <= box[1] + 0.001, "contain height must remain inside preview");
    assert(Math.abs((fitted.width / fitted.height) - (media[0] / media[1])) < 0.0001, "contain fit must preserve aspect ratio");
  }
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
assert.strictEqual(model.activeSegmentIndex(segments, 8), 2);

for (const required of [
  "object-fit:contain!important",
  "aspect-ratio:auto!important",
  "transform:none!important",
  ":fullscreen",
  ".transcript-row.is-active",
  ".core-player-timeline",
  ".core-timeline-playhead",
  ".core-timeline-segment.is-active",
  "max-height:min(42vh,420px)"
]) {
  assert(css.includes(required), "Core editor CSS is missing: " + required);
}

for (const eventName of ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended"]) {
  assert(player.includes('"' + eventName + '"'), "Player must subscribe to " + eventName);
}
for (const required of [
  "video.currentTime = target",
  "video.currentTime, video.duration",
  "model.activeSegmentIndex",
  "scrollIntoView",
  "contenteditable",
  "requestFullscreen",
  "video.controls = false",
  "viral-ai:transcript-edit",
  "requestVideoFrameCallback",
  "ResizeObserver",
  "data-core-timeline-track",
  "data-core-playhead",
  "seekVideo(video, ratio * video.duration)",
  "video.currentTime is the single source of truth"
]) {
  assert(player.includes(required), "Core player is missing behavior: " + required);
}

for (const required of [
  'setProperty("object-fit", "contain", "important")',
  'setProperty("object-position", "center center", "important")',
  'setProperty("transform", "none", "important")',
  "data-core-playhead",
  "corePlaybackState",
  "coreMediaReady",
  "querySelectorAll(\"#page video.preview-video, #page video.core-player-media\")",
  "seekToRatio(video",
  '"play", "pause", "ended"',
  "const wiredSeeks = new WeakSet()",
  "const wiredTracks = new WeakSet()",
  "const surfaceObservers = new WeakMap()",
  "function wireSurface(video)",
  "function syncEditorDock(video, duration, current)",
  "function bindSurfaceResize(video, host)",
  "function currentSurfaceVideo(host, fallback)",
  ".core-editor-bottom-dock",
  "currentVideo !== video",
  "wireSurface(video);",
  "bindSurfaceResize(video, host);",
  "currentSurfaceVideo(host, video)",
  "current?.observer?.disconnect?.()",
  'video.closest(".preview") !== host',
  "observer.observe(host)",
  "data-bottom-playhead",
  "data-bottom-time",
  ".core-bottom-segment"
]) {
  assert(rebind.includes(required), "Core player rebind is missing hardening behavior: " + required);
}

for (const required of [
  "pointerdown",
  "pointermove",
  "pointerup",
  "setPointerCapture",
  "video.currentTime = ratio * duration",
  "ArrowLeft",
  "ArrowRight",
  "event.shiftKey ? -10 : -5",
  "event.shiftKey ? 10 : 5",
  "video.paused",
  "const video = activeVideoFor(host)",
  "if (!(video instanceof HTMLVideoElement)) return"
]) {
  assert(interactions.includes(required), "Core player interactions are missing: " + required);
}

assert(!player.includes("setInterval("), "Player synchronization must not use an independent timer clock.");
assert(!interactions.includes("setInterval("), "Scrubbing must not introduce a second playback clock.");
assert(!rebind.includes("setInterval("), "Player rebind must stay synchronized to media events instead of an independent timer clock.");
assert(index.includes('href="core-editor.css"'));
assert(index.includes('src="core-player-model.js"'));
assert(index.includes('src="core-player.js"'));
assert(index.includes('src="core-player-interactions.js"'));
assert(index.includes('src="core-player-rebind.js"'));

console.log("Core player geometry, timeline, scrubbing and synchronization tests passed.");
