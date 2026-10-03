const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sqliteApi() {
  try {
    return require("node:sqlite");
  } catch (error) {
    const wrapped = new Error("SQLite backup requires Node.js with node:sqlite support.");
    wrapped.code = "SQLITE_DRIVER_UNAVAILABLE";
    wrapped.cause = error;
    throw wrapped;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);

  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest("hex");
}

function verifySqliteBackup(filePath) {
  const { DatabaseSync } = sqliteApi();
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    const error = new Error("Backup file does not exist.");
    error.code = "BACKUP_NOT_FOUND";
    throw error;
  }

  const db = new DatabaseSync(resolved, { readOnly: true });

  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrity = integrityRows.map(row => row.integrity_check);
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      const error = new Error("SQLite backup integrity check failed.");
      error.code = "BACKUP_INTEGRITY_FAILED";
      error.details = { integrity };
      throw error;
    }

    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'state_sections'"
    ).get();

    if (!table) {
      const error = new Error("SQLite backup is missing the state_sections table.");
      error.code = "BACKUP_SCHEMA_INVALID";
      throw error;
    }

    const sections = db.prepare(
      "SELECT section FROM state_sections ORDER BY section"
    ).all().map(row => row.section);

    return {
      ok: true,
      filePath: resolved,
      sizeBytes: fs.statSync(resolved).size,
      sha256: sha256File(resolved),
      sections
    };
  } finally {
    try { db.close(); } catch {}
  }
}

function cleanupOldBackups(backupDir, keep) {
  const safeKeep = Math.max(1, Math.min(365, Number(keep || 14)));
  const entries = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^state-backup-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite$/.test(entry.name))
    .map(entry => {
      const filePath = path.join(backupDir, entry.name);
      return {
        name: entry.name,
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed = [];
  for (const entry of entries.slice(safeKeep)) {
    try {
      fs.rmSync(entry.filePath, { force: true });
      fs.rmSync(entry.filePath + ".json", { force: true });
      removed.push(entry.name);
    } catch {}
  }

  return removed;
}

async function createSqliteBackup({
  sourcePath,
  backupDir,
  keep = 14,
  now = new Date()
}) {
  const { DatabaseSync, backup } = sqliteApi();

  if (typeof backup !== "function") {
    const error = new Error("This Node.js runtime does not provide sqlite.backup().");
    error.code = "SQLITE_BACKUP_UNAVAILABLE";
    throw error;
  }

  const source = path.resolve(sourcePath);
  const targetDir = path.resolve(backupDir);

  if (!fs.existsSync(source)) {
    const error = new Error("SQLite source state file does not exist.");
    error.code = "BACKUP_SOURCE_NOT_FOUND";
    throw error;
  }

  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  const stamp = now.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const suffix = crypto.randomBytes(4).toString("hex");
  const fileName = "state-backup-" + stamp + "-" + suffix + ".sqlite";
  const target = path.join(targetDir, fileName);

  const sourceDb = new DatabaseSync(source, { readOnly: true });

  try {
    await backup(sourceDb, target);
  } catch (error) {
    try { fs.rmSync(target, { force: true }); } catch {}
    const wrapped = new Error("SQLite online backup failed.");
    wrapped.code = "BACKUP_FAILED";
    wrapped.cause = error;
    throw wrapped;
  } finally {
    try { sourceDb.close(); } catch {}
  }

  try { fs.chmodSync(target, 0o600); } catch {}

  const verification = verifySqliteBackup(target);
  const manifest = {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    file: fileName,
    sizeBytes: verification.sizeBytes,
    sha256: verification.sha256,
    integrity: "ok",
    sections: verification.sections
  };

  fs.writeFileSync(target + ".json", JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  try { fs.chmodSync(target + ".json", 0o600); } catch {}

  const removed = cleanupOldBackups(targetDir, keep);

  return {
    ...manifest,
    filePath: target,
    manifestPath: target + ".json",
    removed
  };
}

module.exports = {
  sha256File,
  verifySqliteBackup,
  cleanupOldBackups,
  createSqliteBackup
};
