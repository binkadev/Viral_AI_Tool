"use strict";
function registerPrivateBetaUpdateIpc({ ipcMain, trusted, service }) {
  const methods = { state: "snapshot", check: "check", download: "download", cancel: "cancel", install: "install", automatic: "setAutomatic" };
  for (const [action, method] of Object.entries(methods)) {
    ipcMain.handle("updates:" + action, async (event, ...args) => {
      if (!trusted(event)) return { errorCode: "UPDATE_UNAUTHORIZED" };
      if (action === "automatic" ? args.length !== 1 || typeof args[0] !== "boolean" : args.length !== 0) return { errorCode: "UPDATE_INVALID_REQUEST" };
      const updater = service();
      return updater ? updater[method](...args) : { errorCode: "UPDATE_UNAVAILABLE" };
    });
  }
}
module.exports = { registerPrivateBetaUpdateIpc };
