'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { normalizePayload, dimensionsFor } = require('./composition-preview');

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const active = new Map();
const reservations = new Map();
const activeKeys = new Map();
const cancelled = new Set();

function exportError(code, message, details = {}) {
  const error = new Error(String(message || code || 'COMPOSITION_EXPORT_FAILED'));
  error.code = String(code || 'COMPOSITION_EXPORT_FAILED');
  error.details = details;
  return error;
}

function binaryPath() {
  if (!ffmpegStatic) throw exportError('ENGINE_UNAVAILABLE', 'Video export engine is unavailable.');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

function safeOperationId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw exportError('JOB_INVALID', 'Invalid composition export job id.');
  return id;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function assertOutputDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) throw exportError('OUTPUT_REQUIRED', 'Missing output folder.');
  const resolved = path.resolve(value);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw exportError('OUTPUT_UNAVAILABLE', 'Output path is not a directory.', { outputDir: resolved });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (error) {
    if (error?.code && String(error.code).startsWith('OUTPUT_')) throw error;
    throw exportError('OUTPUT_UNAVAILABLE', 'Output folder is not writable.', { outputDir: resolved });
  }
  return resolved;
}

function safeAudioPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw exportError('AUDIO_SOURCE_INVALID', 'Composition audio source is invalid.');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw exportError('SOURCE_MISSING', 'Composition audio source is missing.', { path: resolved });
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw exportError('AUDIO_SOURCE_INVALID', 'Composition audio source is not readable.', { path: resolved });
  if (!AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw exportError('AUDIO_SOURCE_UNSUPPORTED', 'Composition audio source format is unsupported.', { path: resolved });
  return resolved;
}

function availableDiskBytes(directory) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stat = fs.statfsSync(directory);
    const blocks = Number(stat.bavail ?? stat.bfree ?? 0);
    const blockSize = Number(stat.bsize || 0);
    const bytes = blocks * blockSize;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

function sanitizeBaseName(value) {
  const cleaned = String(value || 'automation-video')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return cleaned || 'automation-video';
}

function timestampLabel(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = value => String(value).padStart(2, '0');
  return [
    safe.getFullYear(),
    pad(safe.getMonth() + 1),
    pad(safe.getDate())
  ].join('') + '-' + [pad(safe.getHours()), pad(safe.getMinutes()), pad(safe.getSeconds())].join('');
}

function uniqueOutputPath(outputDir, projectName, now = new Date()) {
  const base = sanitizeBaseName(projectName);
  const stamp = timestampLabel(now);
  let candidate = path.join(outputDir, `${base}-${stamp}.mp4`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${base}-${stamp}-${suffix}.mp4`);
    suffix += 1;
  }
  return candidate;
}

function normalizeSubtitles(composition) {
  const list = Array.isArray(composition?.tracks?.subtitle) ? composition.tracks.subtitle : [];
  return list.map((item, index) => {
    const startSec = Math.max(0, number(item?.startSec, 0));
    const endSec = Math.max(startSec + 0.05, number(item?.endSec, startSec + number(item?.durationSec, 0)));
    const body = text(item?.text, 6000).replace(/\r\n?/g, '\n');
    return { id: String(item?.id || `subtitle-${index + 1}`), startSec, endSec, text: body };
  }).filter(item => item.text);
}

function normalizeAudio(composition) {
  const list = Array.isArray(composition?.tracks?.audio) ? composition.tracks.audio : [];
  return list.map((item, index) => {
    const sourcePath = safeAudioPath(item?.sourcePath);
    const sourceInSec = Math.max(0, number(item?.sourceInSec, 0));
    const startSec = Math.max(0, number(item?.startSec, 0));
    const durationSec = Math.max(0.05, number(item?.durationSec, number(item?.endSec, 0) - startSec));
    return {
      id: String(item?.id || `audio-${index + 1}`),
      sourcePath,
      sourceInSec,
      startSec,
      durationSec
    };
  });
}

function normalizeExportPayload({ composition, outputDir, projectName, burnSubtitles = true } = {}) {
  const normalizedVideo = normalizePayload({ composition });
  const safeOutputDir = assertOutputDirectory(outputDir);
  const audio = normalizeAudio(composition);
  const subtitles = burnSubtitles ? normalizeSubtitles(composition) : [];
  const requiredFreeBytes = Math.max(
    MIN_FREE_BYTES,
    Math.ceil(normalizedVideo.totalDuration * 2.5 * 1024 * 1024)
  );
  const freeBytes = availableDiskBytes(safeOutputDir);
  if (freeBytes !== null && freeBytes < requiredFreeBytes) {
    throw exportError('LOW_DISK_SPACE', 'Not enough free disk space for composition export.', {
      freeBytes,
      requiredFreeBytes
    });
  }
  return {
    ...normalizedVideo,
    outputDir: safeOutputDir,
    projectName: sanitizeBaseName(projectName),
    audio,
    subtitles,
    burnSubtitles: Boolean(burnSubtitles),
    freeBytes,
    requiredFreeBytes
  };
}

function srtTime(seconds) {
  const totalMs = Math.max(0, Math.round(number(seconds, 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function writeSubtitleFile(subtitles, tempRoot, operationId) {
  if (!subtitles.length) return null;
  const root = path.resolve(String(tempRoot || ''));
  if (!root) throw exportError('TEMP_UNAVAILABLE', 'Temporary export directory is unavailable.');
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, `${operationId}.srt`);
  const body = subtitles.map((item, index) => [
    String(index + 1),
    `${srtTime(item.startSec)} --> ${srtTime(item.endSec)}`,
    item.text,
    ''
  ].join('\n')).join('\n');
  fs.writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function escapeFilterPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function parseProgress(chunk, totalDuration, onProgress) {
  const value = String(chunk || '');
  const timeMatches = [...value.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (!timeMatches.length || !(totalDuration > 0)) return;
  const raw = Number(timeMatches[timeMatches.length - 1][1] || 0);
  const seconds = raw / 1000000;
  if (!Number.isFinite(seconds)) return;
  const percent = Math.max(1, Math.min(99, Math.round((seconds / totalDuration) * 100)));
  onProgress?.({ phase: 'processing', percent });
}

function exportKey(normalized) {
  return `${normalized.signature}|${normalized.outputDir}`;
}

function removePartial(filePath) {
  if (!filePath) return;
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

function spawnExport(args, { operationId, key, totalDuration, onProgress }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binaryPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    active.set(operationId, child);
    activeKeys.set(key, operationId);
    reservations.delete(operationId);
    let stderr = '';
    child.stdout.on('data', chunk => parseProgress(chunk, totalDuration, onProgress));
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      active.delete(operationId);
      if (activeKeys.get(key) === operationId) activeKeys.delete(key);
      if (code === 0) resolve();
      else reject(exportError('COMPOSITION_EXPORT_FAILED', 'Could not export the composition.', {
        exitCode: code,
        technicalMessage: stderr.trim()
      }));
    });
    if (cancelled.has(operationId)) {
      try { child.kill('SIGTERM'); } catch {}
    }
  });
}

async function exportComposition({
  operationId,
  composition,
  outputDir,
  tempRoot,
  projectName,
  burnSubtitles = true,
  now = new Date(),
  onProgress
} = {}) {
  const id = safeOperationId(operationId);
  if (active.has(id) || reservations.has(id)) throw exportError('DUPLICATE_ACTIVE', 'This composition export is already active.');
  const normalized = normalizeExportPayload({ composition, outputDir, projectName, burnSubtitles });
  const key = exportKey(normalized);
  if (activeKeys.has(key) || [...reservations.values()].includes(key)) {
    throw exportError('DUPLICATE_ACTIVE', 'This composition is already being exported to the selected folder.');
  }

  reservations.set(id, key);
  cancelled.delete(id);
  const outputPath = uniqueOutputPath(normalized.outputDir, normalized.projectName, now);
  let subtitlePath = null;
  let succeeded = false;

  try {
    onProgress?.({ phase: 'validating', percent: 1 });
    if (cancelled.has(id)) return { cancelled: true, outputPath: null };

    subtitlePath = writeSubtitleFile(normalized.subtitles, tempRoot, id);
    const dims = dimensionsFor(normalized.aspectRatio);
    const args = ['-n'];
    normalized.clips.forEach(clip => args.push('-i', clip.sourcePath));
    normalized.audio.forEach(track => args.push('-i', track.sourcePath));

    const filters = [];
    const videoLabels = [];
    normalized.clips.forEach((clip, index) => {
      const label = `v${index}`;
      filters.push(
        `[${index}:v:0]trim=start=${clip.sourceInSec.toFixed(3)}:duration=${clip.durationSec.toFixed(3)},` +
        `setpts=PTS-STARTPTS,scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,` +
        `crop=${dims.width}:${dims.height},fps=30,format=yuv420p[${label}]`
      );
      videoLabels.push(`[${label}]`);
    });
    filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vbase]`);

    if (subtitlePath) {
      filters.push(
        `[vbase]subtitles=filename='${escapeFilterPath(subtitlePath)}':force_style='Alignment=2,MarginV=54,Outline=2,Shadow=0'[vout]`
      );
    } else {
      filters.push('[vbase]null[vout]');
    }

    if (normalized.audio.length) {
      const audioLabels = [];
      normalized.audio.forEach((track, index) => {
        const inputIndex = normalized.clips.length + index;
        const label = `a${index}`;
        const delayMs = Math.max(0, Math.round(track.startSec * 1000));
        filters.push(
          `[${inputIndex}:a:0]atrim=start=${track.sourceInSec.toFixed(3)}:duration=${track.durationSec.toFixed(3)},` +
          `asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `adelay=${delayMs}:all=1[${label}]`
        );
        audioLabels.push(`[${label}]`);
      });
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${normalized.totalDuration.toFixed(3)}[silence]`);
      filters.push(
        `[silence]${audioLabels.join('')}amix=inputs=${audioLabels.length + 1}:duration=longest:dropout_transition=0:normalize=0,` +
        `atrim=duration=${normalized.totalDuration.toFixed(3)},alimiter=limit=0.95[aout]`
      );
    }

    args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
    if (normalized.audio.length) args.push('-map', '[aout]');
    else args.push('-an');
    args.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p'
    );
    if (normalized.audio.length) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push(
      '-movflags', '+faststart',
      '-t', normalized.totalDuration.toFixed(3),
      '-progress', 'pipe:1',
      '-nostats',
      outputPath
    );

    if (cancelled.has(id)) return { cancelled: true, outputPath: null };
    onProgress?.({ phase: 'queued', percent: 2 });
    if (cancelled.has(id)) return { cancelled: true, outputPath: null };
    onProgress?.({ phase: 'processing', percent: 3 });

    try {
      await spawnExport(args, {
        operationId: id,
        key,
        totalDuration: normalized.totalDuration,
        onProgress
      });
    } catch (error) {
      if (cancelled.has(id)) return { cancelled: true, outputPath: null };
      throw error;
    }

    if (cancelled.has(id)) return { cancelled: true, outputPath: null };
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw exportError('COMPOSITION_EXPORT_FAILED', 'Composition export did not create a usable output file.');
    }

    succeeded = true;
    onProgress?.({ phase: 'completed', percent: 100 });
    return {
      cancelled: false,
      outputPath,
      duration: normalized.totalDuration,
      width: dims.width,
      height: dims.height,
      sizeBytes: fs.statSync(outputPath).size,
      subtitleCount: normalized.subtitles.length,
      audioCount: normalized.audio.length,
      compositionSignature: normalized.signature
    };
  } finally {
    reservations.delete(id);
    active.delete(id);
    if (activeKeys.get(key) === id) activeKeys.delete(key);
    const wasCancelled = cancelled.has(id);
    cancelled.delete(id);
    if ((!succeeded || wasCancelled) && outputPath) removePartial(outputPath);
    if (subtitlePath) removePartial(subtitlePath);
  }
}

function cancelCompositionExport(operationId) {
  const id = String(operationId || '');
  if (!active.has(id) && !reservations.has(id)) return false;
  cancelled.add(id);
  const child = active.get(id);
  if (!child) return true;
  try {
    child.kill('SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function cancelAllCompositionExports() {
  let count = 0;
  const ids = new Set([...active.keys(), ...reservations.keys()]);
  for (const id of ids) if (cancelCompositionExport(id)) count += 1;
  return count;
}

function getActiveCompositionExportCount() {
  return new Set([...active.keys(), ...reservations.keys()]).size;
}

function serializeExportError(error) {
  return {
    code: error?.code || 'COMPOSITION_EXPORT_FAILED',
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  normalizeExportPayload,
  sanitizeBaseName,
  uniqueOutputPath,
  exportComposition,
  cancelCompositionExport,
  cancelAllCompositionExports,
  getActiveCompositionExportCount,
  serializeExportError
};
