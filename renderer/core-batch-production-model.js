(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralBatchProductionModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const BATCH_SCHEMA_VERSION = 1, MAX_PROJECTS = 100;
  const ACTIVE = ["activating", "materials", "voice", "render"];
  const TERMINAL = ["completed", "skipped_ready", "needs_attention", "stopped"];
  const BATCH_TERMINAL = ["completed", "completed_with_attention"];
  const STATUSES = ["draft", "running", "paused", "stopping", ...BATCH_TERMINAL, "interrupted"];
  const REASONS = ["PROJECT_NOT_FOUND", "PROJECT_CHANGED", "USER_INTERVENTION", "PROJECT_WORK_RUNNING", "PROJECT_STORAGE_PROTECTED", "PROJECT_TRANSITION_PENDING",
    "BATCH_STORAGE_FAILED", "BATCH_STORAGE_PROTECTED", "PROJECT_SAVE_FAILED", "PROJECT_STATE_UNAVAILABLE", "BATCH_INVALID", "BATCH_EXISTS", "BATCH_EMPTY", "BATCH_DUPLICATE", "BATCH_TOO_MANY", "OUTPUT_REQUIRED", "OUTPUT_UNAVAILABLE", "LOW_DISK_SPACE",
    "MATERIALS_ATTENTION", "NO_SCENES", "RECOVERY_REQUIRED", "VOICE_REQUIRED", "VOICE_UNAVAILABLE", "VOICE_FAILED", "RENDER_FAILED", "OUTPUT_MISSING",
    "PROJECT_RENDER_VOICE_REQUIRED", "PROJECT_RENDER_VOICE_STALE", "PROJECT_RENDER_BGM_UNAVAILABLE", "PROJECT_RENDER_MEDIA_MISSING", "PROJECT_RENDER_TIMING_INVALID",
    "PROJECT_RENDER_PROFILE_UNRESOLVED", "PROJECT_RENDER_INCOMPLETE", "PROJECT_RENDER_INPUT_CHANGED", "PROJECT_RENDER_DUPLICATE"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = code => Object.assign(Error(code), {code});
  const bounded = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
  const reason = (s, fallback = "BATCH_INVALID") => REASONS.includes(s) ? s : fallback;
  const terminal = item => TERMINAL.includes(item?.status);
  const finished = batch => BATCH_TERMINAL.includes(batch?.status);
  function membership(ids) {
    if (!Array.isArray(ids) || !ids.length) throw failure("BATCH_EMPTY");
    if (ids.length > MAX_PROJECTS) throw failure("BATCH_TOO_MANY");
    if (!ids.every(s => bounded(s, 512))) throw failure("BATCH_INVALID");
    if (new Set(ids).size !== ids.length) throw failure("BATCH_DUPLICATE");
    return [...ids];
  }
  function outputDirectory(s) {
    if (!bounded(s, 32767) || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/i.test(s) || /^(?:https?|file):/i.test(s)) throw failure("OUTPUT_REQUIRED");
    return s;
  }
  function date(s, nullable = true) {
    if (s === null && nullable) return null;
    if (typeof s !== "string" || s.length > 32 || !Number.isFinite(Date.parse(s))) throw failure("BATCH_INVALID");
    return s;
  }
  // Validate first, then project only the bounded v1 fields. Never retain nested
  // Project/provider/job payloads, raw errors or progress in this record.
  function normalize(input) {
    if (!input || input.schemaVersion !== BATCH_SCHEMA_VERSION) throw failure("BATCH_STORAGE_PROTECTED");
    if (input.current === null) return {schemaVersion:BATCH_SCHEMA_VERSION, current:null};
    const b = input.current;
    if (!b || !/^batch-[A-Za-z0-9-]{1,80}$/.test(b.batchId) || !STATUSES.includes(b.status) || b.reason !== null && !REASONS.includes(b.reason)) throw failure("BATCH_INVALID");
    const projectIds = membership(b.projectIds);
    if (!Array.isArray(b.items) || b.items.length !== projectIds.length || !Number.isInteger(b.cursor) || b.cursor < 0 || b.cursor > projectIds.length ||
        typeof b.pauseRequested !== "boolean" || typeof b.stopRequested !== "boolean") throw failure("BATCH_INVALID");
    const items = b.items.map((item, i) => {
      if (!item || item.projectId !== projectIds[i] || !["pending", ...ACTIVE, ...TERMINAL, "interrupted"].includes(item.status) ||
          item.stage !== item.status || item.reason !== null && !REASONS.includes(item.reason)) throw failure("BATCH_INVALID");
      return {projectId:item.projectId, status:item.status, stage:item.stage, reason:item.reason, startedAt:date(item.startedAt), completedAt:date(item.completedAt)};
    });
    const executing = items.filter(i => ACTIVE.includes(i.status));
    if (executing.length > 1 || executing.length && items[b.cursor] !== executing[0] ||
        items.some((i, n) => n < b.cursor && !terminal(i)) ||
        finished(b) && (items.some(i => !terminal(i)) || aggregate({items}) !== b.status) ||
        !["running", "stopping"].includes(b.status) && executing.length ||
        b.status === "draft" && (b.cursor !== 0 || items.some(i => i.status !== "pending"))) throw failure("BATCH_INVALID");
    return {schemaVersion:BATCH_SCHEMA_VERSION, current:{batchId:b.batchId, status:b.status, projectIds, outputDir:outputDirectory(b.outputDir), cursor:b.cursor,
      createdAt:date(b.createdAt, false), startedAt:date(b.startedAt), updatedAt:date(b.updatedAt, false), completedAt:date(b.completedAt),
      pauseRequested:b.pauseRequested, stopRequested:b.stopRequested, reason:b.reason === null ? null : reason(b.reason), items}};
  }
  function restart(input, now) {
    const value = normalize(input), b = value.current;
    if (b && ["running", "paused", "stopping"].includes(b.status)) {
      b.status = "interrupted"; b.updatedAt = now; b.pauseRequested = false; b.stopRequested = false;
      for (const item of b.items) if (ACTIVE.includes(item.status)) {item.status = item.stage = "interrupted"; item.reason = "PROJECT_CHANGED";}
    }
    return value;
  }
  function counts(batch) {
    const items = batch?.items || [], count = status => items.filter(i => i.status === status).length;
    return {total:items.length, pending:count("pending"), active:items.filter(i => ACTIVE.includes(i.status)).length,
      completed:count("completed"), skipped:count("skipped_ready"), attention:count("needs_attention"), stopped:count("stopped"), interrupted:count("interrupted"),
      terminal:items.filter(terminal).length};
  }
  function progress(batch) {const c = counts(batch); return {...c, percent:c.total ? Math.floor(c.terminal / c.total * 100) : 0};}
  const next = batch => batch.items.findIndex(i => ["pending", "interrupted"].includes(i.status));
  const aggregate = batch => batch.items.every(i => ["completed", "skipped_ready"].includes(i.status)) ? "completed" : "completed_with_attention";
  const resumable = batch => ["paused", "interrupted"].includes(batch?.status);
  return {BATCH_SCHEMA_VERSION, MAX_PROJECTS, ACTIVE, TERMINAL, STATUSES, REASONS, clone, failure, reason, membership, outputDirectory, normalize, restart, terminal, finished, resumable, next, aggregate, counts, progress};
});
