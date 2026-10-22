(function installCoreProjectPersistence() {
  "use strict";

  const model = window.ViralCoreProjectSnapshot;
  if (!model) return;

  const {
    SNAPSHOT_KEY,
    LEGACY_STATE_KEY,
    LEGACY_UI_KEYS
  } = model;
  const LEGACY_TRANSCRIPT_EDIT_KEY = "viral-ai-core-transcript-edits-v1";
  const DEBOUNCE_MS = 320;
  const REGISTRY_KEY = "viral-ai-core-project-registry-v1";
  const REGISTRY_SCHEMA_VERSION = 1;
  const BRIEF_KEY = "viral-ai-generation-brief";
  let registry = { schemaVersion: REGISTRY_SCHEMA_VERSION, activeProjectId: null, projects: [] };
  let registryError = null;
  let projectTransition = false;
  const projectionOverrides = new Map();
  const observedLegacyKeys = new Set([LEGACY_STATE_KEY, BRIEF_KEY, ...Object.values(LEGACY_UI_KEYS)]);
  const storagePrototype = Storage.prototype;
  const nativeGetItem = storagePrototype.getItem;
  const nativeSetItem = storagePrototype.setItem;
  const nativeRemoveItem = storagePrototype.removeItem;
  const restoredVideos = new WeakSet();
  const wiredVideos = new WeakSet();
  const restoredScrollSurfaces = new WeakMap();
  let currentSnapshot = null;
  let saveTimer = 0;
  let restoreQueued = false;
  let suppressStorageObservation = false;
  let unsupportedSchemaVersion = null;

  function readJson(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeNative(key, value) {
    suppressStorageObservation = true;
    try {
      nativeSetItem.call(localStorage, key, String(value));
    } finally {
      suppressStorageObservation = false;
    }
  }

  function removeNative(key) {
    suppressStorageObservation = true;
    try {
      nativeRemoveItem.call(localStorage, key);
    } finally {
      suppressStorageObservation = false;
    }
  }

  function dispatchSaveFailure(reason, error) {
    try {
      window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-save-failed", {
        detail: { reason, message: String(error?.message || error || "storage-write-failed") }
      }));
    } catch {}
  }

  function assertWritable() {
    if (unsupportedSchemaVersion || registryError) throw Error("PROJECT_STORAGE_PROTECTED");
  }

  // One atomic localStorage record owns snapshots AND selection. Mirrors never
  // decide which project is active and cannot replace a newer registry on boot.
  function writeRegistry(next) {
    assertWritable();
    writeNative(REGISTRY_KEY, JSON.stringify(next));
    registry = next;
  }

  function saveSnapshot(snapshot) {
    const projects = registry.projects.filter(p => p.projectId !== snapshot.projectId);
    projects.push(snapshot);
    writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, activeProjectId: snapshot.projectId, projects });
  }

  function writeBootstrapSnapshot(snapshot, reason) {
    try {
      saveSnapshot(snapshot);
      writeNative(SNAPSHOT_KEY, JSON.stringify(snapshot));
      return true;
    } catch (error) {
      dispatchSaveFailure(reason, error);
      return false;
    }
  }

  function legacyUiState() {
    const read = key => localStorage.getItem(key);
    return {
      leftCollapsed: read(LEGACY_UI_KEYS.leftCollapsed),
      rightCollapsed: read(LEGACY_UI_KEYS.rightCollapsed),
      assetsCollapsed: read(LEGACY_UI_KEYS.assetsCollapsed),
      inspectorTab: read(LEGACY_UI_KEYS.inspectorTab),
      bottomTab: read(LEGACY_UI_KEYS.bottomTab),
      bottomHeight: read(LEGACY_UI_KEYS.bottomHeight),
      bottomCollapsed: read(LEGACY_UI_KEYS.bottomCollapsed),
      timelineZoom: read(LEGACY_UI_KEYS.timelineZoom),
      timelineSelection: read(LEGACY_UI_KEYS.timelineSelection),
      timelineScrollLeft: 0
    };
  }

  function compatibilityValues(snapshot) {
    const existing = readJson(LEGACY_STATE_KEY, {}) || {};
    return {
      [SNAPSHOT_KEY]: JSON.stringify(snapshot),
      [LEGACY_STATE_KEY]: JSON.stringify(model.toLegacyState(snapshot, existing)),
      [BRIEF_KEY]: snapshot.workflow.generationBrief || "",
      ...model.legacyUiProjection(snapshot)
    };
  }

  function projectLegacyProjection(snapshot, values = compatibilityValues(snapshot)) {
    // Projection failures cannot undo an authoritative commit. Reads in this
    // renderer still see the selected project's values; restart repairs mirrors.
    for (const [key, value] of Object.entries(values)) {
      projectionOverrides.set(key, value);
      try { writeNative(key, value); projectionOverrides.delete(key); }
      catch (error) { dispatchSaveFailure("project-compatibility-mirror", error); }
    }
  }

  function bootstrapSnapshot() {
    const storedRegistry = nativeGetItem.call(localStorage, REGISTRY_KEY);
    if (storedRegistry !== null) {
      try {
        const input = JSON.parse(storedRegistry);
        if (input?.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(input.projects)) throw Error("PROJECT_REGISTRY_UNSUPPORTED");
        const ids = new Set();
        const projects = input.projects.map(entry => {
          const result = model.migrateSnapshot(entry, { restartSafeMedia: true });
          if (result.unsupportedVersion) unsupportedSchemaVersion = result.unsupportedVersion;
          if (!result.snapshot || ids.has(result.snapshot.projectId)) throw Error("PROJECT_REGISTRY_INVALID");
          ids.add(result.snapshot.projectId);
          return result.snapshot;
        });
        if (input.activeProjectId !== null && !ids.has(input.activeProjectId) || projects.length && input.activeProjectId === null) throw Error("PROJECT_REGISTRY_INVALID");
        registry = { schemaVersion: REGISTRY_SCHEMA_VERSION, activeProjectId: input.activeProjectId, projects };
        currentSnapshot = projects.find(p => p.projectId === registry.activeProjectId) || null;
        if (currentSnapshot && JSON.stringify(input) !== JSON.stringify(registry)) writeBootstrapSnapshot(currentSnapshot, "bootstrap-schema-backfill");
      } catch (error) {
        registryError = error.message || "PROJECT_REGISTRY_INVALID";
        dispatchSaveFailure("bootstrap-project-registry", error);
        return;
      }
    } else {
      const raw = readJson(SNAPSHOT_KEY, null);
      const migrated = model.migrateSnapshot(raw, { restartSafeMedia: true });
      unsupportedSchemaVersion = migrated.unsupportedVersion;
      if (unsupportedSchemaVersion) return;
      currentSnapshot = migrated.snapshot;
      if (currentSnapshot) currentSnapshot.workflow.generationBrief = nativeGetItem.call(localStorage, BRIEF_KEY) ?? currentSnapshot.workflow.generationBrief;
      if (!currentSnapshot) {
        currentSnapshot = model.fromLegacy(readJson(LEGACY_STATE_KEY, {}) || {}, legacyUiState());
        if (currentSnapshot) writeBootstrapSnapshot(currentSnapshot, "bootstrap-legacy-migration");
      } else {
        writeBootstrapSnapshot(currentSnapshot, "bootstrap-schema-backfill");
      }
    }

    if (currentSnapshot) {
      try {
        projectLegacyProjection(currentSnapshot);
      } catch (error) {
        dispatchSaveFailure("bootstrap-legacy-projection", error);
      }
      try { nativeRemoveItem.call(localStorage, LEGACY_TRANSCRIPT_EDIT_KEY); } catch {}
    }
  }

  bootstrapSnapshot();

  function appState() {
    try {
      return typeof state !== "undefined" && state ? state : null;
    } catch {
      return null;
    }
  }

  function latestSourcePath(current) {
    return model.latestSourceJob(current)?.sourcePath || current?.speech?.result?.sourcePath || null;
  }

  function currentVideo() {
    const video = document.querySelector("#page .core-editor-focus-section video.preview-video, #page .core-editor-focus-section video.core-player-media, #page video.preview-video, #page video.core-player-media");
    return video instanceof HTMLVideoElement && video.isConnected ? video : null;
  }

  function currentTimelineScroll() {
    const node = document.querySelector("#page [data-timeline-scroll]");
    return node instanceof HTMLElement ? node : null;
  }

  function storedSelectionValue() {
    const raw = localStorage.getItem(LEGACY_UI_KEYS.timelineSelection);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof parsed.selection === "string") return parsed.selection;
    } catch {}
    return raw;
  }

  function currentTimelineSelection() {
    const dock = document.querySelector("#page .core-editor-bottom-dock");
    if (dock instanceof HTMLElement && dock.dataset.timelineSelection) return dock.dataset.timelineSelection;
    return storedSelectionValue() || currentSnapshot?.editor?.timeline?.selection || "none";
  }

  function playbackState(current) {
    const sourcePath = latestSourcePath(current);
    const previous = currentSnapshot?.editor?.playback || {};
    const sameSource = Boolean(sourcePath && previous.sourcePath && String(sourcePath) === String(previous.sourcePath));
    let position = sameSource ? Number(previous.position || 0) : 0;
    const video = currentVideo();
    if (video) {
      const livePosition = Math.max(0, Number(video.currentTime || 0));
      if (!sameSource || restoredVideos.has(video) || livePosition > 0.05 || position <= 0.05) position = livePosition;
    }
    return { position, sourcePath: sourcePath ? String(sourcePath) : null };
  }

  function editorState(current) {
    const previous = currentSnapshot?.editor || {};
    const scroll = currentTimelineScroll();
    return {
      page: String(current?.page || previous.page || "ai-video"),
      playback: playbackState(current),
      timeline: {
        tab: localStorage.getItem(LEGACY_UI_KEYS.bottomTab) || previous.timeline?.tab,
        height: localStorage.getItem(LEGACY_UI_KEYS.bottomHeight) || previous.timeline?.height,
        collapsed: localStorage.getItem(LEGACY_UI_KEYS.bottomCollapsed) ?? previous.timeline?.collapsed,
        zoom: localStorage.getItem(LEGACY_UI_KEYS.timelineZoom) || previous.timeline?.zoom,
        scrollLeft: scroll ? scroll.scrollLeft : previous.timeline?.scrollLeft,
        selection: currentTimelineSelection()
      },
      panels: {
        leftCollapsed: localStorage.getItem(LEGACY_UI_KEYS.leftCollapsed) ?? previous.panels?.leftCollapsed,
        rightCollapsed: localStorage.getItem(LEGACY_UI_KEYS.rightCollapsed) ?? previous.panels?.rightCollapsed,
        assetsCollapsed: localStorage.getItem(LEGACY_UI_KEYS.assetsCollapsed) ?? previous.panels?.assetsCollapsed,
        inspectorTab: localStorage.getItem(LEGACY_UI_KEYS.inspectorTab) || previous.panels?.inspectorTab
      }
    };
  }

  function hydrateRetainedState() {
    const current = appState();
    if (!current || !currentSnapshot) return;
    if (!Array.isArray(current.generationOutputs)) {
      current.generationOutputs = model.clone(currentSnapshot.workflow.generationOutputs, []);
    }
    if (!current.scenePlan && currentSnapshot.scenePlan) {
      current.scenePlan = model.clone(currentSnapshot.scenePlan);
    }
    if (!current.mediaAssembly && currentSnapshot.mediaAssembly) {
      current.mediaAssembly = model.clone(currentSnapshot.mediaAssembly);
    }
    if (!current.media && currentSnapshot.media) {
      current.media = model.clone(currentSnapshot.media, { schemaVersion: 1, assets: [], selectedAssetId: null });
    }
    ["translation", "voice"].forEach(section => {
      const persisted = currentSnapshot.workflow?.[section];
      const live = current?.[section];
      if (!persisted || !live) return;
      if (persisted.staleJob && !live.staleJob) live.staleJob = model.clone(persisted.staleJob, null);
      if (persisted.staleResult && !live.staleResult) live.staleResult = model.clone(persisted.staleResult, null);
    });
  }

  function flush(reason = "semantic-change") {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    if (unsupportedSchemaVersion || registryError || projectTransition) return null;
    const current = appState();
    if (!current) return null;
    hydrateRetainedState();
    const next = model.buildSnapshot(current, editorState(current), currentSnapshot);
    if (!next) return null;
    next.workflow.generationBrief = localStorage.getItem(BRIEF_KEY) || "";
    if (model.semanticSignature(next) === model.semanticSignature(currentSnapshot) && registry.activeProjectId === next.projectId) return currentSnapshot;
    try {
      saveSnapshot(next);
    } catch (error) {
      dispatchSaveFailure(reason, error);
      return null;
    }
    currentSnapshot = next;
    if (next.mediaAssembly) current.mediaAssembly = model.clone(next.mediaAssembly);
    projectLegacyProjection(next);
    window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-saved", {
      detail: { reason, schemaVersion: next.schemaVersion, projectId: next.projectId }
    }));
    return next;
  }

  // Synchronous durable write is the admission boundary; rerenders never create projects.
  function ensureProject({ projectName } = {}) {
    assertWritable();
    if (projectTransition) throw Error("PROJECT_TRANSITION_PENDING");
    const current = appState();
    if (!current) throw Error("PROJECT_STATE_UNAVAILABLE");
    hydrateRetainedState();
    let next = model.buildSnapshot(current, editorState(current), currentSnapshot);
    if (!next) {
      const projectId = window.crypto?.randomUUID?.();
      if (!projectId) throw Error("PROJECT_ID_UNAVAILABLE");
      next = model.createDraftProject({ projectId, projectName }, current, editorState(current));
    }
    if (!next) throw Error("PROJECT_INVALID");
    const sceneModel = window.ViralCoreScenePlanModel;
    if (!sceneModel) throw Error("PROJECT_SCENE_UNAVAILABLE");
    let plan = sceneModel.normalizePlan(next.scenePlan || current.scenePlan || {});
    if (!plan.scenes.length) {
      const id = window.crypto?.randomUUID?.();
      if (!id) throw Error("SCENE_ID_UNAVAILABLE");
      plan = sceneModel.normalizePlan({ ...plan, scenes: [{ id, status: "draft" }], selectedSceneId: id });
    }
    if (!plan.scenes.some(scene => scene.id === plan.selectedSceneId)) plan.selectedSceneId = plan.scenes[0].id;
    next = { ...next, scenePlan: plan };
    try {
      next.workflow.generationBrief = localStorage.getItem(BRIEF_KEY) || "";
      saveSnapshot(next);
    } catch (error) {
      dispatchSaveFailure("ensure-project", error);
      throw error;
    }
    currentSnapshot = next;
    projectLegacyProjection(next);
    current.scenePlan = model.clone(plan);
    if (next.mediaAssembly) current.mediaAssembly = model.clone(next.mediaAssembly);
    if (!current.media) current.media = model.clone(next.media);
    window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-saved", {
      detail: { reason: "ensure-project", schemaVersion: next.schemaVersion, projectId: next.projectId }
    }));
    return model.clone(next);
  }

  function listProjects() {
    return registry.projects.map(p => ({ projectId: p.projectId, projectName: p.projectName,
      projectKind: p.projectKind, updatedAt: p.updatedAt, hasSource: !!p.source }));
  }

  // Registry writes target an explicit project and never change selection.
  // Build first, commit atomically, then project the committed active state.
  function reportGeneratedAttachment(jobId, outcome) {
    try {
      const pending = window.desktopAPI?.reportGenerationAttachment?.({jobId, outcome, reportId: crypto.randomUUID()});
      pending?.catch?.(() => {});
    } catch {}
  }

  function updateProjectMedia(projectId, update, attachmentJobId) {
    assertWritable();
    if (projectTransition) throw Error("PROJECT_TRANSITION_PENDING");
    const active = registry.activeProjectId === projectId;
    if (active && !flush("before-generated-media")) throw Error("PROJECT_SAVE_FAILED");
    const stored = registry.projects.find(item => item.projectId === projectId);
    if (!stored) throw Error("PROJECT_NOT_FOUND");
    const next = update(model.clone(stored));
    if (JSON.stringify(next) === JSON.stringify(stored)) return model.clone(stored);
    try {
      writeRegistry({ ...registry, projects: registry.projects.map(item => item.projectId === projectId ? next : item) });
    } catch (error) {
      if (attachmentJobId) reportGeneratedAttachment(attachmentJobId, "failure");
      dispatchSaveFailure("generated-media", error);
      throw error;
    }
    if (attachmentJobId) reportGeneratedAttachment(attachmentJobId, "success");
    if (active) {
      currentSnapshot = next;
      const current = appState();
      const jobs = current.jobs || [];
      current.jobs = next.workflow.jobs.map(job => jobs.find(existing => existing.id === job.id) || model.clone(job));
      current.media = model.clone(next.media);
      if (next.mediaAssembly) current.mediaAssembly = model.clone(next.mediaAssembly);
      current.generationOutputs = model.clone(next.workflow.generationOutputs);
      projectLegacyProjection(next);
      presentProject("generated-media", () => window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
        detail: { reason: "generated-media", projectId }
      })));
    }
    return model.clone(next);
  }

  function registerGenerationJob(job) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(job?.id || "") || job.kind !== "video") throw Error("PROJECT_GENERATION_INVALID");
    return updateProjectMedia(job.projectId, snapshot => {
      if (job.sceneId && !snapshot.scenePlan?.scenes?.some(scene => scene.id === job.sceneId)) throw Error("PROJECT_SCENE_NOT_FOUND");
      const entries = snapshot.workflow.generationOutputs || [];
      const existing = entries.find(item => item.jobId === job.id);
      if (existing && existing.sceneId !== job.sceneId) throw Error("PROJECT_GENERATION_MISMATCH");
      if (!existing) snapshot.workflow.generationOutputs = [...entries, { jobId: job.id, sceneId: job.sceneId, assetId: null }];
      return snapshot;
    });
  }

  function generationOutputJobs() {
    return registry.projects.flatMap(project => (project.workflow.generationOutputs || []).map(entry => ({ ...entry, projectId: project.projectId })));
  }

  function attachGeneratedOutput(job, output, meta) {
    return updateProjectMedia(job.projectId, snapshot => model.attachGeneratedOutput(snapshot, job, output, meta), job.id);
  }

  // Scene materials share the registry's synchronous commit boundary. Selection
  // changes only assembly; it never selects a library asset or rebinds a player.
  function mutateSceneMaterial(operation, sceneId, assetId, options = {}) {
    assertWritable();
    if (projectTransition) throw Error("PROJECT_TRANSITION_PENDING");
    const current = appState(), projectId = registry.activeProjectId;
    if (!current || !projectId || currentSnapshot?.projectId !== projectId ||
        current.projectId && current.projectId !== projectId) throw Error("PROJECT_STATE_UNAVAILABLE");
    if (options.projectId && options.projectId !== projectId) throw Error("PROJECT_MISMATCH");
    const next = model.migrateSnapshot({ ...currentSnapshot,
      scenePlan: current.scenePlan ?? currentSnapshot.scenePlan, media: current.media ?? currentSnapshot.media,
      mediaAssembly: current.mediaAssembly ?? currentSnapshot.mediaAssembly }).snapshot;
    if (!next || next.projectId !== projectId || !model.mediaAssemblyModel) throw Error("PROJECT_STATE_UNAVAILABLE");
    const scenes = next.scenePlan.scenes, assets = next.media.assets;
    if (!scenes.some(scene => scene.id === sceneId)) throw Error("PROJECT_SCENE_NOT_FOUND");
    if (operation !== "clearSelection" && !assets.some(asset => asset.id === assetId && ["video", "image"].includes(asset.kind))) throw Error("PROJECT_ASSET_NOT_FOUND");
    if (operation === "selectCandidate" && !model.mediaAssemblyModel.sceneSlot(next.mediaAssembly, sceneId)?.candidateAssetIds.includes(assetId)) throw Error("PROJECT_MATERIAL_NOT_FOUND");
    const descriptor = Object.getOwnPropertyDescriptor(current, "mediaAssembly");
    if (descriptor ? !("value" in descriptor) || !descriptor.writable : !Object.isExtensible(current)) throw Error("PROJECT_STATE_UNAVAILABLE");
    next.mediaAssembly = model.mediaAssemblyModel[operation](next.mediaAssembly, sceneId,
      ...(operation === "clearSelection" ? [] : [assetId]),
      { scenes, assets, now: Date.now(), selectionSource: "manual", selectIfEmpty: options.selectIfEmpty === true });
    // Pure no-ops (including capacity and duplicate adds) need no write or event.
    if (model.semanticSignature(next) === model.semanticSignature(currentSnapshot)) return model.clone(currentSnapshot);
    next.updatedAt = new Date().toISOString();
    try { saveSnapshot(next); }
    catch (error) { dispatchSaveFailure("scene-material", error); throw error; }
    currentSnapshot = next;
    current.mediaAssembly = model.clone(next.mediaAssembly);
    projectLegacyProjection(next);
    presentProject("scene-material", () => window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "scene-material", projectId, sceneId }
    })));
    return model.clone(next);
  }

  function addSceneMaterialCandidate(sceneId, assetId, options = {}) {
    return mutateSceneMaterial("addCandidate", sceneId, assetId, options);
  }
  function selectSceneMaterial(sceneId, assetId, options = {}) {
    return mutateSceneMaterial("selectCandidate", sceneId, assetId, options);
  }
  function removeSceneMaterialCandidate(sceneId, assetId, options = {}) {
    return mutateSceneMaterial("removeCandidate", sceneId, assetId, options);
  }
  function clearSceneMaterialSelection(sceneId, options = {}) {
    return mutateSceneMaterial("clearSelection", sceneId, null, options);
  }

  // Capture pending non-Scene state through the normal snapshot path, retaining
  // committed Scene authority. Publish only after one atomic registry write.
  function mutateProjectScene(operation, sceneId, value, options = {}) {
    assertWritable();
    if (projectTransition) throw Error("PROJECT_TRANSITION_PENDING");
    const projectId = options.projectId;
    if (!projectId || projectId !== registry.activeProjectId) throw Error("PROJECT_MISMATCH");
    const current = appState(), sceneModel = window.ViralCoreScenePlanModel;
    if (!current || currentSnapshot?.projectId !== projectId || current.projectId && current.projectId !== projectId ||
        !sceneModel || !model.mediaAssemblyModel) throw Error("PROJECT_STATE_UNAVAILABLE");
    for (const key of ["scenePlan", "mediaAssembly"]) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor ? !("value" in descriptor) || !descriptor.writable : !Object.isExtensible(current)) throw Error("PROJECT_STATE_UNAVAILABLE");
    }
    const captured = { ...current,
      scenePlan: model.clone(currentSnapshot.scenePlan),
      mediaAssembly: model.clone(currentSnapshot.mediaAssembly) };
    const next = model.buildSnapshot(captured, editorState(current), currentSnapshot);
    if (!next || next.projectId !== projectId) throw Error("PROJECT_STATE_UNAVAILABLE");
    next.workflow.generationBrief = localStorage.getItem(BRIEF_KEY) || "";
    const plan = next.scenePlan;
    if (sceneModel.ACTIVE_PLANNER_STATES.has(plan.plannerJob.status)) throw Error("PROJECT_SCENE_BUSY");
    if (operation !== "addScene" && !plan.scenes.some(scene => scene.id === sceneId)) throw Error("PROJECT_SCENE_NOT_FOUND");
    if (operation === "removeScene" && plan.scenes.length <= 1) throw Error("PROJECT_FINAL_SCENE");
    const now = Date.now();
    if (operation === "addScene") {
      if (plan.scenes.length >= sceneModel.MAX_SCENES) throw Error("PROJECT_SCENE_LIMIT");
      const scene = { ...(value || {}) };
      if (!Object.prototype.hasOwnProperty.call(scene, "id")) scene.id = window.crypto?.randomUUID?.();
      if (typeof scene.id !== "string" || !scene.id.trim() || scene.id !== scene.id.trim() || scene.id.length > 512) throw Error("PROJECT_SCENE_ID_INVALID");
      if (plan.scenes.some(item => item.id === scene.id)) throw Error("PROJECT_SCENE_DUPLICATE");
      next.scenePlan = sceneModel.addScene(plan, scene, { ...options, now });
    } else if (operation === "moveScene") {
      if (!Number.isInteger(value) || value < 0 || value >= plan.scenes.length) throw Error("PROJECT_SCENE_INDEX_INVALID");
      next.scenePlan = sceneModel.moveScene(plan, sceneId, value, { now });
    } else next.scenePlan = sceneModel[operation](plan, sceneId, { now });
    next.mediaAssembly = model.mediaAssemblyModel.normalizeAssembly(next.mediaAssembly,
      { scenes: next.scenePlan.scenes, assets: next.media.assets });
    if (model.semanticSignature(next) === model.semanticSignature(currentSnapshot)) return model.clone(currentSnapshot);
    next.updatedAt = new Date(now).toISOString();
    const livePlan = model.clone(next.scenePlan), liveAssembly = model.clone(next.mediaAssembly);
    const projection = compatibilityValues(next);
    try { saveSnapshot(next); }
    catch (error) { dispatchSaveFailure("project-scene", error); throw error; }
    currentSnapshot = next;
    current.scenePlan = livePlan;
    current.mediaAssembly = liveAssembly;
    projectLegacyProjection(next, projection);
    presentProject("project-scene", () => window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "project-scene", projectId, sceneId: next.scenePlan.selectedSceneId }
    })));
    return model.clone(next);
  }

  function addProjectScene(scene = {}, options = {}) { return mutateProjectScene("addScene", null, scene, options); }
  function selectProjectScene(sceneId, options = {}) { return mutateProjectScene("selectScene", sceneId, null, options); }
  function removeProjectScene(sceneId, options = {}) { return mutateProjectScene("removeScene", sceneId, null, options); }
  function moveProjectScene(sceneId, targetIndex, options = {}) { return mutateProjectScene("moveScene", sceneId, targetIndex, options); }

  function assertSwitchSafe() {
    const current = appState();
    const workflows = [current?.speech?.job, current?.translation?.job, current?.voice?.job, current?.scenePlan?.plannerJob,
      ...(current?.jobs || []).filter(j => j.isRenderOutput)];
    const busy = new Set(["validating", "preparing", "uploading", "queued", "processing", "translating", "generating", "downloading", "rendering", "planning", "cancelling"]);
    if (workflows.some(job => busy.has(job?.status))) throw Error("PROJECT_WORK_RUNNING");
    // Scoped GenerationService/media jobs keep their own project identity.
    // Unscoped legacy workflows must finish before replacing their live state.
  }

  function prepareActivation(target, current) {
    const migrated = model.migrateSnapshot(target);
    const snapshot = migrated.snapshot;
    if (!snapshot || migrated.unsupportedVersion) throw Error("PROJECT_INVALID");
    const projected = model.toLegacyState(snapshot, {});
    const runtime = { projectId: snapshot.projectId, projectName: snapshot.projectName,
      page: snapshot.source ? "ai-video" : "ai-create" };
    for (const key of ["output", "renderOptions", "jobs", "media", "scenePlan", "mediaAssembly", "generationOutputs"]) runtime[key] = model.clone(projected[key]);
    // Prepare all project-owned state before the registry commit. Global provider
    // catalogs/configuration survive, while old jobs/results/assignments do not.
    for (const key of ["speech", "translation", "voice"]) {
      const global = current[key] || {};
      const { job, result, staleJob, staleResult, assignments, ...configuration } = global;
      runtime[key] = { ...configuration, ...model.clone(projected[key]), staleJob: projected[key].staleJob || null, staleResult: projected[key].staleResult || null };
    }
    // Runtime state is a normal mutable application object. Reject readonly or
    // accessor fields before committing so assignment cannot fail afterward.
    for (const key of Object.keys(runtime)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor ? !("value" in descriptor) || !descriptor.writable : !Object.isExtensible(current)) throw Error("PROJECT_STATE_UNAVAILABLE");
    }
    return { snapshot, current, runtime, mirrors: compatibilityValues(snapshot), result: model.clone(snapshot) };
  }

  function presentProject(stage, action) {
    try { action(); }
    catch {
      // Presentation errors are distinct from failed durable saves. Ownership
      // has already changed; never tell the caller the old project was retained.
      try {
        window.dispatchEvent(new CustomEvent("viral-ai:project-presentation-failed", {
          detail: { stage, projectId: currentSnapshot.projectId }
        }));
      } catch {}
    }
  }

  function activate(prepared) {
    const { snapshot, current, runtime, mirrors, result } = prepared;
    currentSnapshot = snapshot;
    Object.assign(current, runtime);
    // Durable selection, snapshot, and runtime agree before any fallible DOM,
    // rendering, compatibility mirror, or observer notification work begins.
    presentProject("pause", () => currentVideo()?.pause?.());
    presentProject("mirrors", () => projectLegacyProjection(snapshot, mirrors));
    presentProject("transcript-reset", () => removeNative(LEGACY_TRANSCRIPT_EDIT_KEY));
    presentProject("detach", () => document.getElementById?.("page")?.replaceChildren());
    presentProject("render", () => { if (typeof render === "function") render(); });
    presentProject("restore-event", () => window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-restored", {
      detail: { schemaVersion: snapshot.schemaVersion, projectId: snapshot.projectId }
    })));
    presentProject("state-event", () => window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", { detail: { reason: "project-switch" } })));
    presentProject("restore", queueRestore);
    return result;
  }

  function transition(makeTarget) {
    assertWritable();
    if (projectTransition) throw Error("PROJECT_TRANSITION_PENDING");
    assertSwitchSafe();
    const current = appState();
    if (!current) throw Error("PROJECT_STATE_UNAVAILABLE");
    const needsSave = !!currentSnapshot || !!model.sourceFromState(current);
    if (needsSave && !flush("before-project-switch")) throw Error("PROJECT_SAVE_FAILED");
    projectTransition = true;
    try {
      let prepared;
      try {
        prepared = prepareActivation(makeTarget(), current);
        saveSnapshot(prepared.snapshot); // Atomic durable ownership boundary.
      } catch (error) {
        dispatchSaveFailure("project-switch", error);
        throw error;
      }
      return activate(prepared);
    } finally { projectTransition = false; }
  }

  // A shared pending promise coalesces two clicks in the same event/render turn.
  let creatingProject = null;
  function createProject({ kind, projectName } = {}) {
    if (creatingProject) return creatingProject;
    creatingProject = Promise.resolve().then(() => {
      if (kind !== "ai") throw Error("PROJECT_KIND_UNSUPPORTED");
      return transition(() => {
        const projectId = window.crypto?.randomUUID?.();
        if (!projectId || registry.projects.some(p => p.projectId === projectId)) throw Error("PROJECT_ID_UNAVAILABLE");
        const draft = model.createDraftProject({ projectId, projectName }, {}, {});
        if (!draft) throw Error("PROJECT_INVALID");
        const sceneId = window.crypto?.randomUUID?.();
        if (!sceneId) throw Error("SCENE_ID_UNAVAILABLE");
        return { ...draft, scenePlan: window.ViralCoreScenePlanModel.normalizePlan({ sourceType: "script",
          scenes: [{ id: sceneId, sceneState: "draft" }], selectedSceneId: sceneId }) };
      });
    }).finally(() => { creatingProject = null; });
    return creatingProject;
  }

  function openProject(projectId) {
    assertWritable();
    if (registry.activeProjectId === projectId) return model.clone(currentSnapshot);
    const stored = registry.projects.find(p => p.projectId === projectId);
    if (!stored) throw Error("PROJECT_NOT_FOUND");
    return transition(() => model.migrateSnapshot(stored, { restartSafeMedia: true }).snapshot);
  }

  function schedule(reason = "semantic-change") {
    if (unsupportedSchemaVersion || registryError || projectTransition) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flush(reason), DEBOUNCE_MS);
  }

  storagePrototype.getItem = function patchedGetItem(key) {
    const normalizedKey = String(key);
    if (this === localStorage && projectionOverrides.has(normalizedKey)) return projectionOverrides.get(normalizedKey);
    if (this === localStorage && normalizedKey === LEGACY_TRANSCRIPT_EDIT_KEY && currentSnapshot) return null;
    return nativeGetItem.call(this, key);
  };

  storagePrototype.setItem = function patchedSetItem(key, value) {
    const normalizedKey = String(key);
    if (this === localStorage && normalizedKey === LEGACY_TRANSCRIPT_EDIT_KEY && currentSnapshot) return;
    nativeSetItem.call(this, key, value);
    if (this === localStorage) projectionOverrides.delete(normalizedKey);
    if (suppressStorageObservation || this !== localStorage) return;
    if (normalizedKey === SNAPSHOT_KEY || normalizedKey === REGISTRY_KEY) return;
    if (observedLegacyKeys.has(normalizedKey)) schedule("storage:" + normalizedKey);
  };

  storagePrototype.removeItem = function patchedRemoveItem(key) {
    nativeRemoveItem.call(this, key);
    if (suppressStorageObservation || this !== localStorage) return;
    const normalizedKey = String(key);
    if (observedLegacyKeys.has(normalizedKey)) schedule("storage-remove:" + normalizedKey);
  };

  function restorePlayback(video) {
    if (!(video instanceof HTMLVideoElement) || restoredVideos.has(video) || !video.isConnected || !currentSnapshot) return;
    const current = appState();
    const sourcePath = latestSourcePath(current);
    const persisted = currentSnapshot.editor?.playback;
    if (!sourcePath || !persisted?.sourcePath || String(sourcePath) !== String(persisted.sourcePath)) return;
    const target = Math.max(0, Number(persisted.position || 0));

    const apply = () => {
      if (!video.isConnected || currentVideo() !== video) return;
      if (Number(video.currentTime || 0) > 0.25 && target > 0.25) {
        restoredVideos.add(video);
        return;
      }
      const duration = Number(video.duration);
      const safeTarget = Number.isFinite(duration) && duration > 0
        ? Math.min(target, Math.max(0, duration - 0.001))
        : target;
      if (safeTarget > 0.01 && Math.abs(Number(video.currentTime || 0) - safeTarget) > 0.05) {
        try { video.currentTime = safeTarget; } catch {}
      }
      restoredVideos.add(video);
      window.dispatchEvent(new CustomEvent("viral-ai:project-playback-restored", {
        detail: { position: safeTarget, sourcePath: String(sourcePath) }
      }));
    };

    if ((Number.isFinite(Number(video.duration)) && Number(video.duration) > 0) || video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }

  function wireVideo(video) {
    if (!(video instanceof HTMLVideoElement) || wiredVideos.has(video)) return;
    wiredVideos.add(video);
    ["pause", "seeked", "ended"].forEach(name => video.addEventListener(name, () => schedule("playback:" + name)));
    video.addEventListener("loadedmetadata", () => restorePlayback(video));
  }

  function restoreScroll() {
    const scroll = currentTimelineScroll();
    if (!(scroll instanceof HTMLElement) || !currentSnapshot) return;
    const projectId = currentSnapshot.projectId;
    if (restoredScrollSurfaces.get(scroll) === projectId) return;
    const target = Math.max(0, Number(currentSnapshot.editor?.timeline?.scrollLeft || 0));
    requestAnimationFrame(() => {
      if (!scroll.isConnected) return;
      scroll.scrollLeft = target;
      restoredScrollSurfaces.set(scroll, projectId);
    });
  }

  function restoreRuntime() {
    restoreQueued = false;
    hydrateRetainedState();
    const video = currentVideo();
    if (video) {
      wireVideo(video);
      restorePlayback(video);
    }
    restoreScroll();
  }

  function queueRestore() {
    if (restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(restoreRuntime);
  }

  function startRuntime() {
    hydrateRetainedState();
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueRestore).observe(page, { childList: true, subtree: true });

    [
      "viral-ai:core-state-changed",
      "viral-ai:transcript-edit",
      "viral-ai:editor-segment-selected",
      "viral-ai:player-seek"
    ].forEach(name => window.addEventListener(name, () => schedule(name)));

    [
      "viral-ai:editor-preview-preserved",
      "viral-ai:transcript-workstation-ready"
    ].forEach(name => window.addEventListener(name, queueRestore));

    document.addEventListener("scroll", event => {
      if (event.target instanceof HTMLElement && event.target.matches("[data-timeline-scroll]")) schedule("timeline-scroll");
    }, true);

    window.addEventListener("pagehide", () => flush("pagehide"));
    window.addEventListener("beforeunload", () => flush("beforeunload"));
    queueRestore();
    schedule("runtime-ready");

    if (currentSnapshot) {
      window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-restored", {
        detail: { schemaVersion: currentSnapshot.schemaVersion, projectId: currentSnapshot.projectId }
      }));
    }
  }

  window.ViralCoreProjectPersistence = {
    key: SNAPSHOT_KEY,
    schemaVersion: model.CURRENT_SCHEMA_VERSION,
    snapshot() { return model.clone(currentSnapshot, null); },
    ensureProject,
    registryKey: REGISTRY_KEY,
    registrySchemaVersion: REGISTRY_SCHEMA_VERSION,
    listProjects,
    registerGenerationJob,
    generationOutputJobs,
    attachGeneratedOutput,
    addSceneMaterialCandidate,
    selectSceneMaterial,
    removeSceneMaterialCandidate,
    clearSceneMaterialSelection,
    addProjectScene,
    selectProjectScene,
    removeProjectScene,
    moveProjectScene,
    activeProjectId() { return registry.activeProjectId; },
    createProject,
    openProject,
    storageError() { return registryError; },
    schedule,
    flush,
    restore: queueRestore,
    unsupportedSchemaVersion() { return unsupportedSchemaVersion; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
  else startRuntime();
})();
