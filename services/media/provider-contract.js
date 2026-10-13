"use strict";

const SEARCH_KINDS = Object.freeze(["video", "image"]);
const ORIENTATIONS = Object.freeze(["portrait", "landscape", "square", "any"]);
const DEFAULT_PER_PAGE = 18;
const MAX_PER_PAGE = 40;

function mediaProviderError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function text(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeSearchRequest(input = {}) {
  const query = text(input.query, 180);
  if (query.length < 2) {
    throw mediaProviderError("MEDIA_SEARCH_INVALID", "Search query is too short.");
  }

  const kindRaw = text(input.kind, 20).toLowerCase() || "video";
  if (!SEARCH_KINDS.includes(kindRaw)) {
    throw mediaProviderError("MEDIA_SEARCH_INVALID", "Media kind is not supported.", { field: "kind" });
  }

  const orientationRaw = text(input.orientation, 20).toLowerCase() || "any";
  if (!ORIENTATIONS.includes(orientationRaw)) {
    throw mediaProviderError("MEDIA_SEARCH_INVALID", "Orientation is not supported.", { field: "orientation" });
  }

  return {
    query,
    kind: kindRaw,
    orientation: orientationRaw,
    page: integer(input.page, 1, 1, 1000),
    perPage: integer(input.perPage, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE)
  };
}

function safeHttpUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOrientation(width, height) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio > 1.12) return "landscape";
  if (ratio < 0.89) return "portrait";
  return "square";
}

function normalizeVariant(input = {}) {
  const url = safeHttpUrl(input.url);
  if (!url) return null;
  const width = Math.max(0, Math.round(Number(input.width) || 0));
  const height = Math.max(0, Math.round(Number(input.height) || 0));
  return {
    id: text(input.id, 200) || [width, height, text(input.quality, 50)].filter(Boolean).join("x") || url,
    url,
    width,
    height,
    quality: text(input.quality, 80) || null,
    mime: text(input.mime, 120) || null,
    sizeBytes: Math.max(0, Math.round(Number(input.sizeBytes) || 0))
  };
}

function normalizeSearchResult(input = {}) {
  const provider = text(input.provider, 80).toLowerCase();
  const providerAssetId = text(input.providerAssetId, 240);
  const kind = text(input.kind, 20).toLowerCase();
  if (!provider || !providerAssetId || !SEARCH_KINDS.includes(kind)) return null;

  const width = Math.max(0, Math.round(Number(input?.meta?.width) || 0));
  const height = Math.max(0, Math.round(Number(input?.meta?.height) || 0));
  const variants = (Array.isArray(input.variants) ? input.variants : [])
    .map(normalizeVariant)
    .filter(Boolean);

  return {
    provider,
    providerAssetId,
    kind,
    name: text(input.name, 320) || provider + "-" + providerAssetId,
    previewUrl: safeHttpUrl(input.previewUrl),
    thumbnailUrl: safeHttpUrl(input.thumbnailUrl),
    meta: {
      width,
      height,
      duration: Math.max(0, Number(input?.meta?.duration) || 0),
      orientation: input?.meta?.orientation || normalizeOrientation(width, height)
    },
    attribution: {
      creatorName: text(input?.attribution?.creatorName, 240) || null,
      creatorUrl: safeHttpUrl(input?.attribution?.creatorUrl),
      sourceUrl: safeHttpUrl(input?.attribution?.sourceUrl),
      licenseName: text(input?.attribution?.licenseName, 160) || null,
      licenseUrl: safeHttpUrl(input?.attribution?.licenseUrl),
      attributionText: text(input?.attribution?.attributionText, 800) || null
    },
    variants
  };
}

function publicSearchError(error) {
  const allowed = new Set([
    "MEDIA_SEARCH_INVALID",
    "MEDIA_SEARCH_UNAVAILABLE",
    "MEDIA_SEARCH_TIMEOUT",
    "MEDIA_PROVIDER_UNAVAILABLE",
    "MEDIA_AUTH_REQUIRED",
    "MEDIA_QUOTA_EXCEEDED"
  ]);

  const code = allowed.has(error?.code) ? error.code : "MEDIA_SEARCH_UNAVAILABLE";
  const details = {};
  if (error?.details?.field) details.field = text(error.details.field, 80);
  return { code, details };
}

module.exports = {
  SEARCH_KINDS,
  ORIENTATIONS,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  mediaProviderError,
  normalizeSearchRequest,
  safeHttpUrl,
  normalizeOrientation,
  normalizeVariant,
  normalizeSearchResult,
  publicSearchError
};
