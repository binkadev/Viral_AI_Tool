const path = require("path");

function createSqliteStateStore(filePath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (error) {
    const wrapped = new Error("SQLite state driver requires Node.js with node:sqlite support.");
    wrapped.code = "SQLITE_DRIVER_UNAVAILABLE";
    wrapped.cause = error;
    throw wrapped;
  }

  const resolved = path.resolve(filePath);
  const db = new DatabaseSync(resolved);

  db.exec([
    "PRAGMA journal_mode = WAL;",
    "PRAGMA synchronous = FULL;",
    "PRAGMA foreign_keys = ON;",
    "PRAGMA busy_timeout = 5000;",
    "CREATE TABLE IF NOT EXISTS state_sections (",
    "  section TEXT PRIMARY KEY,",
    "  payload TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ");"
  ].join("\n"));

  const selectOne = db.prepare(
    "SELECT payload FROM state_sections WHERE section = ?"
  );
  const selectAll = db.prepare(
    "SELECT section, payload FROM state_sections ORDER BY section"
  );
  const upsert = db.prepare([
    "INSERT INTO state_sections(section, payload, updated_at)",
    "VALUES (?, ?, ?)",
    "ON CONFLICT(section) DO UPDATE SET",
    "  payload = excluded.payload,",
    "  updated_at = excluded.updated_at"
  ].join("\n"));

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function parsePayload(section, payload, fallback) {
    try {
      return JSON.parse(payload);
    } catch (error) {
      const wrapped = new Error("SQLite state section is corrupt: " + section);
      wrapped.code = "STATE_CORRUPT";
      wrapped.details = { section };
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function get(section, fallback = null) {
    const row = selectOne.get(String(section));
    if (!row) return clone(fallback);
    return clone(parsePayload(section, row.payload, fallback));
  }

  function set(section, value) {
    const safeSection = String(section || "").trim();
    if (!safeSection || safeSection.length > 120) {
      const error = new Error("State section name is invalid.");
      error.code = "STATE_SECTION_INVALID";
      throw error;
    }

    const payload = JSON.stringify(value);
    const updatedAt = new Date().toISOString();

    db.exec("BEGIN IMMEDIATE");
    try {
      upsert.run(safeSection, payload, updatedAt);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    return clone(value);
  }

  function mutate(section, updater, fallback = {}) {
    const current = get(section, fallback);
    const next = updater(clone(current));
    return set(section, next === undefined ? current : next);
  }

  function snapshot() {
    const result = {};
    for (const row of selectAll.all()) {
      result[row.section] = parsePayload(row.section, row.payload, null);
    }
    return clone(result);
  }

  function close() {
    try { db.close(); } catch {}
  }

  return {
    driver: "sqlite",
    path: resolved,
    get,
    set,
    mutate,
    save: () => true,
    snapshot,
    recovery: () => null,
    close
  };
}

module.exports = {
  createSqliteStateStore
};
