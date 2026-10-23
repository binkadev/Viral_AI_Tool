"use strict";
const fs = require("node:fs"), path = require("node:path"), {atomic, failure} = require("./storage");
const {keys, name} = require("../../renderer/core-telegram-notifications-model");
const VERSION = 1;
function token(value) {
  if (typeof value !== "string" || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw failure("TELEGRAM_INVALID_REQUEST");
  const result = value.trim(); if (!/^[1-9][0-9]{4,19}:[A-Za-z0-9_-]{20,100}$/.test(result)) throw failure("TELEGRAM_INVALID_REQUEST"); return result;
}
function chat(value) {
  if (typeof value !== "string" || !/^-?[1-9][0-9]{0,19}$/.test(value)) throw failure("TELEGRAM_INVALID_REQUEST"); return value;
}
function bot(value) {
  if (!value || value.is_bot !== true || !Number.isSafeInteger(value.id) || value.id <= 0) throw failure("TELEGRAM_AUTH_FAILED");
  return {id:value.id, username:typeof value.username === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value.username) ? value.username : "",
    firstName:name(value.first_name).slice(0, 80)};
}
function createConfigStore({userDataPath, safeStorage, io = fs, now = () => new Date().toISOString()}) {
  const file = path.join(userDataPath, "telegram-config.json"); let current = null, error = null;
  const secure = () => {try {return safeStorage?.isEncryptionAvailable() === true && typeof safeStorage.encryptString === "function" && typeof safeStorage.decryptString === "function";} catch {return false;}};
  try {
    const raw = io.readFileSync(file, "utf8"); if (raw.length > 20000) throw Error(); const v = JSON.parse(raw);
    keys(v, ["version", "encryptedBotToken", "chatId", "enabled", "bot", "updatedAt"]);
    if (v.version !== VERSION || typeof v.enabled !== "boolean" || typeof v.updatedAt !== "string" || !Number.isFinite(Date.parse(v.updatedAt))) throw Error();
    if (v.encryptedBotToken === null && v.chatId === null && v.enabled === false && v.bot === null) current = null;
    else {
      chat(v.chatId); if (typeof v.encryptedBotToken !== "string" || !/^[A-Za-z0-9+/]{4,16000}={0,2}$/.test(v.encryptedBotToken)) throw Error();
      const ciphertext = Buffer.from(v.encryptedBotToken, "base64");
      if (ciphertext.toString("base64") !== v.encryptedBotToken) throw Error();
      if (secure()) token(safeStorage.decryptString(ciphertext));
      keys(v.bot, ["id", "username", "firstName"]);
      const meta = bot({id:v.bot.id, is_bot:true, username:v.bot.username, first_name:v.bot.firstName});
      current = {...v, bot:meta};
    }
  } catch (e) {if (e.code !== "ENOENT") error = "TELEGRAM_CONFIG_PROTECTED";}
  function status() {return {configured:!!current && !error, enabled:!!current?.enabled && !error, chatIdMasked:current ? "••••" + current.chatId.slice(-4) : null,
    bot:current ? {username:current.bot.username, firstName:current.bot.firstName} : null, secureStorageAvailable:secure(), code:error || (!secure() ? "SECURE_STORAGE_UNAVAILABLE" : null)};}
  function write(next) {try {atomic(file, next, io);} catch {throw failure("TELEGRAM_CONFIG_WRITE_FAILED");} current = next.encryptedBotToken === null ? null : next; error = null; return status();}
  function credentials() {
    if (error) throw failure(error); if (!current) throw failure("TELEGRAM_NOT_CONFIGURED"); if (!secure()) throw failure("SECURE_STORAGE_UNAVAILABLE");
    try {return {botToken:token(safeStorage.decryptString(Buffer.from(current.encryptedBotToken, "base64"))), chatId:current.chatId, enabled:current.enabled};}
    catch {error = "TELEGRAM_CONFIG_PROTECTED"; throw failure(error);}
  }
  return {status, credentials, save({botToken, chatId, enabled, bot:metadata}) {
    if (error) throw failure(error); if (!secure()) throw failure("SECURE_STORAGE_UNAVAILABLE");
    let encrypted; try {encrypted = safeStorage.encryptString(token(botToken)).toString("base64");} catch {throw failure("SECURE_STORAGE_UNAVAILABLE");}
    if (!encrypted || typeof enabled !== "boolean") throw failure("TELEGRAM_INVALID_REQUEST");
    const meta = bot({id:metadata?.id, is_bot:true, username:metadata?.username, first_name:metadata?.firstName});
    return write({version:VERSION, encryptedBotToken:encrypted, chatId:chat(chatId), enabled, bot:meta, updatedAt:now()});
  }, setEnabled(enabled) {
    if (error) throw failure(error); if (!current) throw failure("TELEGRAM_NOT_CONFIGURED"); if (typeof enabled !== "boolean") throw failure("TELEGRAM_INVALID_REQUEST");
    return write({...current, enabled, updatedAt:now()});
  }, clear() {
    // Durable disabled tombstone first: even an unlink failure cannot reactivate
    // credentials on restart. No decrypted token is retained in memory.
    try {write({version:VERSION, encryptedBotToken:null, chatId:null, enabled:false, bot:null, updatedAt:now()});}
    catch {current = null; error = "TELEGRAM_CONFIG_PROTECTED"; throw failure("TELEGRAM_CONFIG_WRITE_FAILED");}
    try {io.rmSync(file, {force:true});} catch {} return status();
  }};
}
module.exports = {VERSION, token, chat, bot, createConfigStore};
