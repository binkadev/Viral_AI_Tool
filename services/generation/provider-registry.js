"use strict";
const { getModel, listModels } = require("./model-catalog");
const { failure } = require("./generation-job");
// Native-only adapter contract: readiness(), preflight(context), start(context),
// reconcile(context), cancel(context). Context contains the durable jobId as the
// provider idempotency key, normalized request, modelId and a private outputDirectory.
// start/reconcile return {status: completed|failed|cancelled|pending, fileName?}.
// cancel returns {confirmed: true} only when remote work has stopped AND local
// partial outputs have been cleaned. No credentials, raw responses or remote IDs
// cross this contract. Adapters privately own auth and remote job mappings.
// preflight must check quota, connectivity and relevant resources before submission.
class ProviderRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) {
    if (!adapter || !["readiness", "preflight", "start", "reconcile", "cancel"].every(k => typeof adapter[k] === "function") ||
        !Array.isArray(adapter.modelIds) || !adapter.modelIds.length || adapter.modelIds.some(id => getModel(id)?.provider !== adapter.id) ||
        this.adapters.has(adapter.id)) throw failure("INVALID_PROVIDER");
    this.adapters.set(adapter.id, adapter);
  }
  get(id) { return this.adapters.get(id); }
  async readiness() {
    const availability = Object.fromEntries(listModels().map(m => [m.provider, false]));
    const modelIds = [];
    for (const [id, adapter] of this.adapters) {
      try {
        if ((await adapter.readiness())?.ready === true) {
          availability[id] = true;
          modelIds.push(...adapter.modelIds);
        }
      } catch { /* Fail closed; never expose adapter errors. */ }
    }
    return { ready: modelIds.length > 0, availability, modelIds };
  }
}
module.exports = { ProviderRegistry };
