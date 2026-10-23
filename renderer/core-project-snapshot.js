(function attachCoreProjectSnapshot(root, factory) {
  let mediaModel = root?.ViralCoreMediaLibraryModel || null;
  if (!mediaModel && typeof module !== "undefined" && module.exports && typeof require === "function") {
    try { mediaModel = require("./core-media-library-model"); } catch {}
  }
  const audioModel = root?.ViralCoreProjectAudioModel || (typeof module !== "undefined" && module.exports ? require("./core-project-audio-model") : null);
  const api = factory(mediaModel, audioModel);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectSnapshot = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreProjectSnapshot(mediaModel, audioModel) {
  "use strict";

  const CURRENT_SCHEMA_VERSION = 4;
  const SNAPSHOT_KEY = "viral-ai-core-project-snapshot";
  const LEGACY_STATE_KEY = "viral-ai-tool-state";
  const LEGACY_UI_KEYS = Object.freeze({
    leftCollapsed: "viral-ai-core-left-collapsed",
    rightCollapsed: "viral-ai-core-right-collapsed",
    assetsCollapsed: "viral-ai-core-editor-assets-collapsed",
    inspectorTab: "viral-ai-core-editor-inspector-tab",
    bottomTab: "viral-ai-core-editor-bottom-tab",
    bottomHeight: "viral-ai-core-editor-bottom-height",
    bottomCollapsed: "viral-ai-core-editor-bottom-collapsed",
    timelineZoom: "viral-ai-core-editor-timeline-zoom",
    timelineSelection: "viral-ai-core-timeline-selection"
  });

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback = min) {
    const number = finite(value, fallback);
    return Math.max(min, Math.min(max, number));
  }

  function bool(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  function emptyMedia() {
    return { schemaVersion: 1, assets: [], selectedAssetId: null };
  }

  function mediaFromState(state, options = {}) {
    if (mediaModel?.normalizeLibrary) {
      return mediaModel.normalizeLibrary(state?.media, options);
    }
    const raw = state?.media && typeof state.media === "object" ? state.media : {};
    return {
      schemaVersion: 1,
      assets: Array.isArray(raw.assets) ? clone(raw.assets, []).slice(0, 500) : [],
      selectedAssetId: raw.selectedAssetId ? String(raw.selectedAssetId) : null
    };
  }

  function safeJob(job) {
    if (!job || typeof job !== "object") return null;
    const copy = clone(job, {});
    delete copy.thumbnail;
    delete copy.previewUrl;
    return copy;
  }

  function safeJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : []).map(safeJob).filter(Boolean).slice(0, 100);
  }

  function latestSourceJob(state) {
    const jobs = Array.isArray(state?.jobs) ? state.jobs : [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job && !job.isRenderOutput && job.sourcePath) return job;
    }
    return null;
  }

  function sourceFromState(state) {
    const job = latestSourceJob(state);
    const fallbackPath = state?.speech?.result?.sourcePath || state?.translation?.result?.sourcePath || state?.voice?.result?.sourcePath || null;
    const path = job?.sourcePath || fallbackPath;
    if (!path) return null;
    const identity = String(job?.id || path);
    return {
      identity,
      jobId: job?.id ? String(job.id) : null,
      path: String(path),
      name: String(job?.name || String(path).split(/[\\/]/).pop() || ""),
      fileState: String(job?.fileState || "unknown"),
      meta: clone(job?.meta, null)
    };
  }

  function workflowFromState(state) {
    return {
      // Additive, opt-in references for newly admitted generation jobs only.
      generationOutputs: generationOutputs(state?.generationOutputs),
      output: String(state?.output || ""),
      generationBrief: String(state?.generationBrief || "").slice(0, 8000),
      renderOptions: {
        ...audioModel?.normalizeSettings(state?.renderOptions),
        burnSubtitles: state?.renderOptions?.burnSubtitles !== false,
        mixOriginalAudio: state?.renderOptions?.mixOriginalAudio !== false,
        originalAudioVolume: clamp(state?.renderOptions?.originalAudioVolume, 0, 0.35, 0.12)
      },
      speech: {
        mode: state?.speech?.mode === "cloud" ? "cloud" : "local",
        language: String(state?.speech?.language || "auto"),
        job: clone(state?.speech?.job, null),
        result: clone(state?.speech?.result, null)
      },
      translation: {
        mode: state?.translation?.mode === "local" ? "local" : "cloud",
        targetLanguage: String(state?.translation?.targetLanguage || "en"),
        preserveTone: state?.translation?.preserveTone !== false,
        job: clone(state?.translation?.job, null),
        result: clone(state?.translation?.result, null),
        staleJob: clone(state?.translation?.staleJob, null),
        staleResult: clone(state?.translation?.staleResult, null)
      },
      voice: {
        mode: state?.voice?.mode === "local" ? "local" : "cloud",
        assignments: clone(state?.voice?.assignments, {}),
        job: clone(state?.voice?.job, null),
        result: clone(state?.voice?.result, null),
        staleJob: clone(state?.voice?.staleJob, null),
        staleResult: clone(state?.voice?.staleResult, null)
      },
      jobs: safeJobs(state?.jobs)
    };
  }

  function generationOutputs(input) {
    const seen = new Set();
    return (Array.isArray(input) ? input : []).filter(entry => {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(entry?.jobId || "") || seen.has(entry.jobId)) return false;
      if (entry.sceneId !== null && !/^[a-zA-Z0-9_-]{1,160}$/.test(entry.sceneId || "")) return false;
      seen.add(entry.jobId);
      return true;
    }).map(entry => ({ jobId: entry.jobId, sceneId: entry.sceneId,
      assetId: entry.assetId === "generation:" + entry.jobId ? entry.assetId : null }));
  }

  function normalizeSelection(value) {
    const raw = String(value || "none");
    if (raw === "video" || raw === "audio" || raw === "none") return raw;
    const match = /^subtitle:(\d+)$/.exec(raw);
    return match ? "subtitle:" + Number(match[1]) : "none";
  }

  function normalizeEditor(editor = {}, source = null) {
    const timeline = editor.timeline || {};
    const panels = editor.panels || {};
    const playback = editor.playback || {};
    const position = Math.max(0, finite(playback.position, 0));
    return {
      page: source ? "ai-video" : String(editor.page || "download"),
      playback: {
        position,
        sourceIdentity: playback.sourceIdentity ? String(playback.sourceIdentity) : source?.identity || null,
        sourcePath: playback.sourcePath ? String(playback.sourcePath) : source?.path || null
      },
      timeline: {
        tab: timeline.tab === "transcript" ? "transcript" : "timeline",
        height: Math.round(clamp(timeline.height, 132, 420, 190)),
        collapsed: bool(timeline.collapsed, false),
        zoom: clamp(timeline.zoom, 1, 4, 1),
        scrollLeft: Math.max(0, finite(timeline.scrollLeft, 0)),
        selection: normalizeSelection(timeline.selection)
      },
      panels: {
        leftCollapsed: bool(panels.leftCollapsed, false),
        rightCollapsed: bool(panels.rightCollapsed, false),
        assetsCollapsed: bool(panels.assetsCollapsed, false),
        inspectorTab: ["speech", "translate", "voice", "output"].includes(panels.inspectorTab)
          ? panels.inspectorTab
          : "speech"
      }
    };
  }

  function normalizeSource(source) {
    if (!source || !source.path) return null;
    return {
      identity: String(source.identity || source.jobId || source.path),
      jobId: source.jobId ? String(source.jobId) : null,
      path: String(source.path),
      name: String(source.name || String(source.path).split(/[\\/]/).pop() || ""),
      fileState: String(source.fileState || "unknown"),
      meta: clone(source.meta, null)
    };
  }

  function normalizeProject(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const source = normalizeSource(snapshot.source);
    const aiProject = snapshot.schemaVersion === 4 && snapshot.projectKind === "ai";
    if (!source && !aiProject) return null;
    if (aiProject && (!/^[a-zA-Z0-9_-]{1,160}$/.test(snapshot.projectId || "") || !String(snapshot.projectName || "").trim())) return null;
    const workflow = workflowFromState({
      output: snapshot.workflow?.output,
      generationBrief: snapshot.workflow?.generationBrief,
      generationOutputs: snapshot.workflow?.generationOutputs,
      renderOptions: snapshot.workflow?.renderOptions,
      speech: snapshot.workflow?.speech,
      translation: snapshot.workflow?.translation,
      voice: snapshot.workflow?.voice,
      jobs: snapshot.workflow?.jobs
    });
    const media = mediaFromState({ media: snapshot.media || emptyMedia() }, { restartSafe: options.restartSafeMedia === true });
    if (options.restartSafeMedia) workflow.jobs = workflow.jobs.map(job => job.renderKind === "project" && job.projectId === snapshot.projectId && job.renderInputSignature &&
      ["validating", "queued", "preparing", "processing", "rendering", "cancelling"].includes(job.status)
      ? { ...job, status: "interrupted", failureCode: "PROJECT_RENDER_INTERRUPTED" } : job);
    if (audioModel && !audioModel.resolveBgm({ media, workflow })) workflow.renderOptions.bgmAssetId = null;
    if (options.restartSafeMedia && workflow.voice.job?.projectId === snapshot.projectId && audioModel?.ACTIVE.includes(workflow.voice.job.status)) {
      workflow.voice.job = { ...workflow.voice.job, status: "interrupted" };
    }
    if (options.restartSafeMedia && workflow.voice.staleJob?.projectId === snapshot.projectId && audioModel?.ACTIVE.includes(workflow.voice.staleJob.status)) {
      workflow.voice.staleJob = { ...workflow.voice.staleJob, status: "interrupted" };
    }
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectKind: aiProject ? "ai" : "imported",
      projectId: String(snapshot.projectId || source.identity),
      projectName: String(snapshot.projectName || source?.name || source?.identity),
      updatedAt: snapshot.updatedAt ? String(snapshot.updatedAt) : null,
      source,
      media,
      workflow,
      editor: normalizeEditor(snapshot.editor, source)
    };
  }

  function mediaRestartChanged(input, normalized, options) {
    if (!options.restartSafeMedia || !Array.isArray(input?.media?.assets)) return false;
    const before = input.media.assets;
    const after = normalized?.media?.assets || [];
    return after.some((asset, index) => asset?.status !== before[index]?.status);
  }

  function migrateSnapshot(input, options = {}) {
    if (!input || typeof input !== "object") return { snapshot: null, migrated: false, unsupportedVersion: null };
    const version = Number(input.schemaVersion || 0);
    if (version > CURRENT_SCHEMA_VERSION) {
      return { snapshot: null, migrated: false, unsupportedVersion: version };
    }
    if (version === CURRENT_SCHEMA_VERSION) {
      const snapshot = normalizeProject(input, options);
      const migrated = Boolean(
        snapshot &&
        (
          String(input.projectName || "") !== snapshot.projectName ||
          !input.media ||
          Number(input.media?.schemaVersion || 0) !== 1 ||
          mediaRestartChanged(input, snapshot, options)
        )
      );
      return { snapshot, migrated, unsupportedVersion: null };
    }
    if ([1, 2, 3].includes(version) && input.source && input.workflow) {
      return {
        snapshot: normalizeProject({ ...input, projectKind: "imported", schemaVersion: CURRENT_SCHEMA_VERSION, media: input.media || emptyMedia() }, options),
        migrated: true,
        unsupportedVersion: null
      };
    }
    if (version === 0 && input.source && input.workflow) {
      return {
        snapshot: normalizeProject({ ...input, projectKind: "imported", schemaVersion: CURRENT_SCHEMA_VERSION, media: input.media || emptyMedia() }, options),
        migrated: true,
        unsupportedVersion: null
      };
    }
    return { snapshot: null, migrated: false, unsupportedVersion: null };
  }

  function editorFromLegacy(ui = {}, source = null) {
    return normalizeEditor({
      page: source ? "ai-video" : "download",
      playback: { position: 0, sourceIdentity: source?.identity || null, sourcePath: source?.path || null },
      timeline: {
        tab: ui.bottomTab,
        height: ui.bottomHeight,
        collapsed: ui.bottomCollapsed,
        zoom: ui.timelineZoom,
        scrollLeft: ui.timelineScrollLeft,
        selection: ui.timelineSelection
      },
      panels: {
        leftCollapsed: ui.leftCollapsed,
        rightCollapsed: ui.rightCollapsed,
        assetsCollapsed: ui.assetsCollapsed,
        inspectorTab: ui.inspectorTab
      }
    }, source);
  }

  function fromLegacy(legacyState, legacyUi = {}, now = Date.now()) {
    const source = sourceFromState(legacyState);
    if (!source) return null;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectKind: "imported",
      projectId: source.identity,
      projectName: String(legacyState?.projectName || source.name || source.identity),
      updatedAt: new Date(now).toISOString(),
      source,
      media: mediaFromState(legacyState, { restartSafe: true }),
      workflow: workflowFromState(legacyState),
      editor: editorFromLegacy(legacyUi, source)
    };
  }

  function buildSnapshot(appState, editorState = {}, previous = null, now = Date.now()) {
    const source = sourceFromState(appState);
    const previousSnapshot = migrateSnapshot(previous).snapshot;
    const aiProject = previousSnapshot?.projectKind === "ai";
    if (!source && !aiProject) return null;
    const sameProject = Boolean(
      previousSnapshot &&
      (aiProject || (source?.jobId && previousSnapshot.source?.jobId === source.jobId) || previousSnapshot.source?.identity === source?.identity)
    );
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectKind: aiProject ? "ai" : "imported",
      projectId: sameProject ? previousSnapshot.projectId : source.identity,
      projectName: sameProject
        ? String(previousSnapshot.projectName || source.name || source.identity)
        : String(appState?.projectName || source.name || source.identity),
      updatedAt: new Date(now).toISOString(),
      source,
      media: mediaFromState(appState),
      workflow: workflowFromState(appState),
      editor: normalizeEditor(editorState, source)
    };
  }

  function createDraftProject({ projectId, projectName }, appState = {}, editorState = {}, now = Date.now()) {
    return normalizeProject({ schemaVersion: 4, projectKind: "ai", projectId, projectName,
      updatedAt: new Date(now).toISOString(), source: null, media: emptyMedia(),
      workflow: workflowFromState(appState), editor: normalizeEditor(editorState) });
  }

  function toLegacyState(snapshot, existing = {}) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return clone(existing, {});
    const workflow = migrated.workflow;
    return {
      ...clone(existing, {}),
      page: migrated.source ? "ai-video" : "ai-create",
      output: workflow.output,
      generationOutputs: clone(workflow.generationOutputs, []),
      media: clone(migrated.media, emptyMedia()),
      renderOptions: clone(workflow.renderOptions, {}),
      speech: clone(workflow.speech, {}),
      translation: clone(workflow.translation, {}),
      voice: clone(workflow.voice, {}),
      jobs: safeJobs(workflow.jobs)
    };
  }

  function legacyUiProjection(snapshot) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return {};
    const editor = migrated.editor;
    return {
      [LEGACY_UI_KEYS.leftCollapsed]: editor.panels.leftCollapsed ? "true" : "false",
      [LEGACY_UI_KEYS.rightCollapsed]: editor.panels.rightCollapsed ? "true" : "false",
      [LEGACY_UI_KEYS.assetsCollapsed]: editor.panels.assetsCollapsed ? "true" : "false",
      [LEGACY_UI_KEYS.inspectorTab]: editor.panels.inspectorTab,
      [LEGACY_UI_KEYS.bottomTab]: editor.timeline.tab,
      [LEGACY_UI_KEYS.bottomHeight]: String(editor.timeline.height),
      [LEGACY_UI_KEYS.bottomCollapsed]: editor.timeline.collapsed ? "true" : "false",
      [LEGACY_UI_KEYS.timelineZoom]: String(editor.timeline.zoom),
      [LEGACY_UI_KEYS.timelineSelection]: editor.timeline.selection
    };
  }

  function semanticSignature(snapshot) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return "";
    const stable = clone(migrated, {});
    stable.updatedAt = null;
    return JSON.stringify(stable);
  }

  function attachGeneratedOutput(snapshot, job, output, meta) {
    const entry = snapshot.workflow.generationOutputs?.find(item => item.jobId === job.id);
    if (!entry || job.projectId !== snapshot.projectId || job.sceneId !== entry.sceneId ||
        (entry.sceneId && !snapshot.scenePlan?.scenes?.some(scene => scene.id === entry.sceneId))) throw Error("PROJECT_GENERATION_MISMATCH");
    if (job.status !== "completed" || job.kind !== "video" ||
        job.asset?.fileName !== job.id + ".mp4" || job.output?.fileName !== job.asset.fileName ||
        output?.verified !== true || output.jobId !== job.id || output.projectId !== snapshot.projectId ||
        output.sceneId !== entry.sceneId || output.fileName !== job.output.fileName ||
        ![meta?.duration, meta?.width, meta?.height].every(value => Number.isFinite(value) && value > 0)) throw Error("GENERATED_OUTPUT_UNVERIFIED");
    if (entry.assetId) return snapshot;
    const next = clone(snapshot), assetId = "generation:" + job.id;
    const localIdentity = value => String(value || "").replace(/\\/g, "/").toLowerCase();
    if (next.media.assets.some(asset => asset.id !== assetId && asset.localPath &&
        localIdentity(asset.localPath) === localIdentity(output.path))) throw Error("GENERATED_MEDIA_DUPLICATE");
    const added = mediaModel.addAssets(next.media, [{ id: assetId, kind: "video", origin: "generated",
      provider: job.provider, providerAssetId: job.id, name: output.fileName, localPath: output.path,
      status: "ready", fileState: "available", meta: { ...meta, mime: "video/mp4" } }]);
    const asset = added.library.assets.find(item => item.id === assetId);
    if (!asset?.localPath || asset.localPath !== output.path) throw Error("GENERATED_MEDIA_UNAVAILABLE");
    next.media = added.library;
    const sourceId = "generation-source:" + job.id;
    if (!next.workflow.jobs.some(item => item.id === sourceId)) {
      if (next.workflow.jobs.length >= 100) throw Error("PROJECT_SOURCE_CAPACITY");
      const source = mediaModel.sourceJob({ name: asset.name, path: asset.localPath }, {
        id: sourceId, projectId: job.projectId, sceneId: job.sceneId, generationJobId: job.id, assetId, meta });
      // Keep an existing editor/source selection. An empty AI project selects
      // its first real video through the very same source path as an import.
      if (next.source) next.workflow.jobs.push(source);
      else {
        next.workflow.jobs.unshift(source);
        next.source = sourceFromState({ jobs: next.workflow.jobs });
        next.media.selectedAssetId = asset.id;
        next.editor = normalizeEditor({ ...next.editor, playback: {
          position: 0, sourceIdentity: next.source.identity, sourcePath: next.source.path
        } }, next.source);
      }
    }
    next.workflow.generationOutputs.find(item => item.jobId === job.id).assetId = assetId;
    next.updatedAt = new Date().toISOString();
    return next;
  }

  return {
    CURRENT_SCHEMA_VERSION,
    SNAPSHOT_KEY,
    LEGACY_STATE_KEY,
    LEGACY_UI_KEYS,
    clone,
    latestSourceJob,
    sourceFromState,
    mediaFromState,
    workflowFromState,
    normalizeEditor,
    migrateSnapshot,
    fromLegacy,
    buildSnapshot,
    createDraftProject,
    toLegacyState,
    legacyUiProjection,
    semanticSignature,
    attachGeneratedOutput
  };
});
