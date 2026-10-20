(function installProjectScenePlanSnapshotExtension(root, factory) {
  const base = root?.ViralCoreProjectSnapshot || (typeof module !== "undefined" && module.exports ? require("./core-project-snapshot") : null);
  const sceneModel = root?.ViralCoreScenePlanModel || (typeof module !== "undefined" && module.exports ? require("./core-scene-plan-model") : null);
  const api = factory(base, sceneModel);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && api) root.ViralCoreProjectSnapshot = api;
})(typeof window !== "undefined" ? window : globalThis, function createProjectScenePlanSnapshotExtension(base, sceneModel) {
  "use strict";

  if (!base || !sceneModel?.normalizePlan) return base;

  const CURRENT_SCHEMA_VERSION = 4;

  function clone(value, fallback = null) {
    return base.clone ? base.clone(value, fallback) : JSON.parse(JSON.stringify(value ?? fallback));
  }

  function emptyScenePlan() {
    return sceneModel.normalizePlan({});
  }

  function shouldRestartScenePlan(options = {}) {
    return options.restartSafeScenePlan === true || options.restartSafeMedia === true;
  }

  function scenePlanFromState(state, options = {}) {
    return sceneModel.normalizePlan(state?.scenePlan || {}, {
      restartSafe: shouldRestartScenePlan(options)
    });
  }

  function baseCompatible(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return snapshot;
    const copy = clone(snapshot, {});
    delete copy.scenePlan;
    if (Number(copy.schemaVersion || 0) === 3) copy.schemaVersion = 2;
    return copy;
  }

  function sceneRestartChanged(input, normalized, options) {
    if (!shouldRestartScenePlan(options)) return false;
    return String(input?.scenePlan?.plannerJob?.status || "idle") !== String(normalized?.scenePlan?.plannerJob?.status || "idle");
  }

  function normalizeV4(input, options = {}) {
    const normalizedBase = base.migrateSnapshot(baseCompatible(input), {
      restartSafeMedia: options.restartSafeMedia === true
    }).snapshot;
    if (!normalizedBase) return null;
    return {
      ...normalizedBase,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenePlan: sceneModel.normalizePlan(input?.scenePlan || {}, {
        restartSafe: shouldRestartScenePlan(options)
      })
    };
  }

  function migrateSnapshot(input, options = {}) {
    if (!input || typeof input !== "object") return { snapshot: null, migrated: false, unsupportedVersion: null };
    const version = Number(input.schemaVersion || 0);
    if (version > CURRENT_SCHEMA_VERSION) {
      return { snapshot: null, migrated: false, unsupportedVersion: version };
    }

    if (version === CURRENT_SCHEMA_VERSION) {
      const snapshot = normalizeV4(input, options);
      const migrated = Boolean(
        snapshot && (
          !input.scenePlan ||
          Number(input.scenePlan?.schemaVersion || 0) !== sceneModel.SCENE_PLAN_SCHEMA_VERSION ||
          sceneRestartChanged(input, snapshot, options) ||
          base.migrateSnapshot(baseCompatible(input), { restartSafeMedia: options.restartSafeMedia === true }).migrated
        )
      );
      return { snapshot, migrated, unsupportedVersion: null };
    }

    const migratedBase = base.migrateSnapshot(baseCompatible(input), {
      restartSafeMedia: options.restartSafeMedia === true
    });
    if (!migratedBase.snapshot) {
      return { snapshot: null, migrated: migratedBase.migrated, unsupportedVersion: migratedBase.unsupportedVersion };
    }
    return {
      snapshot: {
        ...migratedBase.snapshot,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        scenePlan: sceneModel.normalizePlan(input.scenePlan || {}, {
          restartSafe: shouldRestartScenePlan(options)
        })
      },
      migrated: true,
      unsupportedVersion: null
    };
  }

  function fromLegacy(legacyState, legacyUi = {}, now = Date.now()) {
    const snapshot = base.fromLegacy(legacyState, legacyUi, now);
    if (!snapshot) return null;
    return {
      ...snapshot,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenePlan: scenePlanFromState(legacyState, { restartSafeScenePlan: true })
    };
  }

  function buildSnapshot(appState, editorState = {}, previous = null, now = Date.now()) {
    const previousV4 = migrateSnapshot(previous).snapshot;
    const basePrevious = previousV4 ? baseCompatible(previousV4) : baseCompatible(previous);
    const snapshot = base.buildSnapshot(appState, editorState, basePrevious, now);
    if (!snapshot) return null;
    return {
      ...snapshot,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenePlan: scenePlanFromState(appState)
    };
  }

  function toLegacyState(snapshot, existing = {}) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return clone(existing, {});
    const projected = base.toLegacyState(baseCompatible(migrated), existing);
    return {
      ...projected,
      scenePlan: clone(migrated.scenePlan, emptyScenePlan())
    };
  }

  function legacyUiProjection(snapshot) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    return migrated ? base.legacyUiProjection(baseCompatible(migrated)) : {};
  }

  function semanticSignature(snapshot) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return "";
    const stable = clone(migrated, {});
    stable.updatedAt = null;
    return JSON.stringify(stable);
  }

  return {
    ...base,
    CURRENT_SCHEMA_VERSION,
    emptyScenePlan,
    scenePlanFromState,
    migrateSnapshot,
    fromLegacy,
    buildSnapshot,
    toLegacyState,
    legacyUiProjection,
    semanticSignature
  };
});
