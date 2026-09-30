const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createSessionStore({ userDataPath, safeStorage }) {
  const filePath = path.join(userDataPath, "session.json");

  function readRaw() {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function writeRaw(data) {
    ensureDir(path.dirname(filePath));
    const temp = filePath + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temp, filePath);
  }

  function remove() {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Session cleanup failure must not crash the app.
    }
  }

  function canEncrypt() {
    return Boolean(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable() &&
      typeof safeStorage.encryptString === "function" &&
      typeof safeStorage.decryptString === "function"
    );
  }

  function setAccessToken(token, meta = {}) {
    if (typeof token !== "string" || !token.trim()) {
      remove();
      return false;
    }

    if (!canEncrypt()) {
      const error = new Error("Secure local storage is unavailable.");
      error.code = "SECURE_STORAGE_UNAVAILABLE";
      throw error;
    }

    const encrypted = safeStorage.encryptString(token.trim()).toString("base64");
    writeRaw({
      version: 1,
      encryptedAccessToken: encrypted,
      expiresAt: meta.expiresAt || null,
      userId: meta.userId || null,
      updatedAt: new Date().toISOString()
    });

    return true;
  }

  function getAccessToken() {
    const data = readRaw();
    if (!data?.encryptedAccessToken || !canEncrypt()) return null;

    if (data.expiresAt) {
      const expiresAt = Date.parse(data.expiresAt);
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
        remove();
        return null;
      }
    }

    try {
      return safeStorage.decryptString(
        Buffer.from(data.encryptedAccessToken, "base64")
      );
    } catch {
      remove();
      return null;
    }
  }

  function status() {
    const data = readRaw();
    const token = getAccessToken();

    return {
      authenticated: Boolean(token),
      userId: token ? (data?.userId || null) : null,
      expiresAt: token ? (data?.expiresAt || null) : null,
      secureStorage: canEncrypt()
    };
  }

  function clear() {
    remove();
    return true;
  }

  return {
    setAccessToken,
    getAccessToken,
    status,
    clear
  };
}

module.exports = { createSessionStore };
