'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SAMPLE_RATE = 24000;
const active = new Map();

function providerError(code, message, details = {}) {
  const error = new Error(String(message || code || 'AUTOMATION_VOICE_FAILED'));
  error.code = String(code || 'AUTOMATION_VOICE_FAILED');
  error.details = details;
  return error;
}

function safeId(value, fallback) {
  const id = String(value || fallback || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id)) throw providerError('VOICE_INPUT_INVALID', 'Invalid voice segment id.');
  return id;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function wavBuffer(durationSec, seed = '') {
  const duration = Math.max(0.35, Math.min(30, number(durationSec, 1)));
  const frames = Math.max(1, Math.round(duration * SAMPLE_RATE));
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  const seedNumber = parseInt(hash(seed).slice(0, 6), 16) || 1;
  const base = 155 + (seedNumber % 90);
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const phraseGate = Math.sin(2 * Math.PI * 2.8 * t) > -0.48 ? 1 : 0.08;
    const syllable = 0.58 + 0.42 * Math.sin(2 * Math.PI * 5.1 * t + (seedNumber % 11));
    const envelope = Math.min(1, t * 10) * Math.min(1, (duration - t) * 12);
    const carrier = Math.sin(2 * Math.PI * base * t) * 0.66 + Math.sin(2 * Math.PI * (base * 2.03) * t) * 0.18;
    const sample = Math.max(-1, Math.min(1, carrier * phraseGate * syllable * envelope * 0.16));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 120) {
    throw providerError('VOICE_INPUT_INVALID', 'Automation voice segments are invalid.');
  }
  return segments.map((item, index) => {
    const sceneId = safeId(item?.sceneId || item?.id, `scene-${index + 1}`);
    const text = String(item?.text || '').trim().slice(0, 4096);
    if (!text) throw providerError('VOICE_INPUT_INVALID', 'Automation voice text is required.', { sceneId });
    const durationSec = Math.max(0.35, number(item?.durationSec, number(item?.endSec, 0) - number(item?.startSec, 0)) || 1);
    return { sceneId, id: sceneId, text, durationSec };
  });
}

async function startDevVoice({ operationId, segments, outputRoot, inputSignature, onProgress } = {}) {
  const id = safeId(operationId, 'automation-voice');
  if (active.has(id)) throw providerError('DUPLICATE_ACTIVE', 'Automation voice generation is already active.');
  const safeSegments = normalizeSegments(segments);
  const controller = new AbortController();
  active.set(id, controller);
  const signature = String(inputSignature || hash(JSON.stringify(safeSegments))).slice(0, 240);
  const dir = path.join(path.resolve(String(outputRoot || '')), hash(signature).slice(0, 24));

  try {
    await fsp.mkdir(dir, { recursive: true });
    const resultSegments = [];
    onProgress?.({ phase: 'preparing', percent: 1 });

    for (let index = 0; index < safeSegments.length; index += 1) {
      if (controller.signal.aborted) return { cancelled: true, result: null };
      const segment = safeSegments[index];
      const filePath = path.join(dir, hash(segment.sceneId + ':' + signature).slice(0, 24) + '.wav');
      const buffer = wavBuffer(segment.durationSec, segment.text + ':' + segment.sceneId);
      await fsp.writeFile(filePath, buffer);
      resultSegments.push({
        id: segment.sceneId,
        sceneId: segment.sceneId,
        text: segment.text,
        audioPath: filePath,
        duration: Number(segment.durationSec.toFixed(3)),
        provider: 'dev-tone',
        developmentPreview: true,
        aiGenerated: false
      });
      onProgress?.({
        phase: 'generating',
        percent: Math.max(2, Math.min(99, Math.round(((index + 1) / safeSegments.length) * 99))),
        sceneId: segment.sceneId
      });
      await new Promise(resolve => setImmediate(resolve));
    }

    if (controller.signal.aborted) return { cancelled: true, result: null };
    const result = {
      id: 'automation-voice-' + hash(signature).slice(0, 12),
      jobId: id,
      provider: 'dev-tone',
      developmentPreview: true,
      aiGenerated: false,
      inputSignature: signature,
      segments: resultSegments,
      createdAt: new Date().toISOString()
    };
    onProgress?.({ phase: 'completed', percent: 100 });
    return { cancelled: false, result };
  } finally {
    active.delete(id);
  }
}

function cancelDevVoice(operationId) {
  const controller = active.get(String(operationId || ''));
  if (!controller) return false;
  controller.abort();
  return true;
}

function cancelAllDevVoice() {
  let count = 0;
  for (const controller of active.values()) {
    controller.abort();
    count += 1;
  }
  return count;
}

function status() {
  const enabled = process.env.VIRAL_AI_AUTOMATION_DEV_VOICE_PROVIDER === '1';
  return {
    ready: enabled,
    provider: enabled ? 'dev-tone' : null,
    developmentPreview: enabled,
    networkUsed: false,
    code: enabled ? 'READY' : 'AUTOMATION_VOICE_NOT_CONFIGURED'
  };
}

function activeCount() {
  return active.size;
}

function serializeError(error) {
  return {
    code: error?.code || 'AUTOMATION_VOICE_FAILED',
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  SAMPLE_RATE,
  wavBuffer,
  normalizeSegments,
  startDevVoice,
  cancelDevVoice,
  cancelAllDevVoice,
  status,
  activeCount,
  serializeError
};
