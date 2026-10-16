"use strict";

const { getModel, listModels } = require("./model-catalog");
const { failure } = require("./generation-job");
const { validateProviderAdapter, normalizeProviderStatus } = require("./provider-contract");

class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    validateProviderAdapter(adapter);
    if (
      adapter.modelIds.some(id => getModel(id)?.provider !== adapter.id) ||
      this.adapters.has(adapter.id)
    ) {
      throw failure("INVALID_PROVIDER");
    }
    this.adapters.set(adapter.id, adapter);
    return adapter.id;
  }

  registerProvider(adapter) {
    return this.register(adapter);
  }

  get(id) {
    return this.adapters.get(id);
  }

  getProvider(id) {
    return this.get(id);
  }

  hasProvider(id) {
    return this.adapters.has(id);
  }

  listProviders() {
    return Array.from(this.adapters.values()).map(adapter => ({
      id: adapter.id,
      modelIds: [...adapter.modelIds]
    }));
  }

  async getProviderStatuses() {
    const statuses = [];
    for (const [id, adapter] of this.adapters) {
      try {
        statuses.push(normalizeProviderStatus(await adapter.readiness(), id));
      } catch {
        statuses.push({ id, state: "error", ready: false });
      }
    }
    return statuses;
  }

  async readiness() {
    const availability = Object.fromEntries(listModels().map(model => [model.provider, false]));
    const modelIds = [];
    const providers = await this.getProviderStatuses();

    for (const status of providers) {
      if (!status.ready) continue;
      const adapter = this.adapters.get(status.id);
      availability[status.id] = true;
      modelIds.push(...adapter.modelIds);
    }

    let state = "not_configured";
    if (modelIds.length > 0) state = "ready";
    else if (providers.some(provider => provider.state === "error")) state = "error";
    else if (providers.some(provider => provider.state === "unavailable")) state = "unavailable";
    else if (providers.length && providers.every(provider => provider.state === "not_configured")) state = "not_configured";

    return {
      ready: modelIds.length > 0,
      state,
      availability,
      modelIds,
      providers
    };
  }
}

module.exports = { ProviderRegistry };
