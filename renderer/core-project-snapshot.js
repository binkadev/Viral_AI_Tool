(function attachCoreProjectSnapshot(root, factory) {
  const automationModel = (typeof module !== "undefined" && module.exports)
    ? require("./core-automation-model")
    : root?.ViralAutomationModel;
  const api = factory(automationModel);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectSnapshot = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreProjectSnapshot(automationModel) {
  "use strict";

  const CURRENT_SCHEMA_VERSION = 2;
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
    timelineZoom: "viral-ai-core-timeline-zoom",
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

  function safeJob(job) {
    if (!job || typeof job !== "object") return null;
    const copy = clone(job, {});
    delete copy.thumbnail;
    delete copy.previewUrl;
    return copy;
  }

  function safeJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : [])
      .filter(job => job?.isAutomationCompositionPreview !== true)
      .map(safeJob)
      .filter(Boolean)
      .slice(0, 100);
  }

  function normalizeAutomation(value) {
    if (!value || typeof value !== "object") return null;
    if (automationModel?.normalizeAutomationState) return automationModel.normalizeAutomationState(value);
    return clone(value, null);
  }

  function automationFromState(state, previousAutomation = null) {
    const direct = state?.automation;
    if (direct && typeof direct === "object") return normalizeAutomation(direct);
    return normalizeAutomation(previousAutomation);
  }

  function automationIdentity(automation) {
    return automation?.brief?.id || automation?.brief?.inputSignature || null;
  }

  function automationProjectName(automation) {
    return String(automation?.brief?.topic || automation?.brief?.product || automationIdentity(automation) || "");
  }

  function latestSourceJob(state) {
    const jobs = Array.isArray(state?.jobs) ? state.jobs : [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job && !job.isRenderOutput && job.isAutomationCompositionPreview !== true && job.sourcePath) return job;
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
      output: String(state?.output || ""),
      renderOptions: {
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

  function sourceFromSnapshot(snapshot) {
    return snapshot?.source && snapshot.source.path
      ? {
          identity: String(snapshot.source.identity || snapshot.source.jobId || snapshot.source.path),
          jobId: snapshot.source.jobId ? String(snapshot.source.jobId) : null,
          path: String(snapshot.source.path),
          name: String(snapshot.source.name || String(snapshot.source.path).split(/[\\/]/).pop() || ""),
          fileState: String(snapshot.source.fileState || "unknown"),
          meta: clone(snapshot.source.meta, null)
        }
      : null;
  }

  function normalizeCurrent(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const source = sourceFromSnapshot(snapshot);
    const automation = normalizeAutomation(snapshot.automation);
    if (!source && !automation?.brief) return null;
    const identity = source?.identity || automationIdentity(automation);
    if (!identity) return null;
    const workflow = workflowFromState({
      output: snapshot.workflow?.output,
      renderOptions: snapshot.workflow?.renderOptions,
      speech: snapshot.workflow?.speech,
      translation: snapshot.workflow?.translation,
      voice: snapshot.workflow?.voice,
      jobs: snapshot.workflow?.jobs
    });
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId: String(snapshot.projectId || identity),
      projectName: String(snapshot.projectName || source?.name || automationProjectName(automation) || identity),
      updatedAt: snapshot.updatedAt ? String(snapshot.updatedAt) : null,
      source,
      workflow,
      automation,
      editor: normalizeEditor(snapshot.editor, source)
    };
  }

  function migrateSnapshot(input) {
    if (!input || typeof input !== "object") return { snapshot: null, migrated: false, unsupportedVersion: null };
    const version = Number(input.schemaVersion || 0);
    if (version > CURRENT_SCHEMA_VERSION) {
      return { snapshot: null, migrated: false, unsupportedVersion: version };
    }
    if (version === CURRENT_SCHEMA_VERSION) {
      const snapshot = normalizeCurrent(input);
      const migrated = Boolean(snapshot && String(input.projectName || "") !== snapshot.projectName);
      return { snapshot, migrated, unsupportedVersion: null };
    }
    if ((version === 1 || version === 0) && (input.source || input.automation) && input.workflow) {
      return {
        snapshot: normalizeCurrent({ ...input, schemaVersion: CURRENT_SCHEMA_VERSION, automation: input.automation || null }),
        migrated: true,
        unsupportedVersion: null
      };
    }
    return { snapshot: null, migrated: false, unsupportedVersion: null };
  }

  function editorFromLegacy(ui = {}, source = null, page = null) {
    return normalizeEditor({
      page: source ? "ai-video" : String(page || "download"),
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
    const automation = automationFromState(legacyState);
    if (!source && !automation?.brief) return null;
    const identity = source?.identity || automationIdentity(automation);
    if (!identity) return null;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId: String(identity),
      projectName: String(legacyState?.projectName || source?.name || automationProjectName(automation) || identity),
      updatedAt: new Date(now).toISOString(),
      source,
      workflow: workflowFromState(legacyState),
      automation,
      editor: editorFromLegacy(legacyUi, source, legacyState?.page)
    };
  }

  function buildSnapshot(appState, editorState = {}, previous = null, now = Date.now()) {
    const source = sourceFromState(appState);
    const previousSnapshot = migrateSnapshot(previous).snapshot;
    const directAutomation = automationFromState(appState);
    const sameSource = Boolean(
      previousSnapshot && source && previousSnapshot.source &&
      ((source.jobId && previousSnapshot.source.jobId === source.jobId) || previousSnapshot.source.identity === source.identity)
    );
    const automation = directAutomation || (sameSource || !source ? normalizeAutomation(previousSnapshot?.automation) : null);
    if (!source && !automation?.brief) return null;
    const sameAutomation = Boolean(
      previousSnapshot?.automation?.brief && automation?.brief &&
      automationIdentity(previousSnapshot.automation) === automationIdentity(automation)
    );
    const sameProject = Boolean(previousSnapshot && (sameSource || sameAutomation));
    const identity = source?.identity || automationIdentity(automation);
    if (!identity) return null;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId: sameProject ? previousSnapshot.projectId : String(identity),
      projectName: sameProject
        ? String(previousSnapshot.projectName || source?.name || automationProjectName(automation) || identity)
        : String(appState?.projectName || source?.name || automationProjectName(automation) || identity),
      updatedAt: new Date(now).toISOString(),
      source,
      workflow: workflowFromState(appState),
      automation,
      editor: normalizeEditor(editorState, source)
    };
  }

  function toLegacyState(snapshot, existing = {}) {
    const migrated = migrateSnapshot(snapshot).snapshot;
    if (!migrated) return clone(existing, {});
    const workflow = migrated.workflow;
    return {
      ...clone(existing, {}),
      page: migrated.editor?.page || (migrated.source ? "ai-video" : "download"),
      projectName: migrated.projectName,
      output: workflow.output,
      renderOptions: clone(workflow.renderOptions, {}),
      speech: clone(workflow.speech, {}),
      translation: clone(workflow.translation, {}),
      voice: clone(workflow.voice, {}),
      jobs: safeJobs(workflow.jobs),
      automation: clone(migrated.automation, null)
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

  return {
    CURRENT_SCHEMA_VERSION,
    SNAPSHOT_KEY,
    LEGACY_STATE_KEY,
    LEGACY_UI_KEYS,
    clone,
    latestSourceJob,
    sourceFromState,
    workflowFromState,
    automationFromState,
    normalizeEditor,
    migrateSnapshot,
    fromLegacy,
    buildSnapshot,
    toLegacyState,
    legacyUiProjection,
    semanticSignature
  };
});
