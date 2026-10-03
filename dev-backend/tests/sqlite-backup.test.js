const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSqliteStateStore } = require("../state-store-sqlite");
const {
  createSqliteBackup,
  verifySqliteBackup,
  cleanupOldBackups
} = require("../sqlite-backup");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-backup-test-"));
  const source = path.join(root, "state.sqlite");
  const backupDir = path.join(root, "backups");

  try {
    const store = createSqliteStateStore(source);
    store.set("users", {
      "owner@example.test": {
        id: "user-1",
        quota: { remainingMinutes: 123 }
      }
    });
    store.set("processedBillingEvents", {
      "evt_test_1": 1234567890
    });

    const first = await createSqliteBackup({
      sourcePath: source,
      backupDir,
      keep: 2,
      now: new Date("2026-10-03T00:00:00.000Z")
    });

    assert.strictEqual(first.integrity, "ok");
    assert.strictEqual(first.sha256.length, 64);
    assert(first.sections.includes("users"));
    assert(first.sections.includes("processedBillingEvents"));
    assert(fs.existsSync(first.filePath));
    assert(fs.existsSync(first.manifestPath));

    const verified = verifySqliteBackup(first.filePath);
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.sha256, first.sha256);

    const restored = createSqliteStateStore(first.filePath);
    assert.strictEqual(
      restored.get("users")["owner@example.test"].quota.remainingMinutes,
      123
    );
    assert.strictEqual(
      restored.get("processedBillingEvents").evt_test_1,
      1234567890
    );
    restored.close();

    store.set("users", {
      "owner@example.test": {
        id: "user-1",
        quota: { remainingMinutes: 77 }
      }
    });

    const oldBackup = createSqliteStateStore(first.filePath);
    assert.strictEqual(
      oldBackup.get("users")["owner@example.test"].quota.remainingMinutes,
      123,
      "backup must remain an immutable point-in-time snapshot"
    );
    oldBackup.close();

    await createSqliteBackup({
      sourcePath: source,
      backupDir,
      keep: 2,
      now: new Date("2026-10-03T01:00:00.000Z")
    });
    await createSqliteBackup({
      sourcePath: source,
      backupDir,
      keep: 2,
      now: new Date("2026-10-03T02:00:00.000Z")
    });

    const backups = fs.readdirSync(backupDir)
      .filter(name => name.endsWith(".sqlite"));
    assert.strictEqual(backups.length, 2, "retention should keep only the newest backups");

    const removed = cleanupOldBackups(backupDir, 1);
    assert.strictEqual(
      fs.readdirSync(backupDir).filter(name => name.endsWith(".sqlite")).length,
      1
    );
    assert(removed.length >= 1);

    store.close();
    console.log("SQLite backup tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
