"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const {
  providerDownloadAllowed,
  extensionForDescriptor,
  supportedDescriptor
} = require("../services/media/acquisition-policy");
const {
  cachePaths,
  publicAcquisitionError,
  createMediaAcquisitionManager
} = require("../services/media/acquisition-manager");

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get(name) { return normalized.get(String(name).toLowerCase()) || null; } };
}

function response({ body, status = 200, url = "https://videos.pexels.com/video-files/987/hd.mp4", type = "video/mp4", length } = {}) {
  const chunks = Array.isArray(body) ? body : [Buffer.from("media-bytes")];
  const size = length == null ? chunks.reduce((sum, chunk) => sum + chunk.length, 0) : length;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: headers({ "content-type": type, "content-length": size }),
    body: Readable.from(chunks)
  };
}

const descriptor = {
  provider: "pexels",
  providerAssetId: "987",
  kind: "video",
  name: "Lion by the river",
  previewUrl: "https://images.pexels.com/videos/987/preview.jpg",
  downloadUrl: "https://videos.pexels.com/video-files/987/hd.mp4",
  mime: "video/mp4",
  meta: { width: 1080, height: 1920, duration: 12, orientation: "portrait" },
  attribution: {
    creatorName: "Jane Creator",
    sourceUrl: "https://www.pexels.com/video/987/",
    licenseName: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/"
  }
};

(async () => {
  assert.strictEqual(providerDownloadAllowed("pexels", descriptor.downloadUrl), true);
  assert.strictEqual(providerDownloadAllowed("pexels", "https://evil.example.test/video.mp4"), false);
  assert.strictEqual(extensionForDescriptor(descriptor), "mp4");
  assert.strictEqual(supportedDescriptor(descriptor), true);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "viral-ai-acquisition-"));
  try {
    const progress = [];
    let fetchCount = 0;
    const bytes = [Buffer.from("first-"), Buffer.from("second")];
    const manager = createMediaAcquisitionManager({
      cacheRoot: temp,
      minFreeBytes: 0,
      maxDownloadBytes: 1024 * 1024,
      now: () => Date.UTC(2026, 9, 12, 13, 0, 0),
      onProgress: event => progress.push(event),
      fetchImpl: async (url, options) => {
        fetchCount += 1;
        assert.strictEqual(url, descriptor.downloadUrl);
        assert.strictEqual(options.redirect, "manual");
        assert(options.signal instanceof AbortSignal);
        return response({ body: bytes });
      }
    });

    const first = await manager.acquire({
      jobId: "media-acquire-0001",
      projectId: "project-source-1",
      descriptor
    });
    assert.strictEqual(first.duplicate, false);
    assert.strictEqual(first.asset.status, "ready");
    assert.strictEqual(first.asset.fileState, "available");
    assert.strictEqual(first.asset.origin, "stock");
    assert.strictEqual(first.asset.provider, "pexels");
    assert.strictEqual(first.asset.providerAssetId, "987");
    assert.strictEqual(first.asset.remoteUrl, null);
    assert.strictEqual(first.asset.meta.sizeBytes, Buffer.concat(bytes).length);
    assert.strictEqual(first.asset.attribution.creatorName, "Jane Creator");
    assert.strictEqual(first.asset.createdAt, "2026-10-12T13:00:00.000Z");
    assert.strictEqual(fs.existsSync(first.asset.localPath), true);
    assert.strictEqual(fs.readFileSync(first.asset.localPath).toString(), "first-second");
    assert(first.asset.localPath.startsWith(path.resolve(temp) + path.sep));
    assert.strictEqual(first.asset.localPath.includes("project-source-1"), false, "raw project id must not become a cache directory name");
    assert.deepStrictEqual(
      progress.map(item => item.state).filter((state, index, all) => index === 0 || state !== all[index - 1]),
      ["validating", "queued", "downloading", "verifying", "ready"]
    );

    const duplicate = await manager.acquire({
      jobId: "media-acquire-0002",
      projectId: "project-source-1",
      descriptor
    });
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.asset.localPath, first.asset.localPath);
    assert.strictEqual(fetchCount, 1, "existing ready cache file must not be downloaded again");

    const paths = cachePaths(temp, "project-source-2", descriptor);
    let releaseSlow;
    const slowBody = (async function* () {
      yield Buffer.from("part-one");
      await new Promise(resolve => { releaseSlow = resolve; });
      yield Buffer.from("part-two");
    })();
    const slowEvents = [];
    const slowManager = createMediaAcquisitionManager({
      cacheRoot: temp,
      minFreeBytes: 0,
      maxDownloadBytes: 1024 * 1024,
      onProgress: event => slowEvents.push(event),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: descriptor.downloadUrl,
        headers: headers({ "content-type": "video/mp4" }),
        body: slowBody
      })
    });

    const pending = slowManager.acquire({
      jobId: "media-acquire-1001",
      projectId: "project-source-2",
      descriptor
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(slowManager.activeCount(), 1);
    await assert.rejects(
      () => slowManager.acquire({
        jobId: "media-acquire-1002",
        projectId: "project-source-2",
        descriptor
      }),
      error => error?.code === "MEDIA_DOWNLOAD_DUPLICATE"
    );
    assert.deepStrictEqual(slowManager.cancel("media-acquire-1001"), { cancelled: true });
    releaseSlow();
    await assert.rejects(() => pending, error => error?.code === "MEDIA_CANCELLED");
    assert.strictEqual(slowManager.activeCount(), 0);
    assert.strictEqual(fs.existsSync(paths.partialPath), false, "cancelled download must remove partial output");
    assert.strictEqual(fs.existsSync(paths.finalPath), false, "cancelled download must never create a ready output");
    assert(slowEvents.some(item => item.state === "cancelling"));
    assert(slowEvents.some(item => item.state === "cancelled"));

    const redirectManager = createMediaAcquisitionManager({
      cacheRoot: temp,
      minFreeBytes: 0,
      fetchImpl: async () => response({ url: "https://evil.example.test/video.mp4" })
    });
    await assert.rejects(
      () => redirectManager.acquire({ jobId: "media-acquire-2001", projectId: "project-redirect", descriptor }),
      error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
    );
    const redirectPaths = cachePaths(temp, "project-redirect", descriptor);
    assert.strictEqual(fs.existsSync(redirectPaths.partialPath), false);

    const oversizeManager = createMediaAcquisitionManager({
      cacheRoot: temp,
      minFreeBytes: 0,
      maxDownloadBytes: 1024 * 1024,
      fetchImpl: async () => response({ length: 2 * 1024 * 1024 })
    });
    await assert.rejects(
      () => oversizeManager.acquire({ jobId: "media-acquire-3001", projectId: "project-large", descriptor }),
      error => error?.code === "MEDIA_DISK_SPACE_LOW"
    );

    const badMimeManager = createMediaAcquisitionManager({
      cacheRoot: temp,
      minFreeBytes: 0,
      fetchImpl: async () => response({ type: "image/jpeg" })
    });
    await assert.rejects(
      () => badMimeManager.acquire({ jobId: "media-acquire-4001", projectId: "project-mime", descriptor }),
      error => error?.code === "MEDIA_VERIFY_FAILED"
    );

    assert.deepStrictEqual(
      publicAcquisitionError(Object.assign(new Error("C:/secret/cache/path"), {
        code: "MEDIA_DESTINATION_UNAVAILABLE",
        details: { path: "C:/secret/cache/path", field: "projectId" }
      })),
      { code: "MEDIA_DESTINATION_UNAVAILABLE", details: { field: "projectId" } }
    );
    assert.deepStrictEqual(
      publicAcquisitionError(Object.assign(new Error("secret"), { code: "EACCES" })),
      { code: "MEDIA_DOWNLOAD_FAILED", details: {} }
    );

    console.log("Media acquisition cache, duplicate, cancel, cleanup, redirect, size and verification lifecycle tests passed.");
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
