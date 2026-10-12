"use strict";

const assert = require("assert");
const model = require("../renderer/core-media-library-model");
const runtime = require("../renderer/core-media-library-runtime");

const appState = {
  media: { schemaVersion: 1, assets: [], selectedAssetId: null }
};
const scheduled = [];
const events = [];
let selected = [
  { path: "C:\\Media\\Lion.mp4", name: "Lion.mp4", ext: "MP4" },
  { path: "C:\\Media\\Square.mp4", name: "Square.mp4", ext: "MP4" }
];

const controller = runtime.createController({
  model,
  getState: () => appState,
  desktopAPI: {
    selectVideos: async () => selected,
    probeVideo: async filePath => {
      if (filePath.includes("Lion")) return { width: 1920, height: 1080, duration: 41.5 };
      if (filePath.includes("Square")) return { width: 1080, height: 1080, duration: 12 };
      const error = new Error("raw technical detail");
      error.code = "VIDEO_PROBE_FAILED";
      throw error;
    }
  },
  schedule: reason => scheduled.push(reason),
  emit: (name, detail) => events.push({ name, detail })
});

(async () => {
  const first = await controller.importLocalVideos();
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.cancelled, false);
  assert.strictEqual(first.added.length, 2);
  assert.strictEqual(first.duplicates.length, 0);
  assert.strictEqual(appState.media.assets.length, 2);
  assert.strictEqual(appState.media.assets[0].meta.orientation, "landscape");
  assert.strictEqual(appState.media.assets[1].meta.orientation, "square");
  assert.strictEqual(appState.media.selectedAssetId, first.added[0].id, "first newly imported asset should become selected when nothing was selected");
  assert(scheduled.includes("media-import-local-video"));
  assert(events.some(event => event.name === "viral-ai:media-library-changed"));
  assert(events.some(event => event.name === "viral-ai:core-state-changed"));

  const duplicate = await controller.importLocalVideos();
  assert.strictEqual(duplicate.ok, true);
  assert.strictEqual(duplicate.added.length, 0);
  assert.strictEqual(duplicate.duplicates.length, 2, "service/domain layer must reject duplicate local media even when UI allows a repeated import action");
  assert.strictEqual(appState.media.assets.length, 2);

  const secondId = appState.media.assets[1].id;
  controller.selectAsset(secondId);
  assert.strictEqual(appState.media.selectedAssetId, secondId);
  controller.toggleFavorite(secondId);
  assert.strictEqual(appState.media.assets.find(asset => asset.id === secondId).favorite, true);
  controller.removeFromProject(secondId);
  assert.strictEqual(appState.media.assets.length, 1);
  assert.strictEqual(appState.media.assets.some(asset => asset.id === secondId), false);

  selected = [];
  const cancelled = await controller.importLocalVideos();
  assert.strictEqual(cancelled.ok, true);
  assert.strictEqual(cancelled.cancelled, true);
  assert.strictEqual(cancelled.added.length, 0);

  selected = [
    { path: "C:\\Media\\Broken.mp4", name: "Broken.mp4", ext: "MP4" }
  ];
  const broken = await controller.importLocalVideos();
  assert.strictEqual(broken.ok, false);
  assert.strictEqual(broken.added.length, 0);
  assert.strictEqual(broken.errors.length, 1);
  assert.strictEqual(broken.errors[0].code, "VIDEO_PROBE_FAILED");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(broken.errors[0], "message"), false, "raw technical errors must not reach commercial UI state");

  const noBridge = runtime.createController({ model, getState: () => appState, desktopAPI: {} });
  const unavailable = await noBridge.importLocalVideos();
  assert.strictEqual(unavailable.ok, false);
  assert.strictEqual(unavailable.errors[0].code, "MEDIA_IMPORT_UNAVAILABLE");

  assert.strictEqual(runtime.safeErrorCode({ code: "OK_CODE" }), "OK_CODE");
  assert.strictEqual(runtime.safeErrorCode({ code: "not safe: secret" }), "MEDIA_IMPORT_FAILED");

  console.log("Core media library runtime import, dedupe, selection, favorite, removal and error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
