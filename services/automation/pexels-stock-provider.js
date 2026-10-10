'use strict';

const path = require('path');
const crypto = require('crypto');

function orientationFor(aspectRatio) {
  if (aspectRatio === '16:9') return 'landscape';
  if (aspectRatio === '1:1') return 'square';
  return 'portrait';
}

function pickVideoFile(video, aspectRatio) {
  const files = Array.isArray(video?.video_files) ? video.video_files : [];
  const target = orientationFor(aspectRatio);
  const candidates = files.filter(file => {
    const w = Number(file?.width || 0);
    const h = Number(file?.height || 0);
    if (!w || !h || !file?.link) return false;
    if (target === 'portrait') return h > w;
    if (target === 'landscape') return w > h;
    return Math.abs(w - h) / Math.max(w, h) < 0.2;
  });
  const pool = candidates.length ? candidates : files.filter(file => file?.link);
  return pool.sort((a, b) => {
    const aq = Number(a?.width || 0) * Number(a?.height || 0);
    const bq = Number(b?.width || 0) * Number(b?.height || 0);
    const aHd = aq >= 1280 * 720 ? 1 : 0;
    const bHd = bq >= 1280 * 720 ? 1 : 0;
    return bHd - aHd || bq - aq;
  })[0] || null;
}

function cacheKeyFor(video, file) {
  const raw = ['pexels', video?.id, file?.id, file?.width, file?.height, file?.quality].join(':');
  return 'pexels:' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function createPexelsStockProvider({ cache, fetchImpl = global.fetch, apiKey = process.env.PEXELS_API_KEY } = {}) {
  if (!cache) throw new Error('Pexels provider requires an asset cache.');

  return {
    id: 'pexels',
    capabilities: {
      strategies: ['stock'],
      mediaTypes: ['video'],
      aspects: ['16:9', '9:16', '1:1']
    },

    async isConfigured() {
      return Boolean(String(apiKey || '').trim() && typeof fetchImpl === 'function');
    },

    async search(request, { signal } = {}) {
      if (!(await this.isConfigured())) {
        const error = new Error('Pexels API key is not configured.');
        error.code = 'PROVIDER_NOT_CONFIGURED';
        throw error;
      }
      const params = new URLSearchParams({
        query: String(request?.query || ''),
        orientation: orientationFor(request?.aspectRatio),
        size: 'medium',
        per_page: '15'
      });
      const response = await fetchImpl('https://api.pexels.com/videos/search?' + params.toString(), {
        method: 'GET',
        headers: { Authorization: String(apiKey).trim() },
        signal
      });
      if (!response?.ok) {
        const error = new Error('Pexels search failed with HTTP ' + Number(response?.status || 0));
        error.status = Number(response?.status || 0);
        throw error;
      }
      const payload = await response.json();
      const videos = Array.isArray(payload?.videos) ? payload.videos : [];
      return videos.map((video, index) => {
        const file = pickVideoFile(video, request?.aspectRatio);
        if (!file) return null;
        const userName = String(video?.user?.name || '').trim();
        return {
          providerAssetId: String(video.id),
          type: 'video',
          width: Number(file.width || video.width || 0),
          height: Number(file.height || video.height || 0),
          durationSec: Number(video.duration || 0),
          previewUrl: String(video?.image || ''),
          sourcePage: String(video?.url || ''),
          license: 'Pexels License',
          attribution: userName ? 'Pexels · ' + userName : 'Pexels',
          score: Math.max(0, 100 - index),
          raw: {
            downloadUrl: String(file.link || ''),
            cacheKey: cacheKeyFor(video, file),
            extension: path.extname(new URL(file.link).pathname) || '.mp4',
            fileId: file.id || null
          }
        };
      }).filter(Boolean);
    },

    async materialize(candidate, { signal, request } = {}) {
      const downloadUrl = String(candidate?.raw?.downloadUrl || '');
      const cacheKey = String(candidate?.raw?.cacheKey || '');
      if (!downloadUrl || !cacheKey) {
        const error = new Error('Pexels candidate is missing materialization metadata.');
        error.code = 'FILE_INVALID';
        throw error;
      }
      const result = await cache.download({
        cacheKey,
        url: downloadUrl,
        extension: candidate?.raw?.extension || '.mp4',
        signal,
        metadata: {
          provider: 'pexels',
          providerAssetId: candidate.providerAssetId,
          width: candidate.width,
          height: candidate.height,
          durationSec: candidate.durationSec,
          sourcePage: candidate.sourcePage,
          license: candidate.license,
          attribution: candidate.attribution
        }
      });
      return {
        provider: 'pexels',
        providerAssetId: candidate.providerAssetId,
        type: 'video',
        localPath: result.record.localPath,
        previewPath: '',
        sourcePage: candidate.sourcePage,
        width: candidate.width,
        height: candidate.height,
        durationSec: candidate.durationSec || request?.desiredDurationSec || 0,
        license: candidate.license,
        attribution: candidate.attribution,
        checksum: result.record.checksum,
        cacheKey,
        cacheHit: result.cacheHit
      };
    }
  };
}

module.exports = { createPexelsStockProvider, pickVideoFile, orientationFor };
