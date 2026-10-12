"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  safeProvider,
  providerDownloadAllowed,
  extensionForDescriptor,
  kindForDescriptor,
  supportedDescriptor
} = require("./acquisition-policy");

const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_BYTES = 256 * 1024 * 1024;

function acquisitionError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "MediaAcquisitionError";
  error.code = code;
  error.details = details;
  return error;
}

function text(value, max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validJobId(value) {
  const id = text(value, 160);
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(id)) {
    throw acquisitionError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition job id is invalid.", { field: "jobId" });
  }
  return id;
}

function validProjectId(value) {
  const id = text(value, 512);
  if (!id) throw acquisitionError("MEDIA_DESTINATION_UNAVAILABLE", "Project identity is required.", { field: "projectId" });
  return id;
}

function sha(value, length = 32) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeAttribution(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    creatorName: text(source.creatorName, 240) || null,
    creatorUrl: safeHttpUrl(source.creatorUrl),
    sourceUrl: safeHttpUrl(source.sourceUrl),
    licenseName: text(source.licenseName, 160) || null,
    licenseUrl: safeHttpUrl(source.licenseUrl),
    attributionText: text(source.attributionText, 800) || null
  };
}

function normalizeOrientation(value) {
  const orientation = text(value, 20).toLowerCase();
  return ["portrait", "landscape", "square"].includes(orientation) ? orientation : null;
}

function normalizedDescriptor(input) {
  const source = input && typeof input === "object" ? input : {};
  const provider = safeProvider(source.provider);
  const providerAssetId = text(source.providerAssetId, 240);
  const downloadUrl = safeHttpUrl(source.downloadUrl);
  const descriptor = {
    provider,
    providerAssetId,
    kind: kindForDescriptor(source),
    name: text(source.name, 320) || (providerAssetId ? provider + "-" + providerAssetId : "Media"),
    previewUrl: safeHttpUrl(source.previewUrl),
    downloadUrl,
    mime: text(source.mime || source?.meta?.mime, 120).toLowerCase() || null,
    meta: {
      width: Math.max(0, Math.round(Number(source?.meta?.width || 0))),
      height: Math.max(0, Math.round(Number(source?.meta?.height || 0))),
      duration: Math.max(0, Number(source?.meta?.duration || 0)),
      orientation: normalizeOrientation(source?.meta?.orientation)
    },
    attribution: normalizeAttribution(source.attribution)
  };
  if (!supportedDescriptor({ ...source, ...descriptor })) {
    throw acquisitionError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition source is not supported.");
  }
  return descriptor;
}

function identityFor(projectId, descriptor) {
  return sha(projectId, 40) + ":" + descriptor.provider + ":" + descriptor.providerAssetId;
}

function cachePaths(cacheRoot, projectId, descriptor) {
  const extension = extensionForDescriptor(descriptor);
  if (!extension) throw acquisitionError("MEDIA_SOURCE_UNAVAILABLE", "Media file type is not supported.");
  const projectKey = sha(projectId, 32);
  const assetKey = sha(descriptor.provider + ":" + descriptor.providerAssetId, 32);
  const provider = safeProvider(descriptor.provider) || "media";
  const directory = path.join(cacheRoot, projectKey);
  const filename = provider + "-" + assetKey + "." + extension;
  const finalPath = path.join(directory, filename);
  return { directory, finalPath, partialPath: finalPath + ".part", extension };
}

function numericHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function mimeHeader(headers) {
  return String(headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
}

async function availableBytes(target) {
  if (typeof fsp.statfs !== "function") return null;
  try {
    const info = await fsp.statfs(target);
    const blockSize = Number(info.bsize || info.frsize || 0);
    const available = Number(info.bavail ?? info.bfree ?? 0);
    if (!Number.isFinite(blockSize) || !Number.isFinite(available) || blockSize <= 0 || available < 0) return null;
    return blockSize * available;
  } catch {
    return null;
  }
}

async function regularFileSize(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() ? Math.max(0, Number(stat.size || 0)) : 0;
  } catch {
    return 0;
  }
}

function publicAcquisitionError(error) {
  const allowed = new Set([
    "MEDIA_SOURCE_UNAVAILABLE",
    "MEDIA_DESTINATION_UNAVAILABLE",
    "MEDIA_DISK_SPACE_LOW",
    "MEDIA_DOWNLOAD_DUPLICATE",
    "MEDIA_DOWNLOAD_FAILED",
    "MEDIA_VERIFY_FAILED",
    "MEDIA_CANCELLED"
  ]);
  return {
    code: allowed.has(error?.code) ? error.code : "MEDIA_DOWNLOAD_FAILED",
    details: error?.details?.field ? { field: text(error.details.field, 80) } : {}
  };
}

function createMediaAcquisitionManager({
  cacheRoot,
  fetchImpl = global.fetch,
  onProgress = () => {},
  now = () => Date.now(),
  maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
  minFreeBytes = DEFAULT_MIN_FREE_BYTES
} = {}) {
  const root = path.resolve(String(cacheRoot || "").trim() || ".");
  const maxBytes = Math.max(1024 * 1024, Number(maxDownloadBytes || DEFAULT_MAX_DOWNLOAD_BYTES));
  const freeFloor = Math.max(0, Number(minFreeBytes || DEFAULT_MIN_FREE_BYTES));
  const jobs = new Map();
  const identities = new Map();

  if (typeof fetchImpl !== "function") throw new TypeError("Media acquisition manager requires fetch.");

  function emit(record, state, progress, extra = {}) {
    record.state = state;
    record.progress = Math.max(0, Math.min(100, Number(progress || 0)));
    const payload = {
      jobId: record.jobId,
      state,
      progress: record.progress,
      provider: record.descriptor.provider,
      providerAssetId: record.descriptor.providerAssetId,
      ...extra
    };
    try { onProgress(payload); } catch {}
    return payload;
  }

  async function ensureDestination(paths, expectedBytes = 0) {
    try {
      await fsp.mkdir(paths.directory, { recursive: true });
    } catch {
      throw acquisitionError("MEDIA_DESTINATION_UNAVAILABLE", "Media cache directory could not be prepared.");
    }
    const free = await availableBytes(paths.directory);
    if (free != null && free < freeFloor + Math.max(0, Number(expectedBytes || 0))) {
      throw acquisitionError("MEDIA_DISK_SPACE_LOW", "There is not enough disk space for this media.");
    }
  }

  function mediaAsset(descriptor, finalPath, sizeBytes) {
    const timestamp = new Date(now()).toISOString();
    return {
      id: "stock:" + descriptor.provider + ":" + descriptor.providerAssetId,
      kind: descriptor.kind,
      origin: "stock",
      provider: descriptor.provider,
      providerAssetId: descriptor.providerAssetId,
      name: descriptor.name,
      localPath: finalPath,
      previewUrl: descriptor.previewUrl,
      remoteUrl: null,
      status: "ready",
      fileState: "available",
      progress: 100,
      favorite: false,
      meta: {
        width: descriptor.meta.width,
        height: descriptor.meta.height,
        duration: descriptor.meta.duration,
        sizeBytes: Math.max(0, Number(sizeBytes || 0)),
        mime: descriptor.mime,
        orientation: descriptor.meta.orientation
      },
      attribution: descriptor.attribution,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  async function acquire({ jobId: rawJobId, projectId: rawProjectId, descriptor: rawDescriptor } = {}) {
    const jobId = validJobId(rawJobId);
    const projectId = validProjectId(rawProjectId);
    const descriptor = normalizedDescriptor(rawDescriptor);
    const identity = identityFor(projectId, descriptor);
    if (jobs.has(jobId) || identities.has(identity)) {
      throw acquisitionError("MEDIA_DOWNLOAD_DUPLICATE", "This media is already being added to the project.");
    }

    const paths = cachePaths(root, projectId, descriptor);
    const existingSize = await regularFileSize(paths.finalPath);
    if (existingSize > 0) {
      return { duplicate: true, asset: mediaAsset(descriptor, paths.finalPath, existingSize) };
    }

    const record = {
      jobId,
      projectId,
      descriptor,
      identity,
      controller: new AbortController(),
      state: "validating",
      progress: 0,
      partialPath: paths.partialPath
    };
    jobs.set(jobId, record);
    identities.set(identity, jobId);
    emit(record, "validating", 0);

    let fileHandle = null;
    let downloaded = 0;
    let expectedBytes = 0;

    try {
      await ensureDestination(paths);
      try { await fsp.rm(paths.partialPath, { force: true }); }
      catch { throw acquisitionError("MEDIA_DESTINATION_UNAVAILABLE", "A partial media file could not be cleared."); }

      emit(record, "queued", 3);
      let response;
      try {
        response = await fetchImpl(descriptor.downloadUrl, {
          method: "GET",
          redirect: "manual",
          signal: record.controller.signal,
          headers: { accept: descriptor.mime || "application/octet-stream" }
        });
      } catch (error) {
        if (record.controller.signal.aborted || error?.name === "AbortError") {
          throw acquisitionError("MEDIA_CANCELLED", "Media download was cancelled.");
        }
        throw acquisitionError("MEDIA_DOWNLOAD_FAILED", "Media could not be downloaded.");
      }

      if (record.controller.signal.aborted) throw acquisitionError("MEDIA_CANCELLED", "Media download was cancelled.");
      if (!response?.ok || Number(response.status || 0) < 200 || Number(response.status || 0) >= 300) {
        throw acquisitionError("MEDIA_SOURCE_UNAVAILABLE", "Media source is not available.");
      }
      if (!providerDownloadAllowed(descriptor.provider, response.url || descriptor.downloadUrl)) {
        throw acquisitionError("MEDIA_SOURCE_UNAVAILABLE", "Media source redirected outside the approved provider.");
      }

      expectedBytes = numericHeader(response.headers, "content-length");
      if (expectedBytes > maxBytes) {
        throw acquisitionError("MEDIA_DISK_SPACE_LOW", "Media file exceeds the allowed download size.");
      }
      await ensureDestination(paths, expectedBytes);

      const responseMime = mimeHeader(response.headers);
      if (responseMime) {
        const expectedKind = kindForDescriptor({ ...descriptor, mime: responseMime });
        if (!expectedKind || expectedKind !== descriptor.kind) {
          throw acquisitionError("MEDIA_VERIFY_FAILED", "Downloaded media type does not match the expected asset.");
        }
        descriptor.mime = responseMime;
      }
      if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
        throw acquisitionError("MEDIA_DOWNLOAD_FAILED", "Media response did not include a downloadable body.");
      }

      try {
        fileHandle = await fsp.open(paths.partialPath, "wx");
      } catch {
        throw acquisitionError("MEDIA_DESTINATION_UNAVAILABLE", "Media cache file could not be created.");
      }

      emit(record, "downloading", expectedBytes > 0 ? 5 : 10);
      for await (const chunkValue of response.body) {
        if (record.controller.signal.aborted) throw acquisitionError("MEDIA_CANCELLED", "Media download was cancelled.");
        const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
        downloaded += chunk.length;
        if (downloaded > maxBytes || (expectedBytes > 0 && downloaded > expectedBytes)) {
          throw acquisitionError("MEDIA_DOWNLOAD_FAILED", "Downloaded media exceeded the expected size.");
        }
        await fileHandle.write(chunk);
        const progress = expectedBytes > 0
          ? 5 + Math.floor((downloaded / expectedBytes) * 85)
          : Math.min(88, 10 + Math.floor(downloaded / (1024 * 1024)));
        emit(record, "downloading", progress);
      }

      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = null;

      emit(record, "verifying", 94);
      const partialSize = await regularFileSize(paths.partialPath);
      if (partialSize <= 0 || partialSize !== downloaded || (expectedBytes > 0 && partialSize !== expectedBytes)) {
        throw acquisitionError("MEDIA_VERIFY_FAILED", "Downloaded media failed integrity verification.");
      }

      try {
        await fsp.rename(paths.partialPath, paths.finalPath);
      } catch {
        throw acquisitionError("MEDIA_DESTINATION_UNAVAILABLE", "Downloaded media could not be finalized.");
      }

      const asset = mediaAsset(descriptor, paths.finalPath, partialSize);
      emit(record, "ready", 100, { assetId: asset.id });
      return { duplicate: false, asset };
    } catch (rawError) {
      const error = rawError?.code ? rawError : acquisitionError("MEDIA_DOWNLOAD_FAILED", "Media download failed.");
      if (record.controller.signal.aborted && error.code !== "MEDIA_CANCELLED") {
        error.code = "MEDIA_CANCELLED";
      }
      if (fileHandle) {
        try { await fileHandle.close(); } catch {}
        fileHandle = null;
      }
      try { await fsp.rm(paths.partialPath, { force: true }); } catch {}
      if (error.code === "MEDIA_CANCELLED") emit(record, "cancelled", record.progress);
      else emit(record, "failed", record.progress, { error: { code: publicAcquisitionError(error).code } });
      throw error;
    } finally {
      jobs.delete(jobId);
      if (identities.get(identity) === jobId) identities.delete(identity);
    }
  }

  function cancel(rawJobId) {
    const jobId = text(rawJobId, 160);
    const record = jobs.get(jobId);
    if (!record) return { cancelled: false };
    if (!["cancelling", "cancelled", "ready", "failed"].includes(record.state)) {
      emit(record, "cancelling", record.progress);
    }
    try { record.controller.abort(); } catch {}
    return { cancelled: true };
  }

  function cancelAll() {
    const count = jobs.size;
    for (const record of jobs.values()) {
      if (!["cancelling", "cancelled", "ready", "failed"].includes(record.state)) {
        emit(record, "cancelling", record.progress);
      }
      try { record.controller.abort(); } catch {}
    }
    return count;
  }

  return {
    acquire,
    cancel,
    cancelAll,
    activeCount: () => jobs.size,
    publicError: publicAcquisitionError,
    cacheRoot: root
  };
}

module.exports = {
  DEFAULT_MAX_DOWNLOAD_BYTES,
  DEFAULT_MIN_FREE_BYTES,
  acquisitionError,
  normalizedDescriptor,
  identityFor,
  cachePaths,
  publicAcquisitionError,
  createMediaAcquisitionManager
};
