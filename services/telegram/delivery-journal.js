"use strict";
const fs = require("node:fs"), path = require("node:path"), {atomic, failure, CODES} = require("./storage");
const model = require("../../renderer/core-telegram-notifications-model");
const VERSION = 1, MAX_RECORDS = 500, STATES = ["sending", "delivered", "failed", "uncertain", "suppressed"];
function createDeliveryJournal({userDataPath, io = fs, now = () => new Date().toISOString()}) {
  const file = path.join(userDataPath, "telegram-notification-state.json");
  let data = {version:VERSION, retiredThrough:null, records:[]}, error = null;
  function write(next) {try {atomic(file, next, io);} catch {error = "TELEGRAM_JOURNAL_WRITE_FAILED"; throw failure(error);} data = next;}
  try {
    const raw = io.readFileSync(file, "utf8"); if (raw.length > 1500000) throw Error(); const v = JSON.parse(raw);
    model.keys(v, ["version", "retiredThrough", "records"]);
    if (v.version !== VERSION || v.retiredThrough !== null && !model.date(v.retiredThrough) || !Array.isArray(v.records) || v.records.length > MAX_RECORDS) throw Error();
    const seen = new Set();
    for (const r of v.records) {
      model.keys(r, ["eventId", "type", "status", "occurredAt", "attemptedAt", "completedAt", "code"]);
      if (!model.validIdentity(r.eventId, r.type) || seen.has(r.eventId) || !model.TYPES.includes(r.type) || !STATES.includes(r.status) ||
        !model.date(r.occurredAt) || !model.date(r.attemptedAt) || r.completedAt !== null && !model.date(r.completedAt) || r.code !== null && !CODES.includes(r.code)) throw Error();
      seen.add(r.eventId);
    }
    data = v;
    if (v.records.some(r => r.status === "sending")) write({...v, records:v.records.map(r => r.status === "sending" ? {...r, status:"uncertain", completedAt:now(), code:"TELEGRAM_SEND_FAILED"} : r)});
  } catch (e) {if (e.code !== "ENOENT") error ||= "TELEGRAM_JOURNAL_PROTECTED";}
  const assert = () => {if (error) throw failure(error);};
  return {status:() => ({protected:!!error, code:error, count:data.records.length}),
    reserve(intent, suppressed = false) {
      assert(); if (data.records.some(r => r.eventId === intent.eventId) || data.retiredThrough && Date.parse(intent.occurredAt) <= Date.parse(data.retiredThrough)) return false;
      const next = {version:VERSION, retiredThrough:data.retiredThrough, records:data.records.map(r => ({...r}))};
      if (next.records.length === MAX_RECORDS) {
        const candidates = next.records.filter(r => r.status !== "sending").sort((a,b) => Date.parse(a.occurredAt)-Date.parse(b.occurredAt) || a.eventId.localeCompare(b.eventId));
        if (!candidates.length) throw failure("TELEGRAM_BUSY");
        const retired = candidates[0]; next.records = next.records.filter(r => r !== retired);
        // Original deterministic event timestamps below this retirement boundary
        // fail closed even after their individual dedupe record is evicted.
        if (!next.retiredThrough || Date.parse(retired.occurredAt) > Date.parse(next.retiredThrough)) next.retiredThrough = retired.occurredAt;
      }
      next.records.push({eventId:intent.eventId, type:intent.type, status:suppressed ? "suppressed" : "sending", occurredAt:intent.occurredAt, attemptedAt:now(), completedAt:suppressed ? now() : null, code:suppressed ? "TELEGRAM_DISABLED" : null});
      write(next); return true;
    }, finish(eventId, status, code = null) {
      assert(); if (!["delivered", "failed", "uncertain"].includes(status) || code !== null && !CODES.includes(code)) throw failure("TELEGRAM_INVALID_REQUEST");
      write({...data, records:data.records.map(r => r.eventId === eventId && r.status === "sending" ? {...r, status, code, completedAt:now()} : r)});
    }};
}
module.exports = {VERSION, MAX_RECORDS, createDeliveryJournal};
