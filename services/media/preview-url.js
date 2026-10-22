"use strict";
const path = require("node:path"), { pathToFileURL } = require("node:url");
const { describeLocalMediaFile } = require("./local-files");
function localPreviewUrl(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).sort().join() !== "kind,localPath" || !["video", "image"].includes(payload.kind) ||
      typeof payload.localPath !== "string" || payload.localPath.length > 32767 || !path.isAbsolute(payload.localPath)) throw Error("PREVIEW_INVALID");
  const media = describeLocalMediaFile(payload.localPath);
  if (media.kind !== payload.kind) throw Error("PREVIEW_INVALID");
  return pathToFileURL(path.resolve(media.localPath)).href;
}
function registerPreviewIpc({ ipcMain, trusted }) {
  ipcMain.handle("media:preview-url", (event, payload, ...extra) => {
    if (!trusted(event) || extra.length) return { ok: false, code: "unavailable" };
    try { return { ok: true, url: localPreviewUrl(payload) }; }
    catch (error) { return { ok: false, code: error.code === "MEDIA_FILE_MISSING" ? "missing-file" : "unavailable" }; }
  });
}
module.exports = { localPreviewUrl, registerPreviewIpc };
