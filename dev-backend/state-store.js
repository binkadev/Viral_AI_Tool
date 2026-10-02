const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_STATE = Object.freeze({
  version: 1,
  users: {},
  refreshSessions: {},
  processedBillingEvents: {},
  jobs: {
    speech: { jobs: {}, idempotency: {} },
    translation: { jobs: {}, idempotency: {} },
    voice: { jobs: {}, idempotency: {} }
  },
  billing: {
    checkoutSessions: {},
    portalSessions: {},
    invoices: {}
  },
  meta: {
    createdAt: null,
    updatedAt: null
  }
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeState(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    users: input.users && typeof input.users === "object" ? input.users : {},
    refreshSessions: input.refreshSessions && typeof input.refreshSessions === "object"
      ? input.refreshSessions
      : {},
    processedBillingEvents: input.processedBillingEvents && typeof input.processedBillingEvents === "object"
      ? input.processedBillingEvents
      : {},
    jobs: {
      speech: input.jobs?.speech && typeof input.jobs.speech === "object"
        ? input.jobs.speech
        : { jobs: {}, idempotency: {} },
      translation: input.jobs?.translation && typeof input.jobs.translation === "object"
        ? input.jobs.translation
        : { jobs: {}, idempotency: {} },
      voice: input.jobs?.voice && typeof input.jobs.voice === "object"
        ? input.jobs.voice
        : { jobs: {}, idempotency: {} }
    },
    billing: {
      checkoutSessions: input.billing?.checkoutSessions && typeof input.billing.checkoutSessions === "object"
        ? input.billing.checkoutSessions
        : {},
      portalSessions: input.billing?.portalSessions && typeof input.billing.portalSessions === "object"
        ? input.billing.portalSessions
        : {},
      invoices: input.billing?.invoices && typeof input.billing.invoices === "object"
        ? input.billing.invoices
        : {}
    },
    meta: {
      createdAt: input.meta?.createdAt || null,
      updatedAt: input.meta?.updatedAt || null
    }
  };
}

function createDurableStateStore(filePath) {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });

  let state = clone(DEFAULT_STATE);
  let recovery = null;

  function load() {
    if (!fs.existsSync(resolved)) {
      const now = new Date().toISOString();
      state.meta.createdAt = now;
      state.meta.updatedAt = now;
      save();
      return clone(state);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
      state = mergeState(raw);
      if (!state.meta.createdAt) state.meta.createdAt = new Date().toISOString();
      return clone(state);
    } catch (error) {
      const backup = resolved + ".corrupt-" + Date.now();
      try { fs.renameSync(resolved, backup); } catch {}

      const now = new Date().toISOString();
      state = clone(DEFAULT_STATE);
      state.meta.createdAt = now;
      state.meta.updatedAt = now;
      recovery = {
        code: "STATE_CORRUPT_RECOVERED",
        backup,
        at: now
      };
      save();
      return clone(state);
    }
  }

  function save() {
    state.meta.updatedAt = new Date().toISOString();

    const temp = resolved + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
    const body = JSON.stringify(state, null, 2);

    fs.writeFileSync(temp, body, { encoding: "utf8", mode: 0o600 });
    try {
      const fd = fs.openSync(temp, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch {}

    fs.renameSync(temp, resolved);
    try { fs.chmodSync(resolved, 0o600); } catch {}
  }

  function get(section, fallback = null) {
    if (!Object.prototype.hasOwnProperty.call(state, section)) return clone(fallback);
    return clone(state[section]);
  }

  function set(section, value) {
    state[section] = clone(value);
    save();
    return clone(state[section]);
  }

  function mutate(section, updater, fallback = {}) {
    const current = clone(
      Object.prototype.hasOwnProperty.call(state, section)
        ? state[section]
        : fallback
    );
    const next = updater(current);
    state[section] = clone(next === undefined ? current : next);
    save();
    return clone(state[section]);
  }

  function snapshot() {
    return clone(state);
  }

  load();

  return {
    path: resolved,
    get,
    set,
    mutate,
    save,
    snapshot,
    recovery: () => clone(recovery)
  };
}

module.exports = {
  createDurableStateStore
};
