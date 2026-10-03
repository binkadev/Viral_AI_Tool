const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE_NAME = "pending-update.json";
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function updateStatePath(userDataPath) {
  return path.join(path.resolve(String(userDataPath || "")), FILE_NAME);
}

function validVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ""));
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function markPendingUpdate(userDataPath, {
  fromVersion,
  toVersion,
  sha256,
  fileName
}) {
  if (!validVersion(fromVersion) || !validVersion(toVersion) || !validSha256(sha256)) {
    const error = new Error("Pending update metadata is invalid.");
    error.code = "UPDATE_STATE_INVALID";
    throw error;
  }

  const record = {
    schemaVersion: 1,
    fromVersion: String(fromVersion),
    toVersion: String(toVersion),
    sha256: String(sha256).toLowerCase(),
    fileName: path.basename(String(fileName || "")).slice(0, 180),
    createdAt: new Date().toISOString()
  };

  writeAtomic(updateStatePath(userDataPath), record);
  return clone(record);
}

function readPendingUpdate(userDataPath) {
  const filePath = updateStatePath(userDataPath);
  if (!fs.existsSync(filePath)) return null;

  try {
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      record?.schemaVersion !== 1 ||
      !validVersion(record.fromVersion) ||
      !validVersion(record.toVersion) ||
      !validSha256(record.sha256) ||
      Number.isNaN(Date.parse(record.createdAt))
    ) {
      return { invalid: true, filePath };
    }

    return {
      ...record,
      filePath
    };
  } catch {
    return { invalid: true, filePath };
  }
}

function clearPendingUpdate(userDataPath) {
  try { fs.rmSync(updateStatePath(userDataPath), { force: true }); } catch {}
}

function evaluatePendingUpdate(userDataPath, currentVersion, now = Date.now()) {
  const pending = readPendingUpdate(userDataPath);
  if (!pending) return null;

  if (pending.invalid) {
    clearPendingUpdate(userDataPath);
    return {
      status: "invalid",
      fromVersion: null,
      toVersion: null
    };
  }

  const createdAt = Date.parse(pending.createdAt);
  const ageMs = Math.max(0, now - createdAt);

  if (String(currentVersion) === pending.toVersion) {
    clearPendingUpdate(userDataPath);
    return {
      status: "completed",
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion,
      completedAt: new Date(now).toISOString()
    };
  }

  if (ageMs > MAX_PENDING_AGE_MS) {
    clearPendingUpdate(userDataPath);
    return {
      status: "expired",
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion
    };
  }

  return {
    status: "incomplete",
    fromVersion: pending.fromVersion,
    toVersion: pending.toVersion,
    createdAt: pending.createdAt
  };
}

module.exports = {
  FILE_NAME,
  MAX_PENDING_AGE_MS,
  markPendingUpdate,
  readPendingUpdate,
  clearPendingUpdate,
  evaluatePendingUpdate
};
