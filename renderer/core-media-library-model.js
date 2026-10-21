(function attachCoreMediaLibraryModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreMediaLibraryModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreMediaLibraryModel() {
  "use strict";

  const LIBRARY_SCHEMA_VERSION = 1;
  const MAX_PROJECT_ASSETS = 500;
  const KINDS = Object.freeze(["video", "image", "audio"]);
  const ORIGINS = Object.freeze(["source", "local", "stock", "generated"]);
  const FILE_STATES = Object.freeze(["available", "missing", "remote", "trashed", "unknown"]);
  const ASSET_STATES = Object.freeze([
    "ready",
    "validating",
    "queued",
    "downloading",
    "generating",
    "verifying",
    "cancelling",
    "cancelled",
    "failed",
    "interrupted"
  ]);
  const ACTIVE_STATES = new Set(["validating", "queued", "downloading", "generating", "verifying", "cancelling"]);

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function text(value, max = 400) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function iso(value, fallback = null) {
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
    return fallback;
  }

  function httpUrl(value) {
    const raw = text(value, 2000);
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  function localPath(value) {
    const raw = text(value, 4096);
    if (!raw || /^https?:\/\//i.test(raw) || /^file:/i.test(raw)) return null;
    return raw;
  }

  function normalizeKind(value) {
    const raw = text(value, 32).toLowerCase();
    return KINDS.includes(raw) ? raw : "video";
  }

  function normalizeOrigin(value) {
    const raw = text(value, 32).toLowerCase();
    return ORIGINS.includes(raw) ? raw : "local";
  }

  function normalizeAssetState(value) {
    const raw = text(value, 40).toLowerCase();
    return ASSET_STATES.includes(raw) ? raw : "ready";
  }

  function normalizeFileState(value, pathValue, origin) {
    const raw = text(value, 40).toLowerCase();
    if (FILE_STATES.includes(raw)) return raw;
    if (pathValue) return "available";
    if (origin === "stock" || origin === "generated") return "remote";
    return "unknown";
  }

  function normalizeAttribution(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      creatorName: text(source.creatorName, 240) || null,
      creatorUrl: httpUrl(source.creatorUrl),
      sourceUrl: httpUrl(source.sourceUrl),
      licenseName: text(source.licenseName, 160) || null,
      licenseUrl: httpUrl(source.licenseUrl),
      attributionText: text(source.attributionText, 800) || null
    };
  }

  function normalizeMeta(value) {
    const source = value && typeof value === "object" ? value : {};
    const width = Math.max(0, Math.round(finite(source.width, 0)));
    const height = Math.max(0, Math.round(finite(source.height, 0)));
    const duration = Math.max(0, finite(source.duration, 0));
    const sizeBytes = Math.max(0, Math.round(finite(source.sizeBytes, 0)));
    return {
      width,
      height,
      duration,
      sizeBytes,
      mime: text(source.mime, 120) || null,
      orientation: ["portrait", "landscape", "square"].includes(text(source.orientation, 20).toLowerCase())
        ? text(source.orientation, 20).toLowerCase()
        : null
    };
  }

  function normalizeAsset(input, index = 0, now = Date.now()) {
    if (!input || typeof input !== "object") return null;
    const origin = normalizeOrigin(input.origin);
    const pathValue = localPath(input.localPath || input.path);
    const provider = text(input.provider, 80).toLowerCase() || (origin === "local" || origin === "source" ? "local" : null);
    const providerAssetId = text(input.providerAssetId, 240) || null;
    const fallbackId = [provider || origin, providerAssetId || pathValue || text(input.name, 240) || String(index)].join(":");
    const id = text(input.id || fallbackId, 512);
    if (!id) return null;
    const createdAt = iso(input.createdAt, new Date(now).toISOString());
    const updatedAt = iso(input.updatedAt, createdAt);
    const status = normalizeAssetState(input.status);
    const fileState = normalizeFileState(input.fileState, pathValue, origin);

    return {
      id,
      kind: normalizeKind(input.kind),
      origin,
      provider,
      providerAssetId,
      name: text(input.name, 320) || (pathValue ? pathValue.split(/[\\/]/).filter(Boolean).pop() : id),
      localPath: pathValue,
      previewUrl: httpUrl(input.previewUrl),
      remoteUrl: httpUrl(input.remoteUrl),
      status,
      fileState,
      progress: Math.max(0, Math.min(100, finite(input.progress, status === "ready" ? 100 : 0))),
      favorite: input.favorite === true,
      meta: normalizeMeta(input.meta),
      attribution: normalizeAttribution(input.attribution),
      createdAt,
      updatedAt
    };
  }

  function assetIdentity(asset) {
    const normalized = normalizeAsset(asset);
    if (!normalized) return "";
    if (normalized.provider && normalized.providerAssetId) {
      return "provider:" + normalized.provider + ":" + normalized.providerAssetId;
    }
    if (normalized.localPath) {
      return "local:" + normalized.localPath.replace(/\\/g, "/").toLowerCase();
    }
    if (normalized.remoteUrl) return "remote:" + normalized.remoteUrl;
    return "id:" + normalized.id;
  }

  function restartSafeAsset(asset) {
    const normalized = normalizeAsset(asset);
    if (!normalized) return null;
    if (!ACTIVE_STATES.has(normalized.status)) return normalized;
    return {
      ...normalized,
      status: "interrupted",
      progress: Math.max(0, Math.min(99, normalized.progress))
    };
  }

  function normalizeLibrary(input, { restartSafe = false } = {}) {
    const source = input && typeof input === "object" ? input : {};
    const seen = new Set();
    const assets = [];
    const rawAssets = Array.isArray(source.assets) ? source.assets : [];

    for (let index = 0; index < rawAssets.length && assets.length < MAX_PROJECT_ASSETS; index += 1) {
      const asset = restartSafe ? restartSafeAsset(rawAssets[index]) : normalizeAsset(rawAssets[index], index);
      if (!asset) continue;
      const identity = assetIdentity(asset);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      assets.push(asset);
    }

    const selected = text(source.selectedAssetId, 512) || null;
    return {
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      assets,
      selectedAssetId: selected && assets.some(asset => asset.id === selected) ? selected : null
    };
  }

  function addAssets(library, additions, now = Date.now()) {
    const current = normalizeLibrary(library);
    const assets = current.assets.slice();
    const seen = new Set(assets.map(assetIdentity));
    const added = [];
    const duplicates = [];

    for (const candidate of Array.isArray(additions) ? additions : []) {
      if (assets.length >= MAX_PROJECT_ASSETS) break;
      const asset = normalizeAsset(candidate, assets.length, now);
      if (!asset) continue;
      const identity = assetIdentity(asset);
      if (!identity || seen.has(identity)) {
        duplicates.push(asset);
        continue;
      }
      seen.add(identity);
      assets.push(asset);
      added.push(asset);
    }

    return {
      library: {
        schemaVersion: LIBRARY_SCHEMA_VERSION,
        assets,
        selectedAssetId: current.selectedAssetId || added[0]?.id || null
      },
      added,
      duplicates
    };
  }

  function removeAsset(library, assetId) {
    const current = normalizeLibrary(library);
    const id = text(assetId, 512);
    const assets = current.assets.filter(asset => asset.id !== id);
    return {
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      assets,
      selectedAssetId: current.selectedAssetId === id ? (assets[0]?.id || null) : current.selectedAssetId
    };
  }

  function updateAsset(library, assetId, patch, now = Date.now()) {
    const current = normalizeLibrary(library);
    const id = text(assetId, 512);
    const assets = current.assets.map((asset, index) => {
      if (asset.id !== id) return asset;
      return normalizeAsset({
        ...asset,
        ...(patch && typeof patch === "object" ? clone(patch, {}) : {}),
        id: asset.id,
        createdAt: asset.createdAt,
        updatedAt: new Date(now).toISOString()
      }, index, now) || asset;
    });
    return {
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      assets,
      selectedAssetId: current.selectedAssetId
    };
  }

  // Both imported and generated files use the same Studio source record.
  // Registration references an existing local file; it never copies bytes.
  function sourceJob(file, { id, time = "", ...association } = {}) {
    return { id, name: file.name, lang: "", status: "queued", progress: 0,
      time, sourcePath: file.path, fileState: "available", mediaState: "reading", ...association };
  }

  return {
    LIBRARY_SCHEMA_VERSION,
    MAX_PROJECT_ASSETS,
    KINDS,
    ORIGINS,
    FILE_STATES,
    ASSET_STATES,
    ACTIVE_STATES,
    clone,
    normalizeAsset,
    normalizeLibrary,
    restartSafeAsset,
    assetIdentity,
    sourceJob,
    addAssets,
    removeAsset,
    updateAsset
  };
});
