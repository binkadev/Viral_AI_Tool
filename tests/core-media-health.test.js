"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const health = fs.readFileSync(path.join(root, "renderer", "core-media-health.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-media-health.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const eventName of ["loadstart", "loadedmetadata", "canplay", "waiting", "stalled", "error"]) {
  assert(health.includes('"' + eventName + '"'), "Media health layer must handle " + eventName);
}

for (const required of [
  "video.error?.code",
  "video.networkState",
  "video.readyState",
  "video.videoWidth",
  "video.videoHeight",
  "video.load()",
  "data-media-retry",
  "retryCount",
  "armMetadataTimeout",
  "current?.thumbnail",
  "console.warn(\"[CoreMediaPreview]\"",
  "const wiredRetries = new WeakSet()",
  "const surfaceStates = new WeakMap()",
  "function mediaFor(host)",
  "function wireRetry(host, overlay)",
  "function renderState(video, state, details = {}, logFailure = false)",
  "function syncSurface(video)",
  "surfaceStates.set(video, { state, details })",
  "const video = mediaFor(host)",
  "syncSurface(video);\n    if (wired.has(video)) return;",
  'window.addEventListener("viral-ai:editor-preview-preserved", scan)'
]) {
  assert(health.includes(required), "Media health layer is missing: " + required);
}

assert(health.includes('Number(details.errorCode) === 4'), "Unsupported codec must have an explicit user-safe state.");
assert(css.includes('.core-media-state'));
assert(css.includes('[data-core-media-state="loading"]'));
assert(css.includes('@media(prefers-reduced-motion:reduce)'));
assert(index.includes('href="core-media-health.css"'));
assert(index.includes('src="core-media-health.js"'));

console.log("Core media loading, error, retry and live-surface state tests passed.");
