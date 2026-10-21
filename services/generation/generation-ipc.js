"use strict";

const { identifier } = require("./generation-request");

const SAFE_CODES = new Set([
  "INVALID_REQUEST",
  "PROVIDER_CONFIG_ERROR",
  "NO_GENERATION_ROUTE",
  "PROVIDER_UNAVAILABLE",
  "RESOURCE_UNAVAILABLE",
  "STORE_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "DUPLICATE_JOB",
  "JOB_NOT_FOUND",
  "RETRY_UNSAFE",
  "UNAVAILABLE"
]);

function registerGenerationIpc({ ipcMain, getService, trusted }) {
  const noPayload = (service, payload, fn) => {
    if (payload !== undefined) throw 0;
    return fn(service);
  };

  const handlers = {
    status: (service, payload) => noPayload(service, payload, current => current.readiness()),
    providers: (service, payload) => noPayload(service, payload, async current => {
      const status = await current.readiness();
      return {
        state: status.state,
        ready: status.ready,
        providers: Array.isArray(status.providers) ? status.providers : [],
        modelIds: Array.isArray(status.modelIds) ? status.modelIds : []
      };
    }),
    "provider-check": (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.checkProvider(payload);
    },
    "provider-runtime-diagnosis": (service,payload) => {
      if(!identifier(payload))throw 0;
      return service.providerRuntimeDiagnosis(payload);
    },
    "acceptance-trace": (service,payload) => {
      if(!identifier(payload))throw 0;
      return service.acceptanceTrace(payload);
    },
    "ownership-diagnosis": (service,payload) => {
      if(!identifier(payload))throw 0;
      return service.diagnoseMuseOwnership(payload);
    },
    "provider-session-open": (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.providerSession(payload, true);
    },
    "provider-session-check": (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.providerSession(payload);
    },
    "provider-session-select": (service, payload) => {
      const {instanceId, tabId} = require("./bridge/session-status");
      if (!payload || Object.getPrototypeOf(payload) !== Object.prototype ||
          Object.keys(payload).length !== 3 || !identifier(payload.id) ||
          !instanceId(payload.instanceId) || !(payload.tabId === null || tabId(payload.tabId))) throw 0;
      return service.selectProviderSession(payload.id, {instanceId:payload.instanceId, tabId:payload.tabId});
    },
    "provider-extension-store": (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.openProviderExtensionStore(payload);
    },
    "provider-extension-reveal": (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.revealProviderExtension(payload);
    },
    "provider-configure": (service, payload) => {
      if (!payload || Object.getPrototypeOf(payload) !== Object.prototype ||
          Object.keys(payload).length !== 2 || !identifier(payload.id) ||
          typeof payload.enabled !== "boolean") throw 0;
      return service.configureProvider(payload.id, { enabled: payload.enabled });
    },
    submit: (service, payload) => service.submit(payload),
    list: (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.list(payload).map(job => service.publicJob(job));
    },
    get: (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.publicJob(service.get(payload));
    },
    output: (service,payload)=>{
      if(!identifier(payload))throw 0;
      return service.output(payload);
    },
    cancel: (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.cancel(payload);
    },
    recover: (service, payload) => {
      if (!identifier(payload)) throw 0;
      return service.recover(payload);
    },
    retry: (service, payload) => {
      if (
        !payload ||
        Object.keys(payload).some(key => !["id", "idempotencyKey"].includes(key)) ||
        !identifier(payload.id) ||
        !identifier(payload.idempotencyKey)
      ) throw 0;
      return service.retry(payload.id, payload.idempotencyKey);
    }
  };

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle("generation:" + name, async (event, payload) => {
      try {
        if (!trusted(event)) return { ok: false, errorCode: "UNAVAILABLE" };
        const service = getService();
        if (!service) return { ok: false, errorCode: "UNAVAILABLE" };
        return { ok: true, value: await handler(service, payload) };
      } catch (error) {
        return {
          ok: false,
          errorCode: error === 0
            ? "INVALID_REQUEST"
            : SAFE_CODES.has(error?.code)
              ? error.code
              : "UNAVAILABLE"
        };
      }
    });
  }
}

module.exports = { registerGenerationIpc };
