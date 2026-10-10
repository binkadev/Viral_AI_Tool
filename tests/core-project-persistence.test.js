"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const snapshotModel = require("../renderer/core-project-snapshot");

const root = path.resolve(__dirname, "..");
const persistence = fs.readFileSync(path.join(root, "renderer", "core-project-persistence.js"), "utf8");
const timelineSelection = fs.readFileSync(path.join(root, "renderer", "core-timeline-selection.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.strictEqual(snapshotModel.CURRENT_SCHEMA_VERSION, 2);
assert.strictEqual(snapshotModel.SNAPSHOT_KEY, "viral-ai-core-project-snapshot");

const sourceJob = {
  id: "source-1",
  name: "Long Interview.mp4",
  sourcePath: "C:/media/Long Interview.mp4",
  fileState: "missing",
  status: "completed",
  meta: { duration: 5400, width: 1920, height: 1080 }
};
const legacy = {
  locale: "vi",
  appearance: "midnight",
  output: "C:/exports",
  renderOptions: { burnSubtitles: true, mixOriginalAudio: true, originalAudioVolume: 0.2 },
  jobs: [sourceJob],
  speech: {
    mode: "local",
    language: "vi",
    job: { id: "speech-1", status: "completed", sourcePath: sourceJob.sourcePath },
    result: {
      sourcePath: sourceJob.sourcePath,
      text: "edited transcript",
      segments: [
        { id: "s1", start: 12.5, end: 15.75, text: "edited transcript", sourceText: "edited transcript", speaker: "S1", voice: "alloy", status: "source-edited" }
      ]
    }
  },
  translation: {
    mode: "cloud",
    targetLanguage: "en",
    preserveTone: true,
    job: null,
    result: null,
    staleJob: { id: "tr-old", sourcePath: sourceJob.sourcePath, status: "stale" },
    staleResult: { sourcePath: sourceJob.sourcePath, status: "stale", segments: [{ id: "s1", start: 12.5, end: 15.75, text: "old translation" }] }
  },
  voice: {
    mode: "cloud",
    assignments: { S1: "alloy" },
    job: null,
    result: null,
    staleJob: { id: "voice-old", sourcePath: sourceJob.sourcePath, status: "stale" },
    staleResult: { sourcePath: sourceJob.sourcePath, status: "stale", segments: [{ id: "s1", start: 12.5, end: 15.75, audioPath: "old.wav" }] }
  }
};

const migrated = snapshotModel.fromLegacy(legacy, {
  leftCollapsed: "true",
  rightCollapsed: "false",
  assetsCollapsed: "true",
  inspectorTab: "translate",
  bottomTab: "timeline",
  bottomHeight: "244",
  bottomCollapsed: "false",
  timelineZoom: "2.25",
  timelineSelection: "subtitle:0"
}, Date.UTC(2026, 9, 8, 12, 0, 0));

assert(migrated, "legacy project with a source must migrate into a snapshot");
assert.strictEqual(migrated.schemaVersion, 2);
assert.strictEqual(migrated.projectId, "source-1");
assert.strictEqual(migrated.projectName, "Long Interview.mp4", "legacy projects must gain a stable project name from the current source");
assert.strictEqual(migrated.source.path, sourceJob.sourcePath);
assert.strictEqual(migrated.source.fileState, "missing", "missing source must remain a recoverable project state");
assert.strictEqual(migrated.automation, null, "legacy source-only projects must migrate without inventing automation state");
assert.strictEqual(migrated.workflow.speech.result.segments[0].start, 12.5);
assert.strictEqual(migrated.workflow.speech.result.segments[0].end, 15.75);
assert.strictEqual(migrated.workflow.speech.result.segments[0].status, "source-edited");
assert.strictEqual(migrated.workflow.translation.staleResult.status, "stale");
assert.strictEqual(migrated.workflow.voice.staleResult.status, "stale");
assert.strictEqual(migrated.editor.timeline.zoom, 2.25);
assert.strictEqual(migrated.editor.timeline.selection, "subtitle:0");
assert.strictEqual(migrated.editor.panels.inspectorTab, "translate");

const frontmostSource = { id: "source-new", name: "New.mp4", sourcePath: "C:/media/New.mp4", fileState: "available" };
const olderSource = { id: "source-old", name: "Old.mp4", sourcePath: "C:/media/Old.mp4", fileState: "available" };
assert.strictEqual(
  snapshotModel.sourceFromState({ jobs: [frontmostSource, olderSource] }).identity,
  "source-new",
  "snapshot ownership must follow the editor's frontmost imported source"
);

const legacyProjection = snapshotModel.toLegacyState(migrated, {
  locale: "en",
  appearance: "pearl-light",
  motion: "reduced"
});
assert.strictEqual(legacyProjection.locale, "en", "global locale must not become project-owned");
assert.strictEqual(legacyProjection.appearance, "pearl-light", "global appearance must not become project-owned");
assert.strictEqual(legacyProjection.motion, "reduced");
assert.strictEqual(legacyProjection.jobs[0].fileState, "missing");
assert.strictEqual(legacyProjection.translation.staleResult.status, "stale");
assert.strictEqual(legacyProjection.voice.staleJob.status, "stale");
assert.strictEqual(legacyProjection.automation, null);

const reopenedEditor = {
  page: "ai-video",
  playback: { position: 3678.25, sourcePath: sourceJob.sourcePath },
  timeline: {
    tab: "transcript",
    height: 310,
    collapsed: false,
    zoom: 3,
    scrollLeft: 812,
    selection: "subtitle:0"
  },
  panels: {
    leftCollapsed: false,
    rightCollapsed: true,
    assetsCollapsed: false,
    inspectorTab: "voice"
  }
};
const persisted = snapshotModel.buildSnapshot(legacy, reopenedEditor, migrated, Date.UTC(2026, 9, 8, 12, 1, 0));
assert.strictEqual(persisted.projectId, migrated.projectId);
assert.strictEqual(persisted.projectName, migrated.projectName, "reopen/autosave must retain the project name");
assert.strictEqual(persisted.editor.playback.position, 3678.25);
assert.strictEqual(persisted.editor.timeline.scrollLeft, 812);
assert.strictEqual(persisted.editor.timeline.selection, "subtitle:0");
assert.strictEqual(persisted.editor.panels.rightCollapsed, true);
assert.strictEqual(persisted.editor.panels.inspectorTab, "voice");

const relinkedState = JSON.parse(JSON.stringify(legacy));
relinkedState.jobs[0].sourcePath = "D:/relinked/Long Interview.mp4";
relinkedState.jobs[0].fileState = "available";
relinkedState.speech.result.sourcePath = relinkedState.jobs[0].sourcePath;
const relinked = snapshotModel.buildSnapshot(relinkedState, {
  ...reopenedEditor,
  playback: { position: 3678.25, sourcePath: relinkedState.jobs[0].sourcePath }
}, persisted, Date.UTC(2026, 9, 8, 12, 2, 0));
assert.strictEqual(relinked.projectId, migrated.projectId, "relinking the same source job must not create a different project");
assert.strictEqual(relinked.projectName, persisted.projectName, "relinking the same source must not rename the project");
assert.strictEqual(relinked.source.path, "D:/relinked/Long Interview.mp4");
assert.strictEqual(relinked.source.fileState, "available");

const sameContentLater = { ...persisted, updatedAt: "2099-01-01T00:00:00.000Z" };
assert.strictEqual(
  snapshotModel.semanticSignature(sameContentLater),
  snapshotModel.semanticSignature(persisted),
  "updatedAt must not cause an autosave loop"
);

const v1WithoutProjectName = { ...persisted, schemaVersion: 1 };
delete v1WithoutProjectName.projectName;
delete v1WithoutProjectName.automation;
const normalizedV1 = snapshotModel.migrateSnapshot(v1WithoutProjectName);
assert.strictEqual(normalizedV1.snapshot.projectName, sourceJob.name, "schema-v1 snapshots must normalize projectName without data loss");
assert.strictEqual(normalizedV1.snapshot.schemaVersion, 2, "schema-v1 snapshots must upgrade to Automation Foundation schema v2");
assert.strictEqual(normalizedV1.snapshot.automation, null);
assert.strictEqual(normalizedV1.migrated, true, "schema-v1 snapshots must be rewritten durably during bootstrap");

const v0 = { ...migrated };
delete v0.schemaVersion;
const upgraded = snapshotModel.migrateSnapshot(v0);
assert.strictEqual(upgraded.migrated, true);
assert.strictEqual(upgraded.snapshot.schemaVersion, 2);
assert.strictEqual(upgraded.snapshot.projectName, migrated.projectName);
const future = snapshotModel.migrateSnapshot({ schemaVersion: 99, source: migrated.source, workflow: migrated.workflow });
assert.strictEqual(future.snapshot, null, "future schemas must never be silently downgraded");
assert.strictEqual(future.unsupportedVersion, 99);
assert.strictEqual(snapshotModel.fromLegacy({ jobs: [] }, {}), null, "blank app state must not create a phantom project");

const uiProjection = snapshotModel.legacyUiProjection(persisted);
assert.strictEqual(uiProjection["viral-ai-core-editor-bottom-tab"], "transcript");
assert.strictEqual(uiProjection["viral-ai-core-editor-timeline-zoom"], "3");
assert.strictEqual(uiProjection["viral-ai-core-timeline-selection"], "subtitle:0");

for (const required of [
  'const LEGACY_TRANSCRIPT_EDIT_KEY = "viral-ai-core-transcript-edits-v1"',
  'const DEBOUNCE_MS = 320',
  'const observedLegacyKeys = new Set([LEGACY_STATE_KEY, ...Object.values(LEGACY_UI_KEYS)])',
  'function dispatchSaveFailure(reason, error)',
  'function writeBootstrapSnapshot(snapshot, reason)',
  'writeBootstrapSnapshot(currentSnapshot, "bootstrap-schema-backfill")',
  'dispatchSaveFailure("bootstrap-legacy-projection", error)',
  'storagePrototype.getItem = function patchedGetItem',
  'storagePrototype.setItem = function patchedSetItem',
  'storagePrototype.removeItem = function patchedRemoveItem',
  'normalizedKey === LEGACY_TRANSCRIPT_EDIT_KEY && currentSnapshot',
  'setTimeout(() => flush(reason), DEBOUNCE_MS)',
  'window.addEventListener("pagehide", () => flush("pagehide"))',
  'window.addEventListener("beforeunload", () => flush("beforeunload"))',
  'new MutationObserver(queueRestore)',
  'video.addEventListener("loadedmetadata", () => restorePlayback(video))',
  'currentVideo() !== video',
  'restoredVideos.has(video)',
  'timelineScroll',
  'scroll.scrollLeft',
  'staleResult',
  'staleJob',
  'viral-ai:project-snapshot-saved',
  'viral-ai:project-snapshot-save-failed',
  'viral-ai:project-snapshot-restored'
]) {
  assert(persistence.includes(required), "Project persistence runtime is missing: " + required);
}
assert(
  persistence.indexOf('writeNative(SNAPSHOT_KEY, JSON.stringify(next))') < persistence.indexOf('currentSnapshot = next'),
  "in-memory snapshot must advance only after the durable write succeeds"
);
assert(
  persistence.indexOf('currentSnapshot = migrated.snapshot') < persistence.indexOf('writeBootstrapSnapshot(currentSnapshot, "bootstrap-schema-backfill")'),
  "bootstrap migration must retain the normalized in-memory snapshot before attempting a best-effort durable backfill"
);
assert(persistence.includes('try { removeNative(SNAPSHOT_KEY); } catch {}'), "failed durable writes must remove the stale durable snapshot so startup cannot roll legacy state backward");
assert(!persistence.includes("setInterval("), "project autosave must be semantic/debounced, never polling");
assert(!persistence.includes("video.play("), "reopen must restore position without auto-playing media");

for (const required of [
  'const SELECTION_KEY = "viral-ai-core-timeline-selection"',
  'const SELECTION_VERSION = 1',
  "stateSourceKey()",
  "parseStoredSelection",
  "loadStoredSelection()",
  "persistSelection()",
  'record.source !== currentSource',
  "JSON.stringify(record)",
  "transcriptSelectionAvailable",
  'source: "project-restore"',
  "restoreTranscriptSelection()",
  'viral-ai:transcript-workstation-ready'
]) {
  assert(timelineSelection.includes(required), "Timeline selection persistence is missing: " + required);
}
assert(!timelineSelection.includes(".click()"), "restoring timeline selection must not fake a click/seek");

assert(index.includes('src="core-automation-model.js"'), "automation model must load in the renderer");
assert(index.includes('src="core-project-snapshot.js"'), "snapshot model must load in the renderer");
assert(index.includes('src="core-project-persistence.js"'), "persistence coordinator must load in the renderer");
assert(index.indexOf('src="core-automation-model.js"') < index.indexOf('src="core-project-snapshot.js"'));
assert(index.indexOf('src="core-project-snapshot.js"') < index.indexOf('src="core-project-persistence.js"'));
assert(index.indexOf('src="core-project-persistence.js"') < index.indexOf('src="core-bootstrap.js"'), "snapshot projection must happen before app/bootstrap reads legacy state");
assert(index.indexOf('src="core-project-persistence.js"') < index.indexOf('src="app.js"'));

assert(pkg.scripts["test:core-project-persistence"], "package.json must expose the project persistence regression");
assert(pkg.scripts["test:core-commercial"].includes("test:core-project-persistence"), "commercial regression must gate project persistence");

console.log("Core project snapshot schema v2, automation migration, naming, safe bootstrap backfill, semantic autosave, reopen, source scoping and recovery tests passed.");
