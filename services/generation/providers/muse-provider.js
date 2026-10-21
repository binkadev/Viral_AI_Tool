"use strict";
const { failure } = require("../generation-job");
const {createMuseExecution}=require('./muse-execution');

function createMuseProvider({ configStore, extensionBridge = null, verifyVideo = null }) {
  const execution=createMuseExecution(extensionBridge,verifyVideo);
  const validateConfig = () => {
    const config = configStore.read("muse");
    if (config === null) return { enabled: false, state: "unconfigured", messageCode: "NOT_CONFIGURED" };
    if (!config || typeof config.enabled !== "boolean") throw failure("PROVIDER_CONFIG_ERROR");
    if (!config.enabled) return { enabled: false, state: "unavailable", messageCode: "DISABLED" };
    return { enabled: true, state: "unavailable", messageCode: "EXECUTION_UNAVAILABLE" };
  };
  async function readiness() {
    const checkedAt = new Date().toISOString();
    try {
      const config=validateConfig();
      const ready=config.enabled && typeof verifyVideo==='function' && await extensionBridge?.executionReady?.()===true && (typeof extensionBridge.receiptV2Ready!=='function' || await extensionBridge.receiptV2Ready());
      return { id: "muse", ...config, ...(ready?{state:'ready',messageCode:undefined}:{}), ready, capabilities: ["text-to-video"], checkedAt };
    } catch {
      return { id: "muse", enabled: false, ready: false, state: "error",
        capabilities: ["text-to-video"], messageCode: "CONFIG_ERROR", checkedAt };
    }
  }
  async function unsupported() { throw failure("PROVIDER_UNAVAILABLE"); }
  return Object.freeze({
    id: "muse", displayName: "Muse",
    // Uses the selected tab's settings; do not fabricate a model identifier.
    capabilities: Object.freeze(["text-to-video"]), modelIds: Object.freeze([]),
    validateConfig, readiness,
    diagnoseOwnership:context=>execution.diagnoseOwnership(context),
    acceptanceTrace:context=>execution.acceptanceTrace(context),
    runtimeDiagnosis: async () => {
      // Cached heartbeat/files only: never start a bridge or call execution.
      if(!extensionBridge?.developmentDiagnostics)throw failure('UNAVAILABLE');
      const connection=extensionBridge.connectionDiagnosis(),census=extensionBridge.receiverDiagnosis(),build=extensionBridge.runtimeBuildPreflight();
      const receiver=census.receivers.find(r=>r.selected);
      const providerReady=validateConfig().enabled && typeof verifyVideo==='function' && extensionBridge.cachedExecutionReady() && receiver?.receiptVersion===2;
      const {createReport}=require('../bridge/runtime-preflight');
      return createReport({connection,build,receiver,providerReady});
    },
    openSession: async () => {
      if (!extensionBridge || !validateConfig().enabled) throw failure("PROVIDER_UNAVAILABLE");
      return extensionBridge.open();
    },
    checkSession: async () => {
      if (!extensionBridge) throw failure("PROVIDER_UNAVAILABLE");
      return extensionBridge.check();
    },
    selectSession: async selection => {
      if (!extensionBridge) throw failure("PROVIDER_UNAVAILABLE");
      return extensionBridge.selectSession(selection);
    },
    openExtensionStore: async () => {
      if (!extensionBridge) throw failure("PROVIDER_UNAVAILABLE");
      return extensionBridge.openStore();
    },
    revealExtension: async () => {
      if (!extensionBridge) throw failure("PROVIDER_UNAVAILABLE");
      return extensionBridge.revealExtension();
    },
    executionMode:'single-scene-session', pollIntervalMs:2000,
    preflight: async context => context && !context.sceneId ? {ready:false} : readiness(),
    start:context=>extensionBridge?execution.start(context):unsupported(),
    reconcile:context=>extensionBridge?execution.reconcile(context):unsupported(),
    recoveryState:context=>execution.recoveryState(context),
    cancel:context=>extensionBridge?execution.cancel(context):unsupported()
  });
}
module.exports = { createMuseProvider };
