"use strict";
const { identifier } = require("./generation-request");
const SAFE_CODES = new Set(["INVALID_REQUEST", "NO_GENERATION_ROUTE", "PROVIDER_UNAVAILABLE", "RESOURCE_UNAVAILABLE", "STORE_UNAVAILABLE", "IDEMPOTENCY_CONFLICT", "DUPLICATE_JOB", "JOB_NOT_FOUND", "RETRY_UNSAFE", "UNAVAILABLE"]);
function registerGenerationIpc({ ipcMain, getService, trusted }) {
  const handlers = {
    status: (s, p) => { if (p !== undefined) throw 0; return s.readiness(); },
    submit: (s, p) => s.submit(p),
    list: (s, p) => { if (!identifier(p)) throw 0; return s.list(p); },
    get: (s, p) => { if (!identifier(p)) throw 0; return s.get(p); },
    cancel: (s, p) => { if (!identifier(p)) throw 0; return s.cancel(p); },
    recover: (s, p) => { if (!identifier(p)) throw 0; return s.recover(p); },
    retry: (s, p) => {
      if (!p || Object.keys(p).some(k => !["id", "idempotencyKey"].includes(k)) || !identifier(p.id) || !identifier(p.idempotencyKey)) throw 0;
      return s.retry(p.id, p.idempotencyKey);
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle("generation:" + name, async (event, payload) => {
    try {
      if (!trusted(event)) return { ok: false, errorCode: "UNAVAILABLE" };
      const service = getService();
      if (!service) return { ok: false, errorCode: "UNAVAILABLE" };
      return { ok: true, value: await handler(service, payload) };
    } catch (e) { return { ok: false, errorCode: e === 0 ? "INVALID_REQUEST" : SAFE_CODES.has(e?.code) ? e.code : "UNAVAILABLE" }; }
  });
}
module.exports = { registerGenerationIpc };
