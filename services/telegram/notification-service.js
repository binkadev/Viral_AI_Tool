"use strict";
const model = require("../../renderer/core-telegram-notifications-model"), {I18N} = require("../../renderer/i18n");
const {token, chat} = require("./config-store"), {failure, code} = require("./storage");
const REASONS = {PROJECT_NOT_FOUND:"reasonProjectMissing", USER_INTERVENTION:"reasonIntervention", PROJECT_WORK_RUNNING:"reasonWork", PROJECT_TRANSITION_PENDING:"reasonWork", PROJECT_STORAGE_PROTECTED:"reasonStorage", PROJECT_SAVE_FAILED:"reasonStorage", BATCH_STORAGE_FAILED:"reasonStorage", BATCH_STORAGE_PROTECTED:"reasonStorage", OUTPUT_UNAVAILABLE:"reasonOutput", OUTPUT_REQUIRED:"reasonOutput", LOW_DISK_SPACE:"reasonSpace", MATERIALS_ATTENTION:"reasonMaterials", NO_SCENES:"reasonNoScenes", RECOVERY_REQUIRED:"reasonRecovery", VOICE_REQUIRED:"reasonVoice", VOICE_UNAVAILABLE:"reasonVoice", VOICE_FAILED:"reasonVoice", RENDER_FAILED:"reasonRender", OUTPUT_MISSING:"reasonRender", PROJECT_RENDER_VOICE_REQUIRED:"reasonVoice", PROJECT_RENDER_VOICE_STALE:"reasonVoice", PROJECT_RENDER_BGM_UNAVAILABLE:"reasonBgm", PROJECT_RENDER_MEDIA_MISSING:"reasonMedia", PROJECT_RENDER_TIMING_INVALID:"reasonTiming", PROJECT_RENDER_PROFILE_UNRESOLVED:"reasonProfile", PROJECT_RENDER_INCOMPLETE:"reasonRender", PROJECT_RENDER_INPUT_CHANGED:"reasonChanged"};
function format(intent) {
  const tr = (key, vars) => I18N.t(intent.locale, "telegramNotifications." + key, vars);
  const key = {batch_started:"messageStarted", video_completed:"messageVideo", needs_attention:"messageAttention", batch_interrupted:"messageInterrupted", batch_completed:"messageCompleted"}[intent.type];
  return tr(key, {...intent.counts, name:model.name(intent.projectName) || tr("project"), reason:tr(REASONS[intent.reason] || "reasonGeneric")}).slice(0, 3000);
}
function createNotificationService({config, journal, client, locale = () => "vi"}) {
  let revision = 0, saving = false, testing = null, lastTest = null;
  const status = () => {const c = config.status(), j = journal.status(); return {...c, journalProtected:j.protected, code:c.code || j.code, lastTest};};
  const result = e => ({ok:false, code:code(e)});
  async function save(payload) {
    try {
      model.keys(payload, ["botToken", "chatId", "enabled"]);
      if (typeof payload.enabled !== "boolean") throw failure("TELEGRAM_INVALID_REQUEST");
      if (saving || testing) throw failure("TELEGRAM_BUSY");
      if (payload.botToken === undefined) {
        if (payload.chatId !== undefined) throw failure("TELEGRAM_INVALID_REQUEST");
        config.setEnabled(payload.enabled); if (!payload.enabled) {revision++; client.abortAll();} return {ok:true, data:status()};
      }
      let newToken = token(payload.botToken); const chatId = chat(payload.chatId), current = config.status();
      if (!current.secureStorageAvailable) throw failure("SECURE_STORAGE_UNAVAILABLE");
      if (current.code) throw failure(current.code);
      saving = true; const captured = ++revision;
      client.abortAll();
      try {
        const verified = await client.verify(newToken);
        if (captured !== revision) throw failure("TELEGRAM_DISCONNECTED");
        if (!verified.ok) throw failure(verified.code);
        config.save({botToken:newToken, chatId, enabled:payload.enabled, bot:verified.bot}); lastTest = null;
        return {ok:true, data:status()};
      } finally {newToken = null; saving = false;}
    } catch (e) {return result(e);}
  }
  async function notify(raw) {
    let intent, reserved = false;
    try {
      intent = model.validate(raw); const s = status();
      if (s.journalProtected) throw failure(s.code);
      const suppressed = !s.configured || !s.enabled || !s.secureStorageAvailable || !!s.code;
      if (!journal.reserve(intent, suppressed)) return {ok:true, deduped:true};
      reserved = true;
      if (suppressed) return {ok:true, suppressed:true};
      let credentials = config.credentials(); const captured = revision;
      try {
        const outcome = await client.send(credentials.botToken, credentials.chatId, format(intent));
        if (captured !== revision && outcome.ok) {journal.finish(intent.eventId, "uncertain", "TELEGRAM_DISCONNECTED"); return {ok:false, code:"TELEGRAM_DISCONNECTED"};}
        journal.finish(intent.eventId, outcome.ok ? "delivered" : outcome.uncertain ? "uncertain" : "failed", outcome.ok ? null : outcome.code);
        return outcome.ok ? {ok:true} : {ok:false, code:outcome.code};
      } finally {credentials = null;}
    } catch (e) {
      if (reserved) try {journal.finish(intent.eventId, "uncertain", code(e));} catch {}
      return result(e);
    }
  }
  function test() {
    if (testing) return testing;
    if (saving) return Promise.resolve({ok:false, code:"TELEGRAM_BUSY"});
    const captured = revision;
    testing = Promise.resolve().then(async () => {
      let credentials;
      try {
        credentials = config.credentials();
        const outcome = await client.send(credentials.botToken, credentials.chatId, I18N.t(locale() === "en" ? "en" : "vi", "telegramNotifications.testCopy"));
        if (captured !== revision) throw failure("TELEGRAM_DISCONNECTED");
        lastTest = outcome.ok ? "ok" : outcome.code; return outcome.ok ? {ok:true} : {ok:false, code:outcome.code};
      } catch (e) {lastTest = code(e); return result(e);} finally {credentials = null;}
    }).finally(() => {testing = null;}); return testing;
  }
  function clear() {revision++; client.abortAll(); lastTest = null; try {config.clear(); return {ok:true, data:status()};} catch (e) {return result(e);}}
  return {status, save, clear, test, notify};
}
module.exports = {REASONS, format, createNotificationService};
