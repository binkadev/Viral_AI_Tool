"use strict";
const { failure } = require("../generation-job");

function createMuseProvider({ configStore, browserBridge = null }) {
  const validateConfig = () => {
    const config = configStore.read("muse");
    if (config === null) return { enabled: false, state: "unconfigured", messageCode: "NOT_CONFIGURED" };
    if (!config || typeof config.enabled !== "boolean") throw failure("PROVIDER_CONFIG_ERROR");
    if (!config.enabled) return { enabled: false, state: "unavailable", messageCode: "DISABLED" };
    // Browser connectivity is not proof of authentication or generation support.
    return { enabled: true, state: "authentication_required", messageCode: "AUTHENTICATION_NOT_CONNECTED" };
  };
  async function readiness() {
    const checkedAt = new Date().toISOString();
    try {
      return { id: "muse", ...validateConfig(), ready: false, capabilities: ["text-to-video"], checkedAt };
    } catch {
      return { id: "muse", enabled: false, ready: false, state: "error",
        capabilities: ["text-to-video"], messageCode: "CONFIG_ERROR", checkedAt };
    }
  }
  async function unsupported() { throw failure("PROVIDER_UNAVAILABLE"); }
  return Object.freeze({
    id: "muse", displayName: "Muse",
    // Intended generation category only. No validated models or executable routes yet.
    capabilities: Object.freeze(["text-to-video"]), modelIds: Object.freeze([]),
    validateConfig, readiness,
    openSession: async () => {
      if (!browserBridge || !validateConfig().enabled) throw failure("PROVIDER_UNAVAILABLE");
      return browserBridge.open();
    },
    checkSession: async () => {
      if (!browserBridge) throw failure("PROVIDER_UNAVAILABLE");
      return browserBridge.check();
    },
    preflight: readiness, start: unsupported, reconcile: unsupported, cancel: unsupported
  });
}
module.exports = { createMuseProvider };
