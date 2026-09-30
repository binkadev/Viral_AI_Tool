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

  function encrypt(value) {
    if (!canEncrypt()) {
      const error = new Error("Secure local storage is unavailable.");
      error.code = "SECURE_STORAGE_UNAVAILABLE";
      throw error;
    }
    return safeStorage.encryptString(String(value)).toString("base64");
  }

  function decrypt(value) {
    if (!value || !canEncrypt()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return null;
    }
  }

  function setSession(session = {}) {
    const accessToken = typeof session.accessToken === "string" ? session.accessToken.trim() : "";
    const refreshToken = typeof session.refreshToken === "string" ? session.refreshToken.trim() : "";

    if (!accessToken || !refreshToken) {
      const error = new Error("Session tokens are incomplete.");
      error.code = "SESSION_INVALID";
      throw error;
    }

    writeRaw({
      version: 2,
      encryptedAccessToken: encrypt(accessToken),
      encryptedRefreshToken: encrypt(refreshToken),
      accessExpiresAt: session.accessExpiresAt || null,
      refreshExpiresAt: session.refreshExpiresAt || null,
      user: session.user && typeof session.user === "object" ? {
        id: session.user.id || null,
        email: session.user.email || null,
        name: session.user.name || null,
        plan: session.user.plan || null
      } : null,
      updatedAt: new Date().toISOString()
    });

    return true;
  }

  function setAccessToken(token, meta = {}) {
    const current = readRaw();
    const refreshToken = decrypt(current?.encryptedRefreshToken);
    if (!refreshToken) {
      const error = new Error("Refresh token is required.");
      error.code = "SESSION_INVALID";
      throw error;
    }
    return setSession({
      accessToken: token,
      refreshToken,
      accessExpiresAt: meta.expiresAt || current?.accessExpiresAt || null,
      refreshExpiresAt: current?.refreshExpiresAt || null,
      user: meta.user || current?.user || null
    });
  }

  function accessExpired(data) {
    if (!data?.accessExpiresAt) return false;
    const expiresAt = Date.parse(data.accessExpiresAt);
    return Number.isFinite(expiresAt) && Date.now() >= expiresAt;
  }

  function refreshExpired(data) {
    if (!data?.refreshExpiresAt) return false;
    const expiresAt = Date.parse(data.refreshExpiresAt);
    return Number.isFinite(expiresAt) && Date.now() >= expiresAt;
  }

  function getAccessToken() {
    const data = readRaw();
    if (!data?.encryptedAccessToken || accessExpired(data)) return null;
    return decrypt(data.encryptedAccessToken);
  }

  function getRefreshToken() {
    const data = readRaw();
    if (!data?.encryptedRefreshToken || refreshExpired(data)) return null;
    return decrypt(data.encryptedRefreshToken);
  }

  function getUser() {
    return readRaw()?.user || null;
  }

  function needsRefresh(skewMs = 60000) {
    const data = readRaw();
    if (!data?.encryptedAccessToken) return false;
    if (!data.accessExpiresAt) return false;
    const expiresAt = Date.parse(data.accessExpiresAt);
    return Number.isFinite(expiresAt) && Date.now() + Math.max(0, Number(skewMs || 0)) >= expiresAt;
  }

  function status() {
    const data = readRaw();
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    const user = data?.user || null;

    return {
      authenticated: Boolean(accessToken || refreshToken),
      accessReady: Boolean(accessToken),
      refreshReady: Boolean(refreshToken),
      userId: user?.id || null,
      email: user?.email || null,
      name: user?.name || null,
      plan: user?.plan || null,
      accessExpiresAt: data?.accessExpiresAt || null,
      refreshExpiresAt: data?.refreshExpiresAt || null,
      secureStorage: canEncrypt()
    };
  }

  function clear() {
    remove();
    return true;
  }

  return {
    setSession,
    setAccessToken,
    getAccessToken,
    getRefreshToken,
    getUser,
    needsRefresh,
    status,
    clear
  };
}

module.exports = { createSessionStore };
