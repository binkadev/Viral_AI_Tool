"use strict";

const fs = require("fs");
const path = require("path");

const MEDIA_EXTENSIONS = Object.freeze({
  video: Object.freeze(["mp4", "mov", "mkv", "webm", "avi", "m4v"]),
  image: Object.freeze(["jpg", "jpeg", "png", "webp", "gif", "bmp"]),
  audio: Object.freeze(["mp3", "wav", "m4a", "aac", "ogg", "flac"])
});

const MIME_BY_EXTENSION = Object.freeze({
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac"
});

function mediaError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeExtension(filePath) {
  return path.extname(String(filePath || "")).slice(1).toLowerCase();
}

function kindForExtension(extension) {
  const ext = String(extension || "").toLowerCase();
  for (const [kind, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
    if (extensions.includes(ext)) return kind;
  }
  return null;
}

function classifyMediaPath(filePath) {
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  if (!raw) throw mediaError("MEDIA_FILE_INVALID", "Media path is required.");
  if (raw.includes("\0")) throw mediaError("MEDIA_FILE_INVALID", "Media path is invalid.");
  const extension = normalizeExtension(raw);
  const kind = kindForExtension(extension);
  if (!kind) {
    throw mediaError("MEDIA_TYPE_UNSUPPORTED", "Media type is not supported.", { extension });
  }
  return { kind, extension };
}

function describeLocalMediaFile(filePath, { stat = fs.statSync } = {}) {
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  const classification = classifyMediaPath(raw);
  let fileStat;
  try {
    fileStat = stat(raw);
  } catch (error) {
    const code = error?.code === "ENOENT" ? "MEDIA_FILE_MISSING" : "MEDIA_FILE_UNREADABLE";
    throw mediaError(code, code === "MEDIA_FILE_MISSING" ? "Media file could not be found." : "Media file could not be read.", {
      systemCode: error?.code || null
    });
  }
  if (!fileStat?.isFile?.()) {
    throw mediaError("MEDIA_FILE_INVALID", "Selected media must be a file.");
  }

  const sizeBytes = Math.max(0, Number(fileStat.size || 0));
  const modifiedAt = fileStat.mtime && !Number.isNaN(new Date(fileStat.mtime).getTime())
    ? new Date(fileStat.mtime).toISOString()
    : null;

  return {
    kind: classification.kind,
    origin: "local",
    provider: "local",
    name: path.basename(raw),
    localPath: raw,
    status: "ready",
    fileState: "available",
    progress: 100,
    meta: {
      width: 0,
      height: 0,
      duration: 0,
      sizeBytes,
      mime: MIME_BY_EXTENSION[classification.extension] || null,
      orientation: null
    },
    native: {
      extension: classification.extension,
      modifiedAt
    }
  };
}

function dialogFilters() {
  const all = Array.from(new Set(Object.values(MEDIA_EXTENSIONS).flat()));
  return [
    { name: "Media", extensions: all },
    { name: "Video", extensions: [...MEDIA_EXTENSIONS.video] },
    { name: "Images", extensions: [...MEDIA_EXTENSIONS.image] },
    { name: "Audio", extensions: [...MEDIA_EXTENSIONS.audio] }
  ];
}

function publicMediaError(error) {
  const allowed = new Set([
    "MEDIA_FILE_INVALID",
    "MEDIA_FILE_MISSING",
    "MEDIA_FILE_UNREADABLE",
    "MEDIA_TYPE_UNSUPPORTED"
  ]);
  return {
    code: allowed.has(error?.code) ? error.code : "MEDIA_FILE_UNAVAILABLE",
    details: error?.details && typeof error.details === "object"
      ? { extension: error.details.extension || null }
      : {}
  };
}

module.exports = {
  MEDIA_EXTENSIONS,
  MIME_BY_EXTENSION,
  normalizeExtension,
  kindForExtension,
  classifyMediaPath,
  describeLocalMediaFile,
  dialogFilters,
  publicMediaError
};
