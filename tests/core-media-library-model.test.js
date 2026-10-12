"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-media-library-model");
const snapshotModel = require("../renderer/core-project-snapshot");

assert.strictEqual(model.LIBRARY_SCHEMA_VERSION, 1);
assert.strictEqual(model.MAX_PROJECT_ASSETS, 500);
assert(model.KINDS.includes("video"));
assert(model.KINDS.includes("image"));
assert(model.KINDS.includes("audio"));

const local = model.normalizeAsset({
  id: "local-1",
  kind: "video",
  origin: "local",
  name: "Lion.mp4",
  localPath: "C:\\Media\\Lion.mp4",
  status: "ready",
  meta: { width: 1080, height: 1920, duration: 42.8, sizeBytes: 123456 }
}, 0, Date.UTC(2026, 9, 12, 10, 0, 0));

assert(local, "valid local media must normalize");
assert.strictEqual(local.provider, "local");
assert.strictEqual(local.fileState, "available");
assert.strictEqual(local.progress, 100);
assert.strictEqual(local.meta.width, 1080);
assert.strictEqual(local.meta.height, 1920);
assert.strictEqual(local.meta.duration, 42.8);
assert.strictEqual(model.assetIdentity(local), "local:c:/media/lion.mp4");

const stock = model.normalizeAsset({
  id: "pexels-99",
  kind: "video",
  origin: "stock",
  provider: "Pexels",
  providerAssetId: "99",
  name: "Savannah",
  previewUrl: "https://images.example.test/preview.jpg",
  remoteUrl: "https://cdn.example.test/video.mp4",
  status: "ready",
  attribution: {
    creatorName: "Jane Doe",
    creatorUrl: "https://example.test/jane",
    sourceUrl: "https://example.test/asset/99",
    licenseName: "Provider License",
    licenseUrl: "https://example.test/license",
    attributionText: "Video by Jane Doe"
  }
});

assert.strictEqual(stock.provider, "pexels");
assert.strictEqual(stock.fileState, "remote");
assert.strictEqual(model.assetIdentity(stock), "provider:pexels:99");
assert.strictEqual(stock.attribution.creatorName, "Jane Doe");
assert.strictEqual(stock.attribution.attributionText, "Video by Jane Doe");

const unsafe = model.normalizeAsset({
  id: "unsafe",
  origin: "stock",
  provider: "pexels",
  providerAssetId: "100",
  previewUrl: "javascript:alert(1)",
  remoteUrl: "file:///C:/secret.mp4",
  attribution: { sourceUrl: "javascript:alert(1)" }
});
assert.strictEqual(unsafe.previewUrl, null, "renderer-persisted preview URLs must only be http(s)");
assert.strictEqual(unsafe.remoteUrl, null, "renderer-persisted remote URLs must only be http(s)");
assert.strictEqual(unsafe.attribution.sourceUrl, null);

const interrupted = model.restartSafeAsset({
  id: "download-1",
  kind: "video",
  origin: "stock",
  provider: "pixabay",
  providerAssetId: "abc",
  status: "downloading",
  progress: 64
});
assert.strictEqual(interrupted.status, "interrupted", "active media work must not resurrect after app restart");
assert.strictEqual(interrupted.progress, 64);

const deduped = model.normalizeLibrary({
  selectedAssetId: "local-1",
  assets: [
    local,
    { ...local, id: "local-copy", name: "Copy.mp4" },
    stock
  ]
});
assert.strictEqual(deduped.assets.length, 2, "same local file must not be imported twice into one project");
assert.strictEqual(deduped.selectedAssetId, "local-1");

const inserted = model.addAssets(deduped, [
  { ...stock, id: "stock-copy" },
  {
    id: "audio-1",
    kind: "audio",
    origin: "local",
    name: "Music.wav",
    localPath: "D:\\audio\\Music.wav",
    status: "ready"
  }
], Date.UTC(2026, 9, 12, 11, 0, 0));
assert.strictEqual(inserted.added.length, 1);
assert.strictEqual(inserted.duplicates.length, 1);
assert.strictEqual(inserted.library.assets.length, 3);
assert.strictEqual(inserted.added[0].kind, "audio");

const updated = model.updateAsset(inserted.library, "audio-1", {
  favorite: true,
  status: "failed",
  fileState: "missing",
  progress: 27
}, Date.UTC(2026, 9, 12, 12, 0, 0));
const updatedAudio = updated.assets.find(asset => asset.id === "audio-1");
assert.strictEqual(updatedAudio.favorite, true);
assert.strictEqual(updatedAudio.status, "failed");
assert.strictEqual(updatedAudio.fileState, "missing");
assert.strictEqual(updatedAudio.progress, 27);

const removed = model.removeAsset(updated, "audio-1");
assert.strictEqual(removed.assets.some(asset => asset.id === "audio-1"), false);
assert.strictEqual(removed.assets.length, 2);

const restartedLibrary = model.normalizeLibrary({
  selectedAssetId: "job-1",
  assets: [
    { id: "job-1", kind: "video", origin: "generated", status: "generating", progress: 51 },
    { id: "ready-1", kind: "image", origin: "generated", status: "ready" }
  ]
}, { restartSafe: true });
assert.strictEqual(restartedLibrary.assets[0].status, "interrupted");
assert.strictEqual(restartedLibrary.assets[1].status, "ready");
assert.strictEqual(restartedLibrary.selectedAssetId, "job-1");

const activeSnapshot = {
  schemaVersion: 2,
  projectId: "source-1",
  projectName: "Source.mp4",
  source: {
    identity: "source-1",
    jobId: "source-1",
    path: "C:/media/Source.mp4",
    name: "Source.mp4",
    fileState: "available"
  },
  media: {
    schemaVersion: 1,
    selectedAssetId: "download-2",
    assets: [
      {
        id: "download-2",
        kind: "video",
        origin: "stock",
        provider: "pexels",
        providerAssetId: "200",
        status: "downloading",
        progress: 45
      }
    ]
  },
  workflow: { jobs: [] },
  editor: {}
};
const liveSnapshot = snapshotModel.migrateSnapshot(activeSnapshot);
assert.strictEqual(liveSnapshot.snapshot.media.assets[0].status, "downloading", "normal in-session normalization must not interrupt live work");
assert.strictEqual(liveSnapshot.migrated, false);
const bootSnapshot = snapshotModel.migrateSnapshot(activeSnapshot, { restartSafeMedia: true });
assert.strictEqual(bootSnapshot.snapshot.media.assets[0].status, "interrupted", "bootstrap normalization must not resurrect stale work");
assert.strictEqual(bootSnapshot.migrated, true, "restart-safe transition must be backfilled durably");

const persistence = fs.readFileSync(path.join(__dirname, "..", "renderer", "core-project-persistence.js"), "utf8");
assert(
  persistence.includes('model.migrateSnapshot(raw, { restartSafeMedia: true })'),
  "project persistence bootstrap must explicitly request restart-safe media normalization"
);

console.log("Core media library normalization, dedupe, attribution, URL safety, project ownership and restart-state tests passed.");
