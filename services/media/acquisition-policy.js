"use strict";

const path = require("path");

const PROVIDER_HOSTS = Object.freeze({
  pexels: Object.freeze(["pexels.com"]),
  pixabay: Object.freeze(["pixabay.com"])
});

const EXTENSION_BY_MIME = Object.freeze({
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a"
});

const KIND_BY_EXTENSION = Object.freeze({
  mp4: "video",
  webm: "video",
  mov: "video",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio"
});

function safeProvider(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function providerDownloadAllowed(providerValue, rawUrl) {
  const provider = safeProvider(providerValue);
  const roots = PROVIDER_HOSTS[provider];
  if (!roots) return false;

  let url;
  try { url = new URL(String(rawUrl || "")); }
  catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;

  const host = url.hostname.toLowerCase();
  return roots.some(root => host === root || host.endsWith("." + root));
}

function safeExtension(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : null;
}

function extensionForDescriptor(descriptor = {}) {
  const mime = String(descriptor.mime || descriptor?.meta?.mime || "").split(";")[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME[mime]) return EXTENSION_BY_MIME[mime];
  try {
    const url = new URL(String(descriptor.downloadUrl || ""));
    const ext = safeExtension(path.extname(url.pathname));
    return ext && KIND_BY_EXTENSION[ext] ? ext : null;
  } catch {
    return null;
  }
}

function kindForDescriptor(descriptor = {}) {
  const declared = String(descriptor.kind || "").trim().toLowerCase();
  const ext = extensionForDescriptor(descriptor);
  const inferred = ext ? KIND_BY_EXTENSION[ext] : null;
  if (["video", "image", "audio"].includes(declared) && (!inferred || inferred === declared)) return declared;
  return inferred;
}

function supportedDescriptor(descriptor = {}) {
  const provider = safeProvider(descriptor.provider);
  const providerAssetId = String(descriptor.providerAssetId || "").trim();
  const kind = kindForDescriptor(descriptor);
  const extension = extensionForDescriptor(descriptor);
  return Boolean(
    provider &&
    providerAssetId && providerAssetId.length <= 240 &&
    kind &&
    extension &&
    providerDownloadAllowed(provider, descriptor.downloadUrl)
  );
}

module.exports = {
  PROVIDER_HOSTS,
  EXTENSION_BY_MIME,
  KIND_BY_EXTENSION,
  safeProvider,
  providerDownloadAllowed,
  extensionForDescriptor,
  kindForDescriptor,
  supportedDescriptor
};
