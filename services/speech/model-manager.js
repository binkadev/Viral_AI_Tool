const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const MODEL_REVISION = "8f3c18b358db4d1f2fc1eae49d75cd20989e4309";
const MODEL_ID = "speech-standard-v1";

const MODEL_CATALOG = Object.freeze({
  [MODEL_ID]: Object.freeze({
    id: MODEL_ID,
    tier: "standard",
    version: "2024-07-13",
    displaySizeBytes: 375485327,
    installedSizeBytes: 375485327,
    files: Object.freeze([
      Object.freeze({
        role: "encoder",
        name: "small-encoder.int8.onnx",
        sizeBytes: 112442483,
        sha256: "4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9",
        url: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/${MODEL_REVISION}/small-encoder.int8.onnx`
      }),
      Object.freeze({
        role: "decoder",
        name: "small-decoder.int8.onnx",
        sizeBytes: 262226114,
        sha256: "acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee",
        url: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/${MODEL_REVISION}/small-decoder.int8.onnx`
      }),
      Object.freeze({
        role: "tokens",
        name: "small-tokens.txt",
        sizeBytes: 816730,
        sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
        url: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/${MODEL_REVISION}/small-tokens.txt`
      })
    ])
  })
});

const activeDownloads = new Map();
const SAFE_REDIRECT_HOSTS = [
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "cas-bridge.xethub.hf.co"
];

class ModelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.details = details;
  }
}

function modelError(code, message, details) {
  return new ModelError(code, message, details);
}

function getCatalogEntry(modelId = MODEL_ID) {
  const model = MODEL_CATALOG[modelId];
  if (!model) throw modelError("MODEL_UNKNOWN", "Unknown local speech model.");
  return model;
}

function safeCatalog() {
  return Object.values(MODEL_CATALOG).map(model => ({
    id: model.id,
    tier: model.tier,
    version: model.version,
    downloadSizeBytes: model.displaySizeBytes,
    installedSizeBytes: model.installedSizeBytes
  }));
}

function modelRoot(userDataPath) {
  return path.join(userDataPath, "models", "speech");
}

function modelDirectory(userDataPath, modelId = MODEL_ID) {
  return path.join(modelRoot(userDataPath), modelId);
}

function manifestPath(userDataPath, modelId = MODEL_ID) {
  return path.join(modelDirectory(userDataPath, modelId), "model.json");
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyFile(filePath, spec) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size !== spec.sizeBytes) {
      return { ok: false, reason: "size" };
    }
    const digest = await sha256File(filePath);
    return { ok: digest === spec.sha256, reason: digest === spec.sha256 ? null : "checksum" };
  } catch {
    return { ok: false, reason: "missing" };
  }
}

function readManifest(userDataPath, modelId = MODEL_ID) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(userDataPath, modelId), "utf8"));
  } catch {
    return null;
  }
}

async function status(userDataPath, modelId = MODEL_ID) {
  const model = getCatalogEntry(modelId);
  const dir = modelDirectory(userDataPath, modelId);
  const manifest = readManifest(userDataPath, modelId);
  const downloading = [...activeDownloads.values()].find(item => item.modelId === modelId);

  if (downloading) {
    return {
      modelId,
      state: "downloading",
      ready: false,
      downloadedBytes: downloading.downloadedBytes,
      totalBytes: model.displaySizeBytes,
      percent: downloading.percent
    };
  }

  if (!manifest || manifest.modelId !== modelId || manifest.revision !== MODEL_REVISION) {
    const partialBytes = model.files.reduce((total, spec) => {
      for (const candidate of [
        path.join(dir, spec.name),
        path.join(dir, spec.name + ".part")
      ]) {
        try {
          const size = fs.statSync(candidate).size;
          return total + Math.min(size, spec.sizeBytes);
        } catch {
          // Continue to the next candidate.
        }
      }
      return total;
    }, 0);

    return {
      modelId,
      state: partialBytes > 0 ? "partial" : "not-installed",
      ready: false,
      downloadedBytes: partialBytes,
      totalBytes: model.displaySizeBytes,
      percent: model.displaySizeBytes ? Math.floor((partialBytes / model.displaySizeBytes) * 100) : 0
    };
  }

  for (const spec of model.files) {
    const target = path.join(dir, spec.name);
    try {
      const stat = fs.statSync(target);
      const manifestFile = Array.isArray(manifest.files)
        ? manifest.files.find(file => file.name === spec.name)
        : null;

      if (
        !stat.isFile() ||
        stat.size !== spec.sizeBytes ||
        manifestFile?.sha256 !== spec.sha256 ||
        manifestFile?.sizeBytes !== spec.sizeBytes
      ) {
        return {
          modelId,
          state: "invalid",
          ready: false,
          reason: "metadata",
          downloadedBytes: 0,
          totalBytes: model.displaySizeBytes,
          percent: 0
        };
      }
    } catch {
      return {
        modelId,
        state: "invalid",
        ready: false,
        reason: "missing",
        downloadedBytes: 0,
        totalBytes: model.displaySizeBytes,
        percent: 0
      };
    }
  }

  return {
    modelId,
    state: "installed",
    ready: true,
    integrityVerified: true,
    verifiedAt: manifest.verifiedAt || manifest.installedAt || null,
    downloadedBytes: model.displaySizeBytes,
    totalBytes: model.displaySizeBytes,
    percent: 100,
    version: manifest.version
  };
}

function availableDiskBytes(directory) {
  if (typeof fs.statfsSync !== "function") return null;
  try {
    ensureDirectory(directory);
    const stat = fs.statfsSync(directory);
    const blocks = Number(stat.bavail ?? stat.bfree ?? 0);
    const blockSize = Number(stat.bsize ?? 0);
    const bytes = blocks * blockSize;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

function remainingDownloadBytes(userDataPath, model) {
  const dir = modelDirectory(userDataPath, model.id);
  return model.files.reduce((remaining, spec) => {
    const finalPath = path.join(dir, spec.name);
    const partPath = finalPath + ".part";

    try {
      if (fs.statSync(finalPath).size === spec.sizeBytes) return remaining;
    } catch {
      // Not a completed candidate.
    }

    try {
      const partSize = Math.min(fs.statSync(partPath).size, spec.sizeBytes);
      return remaining + Math.max(0, spec.sizeBytes - partSize);
    } catch {
      return remaining + spec.sizeBytes;
    }
  }, 0);
}

function isSafeRedirectUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();

  return SAFE_REDIRECT_HOSTS.some(allowed =>
    host === allowed ||
    host.endsWith("." + allowed) ||
    (allowed.endsWith(".hf.co") && host.endsWith(".hf.co"))
  ) || host.endsWith(".huggingface.co");
}

function requestDownload(url, { startByte, signal, redirects = 0 }) {
  if (redirects > 8) {
    return Promise.reject(modelError("MODEL_DOWNLOAD_REDIRECT", "Too many download redirects."));
  }
  if (!isSafeRedirectUrl(url)) {
    return Promise.reject(modelError("MODEL_DOWNLOAD_URL", "Unsafe model download URL."));
  }

  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Viral-AI-Tool/0.6",
      "Accept": "application/octet-stream"
    };
    if (startByte > 0) headers.Range = `bytes=${startByte}-`;

    const request = https.get(url, { headers, signal }, response => {
      const statusCode = Number(response.statusCode || 0);

      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(modelError("MODEL_DOWNLOAD_REDIRECT", "Missing redirect URL."));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        requestDownload(nextUrl, { startByte, signal, redirects: redirects + 1 })
          .then(resolve, reject);
        return;
      }

      if (statusCode !== 200 && statusCode !== 206) {
        response.resume();
        reject(modelError("MODEL_DOWNLOAD_HTTP", `Unexpected download status ${statusCode}.`, { statusCode }));
        return;
      }

      resolve({ response, resumed: statusCode === 206 && startByte > 0 });
    });

    request.on("error", error => {
      if (signal?.aborted) {
        reject(modelError("MODEL_DOWNLOAD_CANCELLED", "Model download cancelled."));
      } else {
        reject(modelError("MODEL_DOWNLOAD_NETWORK", error?.message || "Model download failed."));
      }
    });
  });
}

async function downloadOneFile({ userDataPath, model, spec, signal, onBytes }) {
  const dir = modelDirectory(userDataPath, model.id);
  ensureDirectory(dir);

  const finalPath = path.join(dir, spec.name);
  const partPath = finalPath + ".part";

  const finalVerification = await verifyFile(finalPath, spec);
  if (finalVerification.ok) {
    onBytes?.(spec.sizeBytes, spec.sizeBytes, spec);
    return;
  }

  if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true });

  let startByte = 0;
  try {
    startByte = fs.statSync(partPath).size;
    if (startByte > spec.sizeBytes) {
      fs.rmSync(partPath, { force: true });
      startByte = 0;
    }
  } catch {
    startByte = 0;
  }

  let { response, resumed } = await requestDownload(spec.url, {
    startByte,
    signal
  });

  if (startByte > 0 && !resumed) {
    response.destroy();
    fs.rmSync(partPath, { force: true });
    startByte = 0;
    ({ response } = await requestDownload(spec.url, { startByte: 0, signal }));
  }

  let written = startByte;
  onBytes?.(written, spec.sizeBytes, spec);

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(partPath, {
      flags: startByte > 0 ? "a" : "w"
    });

    response.on("data", chunk => {
      written += chunk.length;
      if (written > spec.sizeBytes) {
        response.destroy();
        stream.destroy(modelError("MODEL_DOWNLOAD_SIZE", "Downloaded model file exceeded expected size."));
        return;
      }
      onBytes?.(written, spec.sizeBytes, spec);
    });

    response.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", resolve);
    response.pipe(stream);
  });

  if (signal.aborted) {
    throw modelError("MODEL_DOWNLOAD_CANCELLED", "Model download cancelled.");
  }

  const verification = await verifyFile(partPath, spec);
  if (!verification.ok) {
    fs.rmSync(partPath, { force: true });
    throw modelError("MODEL_CHECKSUM_FAILED", "Downloaded model file failed integrity validation.", {
      file: spec.name,
      reason: verification.reason
    });
  }

  fs.renameSync(partPath, finalPath);
}

function writeManifestAtomic(userDataPath, model) {
  const dir = modelDirectory(userDataPath, model.id);
  ensureDirectory(dir);

  const manifest = {
    schemaVersion: 1,
    modelId: model.id,
    tier: model.tier,
    version: model.version,
    revision: MODEL_REVISION,
    installedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    files: model.files.map(file => ({
      role: file.role,
      name: file.name,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256
    }))
  };

  const target = manifestPath(userDataPath, model.id);
  const temp = target + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(temp, target);
}

async function install({ jobId, userDataPath, modelId = MODEL_ID, onProgress }) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) {
    throw modelError("MODEL_JOB_INVALID", "Invalid model download job id.");
  }
  if (activeDownloads.has(jobId)) {
    throw modelError("MODEL_DOWNLOAD_DUPLICATE", "This model download job is already active.");
  }

  const model = getCatalogEntry(modelId);
  const existing = [...activeDownloads.values()].find(item => item.modelId === model.id);
  if (existing) {
    throw modelError("MODEL_DOWNLOAD_DUPLICATE", "This model is already being downloaded.");
  }

  const root = modelRoot(userDataPath);
  ensureDirectory(root);

  const remainingBytes = remainingDownloadBytes(userDataPath, model);
  const freeBytes = availableDiskBytes(root);
  const safetyReserve = 256 * 1024 * 1024;
  const requiredFreeBytes = remainingBytes + safetyReserve;

  if (freeBytes !== null && freeBytes < requiredFreeBytes) {
    throw modelError("MODEL_LOW_DISK_SPACE", "Not enough free disk space for the local model.", {
      freeBytes,
      requiredFreeBytes
    });
  }

  const controller = new AbortController();
  const state = {
    jobId,
    modelId: model.id,
    controller,
    downloadedBytes: model.displaySizeBytes - remainingBytes,
    percent: model.displaySizeBytes
      ? Math.floor(((model.displaySizeBytes - remainingBytes) / model.displaySizeBytes) * 100)
      : 0
  };
  activeDownloads.set(jobId, state);

  const verifiedBytes = new Map();

  function emitProgress(fileWritten = 0, _fileTotal = 0, spec = null) {
    if (spec) verifiedBytes.set(spec.name, Math.min(fileWritten, spec.sizeBytes));

    let downloadedBytes = 0;
    for (const file of model.files) {
      if (verifiedBytes.has(file.name)) {
        downloadedBytes += verifiedBytes.get(file.name);
        continue;
      }

      const finalPath = path.join(modelDirectory(userDataPath, model.id), file.name);
      const partPath = finalPath + ".part";
      try {
        downloadedBytes += Math.min(fs.statSync(finalPath).size, file.sizeBytes);
        continue;
      } catch {
        // Fall through.
      }
      try {
        downloadedBytes += Math.min(fs.statSync(partPath).size, file.sizeBytes);
      } catch {
        // No bytes for this file yet.
      }
    }

    state.downloadedBytes = Math.min(downloadedBytes, model.displaySizeBytes);
    state.percent = model.displaySizeBytes
      ? Math.min(99, Math.floor((state.downloadedBytes / model.displaySizeBytes) * 100))
      : 0;

    onProgress?.({
      jobId,
      modelId: model.id,
      state: "downloading",
      downloadedBytes: state.downloadedBytes,
      totalBytes: model.displaySizeBytes,
      percent: state.percent,
      file: spec?.role || null
    });
  }

  try {
    emitProgress();

    for (const spec of model.files) {
      if (controller.signal.aborted) {
        throw modelError("MODEL_DOWNLOAD_CANCELLED", "Model download cancelled.");
      }

      await downloadOneFile({
        userDataPath,
        model,
        spec,
        signal: controller.signal,
        onBytes: emitProgress
      });
    }

    onProgress?.({
      jobId,
      modelId: model.id,
      state: "verifying",
      downloadedBytes: model.displaySizeBytes,
      totalBytes: model.displaySizeBytes,
      percent: 99
    });

    for (const spec of model.files) {
      const verification = await verifyFile(
        path.join(modelDirectory(userDataPath, model.id), spec.name),
        spec
      );
      if (!verification.ok) {
        throw modelError("MODEL_CHECKSUM_FAILED", "Installed model failed integrity validation.", {
          file: spec.name,
          reason: verification.reason
        });
      }
    }

    writeManifestAtomic(userDataPath, model);

    onProgress?.({
      jobId,
      modelId: model.id,
      state: "completed",
      downloadedBytes: model.displaySizeBytes,
      totalBytes: model.displaySizeBytes,
      percent: 100
    });

    return { installed: true, modelId: model.id };
  } catch (error) {
    if (controller.signal.aborted || error?.code === "MODEL_DOWNLOAD_CANCELLED") {
      return { installed: false, cancelled: true, modelId: model.id };
    }
    throw error;
  } finally {
    activeDownloads.delete(jobId);
  }
}

function cancel(jobId) {
  const active = activeDownloads.get(jobId);
  if (!active) return false;
  active.controller.abort();
  return true;
}

function cancelAll() {
  let cancelled = 0;
  for (const jobId of [...activeDownloads.keys()]) {
    if (cancel(jobId)) cancelled++;
  }
  return cancelled;
}

function activeDownloadCount() {
  return activeDownloads.size;
}

async function verifyInstalled(userDataPath, modelId = MODEL_ID) {
  const model = getCatalogEntry(modelId);
  const dir = modelDirectory(userDataPath, model.id);

  for (const spec of model.files) {
    const verification = await verifyFile(path.join(dir, spec.name), spec);
    if (!verification.ok) {
      throw modelError("MODEL_CHECKSUM_FAILED", "Installed model failed integrity validation.", {
        file: spec.name,
        reason: verification.reason
      });
    }
  }

  return { verified: true, modelId: model.id };
}

async function remove(userDataPath, modelId = MODEL_ID) {
  const active = [...activeDownloads.values()].find(item => item.modelId === modelId);
  if (active) {
    throw modelError("MODEL_BUSY", "Cannot remove a model while it is downloading.");
  }

  const dir = modelDirectory(userDataPath, modelId);
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, modelId };
}

function paths(userDataPath, modelId = MODEL_ID) {
  const model = getCatalogEntry(modelId);
  const dir = modelDirectory(userDataPath, model.id);

  return {
    modelId: model.id,
    encoder: path.join(dir, model.files.find(file => file.role === "encoder").name),
    decoder: path.join(dir, model.files.find(file => file.role === "decoder").name),
    tokens: path.join(dir, model.files.find(file => file.role === "tokens").name)
  };
}

function serializeModelError(error) {
  return {
    code: error?.code || "MODEL_DOWNLOAD_FAILED",
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  DEFAULT_MODEL_ID: MODEL_ID,
  catalog: safeCatalog,
  status,
  install,
  cancel,
  cancelAll,
  activeDownloadCount,
  verifyInstalled,
  remove,
  paths,
  serializeModelError
};
