"use strict";
function registerTelegramIpc({ipcMain, trusted, service}) {
  const methods = {status:"status", "config-save":"save", "config-clear":"clear", test:"test", notify:"notify"};
  for (const [action, method] of Object.entries(methods)) ipcMain.handle("telegram:" + action, async (event, ...args) => {
    if (!trusted(event)) return {ok:false, code:"TELEGRAM_UNAUTHORIZED"};
    const payload = ["config-save", "notify"].includes(action);
    if (args.length !== (payload ? 1 : 0)) return {ok:false, code:"TELEGRAM_INVALID_REQUEST"};
    const target = service(); if (!target) return {ok:false, code:"TELEGRAM_NOT_CONFIGURED"};
    try {const result = await target[method](...args); return action === "status" ? {ok:true, data:result} : result;}
    catch {return {ok:false, code:"TELEGRAM_SEND_FAILED"};}
  });
}
module.exports = {registerTelegramIpc};
