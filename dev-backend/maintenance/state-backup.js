const path = require("path");
const {
  createSqliteBackup,
  verifySqliteBackup
} = require("../sqlite-backup");

async function main() {
  const command = String(process.argv[2] || "backup").toLowerCase();

  if (command === "verify") {
    const target = process.argv[3];
    if (!target) throw new Error("Usage: node state-backup.js verify <backup.sqlite>");

    const result = verifySqliteBackup(path.resolve(target));
    console.log(JSON.stringify({
      ok: true,
      file: path.basename(result.filePath),
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      sections: result.sections
    }, null, 2));
    return;
  }

  const dataDir = path.resolve(
    process.env.VIRAL_AI_DEV_DATA_DIR || path.join(__dirname, "..", "data")
  );
  const sourcePath = path.join(dataDir, "state.sqlite");
  const backupDir = path.resolve(
    process.env.VIRAL_AI_BACKUP_DIR || path.join(dataDir, "backups")
  );
  const keep = Number(process.env.VIRAL_AI_BACKUP_KEEP || 14);

  const result = await createSqliteBackup({
    sourcePath,
    backupDir,
    keep
  });

  console.log(JSON.stringify({
    ok: true,
    file: result.file,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
    integrity: result.integrity,
    sections: result.sections,
    removedOldBackups: result.removed
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || "BACKUP_FAILED",
    message: error?.message || String(error)
  }, null, 2));
  process.exitCode = 1;
});
