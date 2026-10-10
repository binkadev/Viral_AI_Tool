'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']);
const active = new Map();

function previewError(code, message, details = {}) {
  const error = new Error(String(message || code || 'COMPOSITION_PREVIEW_FAILED'));
  error.code = String(code || 'COMPOSITION_PREVIEW_FAILED');
  error.details = details;
  return error;
}

function binaryPath() {
  if (!ffmpegStatic) throw previewError('ENGINE_UNAVAILABLE', 'Video preview engine is unavailable.');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

function safeOperationId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw previewError('JOB_INVALID', 'Invalid composition preview job id.');
  return id;
}

function safeVideoPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw previewError('SOURCE_INVALID', 'Composition clip source is invalid.');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw previewError('SOURCE_MISSING', 'Composition clip source is missing.', { path: resolved });
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw previewError('SOURCE_INVALID', 'Composition clip source is not a readable file.', { path: resolved });
  if (!VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw previewError('SOURCE_UNSUPPORTED', 'Composition clip format is unsupported.');
  return resolved;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dimensionsFor(aspectRatio) {
  if (aspectRatio === '16:9') return { width: 1280, height: 720 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  return { width: 720, height: 1280 };
}

function normalizePayload(payload = {}) {
  const composition = payload.composition && typeof payload.composition === 'object' ? payload.composition : payload;
  const clips = Array.isArray(composition?.tracks?.video) ? composition.tracks.video : [];
  if (!clips.length) throw previewError('COMPOSITION_EMPTY', 'Composition has no video clips.');
  if (clips.length > 120) throw previewError('COMPOSITION_TOO_LARGE', 'Composition contains too many preview clips.');

  const normalizedClips = clips.map((clip, index) => {
    const sourcePath = safeVideoPath(clip?.sourcePath);
    const sourceInSec = Math.max(0, number(clip?.sourceInSec, 0));
    const durationSec = Math.max(0.05, number(clip?.durationSec, number(clip?.endSec, 0) - number(clip?.startSec, 0)));
    const sourceOutSec = Math.max(sourceInSec + 0.05, number(clip?.sourceOutSec, sourceInSec + durationSec));
    return {
      index,
      id: String(clip?.id || `clip-${index + 1}`),
      sourcePath,
      sourceInSec,
      sourceOutSec,
      durationSec: Math.min(durationSec, sourceOutSec - sourceInSec)
    };
  });

  const totalDuration = normalizedClips.reduce((sum, clip) => sum + clip.durationSec, 0);
  if (!(totalDuration > 0) || totalDuration > 7200) throw previewError('COMPOSITION_DURATION_INVALID', 'Composition preview duration is invalid.');
  const aspectRatio = ['16:9', '9:16', '1:1'].includes(String(composition?.aspectRatio)) ? String(composition.aspectRatio) : '9:16';
  const signature = String(composition?.outputSignature || composition?.id || '').trim();
  if (!signature) throw previewError('COMPOSITION_SIGNATURE_REQUIRED', 'Composition signature is required.');

  return { signature, aspectRatio, clips: normalizedClips, totalDuration };
}

function cacheName(normalized) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      signature: normalized.signature,
      aspectRatio: normalized.aspectRatio,
      clips: normalized.clips.map(clip => ({
        id: clip.id,
        path: clip.sourcePath,
        in: clip.sourceInSec,
        out: clip.sourceOutSec,
        duration: clip.durationSec
      }))
    }))
    .digest('hex')
    .slice(0, 28);
  return `composition-preview-${hash}.mp4`;
}

function parseProgress(chunk, totalDuration, onProgress) {
  const text = String(chunk || '');
  const matches = [...text.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (!matches.length || !totalDuration) return;
  const raw = Number(matches[matches.length - 1][1] || 0);
  const seconds = raw / 1000000;
  if (!Number.isFinite(seconds)) return;
  const percent = Math.max(1, Math.min(99, Math.round((seconds / totalDuration) * 100)));
  onProgress?.({ phase: 'building-preview', percent });
}

function spawnPreview(args, operationId, totalDuration, onProgress) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binaryPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    active.set(operationId, child);
    let stderr = '';
    child.stdout.on('data', chunk => parseProgress(chunk, totalDuration, onProgress));
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      active.delete(operationId);
      if (code === 0) resolve();
      else {
        const error = previewError('COMPOSITION_PREVIEW_FAILED', 'Could not build the Studio preview.', { technicalMessage: stderr.trim(), exitCode: code });
        reject(error);
      }
    });
  });
}

async function buildCompositionPreview({ operationId, composition, cacheRoot, onProgress } = {}) {
  const id = safeOperationId(operationId);
  if (active.has(id)) throw previewError('DUPLICATE_ACTIVE', 'This composition preview is already being built.');
  const normalized = normalizePayload({ composition });
  const root = path.resolve(String(cacheRoot || ''));
  if (!root) throw previewError('CACHE_UNAVAILABLE', 'Preview cache directory is unavailable.');
  fs.mkdirSync(root, { recursive: true });
  const outputPath = path.join(root, cacheName(normalized));
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    const dims = dimensionsFor(normalized.aspectRatio);
    onProgress?.({ phase: 'cached', percent: 100 });
    return { outputPath, cacheHit: true, duration: normalized.totalDuration, ...dims, sizeBytes: fs.statSync(outputPath).size };
  }

  const dims = dimensionsFor(normalized.aspectRatio);
  const args = ['-y'];
  normalized.clips.forEach(clip => args.push('-i', clip.sourcePath));
  const filters = [];
  const labels = [];
  normalized.clips.forEach((clip, index) => {
    const label = `v${index}`;
    filters.push(
      `[${index}:v:0]trim=start=${clip.sourceInSec.toFixed(3)}:duration=${clip.durationSec.toFixed(3)},` +
      `setpts=PTS-STARTPTS,scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,` +
      `crop=${dims.width}:${dims.height},fps=30,format=yuv420p[${label}]`
    );
    labels.push(`[${label}]`);
  });
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[vout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath
  );

  onProgress?.({ phase: 'preparing', percent: 1 });
  try {
    await spawnPreview(args, id, normalized.totalDuration, onProgress);
  } catch (error) {
    try { fs.unlinkSync(outputPath); } catch {}
    if (error?.code) throw error;
    throw previewError('COMPOSITION_PREVIEW_FAILED', 'Could not build the Studio preview.', { technicalMessage: error?.message || String(error) });
  }
  onProgress?.({ phase: 'completed', percent: 100 });
  return { outputPath, cacheHit: false, duration: normalized.totalDuration, ...dims, sizeBytes: fs.statSync(outputPath).size };
}

function cancelCompositionPreview(operationId) {
  const id = String(operationId || '');
  const child = active.get(id);
  if (!child) return false;
  try {
    child.kill('SIGTERM');
    active.delete(id);
    return true;
  } catch {
    return false;
  }
}

function cancelAllCompositionPreviews() {
  let count = 0;
  for (const id of [...active.keys()]) if (cancelCompositionPreview(id)) count += 1;
  return count;
}

function serializePreviewError(error) {
  return {
    code: error?.code || 'COMPOSITION_PREVIEW_FAILED',
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  dimensionsFor,
  normalizePayload,
  cacheName,
  buildCompositionPreview,
  cancelCompositionPreview,
  cancelAllCompositionPreviews,
  serializePreviewError
};
