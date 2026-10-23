(function attachProjectMedia(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root?.ViralCoreProjectPersistence) {
    root.ViralCoreProjectMedia = api.create({ persistence: root.ViralCoreProjectPersistence,
      model: root.ViralCoreMediaLibraryModel, selectLocal: () => root.desktopAPI.selectProjectMedia(),
      id: () => root.crypto.randomUUID(), notify: detail => root.dispatchEvent(new CustomEvent("viral-ai:project-media-feedback", { detail })) });
    root.addEventListener("viral-ai:project-snapshot-restored", () => root.ViralCoreProjectMedia.invalidate());
  }
})(typeof window !== "undefined" ? window : null, function projectMediaOperations() {
  "use strict";
  function create({ persistence, model, selectLocal, id, notify = () => {} }) {
    let epoch = 0, importing = false;
    const operations = new Set();
    const failure = code => Object.assign(Error(code), { code });
    function current(context) { return operations.has(context) && context.epoch === epoch && context.projectId === persistence.activeProjectId(); }
    function begin({ projectId = persistence.activeProjectId(), sceneId = null, intent = "project", expected = null, parent = null } = {}) {
      if (!projectId || projectId !== persistence.activeProjectId() || parent && !current(parent)) throw failure("PROJECT_CHANGED");
      if (!["project", "candidate", "use"].includes(intent) || intent !== "project" && !sceneId) throw failure("PROJECT_MEDIA_INVALID");
      const context = Object.freeze({ projectId, sceneId, intent, operationId: id(), epoch,
        expected: expected ? Object.freeze({ provider: expected.provider, providerAssetId: String(expected.providerAssetId), kind: expected.kind }) : null });
      operations.add(context); return context;
    }
    function finish(context) { operations.delete(context); }
    function admit(context, descriptors) {
      if (!current(context)) throw failure("PROJECT_CHANGED");
      if (!Array.isArray(descriptors) || !descriptors.length) throw failure("PROJECT_MEDIA_INVALID");
      const expected = context.expected;
      for (const a of descriptors) {
        if (!a || !model.KINDS.includes(a.kind) || a.status !== "ready" || a.fileState !== "available" || !a.localPath ||
            expected && (a.origin !== "stock" || a.provider !== expected.provider || String(a.providerAssetId) !== expected.providerAssetId || a.kind !== expected.kind)) throw failure("PROJECT_MEDIA_INVALID");
      }
      // Only canonical fields survive normalization. Provider previews/tickets
      // remain in discovery; production always resolves a verified local AssetRef.
      const result = persistence.addProjectMediaAssets(descriptors.map(a => ({ ...a, previewUrl: null, remoteUrl: null })), { projectId: context.projectId });
      const enrolled = [], errors = [];
      if (context.intent !== "project") for (const asset of new Map(result.assets.map(a => [a.id, a])).values()) {
        if (!["video", "image"].includes(asset.kind)) continue;
        try {
          if (!current(context)) throw failure("PROJECT_CHANGED");
          const snapshot = persistence.addSceneMaterialCandidate(context.sceneId, asset.id, { projectId: context.projectId, selectIfEmpty: false });
          const slot = snapshot.mediaAssembly.slots.find(s => s.sceneId === context.sceneId && s.role === "primary");
          if (!slot?.candidateAssetIds.includes(asset.id)) throw failure("PROJECT_CANDIDATE_LIMIT");
          if (context.intent === "use") persistence.selectSceneMaterial(context.sceneId, asset.id, { projectId: context.projectId });
          enrolled.push(asset.id);
        } catch (error) { errors.push({ assetId: asset.id, code: error.code || error.message }); }
      }
      return { ...result, enrolled, errors, status: errors.length ? "scene-failed" : context.intent !== "project" && !enrolled.length ? "library-only" : result.added.length ? "added" : "duplicate" };
    }
    async function importLocal(options = {}) {
      if (importing) return { status: "busy" };
      const context = begin(options); importing = true;
      notify({ ...context, status: "importing" });
      try {
        const payload = await selectLocal();
        if (!current(context)) throw failure("PROJECT_CHANGED");
        if (!payload?.ok) throw failure(payload?.error?.code || "MEDIA_FILE_UNAVAILABLE");
        if (payload.canceled) { notify({ ...context, status: "cancelled" }); return { status: "cancelled" }; }
        if (!payload.assets?.length) throw failure(payload.errors?.[0]?.code || "PROJECT_MEDIA_INVALID");
        const result = admit(context, payload.assets);
        if (payload.errors?.length) result.status = "partial-import";
        notify({ ...context, status: result.status }); return result;
      } catch (error) {
        const code = error.code || error.message;
        notify({ ...context, status: "failed", code }); return { status: "failed", code };
      } finally { finish(context); importing = false; notify({ ...context, status: "idle" }); }
    }
    return { begin, current, admit, finish, importLocal, importing: () => importing,
      invalidate() { epoch++; operations.clear(); } };
  }
  return { create };
});
