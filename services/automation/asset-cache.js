'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

function safeText(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeExtension(value, fallback = '.bin') {
  const ext = safeText(value, 16).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : fallback;
}

function cacheFileName(cacheKey, extension = '.bin') {
  const hash = crypto.createHash('sha256').update(String(cacheKey || '')).digest('hex');
  return hash.slice(0, 40) + safeExtension(extension);
}

async function checksumFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return 'sha256:' + hash.digest('hex');
}

function createAssetCache({ rootDir, now = () => Date.now(), fetchImpl = global.fetch } = {}) {
  if (!rootDir) throw new Error('Asset cache rootDir is required.');
  const cacheRoot = path.resolve(rootDir);
  const mediaDir = path.join(cacheRoot, 'media');
  const indexPath = path.join(cacheRoot, 'index.json');
  let loaded = false;
  let records = {};
  let writeQueue = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    await fsp.mkdir(mediaDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
      records = parsed && typeof parsed === 'object' && parsed.records && typeof parsed.records === 'object'
        ? parsed.records
        : {};
    } catch {
      records = {};
    }
    loaded = true;
  }

  async function persist() {
    await ensureLoaded();
    const payload = JSON.stringify({ version: 1, updatedAt: new Date(now()).toISOString(), records }, null, 2);
    const temp = indexPath + '.tmp';
    writeQueue = writeQueue.then(async () => {
      await fsp.writeFile(temp, payload, 'utf8');
      await fsp.rename(temp, indexPath);
    });
    return writeQueue;
  }

  async function validateRecord(record) {
    if (!record?.localPath) return null;
    try {
      const stat = await fsp.stat(record.localPath);
      if (!stat.isFile() || stat.size <= 0) return null;
      if (record.checksum) {
        const actualChecksum = await checksumFile(record.localPath);
        if (actualChecksum !== String(record.checksum)) return null;
      }
      return { ...record, size: stat.size };
    } catch {
      return null;
    }
  }

  async function get(cacheKey) {
    await ensureLoaded();
    const key = safeText(cacheKey, 300);
    if (!key) return null;
    const valid = await validateRecord(records[key]);
    if (!valid) {
      if (records[key]) {
        delete records[key];
        await persist();
      }
      return null;
    }
    records[key] = { ...valid, lastUsedAt: new Date(now()).toISOString() };
    await persist();
    return { ...records[key] };
  }

  async function put(cacheKey, record = {}) {
    await ensureLoaded();
    const key = safeText(cacheKey, 300);
    if (!key) throw new Error('Asset cache key is required.');
    const valid = await validateRecord({ ...record, checksum: '' });
    if (!valid) throw new Error('Asset cache file is missing or empty.');
    const timestamp = new Date(now()).toISOString();
    records[key] = {
      cacheKey: key,
      provider: safeText(record.provider, 80),
      providerAssetId: safeText(record.providerAssetId, 220),
      localPath: path.resolve(valid.localPath),
      checksum: safeText(record.checksum, 300) || await checksumFile(valid.localPath),
      width: Number(record.width || 0) || 0,
      height: Number(record.height || 0) || 0,
      durationSec: Number(record.durationSec || 0) || 0,
      sourcePage: safeText(record.sourcePage, 3000),
      license: safeText(record.license, 500),
      attribution: safeText(record.attribution, 500),
      createdAt: record.createdAt ? String(record.createdAt) : timestamp,
      lastUsedAt: timestamp,
      size: valid.size
    };
    await persist();
    return { ...records[key] };
  }

  async function destination(cacheKey, extension = '.bin') {
    await ensureLoaded();
    return path.join(mediaDir, cacheFileName(cacheKey, extension));
  }

  async function download({ cacheKey, url, extension = '.bin', signal, metadata = {} } = {}) {
    const existing = await get(cacheKey);
    if (existing) return { record: existing, cacheHit: true };
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
    const target = await destination(cacheKey, extension);
    const temp = target + '.part';
    await fsp.rm(temp, { force: true }).catch(() => {});
    try {
      const response = await fetchImpl(String(url || ''), { signal, redirect: 'follow' });
      if (!response?.ok || !response.body) {
        const error = new Error('Asset download failed with HTTP ' + Number(response?.status || 0));
        error.status = Number(response?.status || 0);
        throw error;
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp), { signal });
      await fsp.rename(temp, target);
      const record = await put(cacheKey, { ...metadata, localPath: target });
      return { record, cacheHit: false };
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function adopt({ cacheKey, sourcePath, extension, metadata = {} } = {}) {
    const existing = await get(cacheKey);
    if (existing) return { record: existing, cacheHit: true };
    const source = path.resolve(String(sourcePath || ''));
    const ext = extension || path.extname(source) || '.bin';
    const target = await destination(cacheKey, ext);
    if (source !== target) await fsp.copyFile(source, target);
    const record = await put(cacheKey, { ...metadata, localPath: target });
    return { record, cacheHit: false };
  }

  async function status() {
    await ensureLoaded();
    const values = Object.values(records);
    return {
      rootDir: cacheRoot,
      entries: values.length,
      bytes: values.reduce((sum, item) => sum + Number(item?.size || 0), 0)
    };
  }

  return { get, put, download, adopt, destination, status, checksumFile };
}

module.exports = { createAssetCache, cacheFileName, checksumFile };
