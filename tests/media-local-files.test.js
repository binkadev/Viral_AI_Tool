"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const media = require("../services/media/local-files");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-media-test-"));

try {
  const videoPath = path.join(temp, "Clip.MP4");
  const imagePath = path.join(temp, "Cover.jpg");
  const audioPath = path.join(temp, "Voice.wav");
  const unsupportedPath = path.join(temp, "notes.exe");
  fs.writeFileSync(videoPath, Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(imagePath, Buffer.from([4, 5, 6]));
  fs.writeFileSync(audioPath, Buffer.from([7, 8]));
  fs.writeFileSync(unsupportedPath, Buffer.from([9]));

  assert.strictEqual(media.kindForExtension("MP4"), "video");
  assert.strictEqual(media.kindForExtension("jpeg"), "image");
  assert.strictEqual(media.kindForExtension("flac"), "audio");
  assert.strictEqual(media.kindForExtension("exe"), null);

  const video = media.describeLocalMediaFile(videoPath);
  assert.strictEqual(video.kind, "video");
  assert.strictEqual(video.origin, "local");
  assert.strictEqual(video.provider, "local");
  assert.strictEqual(video.name, "Clip.MP4");
  assert.strictEqual(video.localPath, videoPath);
  assert.strictEqual(video.fileState, "available");
  assert.strictEqual(video.status, "ready");
  assert.strictEqual(video.meta.sizeBytes, 4);
  assert.strictEqual(video.meta.mime, "video/mp4");
  assert.strictEqual(video.native.extension, "mp4");

  const image = media.describeLocalMediaFile(imagePath);
  assert.strictEqual(image.kind, "image");
  assert.strictEqual(image.meta.mime, "image/jpeg");

  const audio = media.describeLocalMediaFile(audioPath);
  assert.strictEqual(audio.kind, "audio");
  assert.strictEqual(audio.meta.mime, "audio/wav");

  assert.throws(
    () => media.describeLocalMediaFile(path.join(temp, "missing.mp4")),
    error => error?.code === "MEDIA_FILE_MISSING"
  );
  assert.throws(
    () => media.describeLocalMediaFile(unsupportedPath),
    error => error?.code === "MEDIA_TYPE_UNSUPPORTED" && error?.details?.extension === "exe"
  );
  assert.throws(
    () => media.describeLocalMediaFile(temp),
    error => error?.code === "MEDIA_TYPE_UNSUPPORTED" || error?.code === "MEDIA_FILE_INVALID"
  );
  assert.throws(
    () => media.classifyMediaPath("bad\0path.mp4"),
    error => error?.code === "MEDIA_FILE_INVALID"
  );

  const filters = media.dialogFilters();
  assert(filters[0].extensions.includes("mp4"));
  assert(filters[0].extensions.includes("jpg"));
  assert(filters[0].extensions.includes("wav"));
  assert.strictEqual(filters.some(filter => filter.extensions.includes("*")), false, "media picker must not fall back to arbitrary file types");

  const publicUnsupported = media.publicMediaError(Object.assign(new Error("raw provider detail"), {
    code: "MEDIA_TYPE_UNSUPPORTED",
    details: { extension: "exe", secret: "do-not-leak" }
  }));
  assert.deepStrictEqual(publicUnsupported, {
    code: "MEDIA_TYPE_UNSUPPORTED",
    details: { extension: "exe" }
  });

  const publicUnknown = media.publicMediaError(Object.assign(new Error("sensitive path"), {
    code: "EACCES",
    details: { path: "C:/secret/file.mp4" }
  }));
  assert.deepStrictEqual(publicUnknown, {
    code: "MEDIA_FILE_UNAVAILABLE",
    details: { extension: null }
  });

  console.log("Native local media classification, validation, picker filters and public error isolation tests passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
