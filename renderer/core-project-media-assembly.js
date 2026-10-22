(function installProjectMediaAssembly(root, factory) {
  const common = typeof module !== "undefined" && module.exports;
  const base = common ? require("./core-project-scene-plan") : root?.ViralCoreProjectSnapshot;
  const assembly = common ? require("./core-media-assembly-model") : root?.ViralCoreMediaAssemblyModel;
  const api = factory(base, assembly);
  if (common) module.exports = api;
  if (root && api) root.ViralCoreProjectSnapshot = api;
})(typeof window !== "undefined" ? window : globalThis, function createProjectMediaAssembly(base, assembly) {
  "use strict";
  if (!base || !assembly) return base;
  const CURRENT_SCHEMA_VERSION = 5;
  const context = snapshot => ({ scenes: snapshot.scenePlan?.scenes || [], assets: snapshot.media?.assets || [] });
  function compatible(snapshot) {
    if (!snapshot) return snapshot;
    const copy = base.clone(snapshot);
    delete copy.mediaAssembly;
    if (copy.schemaVersion === CURRENT_SCHEMA_VERSION) copy.schemaVersion = 4;
    return copy;
  }
  function extend(snapshot, input, backfill = false) {
    if (!snapshot) return null;
    const options = context(snapshot);
    let mediaAssembly = assembly.normalizeAssembly(input, options);
    if (backfill) for (const mapping of snapshot.workflow.generationOutputs || []) {
      mediaAssembly = assembly.addCandidate(mediaAssembly, mapping.sceneId, mapping.assetId,
        { ...options, selectIfEmpty: true, selectionSource: "auto", now: snapshot.updatedAt });
    }
    return { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION, mediaAssembly };
  }
  function migrateSnapshot(input, options = {}) {
    if (!input || typeof input !== "object") return { snapshot: null, migrated: false, unsupportedVersion: null };
    const version = Number(input.schemaVersion || 0);
    if (version > CURRENT_SCHEMA_VERSION) return { snapshot: null, migrated: false, unsupportedVersion: version };
    const result = base.migrateSnapshot(compatible(input), options);
    if (!result.snapshot) return result;
    const snapshot = extend(result.snapshot, input.mediaAssembly, version < CURRENT_SCHEMA_VERSION);
    return { snapshot, migrated: result.migrated || version < CURRENT_SCHEMA_VERSION ||
      JSON.stringify(input.mediaAssembly) !== JSON.stringify(snapshot.mediaAssembly), unsupportedVersion: null };
  }
  function fromLegacy(state, ui = {}, now = Date.now()) {
    return extend(base.fromLegacy(state, ui, now), state?.mediaAssembly, !state?.mediaAssembly);
  }
  function buildSnapshot(state, editor = {}, previous = null, now = Date.now()) {
    const migration = migrateSnapshot(previous);
    if (migration.unsupportedVersion) return null;
    const prior = migration.snapshot;
    const snapshot = base.buildSnapshot(state, editor, compatible(prior), now);
    // Carry retained assembly only when the snapshot still has the same Project identity.
    const sameProject = !prior || snapshot?.projectId === prior.projectId;
    return extend(snapshot, sameProject ? state?.mediaAssembly ?? prior?.mediaAssembly : null);
  }
  function createDraftProject(identity, state = {}, editor = {}, now = Date.now()) {
    const draft = base.createDraftProject(identity, state, editor, now);
    return draft ? extend({ ...draft, scenePlan: base.emptyScenePlan() }, null) : null;
  }
  function toLegacyState(input, existing = {}) {
    const snapshot = migrateSnapshot(input).snapshot;
    return snapshot ? { ...base.toLegacyState(compatible(snapshot), existing), mediaAssembly: base.clone(snapshot.mediaAssembly) } : base.clone(existing, {});
  }
  function legacyUiProjection(input) {
    const snapshot = migrateSnapshot(input).snapshot;
    return snapshot ? base.legacyUiProjection(compatible(snapshot)) : {};
  }
  function semanticSignature(input) {
    const snapshot = migrateSnapshot(input).snapshot;
    return snapshot ? JSON.stringify({ ...snapshot, updatedAt: null }) : "";
  }
  function attachGeneratedOutput(snapshot, job, output, meta) {
    const next = base.attachGeneratedOutput(snapshot, job, output, meta);
    const assetId = next.workflow.generationOutputs.find(entry => entry.jobId === job.id)?.assetId;
    // A duplicate attachment replay cannot undo an intentional cleared selection.
    const mediaAssembly = assembly.addCandidate(next.mediaAssembly, job.sceneId, assetId,
      { ...context(next), selectIfEmpty: true, selectionSource: "auto", now: next.updatedAt });
    return { ...next, schemaVersion: CURRENT_SCHEMA_VERSION, mediaAssembly };
  }
  return { ...base, CURRENT_SCHEMA_VERSION, mediaAssemblyModel: assembly, migrateSnapshot, fromLegacy, buildSnapshot,
    createDraftProject, toLegacyState, legacyUiProjection, semanticSignature, attachGeneratedOutput };
});
