'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'kling26-text-to-video';
const DEFAULTS = Object.freeze({
  model: DEFAULT_MODEL,
  resolution: '720p',
  generateAudio: false
});

function normalizeModel(value) {
  return String(value || DEFAULT_MODEL).trim().slice(0, 120) || DEFAULT_MODEL;
}

function normalizeResolution(value) {
  return ['720p', '1080p'].includes(String(value || '').trim()) ? String(value).trim() : '720p';
}

function createMuseConfigStore({ userDataPath, safeStorage, env = process.env } = {}) {
  if (!userDataPath) throw new Error('Muse config store requires userDataPath.');
  const filePath = path.join(path.resolve(userDataPath), 'automation-muse.json');

  function readRaw() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeRaw(value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = filePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
  }

  function encryptionReady() {
    try { return Boolean(safeStorage?.isEncryptionAvailable?.()); }
    catch { return false; }
  }

  function decryptStoredKey(raw) {
    const encrypted = String(raw?.apiKeyEncrypted || '').trim();
    if (!encrypted || !encryptionReady()) return '';
    try {
      return String(safeStorage.decryptString(Buffer.from(encrypted, 'base64')) || '').trim();
    } catch {
      return '';
    }
  }

  function environmentKey() {
    return String(env?.MUSE_VIDEO_API_KEY || '').trim();
  }

  function secret() {
    return environmentKey() || decryptStoredKey(readRaw());
  }

  function read() {
    const raw = readRaw();
    const envKey = environmentKey();
    const storedKey = decryptStoredKey(raw);
    const apiKey = envKey || storedKey;
    return {
      apiKey,
      apiKeyConfigured: Boolean(apiKey),
      apiKeySource: envKey ? 'environment' : storedKey ? 'secure-store' : 'none',
      model: normalizeModel(env?.MUSE_VIDEO_MODEL || raw.model || DEFAULTS.model),
      resolution: normalizeResolution(env?.MUSE_VIDEO_RESOLUTION || raw.resolution || DEFAULTS.resolution),
      generateAudio: String(env?.MUSE_VIDEO_GENERATE_AUDIO || '').trim()
        ? String(env.MUSE_VIDEO_GENERATE_AUDIO).trim() === '1'
        : raw.generateAudio === true
    };
  }

  function publicConfig() {
    const current = read();
    return {
      apiKeyConfigured: current.apiKeyConfigured,
      apiKeySource: current.apiKeySource,
      model: current.model,
      resolution: current.resolution,
      generateAudio: current.generateAudio,
      secureStorageAvailable: encryptionReady(),
      environmentLocked: Boolean(environmentKey())
    };
  }

  function save(payload = {}) {
    const raw = readRaw();
    const next = {
      version: 1,
      model: normalizeModel(payload.model ?? raw.model ?? DEFAULTS.model),
      resolution: normalizeResolution(payload.resolution ?? raw.resolution ?? DEFAULTS.resolution),
      generateAudio: payload.generateAudio == null ? raw.generateAudio === true : payload.generateAudio === true,
      updatedAt: new Date().toISOString()
    };

    const suppliedKey = String(payload.apiKey || '').trim();
    if (suppliedKey) {
      if (!encryptionReady()) {
        const error = new Error('Secure storage is unavailable.');
        error.code = 'SECURE_STORAGE_UNAVAILABLE';
        throw error;
      }
      next.apiKeyEncrypted = safeStorage.encryptString(suppliedKey).toString('base64');
    } else if (raw.apiKeyEncrypted) {
      next.apiKeyEncrypted = raw.apiKeyEncrypted;
    }

    writeRaw(next);
    return publicConfig();
  }

  function clear() {
    try { fs.rmSync(filePath, { force: true }); } catch {}
    return publicConfig();
  }

  return { read, secret, publicConfig, save, clear, filePath };
}

module.exports = { createMuseConfigStore, DEFAULT_MODEL, DEFAULTS };
