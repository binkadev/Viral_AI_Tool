"use strict";
const fs = require("node:fs"), path = require("node:path");
const { describeLocalMediaFile, dialogFilters, publicMediaError } = require("./local-files");

function registerProjectMediaPicker({ ipcMain, dialog, parent, trusted, describe = describeLocalMediaFile,
  readable = file => fs.accessSync(file, fs.constants.R_OK) }) {
  let pending = false;
  ipcMain.handle("media:select-local", async (event, ...args) => {
    if (!trusted(event) || args.length) return { ok: false, error: { code: "MEDIA_FILE_INVALID" } };
    if (pending) return { ok: false, error: { code: "MEDIA_IMPORT_BUSY" } };
    pending = true;
    try {
      const result = await dialog.showOpenDialog(parent(), { properties: ["openFile", "multiSelections"], filters: dialogFilters() });
      if (result.canceled) return { ok: true, canceled: true, assets: [], errors: [] };
      if (!Array.isArray(result.filePaths) || result.filePaths.length > 500) return { ok: false, error: { code: "MEDIA_IMPORT_LIMIT" } };
      const assets = [], errors = [];
      for (const selected of result.filePaths) {
        try {
          if (typeof selected !== "string" || !path.isAbsolute(selected)) throw Object.assign(Error(), { code: "MEDIA_FILE_INVALID" });
          const file = path.resolve(selected), descriptor = describe(file);
          try { readable(file); } catch { throw Object.assign(Error(), { code: "MEDIA_FILE_UNREADABLE" }); }
          // Only normalized public descriptor fields cross IPC. No original bytes are changed.
          const { native, ...asset } = descriptor;
          assets.push(asset);
        } catch (error) { errors.push(publicMediaError(error)); }
      }
      return { ok: true, canceled: false, assets, errors };
    } catch (error) { return { ok: false, error: publicMediaError(error) }; }
    finally { pending = false; }
  });
}
module.exports = { registerProjectMediaPicker };
