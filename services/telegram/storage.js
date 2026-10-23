"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
function atomic(file, value, io = fs) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  try {io.mkdirSync(path.dirname(file), {recursive:true}); io.writeFileSync(temp, JSON.stringify(value), {encoding:"utf8", mode:0o600}); io.renameSync(temp, file);}
  finally {try {io.rmSync(temp, {force:true});} catch {}}
}
const failure = code => Object.assign(Error(code), {code});
const CODES = ["TELEGRAM_INVALID_REQUEST", "SECURE_STORAGE_UNAVAILABLE", "TELEGRAM_CONFIG_PROTECTED", "TELEGRAM_CONFIG_WRITE_FAILED", "TELEGRAM_JOURNAL_PROTECTED", "TELEGRAM_JOURNAL_WRITE_FAILED",
  "TELEGRAM_NOT_CONFIGURED", "TELEGRAM_DISABLED", "TELEGRAM_AUTH_FAILED", "TELEGRAM_CHAT_NOT_FOUND", "TELEGRAM_RATE_LIMITED", "TELEGRAM_REQUEST_REJECTED", "TELEGRAM_SEND_FAILED", "TELEGRAM_NETWORK", "TELEGRAM_TIMEOUT", "TELEGRAM_BUSY", "TELEGRAM_UNAUTHORIZED", "TELEGRAM_DISCONNECTED"];
const code = error => CODES.includes(error?.code) ? error.code : "TELEGRAM_SEND_FAILED";
module.exports = {atomic, failure, CODES, code};
