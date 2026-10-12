(function attachCoreMediaLibraryRuntime(root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreMediaLibraryRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreMediaLibraryRuntime(root) {
  "use strict";

  function safeErrorCode(error, fallback = "MEDIA_IMPORT_FAILED") {
    const raw = String(error?.code || "").trim();
    return /^[A-Z0-9_]{3,80}$/.test(raw) ? raw : fallback;
  }

  function defaultState() {
    try { return typeof state !== "undefined" && state ? state : null; } catch { return null; }
  }

  function createController(options = {}) {
    const model = options.model || root?.ViralCoreMediaLibraryModel;
    const desktopAPI = options.desktopAPI || root?.desktopAPI;
    const getState = typeof options.getState === "function" ? options.getState : defaultState;
    const emit = typeof options.emit === "function"
      ? options.emit
      : (name, detail) => root?.dispatchEvent?.(new CustomEvent(name, { detail }));
    const schedule = typeof options.schedule === "function"
      ? options.schedule
      : reason => root?.ViralCoreProjectPersistence?.schedule?.(reason);

    function currentLibrary() {
      const current = getState();
      return model?.normalizeLibrary
        ? model.normalizeLibrary(current?.media)
        : { schemaVersion: 1, assets: [], selectedAssetId: null };
    }

    function commitLibrary(next, reason = "media-library-change") {
      const current = getState();
      if (!current || !model?.normalizeLibrary) return null;
      current.media = model.normalizeLibrary(next);
      schedule(reason);
      emit("viral-ai:media-library-changed", {
        reason,
        assetCount: current.media.assets.length,
        selectedAssetId: current.media.selectedAssetId
      });
      emit("viral-ai:core-state-changed", { source: "media-library", reason });
      return current.media;
    }

    async function validateVideoSelection(file) {
      const filePath = String(file?.path || "").trim();
      if (!filePath) return { ok: false, error: { code: "MEDIA_FILE_INVALID" } };
      if (!desktopAPI?.probeVideo) return { ok: false, error: { code: "MEDIA_VIDEO_PROBE_UNAVAILABLE" } };

      try {
        const meta = await desktopAPI.probeVideo(filePath);
        const width = Math.max(0, Number(meta?.width || 0));
        const height = Math.max(0, Number(meta?.height || 0));
        const duration = Math.max(0, Number(meta?.duration || 0));
        if (!Number.isFinite(duration) || duration <= 0) {
          return { ok: false, error: { code: "MEDIA_VIDEO_INVALID" } };
        }
        return {
          ok: true,
          asset: {
            id: "local:" + filePath,
            kind: "video",
            origin: "local",
            provider: "local",
            name: String(file?.name || filePath.split(/[\\/]/).filter(Boolean).pop() || "video"),
            localPath: filePath,
            status: "ready",
            fileState: "available",
            progress: 100,
            meta: {
              width: Number.isFinite(width) ? width : 0,
              height: Number.isFinite(height) ? height : 0,
              duration,
              sizeBytes: 0,
              mime: null,
              orientation: width > 0 && height > 0
                ? (width === height ? "square" : width > height ? "landscape" : "portrait")
                : null
            }
          }
        };
      } catch (error) {
        return { ok: false, error: { code: safeErrorCode(error, "MEDIA_VIDEO_PROBE_FAILED") } };
      }
    }

    async function importLocalVideos() {
      if (!model?.addAssets || !desktopAPI?.selectVideos) {
        return { ok: false, cancelled: false, added: [], duplicates: [], errors: [{ code: "MEDIA_IMPORT_UNAVAILABLE" }] };
      }

      let selected;
      try {
        selected = await desktopAPI.selectVideos();
      } catch (error) {
        return { ok: false, cancelled: false, added: [], duplicates: [], errors: [{ code: safeErrorCode(error) }] };
      }

      if (!Array.isArray(selected) || selected.length === 0) {
        return { ok: true, cancelled: true, added: [], duplicates: [], errors: [] };
      }

      const valid = [];
      const errors = [];
      for (const file of selected.slice(0, 100)) {
        const result = await validateVideoSelection(file);
        if (result.ok && result.asset) valid.push(result.asset);
        else errors.push({
          code: result.error?.code || "MEDIA_IMPORT_FAILED",
          name: String(file?.name || "").slice(0, 320) || null
        });
      }

      const insertion = model.addAssets(currentLibrary(), valid);
      if (insertion.added.length > 0) commitLibrary(insertion.library, "media-import-local-video");

      return {
        ok: errors.length === 0,
        cancelled: false,
        added: insertion.added,
        duplicates: insertion.duplicates,
        errors
      };
    }

    function selectAsset(assetId) {
      const library = currentLibrary();
      const id = String(assetId || "").trim();
      if (!id || !library.assets.some(asset => asset.id === id)) return library;
      if (library.selectedAssetId === id) return library;
      return commitLibrary({ ...library, selectedAssetId: id }, "media-select");
    }

    function toggleFavorite(assetId) {
      const library = currentLibrary();
      const asset = library.assets.find(item => item.id === String(assetId || ""));
      if (!asset || !model?.updateAsset) return library;
      return commitLibrary(
        model.updateAsset(library, asset.id, { favorite: !asset.favorite }),
        "media-favorite"
      );
    }

    function removeFromProject(assetId) {
      if (!model?.removeAsset) return currentLibrary();
      const library = currentLibrary();
      const id = String(assetId || "").trim();
      if (!id || !library.assets.some(asset => asset.id === id)) return library;
      return commitLibrary(model.removeAsset(library, id), "media-remove-from-project");
    }

    return {
      currentLibrary,
      commitLibrary,
      validateVideoSelection,
      importLocalVideos,
      selectAsset,
      toggleFavorite,
      removeFromProject
    };
  }

  const controller = root?.ViralCoreMediaLibraryModel
    ? createController()
    : null;

  return {
    safeErrorCode,
    createController,
    controller
  };
});
