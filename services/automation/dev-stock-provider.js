'use strict';

const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function dimensionsFor(aspectRatio) {
  if (aspectRatio === '16:9') return { width: 1280, height: 720 };
  if (aspectRatio === '1:1') return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}

function runFfmpeg(args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const abort = () => {
      try { child.kill(); } catch {}
    };
    if (signal) {
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
    }
    child.stderr.on('data', chunk => { stderr += String(chunk || '').slice(-4000); });
    child.on('error', reject);
    child.on('close', code => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal?.aborted) {
        const error = new Error('Development stock generation cancelled.');
        error.name = 'AbortError';
        reject(error);
      } else if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code + ': ' + stderr.slice(-1200)));
    });
  });
}

function createDevStockProvider({ cache, enabled = process.env.VIRAL_AI_AUTOMATION_DEV_STOCK_PROVIDER === '1' } = {}) {
  if (!cache) throw new Error('Development stock provider requires an asset cache.');

  return {
    id: 'dev-stock',
    capabilities: {
      strategies: ['stock'],
      mediaTypes: ['video'],
      aspects: ['16:9', '9:16', '1:1']
    },

    async isConfigured() {
      return enabled === true && Boolean(ffmpegPath);
    },

    async search(request) {
      if (!(await this.isConfigured())) return [];
      const dims = dimensionsFor(request?.aspectRatio);
      const durationSec = Math.max(Number(request?.desiredDurationSec || 4), Number(request?.minDurationSec || 1));
      return [{
        providerAssetId: 'dev-' + String(request?.requestSignature || request?.id || 'asset'),
        type: 'video',
        width: dims.width,
        height: dims.height,
        durationSec,
        previewUrl: '',
        sourcePage: 'dev://automation-stock/' + encodeURIComponent(String(request?.sceneId || 'scene')),
        license: 'Development preview only',
        attribution: 'Viral AI Tool development provider',
        score: 100,
        raw: {
          cacheKey: 'dev-stock:' + String(request?.requestSignature || request?.id || 'asset'),
          extension: '.mp4'
        }
      }];
    },

    async materialize(candidate, { signal, request } = {}) {
      const cacheKey = String(candidate?.raw?.cacheKey || '');
      const existing = await cache.get(cacheKey);
      if (existing) {
        return {
          provider: 'dev-stock',
          providerAssetId: candidate.providerAssetId,
          type: 'video',
          localPath: existing.localPath,
          sourcePage: candidate.sourcePage,
          width: candidate.width,
          height: candidate.height,
          durationSec: candidate.durationSec,
          license: candidate.license,
          attribution: candidate.attribution,
          checksum: existing.checksum,
          cacheKey,
          cacheHit: true,
          developmentPreview: true
        };
      }

      const target = await cache.destination(cacheKey, '.mp4');
      const duration = Math.max(1, Number(candidate?.durationSec || request?.desiredDurationSec || 4));
      const width = Number(candidate?.width || 720);
      const height = Number(candidate?.height || 1280);
      await runFfmpeg([
        '-y',
        '-f', 'lavfi',
        '-i', `testsrc2=size=${width}x${height}:rate=30`,
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        target
      ], { signal });
      const record = await cache.put(cacheKey, {
        provider: 'dev-stock',
        providerAssetId: candidate.providerAssetId,
        localPath: target,
        width,
        height,
        durationSec: duration,
        sourcePage: candidate.sourcePage,
        license: candidate.license,
        attribution: candidate.attribution
      });
      return {
        provider: 'dev-stock',
        providerAssetId: candidate.providerAssetId,
        type: 'video',
        localPath: record.localPath,
        previewPath: '',
        sourcePage: candidate.sourcePage,
        width,
        height,
        durationSec: duration,
        license: candidate.license,
        attribution: candidate.attribution,
        checksum: record.checksum,
        cacheKey,
        cacheHit: false,
        developmentPreview: true
      };
    }
  };
}

module.exports = { createDevStockProvider, dimensionsFor, runFfmpeg };
