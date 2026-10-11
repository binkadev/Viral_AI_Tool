'use strict';

const path = require('path');
const crypto = require('crypto');

const API_BASE = 'https://muse-video.com';
const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;

const MODEL_CATALOG = Object.freeze([
  {
    id: 'kling26-text-to-video',
    label: 'Omni Video',
    minDuration: 5,
    maxDuration: 10,
    audio: true,
    resolutions: []
  },
  {
    id: 'kling3-standard-text-to-video',
    label: 'Kling 3.0 Standard',
    minDuration: 3,
    maxDuration: 15,
    audio: true,
    resolutions: []
  },
  {
    id: 'kling3-pro-text-to-video',
    label: 'Kling 3.0 Pro',
    minDuration: 3,
    maxDuration: 15,
    audio: true,
    resolutions: []
  },
  {
    id: 'grok-imagine-text-to-video',
    label: 'Grok Imagine',
    minDuration: 6,
    maxDuration: 10,
    allowedDurations: [6, 10],
    audio: false,
    resolutions: []
  },
  {
    id: 'happyhorse-1.0-text-to-video',
    label: 'HappyHorse 1.0',
    minDuration: 4,
    maxDuration: 12,
    audio: true,
    resolutions: ['720p', '1080p']
  }
]);

function modelInfo(modelId) {
  return MODEL_CATALOG.find(item => item.id === String(modelId || '')) || MODEL_CATALOG[0];
}

function clampDuration(value, model) {
  const wanted = Number(value || model.minDuration || 5);
  if (Array.isArray(model.allowedDurations) && model.allowedDurations.length) {
    return model.allowedDurations.reduce((best, candidate) => {
      const bestDistance = Math.abs(best - wanted);
      const candidateDistance = Math.abs(candidate - wanted);
      if (candidateDistance < bestDistance) return candidate;
      // If two discrete durations are equally close, prefer the longer result.
      // Composition can trim surplus frames, while a shorter generated clip can
      // leave the scene without enough source duration.
      if (candidateDistance === bestDistance && candidate > best) return candidate;
      return best;
    }, model.allowedDurations[0]);
  }
  return Math.max(model.minDuration, Math.min(model.maxDuration, Math.round(wanted)));
}

function dimensionsFor(aspectRatio, resolution = '720p') {
  const long = resolution === '1080p' ? 1920 : 1280;
  const short = resolution === '1080p' ? 1080 : 720;
  if (aspectRatio === '16:9') return { width: long, height: short };
  if (aspectRatio === '1:1') return { width: short, height: short };
  return { width: short, height: long };
}

function extensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(String(url || '')).pathname).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.mp4';
  } catch {
    return '.mp4';
  }
}

function providerError(message, { status = 0, code = '', detail = '', retryable = false } = {}) {
  const error = new Error(String(message || code || 'Muse Video request failed.'));
  if (status) error.status = Number(status);
  if (code) error.providerCode = String(code);
  if (detail) error.detail = String(detail);
  if (retryable) error.retryable = true;
  return error;
}

function abortError() {
  const error = new Error('Muse Video generation was cancelled.');
  error.name = 'AbortError';
  error.code = 'CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function jsonResponse(response) {
  try { return await response.json(); }
  catch { return {}; }
}

function assertApiSuccess(response, payload) {
  const code = Number(payload?.code || response?.status || 0);
  if (response?.ok && (code === 200 || !payload?.code)) return;
  const message = String(payload?.message || 'MUSE_REQUEST_FAILED');
  const retryable = [429, 500, 503, 504].includes(Number(response?.status || code));
  throw providerError(message, {
    status: Number(response?.status || code),
    code: message,
    detail: payload?.detail || '',
    retryable
  });
}

function buildPrompt(request = {}) {
  const visual = String(request?.prompt || request?.visualIntent || request?.query || '').trim();
  const narration = String(request?.narration || '').trim();
  const motion = String(request?.motion || '').trim();
  const parts = [visual];
  if (motion) parts.push('Motion: ' + motion + '.');
  if (narration) parts.push('Narration context only, do not render text: ' + narration);
  parts.push('No watermark, no embedded captions, no logos unless explicitly requested.');
  return parts.filter(Boolean).join(' ').slice(0, 6000);
}

function createMuseVideoProvider({
  cache,
  configStore,
  fetchImpl = global.fetch,
  apiBase = API_BASE,
  pollIntervalMs = POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!cache) throw new Error('Muse Video provider requires an asset cache.');
  if (!configStore) throw new Error('Muse Video provider requires a config store.');

  async function requestJson(url, options = {}) {
    if (typeof fetchImpl !== 'function') throw providerError('Fetch is unavailable.');
    const response = await fetchImpl(url, options);
    const payload = await jsonResponse(response);
    assertApiSuccess(response, payload);
    return payload;
  }

  return {
    id: 'muse-video',
    capabilities: {
      strategies: ['generated'],
      mediaTypes: ['video'],
      aspects: ['16:9', '9:16', '1:1']
    },

    modelCatalog() {
      return MODEL_CATALOG.map(item => ({ ...item }));
    },

    async isConfigured() {
      const config = configStore.read();
      return Boolean(config.apiKey && typeof fetchImpl === 'function');
    },

    async generate(request, { signal, onProgress } = {}) {
      throwIfAborted(signal);
      const config = configStore.read();
      if (!config.apiKey) {
        const error = new Error('Muse Video API key is not configured.');
        error.code = 'PROVIDER_NOT_CONFIGURED';
        throw error;
      }

      const model = modelInfo(config.model);
      const duration = clampDuration(request?.desiredDurationSec, model);
      const aspectRatio = ['16:9', '9:16', '1:1'].includes(String(request?.aspectRatio || ''))
        ? String(request.aspectRatio)
        : '9:16';
      const prompt = buildPrompt(request);
      if (!prompt) {
        const error = new Error('Muse Video prompt is empty.');
        error.code = 'INVALID_INPUT';
        throw error;
      }

      const body = {
        model: model.id,
        prompt,
        duration,
        aspect_ratio: aspectRatio
      };
      if (model.resolutions.includes(config.resolution)) body.resolution = config.resolution;
      if (model.audio) body.generate_audio = config.generateAudio === true;
      const negatives = Array.isArray(request?.negativeConstraints)
        ? request.negativeConstraints.map(item => String(item || '').trim()).filter(Boolean)
        : [];
      if (negatives.length) body.negative_prompt = negatives.join(', ').slice(0, 1200);

      onProgress?.({ phase: 'submitting', progress: 2, model: model.id });
      const created = await requestJson(apiBase + '/api/v1/generate', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      });

      throwIfAborted(signal);
      const taskId = String(created?.data?.task_id || '').trim();
      if (!taskId) throw providerError('Muse Video did not return a task id.', { code: 'INVALID_RESPONSE' });

      let data = created.data || {};
      const startedAt = Date.now();
      onProgress?.({ phase: 'queued', progress: 5, model: model.id, taskId });

      while (String(data?.status || '').toUpperCase() === 'IN_PROGRESS') {
        if (Date.now() - startedAt > timeoutMs) {
          const error = new Error('Muse Video generation timed out.');
          error.code = 'PROVIDER_TIMEOUT';
          throw error;
        }
        await wait(pollIntervalMs, signal);
        throwIfAborted(signal);
        const statusPayload = await requestJson(apiBase + '/api/v1/status?task_id=' + encodeURIComponent(taskId), {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + config.apiKey },
          signal
        });
        data = statusPayload?.data || {};
        const elapsed = Date.now() - startedAt;
        const estimated = Math.min(90, 8 + Math.floor(elapsed / 6000) * 4);
        onProgress?.({ phase: 'generating', progress: estimated, model: model.id, taskId });
      }

      const status = String(data?.status || '').toUpperCase();
      if (status === 'FAILED') {
        const providerCode = String(data?.error?.code || 'GENERATION_FAILED');
        throw providerError(data?.error?.message || providerCode, { code: providerCode, retryable: true });
      }
      if (status !== 'SUCCESS') throw providerError('Muse Video returned an unknown task status.', { code: 'INVALID_RESPONSE' });

      const resultUrls = Array.isArray(data?.response?.resultUrls) ? data.response.resultUrls : [];
      const resultUrl = String(resultUrls[0] || '').trim();
      if (!resultUrl) throw providerError('Muse Video completed without a video URL.', { code: 'INVALID_RESPONSE' });

      const dimensions = dimensionsFor(aspectRatio, config.resolution);
      onProgress?.({ phase: 'generated', progress: 94, model: model.id, taskId });
      return [{
        providerAssetId: taskId,
        type: 'video',
        width: dimensions.width,
        height: dimensions.height,
        durationSec: duration,
        previewUrl: resultUrl,
        sourcePage: API_BASE,
        license: 'Generated via Muse Video API',
        attribution: 'Muse Video API · ' + model.label,
        score: 100,
        raw: {
          downloadUrl: resultUrl,
          extension: extensionFromUrl(resultUrl),
          cacheKey: 'muse-video:' + crypto.createHash('sha256').update(taskId + ':' + model.id).digest('hex').slice(0, 40),
          model: model.id,
          consumedCredits: Number(data?.consumed_credits || 0),
          generateAudio: model.audio && config.generateAudio === true
        }
      }];
    },

    async materialize(candidate, { signal, request } = {}) {
      throwIfAborted(signal);
      const downloadUrl = String(candidate?.raw?.downloadUrl || '');
      const cacheKey = String(candidate?.raw?.cacheKey || '');
      if (!downloadUrl || !cacheKey) {
        const error = new Error('Muse Video result is missing download metadata.');
        error.code = 'FILE_INVALID';
        throw error;
      }
      const result = await cache.download({
        cacheKey,
        url: downloadUrl,
        extension: candidate?.raw?.extension || '.mp4',
        signal,
        metadata: {
          provider: 'muse-video',
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
        provider: 'muse-video',
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
        cacheHit: result.cacheHit,
        meta: {
          model: candidate?.raw?.model || '',
          consumedCredits: Number(candidate?.raw?.consumedCredits || 0),
          generateAudio: candidate?.raw?.generateAudio === true
        }
      };
    }
  };
}

module.exports = {
  API_BASE,
  MODEL_CATALOG,
  modelInfo,
  clampDuration,
  dimensionsFor,
  buildPrompt,
  createMuseVideoProvider
};
