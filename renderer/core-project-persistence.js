(function installCoreProjectPersistence() {
  "use strict";

  const model = window.ViralCoreProjectSnapshot;
  if (!model) return;

  const {
    SNAPSHOT_KEY,
    LEGACY_STATE_KEY,
    LEGACY_UI_KEYS
  } = model;
  const DEBOUNCE_MS = 320;
  const observedLegacyKeys = new Set([LEGACY_STATE_KEY, ...Object.values(LEGACY_UI_KEYS)]);
  const storagePrototype = Storage.prototype;
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

  function projectLegacyProjection(snapshot) {
    const existing = readJson(LEGACY_STATE_KEY, {}) || {};
    const next = model.toLegacyState(snapshot, existing);
    writeNative(LEGACY_STATE_KEY, JSON.stringify(next));
    const ui = model.legacyUiProjection(snapshot);
    Object.entries(ui).forEach(([key, value]) => {
      if (value == null) removeNative(key);
      else writeNative(key, value);
    });
  }

  function bootstrapSnapshot() {
    const raw = readJson(SNAPSHOT_KEY, null);
    const migrated = model.migrateSnapshot(raw);
    unsupportedSchemaVersion = migrated.unsupportedVersion;
    if (unsupportedSchemaVersion) return;

    currentSnapshot = migrated.snapshot;
    if (!currentSnapshot) {
      currentSnapshot = model.fromLegacy(readJson(LEGACY_STATE_KEY, {}) || {}, legacyUiState());
      if (currentSnapshot) writeNative(SNAPSHOT_KEY, JSON.stringify(currentSnapshot));
    } else if (migrated.migrated) {
      writeNative(SNAPSHOT_KEY, JSON.stringify(currentSnapshot));
    }

    if (currentSnapshot) projectLegacyProjection(currentSnapshot);
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

  function currentTimelineSelection() {
    const dock = document.querySelector("#page .core-editor-bottom-dock");
    if (dock instanceof HTMLElement && dock.dataset.timelineSelection) return dock.dataset.timelineSelection;
    return localStorage.getItem(LEGACY_UI_KEYS.timelineSelection) || currentSnapshot?.editor?.timeline?.selection || "none";
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
    if (unsupportedSchemaVersion) return null;
    const current = appState();
    if (!current) return null;
    hydrateRetainedState();
    const next = model.buildSnapshot(current, editorState(current), currentSnapshot);
    if (!next) return null;
    if (model.semanticSignature(next) === model.semanticSignature(currentSnapshot)) return currentSnapshot;
    currentSnapshot = next;
    writeNative(SNAPSHOT_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("viral-ai:project-snapshot-saved", {
      detail: { reason, schemaVersion: next.schemaVersion, projectId: next.projectId }
    }));
    return next;
  }

  function schedule(reason = "semantic-change") {
    if (unsupportedSchemaVersion) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flush(reason), DEBOUNCE_MS);
  }

  storagePrototype.setItem = function patchedSetItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (suppressStorageObservation || this !== localStorage) return;
    const normalizedKey = String(key);
    if (normalizedKey === SNAPSHOT_KEY) return;
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
    schedule,
    flush,
    restore: queueRestore,
    unsupportedSchemaVersion() { return unsupportedSchemaVersion; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
  else startRuntime();
})();
