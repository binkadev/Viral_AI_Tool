(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralTelegramNotificationsModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const TYPES = ["batch_started", "video_completed", "needs_attention", "batch_interrupted", "batch_completed"];
  const STATUSES = ["draft", "running", "paused", "stopping", "completed", "completed_with_attention", "interrupted"];
  const ITEMS = ["pending", "activating", "materials", "voice", "render", "completed", "skipped_ready", "needs_attention", "stopped", "interrupted"];
  const failure = () => Object.assign(Error("TELEGRAM_INVALID_REQUEST"), {code:"TELEGRAM_INVALID_REQUEST"});
  const plain = value => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value, allowed) => {if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) throw failure();};
  const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
  const date = value => typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value));
  const batchId = value => typeof value === "string" && /^batch-[A-Za-z0-9-]{1,80}$/.test(value);
  // Names are display-only facts, never paths, URLs, credentials or diagnostics.
  function name(value) {
    const safe = typeof value === "string" ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>]/g, "").trim().slice(0, 200) : "";
    return /(?:[a-z]:[\\/]|\\\\|https?:|file:|www\.|\/[\w.-]+\/|\d{5,}:\S{15,}|Muse|GenerationService|FFmpeg|Receipt\s*V2|Gate\s*[CD]|project-render-v1:)/i.test(safe) ? "" : safe;
  }
  function counts(batch) {
    const items = batch.items;
    return {total:items.length, completed:items.filter(i => i.status === "completed").length, skipped:items.filter(i => i.status === "skipped_ready").length,
      attention:items.filter(i => ["needs_attention", "interrupted"].includes(i.status)).length, stopped:items.filter(i => i.status === "stopped").length};
  }
  function eventId(type, id, projectId, status) {
    if (!batchId(id) || !TYPES.includes(type)) throw failure();
    const prefix = "batch:" + id;
    if (["video_completed", "needs_attention"].includes(type)) {
      if (!text(projectId, 512)) throw failure();
      return prefix + ":project:" + encodeURIComponent(projectId) + (type === "video_completed" ? ":completed" : ":attention");
    }
    return prefix + (type === "batch_started" ? ":started" : type === "batch_interrupted" ? ":interrupted" : ":terminal:" + status);
  }
  function validIdentity(value, type) {
    if (!text(value, 2048)) return false;
    const match = /^batch:(batch-[A-Za-z0-9-]{1,80}):(.+)$/.exec(value); if (!match) return false;
    try {
      if (["video_completed", "needs_attention"].includes(type)) {
        const item = /^project:(.+):(completed|attention)$/.exec(match[2]);
        return !!item && eventId(type, match[1], decodeURIComponent(item[1])) === value;
      }
      return eventId(type, match[1], undefined, match[2].replace(/^terminal:/, "")) === value &&
        (type !== "batch_completed" || ["terminal:completed", "terminal:completed_with_attention"].includes(match[2]));
    } catch {return false;}
  }
  function validate(intent) {
    keys(intent, ["eventId", "type", "batchId", "projectId", "projectName", "reason", "counts", "occurredAt", "locale", "terminalStatus"]);
    if (!TYPES.includes(intent.type) || !batchId(intent.batchId) || !["vi", "en"].includes(intent.locale) || !date(intent.occurredAt) || !text(intent.eventId, 2048)) throw failure();
    const item = ["video_completed", "needs_attention"].includes(intent.type), terminal = intent.type === "batch_completed";
    if (item ? !text(intent.projectId, 512) : intent.projectId !== undefined || intent.projectName !== undefined) throw failure();
    if (intent.projectName !== undefined && (typeof intent.projectName !== "string" || intent.projectName.length > 200)) throw failure();
    if (intent.reason !== undefined && (!text(intent.reason, 80) || !/^[A-Z][A-Z0-9_]*$/.test(intent.reason))) throw failure();
    if (terminal ? !["completed", "completed_with_attention"].includes(intent.terminalStatus) : intent.terminalStatus !== undefined) throw failure();
    if (intent.eventId !== eventId(intent.type, intent.batchId, intent.projectId, intent.terminalStatus)) throw failure();
    let total;
    if (!item) {
      keys(intent.counts, ["total", "completed", "skipped", "attention", "stopped"]);
      if (Object.keys(intent.counts).length !== 5 || !Object.values(intent.counts).every(n => Number.isInteger(n) && n >= 0 && n <= 100) || intent.counts.total < 1) throw failure();
      const {total:t, completed, skipped, attention, stopped} = intent.counts;
      if (completed + skipped + attention + stopped > t || terminal && completed + skipped + attention + stopped !== t) throw failure();
      total = {...intent.counts};
    } else if (intent.counts !== undefined) throw failure();
    return {eventId:intent.eventId, type:intent.type, batchId:intent.batchId, occurredAt:intent.occurredAt, locale:intent.locale,
      ...(item ? {projectId:intent.projectId, projectName:name(intent.projectName)} : {counts:total}),
      ...(intent.reason ? {reason:intent.reason} : {}), ...(terminal ? {terminalStatus:intent.terminalStatus} : {})};
  }
  function snapshot(input) {
    if (input === null || input === undefined) return null;
    if (!batchId(input.batchId) || !STATUSES.includes(input.status) || !Array.isArray(input.items) || !input.items.length || input.items.length > 100 ||
      new Set(input.items.map(i => i.projectId)).size !== input.items.length) throw failure();
    const items = input.items.map(i => {
      if (!text(i.projectId, 512) || !ITEMS.includes(i.status)) throw failure();
      return {projectId:i.projectId, status:i.status, reason:typeof i.reason === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(i.reason) ? i.reason : undefined,
        completedAt:date(i.completedAt) ? i.completedAt : null};
    });
    return {batchId:input.batchId, status:input.status, items, startedAt:date(input.startedAt) ? input.startedAt : null,
      updatedAt:date(input.updatedAt) ? input.updatedAt : null, completedAt:date(input.completedAt) ? input.completedAt : null,
      reason:typeof input.reason === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.reason) ? input.reason : undefined};
  }
  function transitions(previous, current, {locale = "vi", projects = []} = {}) {
    const before = snapshot(previous), after = snapshot(current); if (!after) return [];
    const same = before?.batchId === after.batchId, names = new Map(projects.map(p => [p.projectId, p.projectName])), result = [];
    const emit = (type, item) => {
      const terminal = type === "batch_completed", stamp = item?.completedAt || (terminal ? after.completedAt : type === "batch_started" ? after.startedAt : after.updatedAt) || after.updatedAt;
      result.push(validate({type, batchId:after.batchId, eventId:eventId(type, after.batchId, item?.projectId, after.status), occurredAt:stamp, locale,
        ...(item ? {projectId:item.projectId, projectName:name(names.get(item.projectId)), ...(item.reason ? {reason:item.reason} : {})} : {counts:counts(after)}),
        ...(type === "batch_interrupted" && after.reason ? {reason:after.reason} : {}), ...(terminal ? {terminalStatus:after.status} : {})}));
    };
    if (after.status === "running" && (!before || !same || before.status === "draft")) emit("batch_started");
    const oldItems = new Map((same ? before.items : []).map(i => [i.projectId, i]));
    for (const item of after.items) if (oldItems.get(item.projectId)?.status !== item.status) {
      if (item.status === "completed") emit("video_completed", item);
      else if (item.status === "needs_attention") emit("needs_attention", item);
    }
    if (after.status === "interrupted" && (!same || before.status !== "interrupted")) emit("batch_interrupted");
    if (["completed", "completed_with_attention"].includes(after.status) && (!same || !["completed", "completed_with_attention"].includes(before.status))) emit("batch_completed");
    return result;
  }
  return {TYPES, keys, text, date, name, eventId, validIdentity, validate, snapshot, transitions};
});
