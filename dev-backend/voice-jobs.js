const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const voiceProvider = require("./providers/voice");

const MAX_SEGMENTS = 300;
const MAX_TOTAL_CHARS = 60000;
const MAX_SEGMENT_CHARS = 4096;
const PREVIEW_MAX_CHARS = 220;
const PREVIEW_COOLDOWN_MS = 3000;
const RESULT_TTL_MS = 60 * 60 * 1000;

const jobs = new Map();
const idempotency = new Map();
const previewTimes = new Map();

class VoiceJobError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VoiceJobError";
    this.code = code;
    this.details = details;
  }
}

function jobError(code, message, details) {
  return new VoiceJobError(code, message, details);
}

function stableJobId() {
  return "vo_" + crypto.randomBytes(12).toString("hex");
}

function normalizeLanguage(value, fallback = "") {
  const code = String(value || fallback).trim();
  if (!code) return "";
  if (code === "auto") return code;
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(code) ? code : "";
}

function speakerKey(value) {
  const text = String(value || "").trim();
  return text || "speaker-1";
}

function safeFileName(segmentId) {
  return crypto.createHash("sha256").update(String(segmentId)).digest("hex").slice(0, 28) + ".wav";
}

function normalizeSegments(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SEGMENTS) {
    throw jobError("VOICE_INPUT_INVALID", "Voice segments are invalid.");
  }

  const ids = new Set();
  let totalChars = 0;

  const segments = input.map((item, index) => {
    const id = String(item?.id || "segment-" + (index + 1)).trim();
    const text = String(item?.text || "").trim();
    const start = Math.max(0, Number(item?.start || 0));
    const end = Math.max(start, Number(item?.end || start));
    const speaker = speakerKey(item?.speaker);

    if (!id || ids.has(id) || !text || text.length > MAX_SEGMENT_CHARS) {
      throw jobError("VOICE_INPUT_INVALID", "Voice segment content is invalid.");
    }

    ids.add(id);
    totalChars += text.length;

    return { id, start, end, text, speaker };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw jobError("VOICE_TOO_LARGE", "Voice input is too large.", {
      maxChars: MAX_TOTAL_CHARS,
      totalChars
    });
  }

  return { segments, totalChars };
}

function catalogIds() {
  return new Set(voiceProvider.publicCatalog().map(item => String(item.id)));
}

function normalizeAssignments(raw, segments) {
  const available = catalogIds();
  const defaultVoiceId = String(raw?.defaultVoiceId || "").trim();
  const bySpeakerRaw = raw?.bySpeaker && typeof raw.bySpeaker === "object" ? raw.bySpeaker : {};

  if (!defaultVoiceId || !available.has(defaultVoiceId)) {
    throw jobError("VOICE_NOT_FOUND", "Default voice is unavailable.");
  }

  const speakers = [...new Set(segments.map(item => item.speaker))];
  const bySpeaker = {};

  for (const speaker of speakers) {
    const requested = String(bySpeakerRaw[speaker] || defaultVoiceId).trim();
    if (!available.has(requested)) {
      throw jobError("VOICE_NOT_FOUND", "Assigned voice is unavailable.");
    }
    bySpeaker[speaker] = requested;
  }

  return { defaultVoiceId, bySpeaker };
}

function validateCreateBody(body) {
  const clientJobId = String(body?.clientJobId || "").trim();
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(clientJobId)) {
    throw jobError("VOICE_INPUT_INVALID", "Client job ID is invalid.");
  }

  const language = normalizeLanguage(body?.language);
  if (!language || language === "auto") {
    throw jobError("VOICE_LANGUAGE_INVALID", "Voice language is invalid.");
  }

  const normalized = normalizeSegments(body?.segments);
  const assignments = normalizeAssignments(body?.assignments || {}, normalized.segments);

  return {
    clientJobId,
    language,
    segments: normalized.segments,
    totalChars: normalized.totalChars,
    assignments
  };
}

function fingerprint(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      language: input.language,
      segments: input.segments.map(item => ({
        id: item.id,
        text: item.text,
        speaker: item.speaker,
        start: item.start,
        end: item.end
      })),
      assignments: input.assignments
    }))
    .digest("hex");
}

function publicErrorCode(error) {
  const code = error?.code || "";

  if (code === "PROVIDER_CANCELLED") return "CANCELLED";
  if (code === "VOICE_NOT_FOUND") return "VOICE_NOT_FOUND";
  if (code === "VOICE_TEXT_INVALID") return "VOICE_INPUT_INVALID";
  if (code === "PROVIDER_AUDIO_INVALID") return "VOICE_AUDIO_INVALID";
  if ([
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_NETWORK",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_CONFIG_INVALID",
    "PROVIDER_NOT_CONFIGURED"
  ].includes(code)) {
    return "SERVICE_UNAVAILABLE";
  }

  return "VOICE_FAILED";
}

function jobDir(jobId) {
  return path.join(__dirname, "data", "voice", jobId);
}

function cleanupDir(jobId) {
  try {
    fs.rmSync(jobDir(jobId), { recursive: true, force: true });
  } catch {}
}

function scheduleCleanup(job) {
  if (!job || job.cleanupTimer) return;
  job.cleanupTimer = setTimeout(() => {
    cleanupDir(job.id);
    job.filesExpired = true;
  }, RESULT_TTL_MS);
  job.cleanupTimer.unref?.();
}

function audioRoute(jobId, segmentId) {
  return "/v1/voice/jobs/" + encodeURIComponent(jobId) +
    "/segments/" + encodeURIComponent(segmentId) + "/audio";
}

function timingMeta(segment, audioDuration) {
  const slot = Math.max(0, Number(segment.end || 0) - Number(segment.start || 0));
  const ratio = slot > 0 ? audioDuration / slot : 1;

  return {
    slotDuration: Number(slot.toFixed(3)),
    audioDuration: Number(audioDuration.toFixed(3)),
    durationRatio: Number(ratio.toFixed(2)),
    timingRisk: slot > 0 && audioDuration > slot * 1.1 + 0.15
  };
}

function publicJob(job) {
  const payload = {
    jobId: job.id,
    state: job.state
  };

  if (Number.isFinite(job.progress)) payload.progress = job.progress;
  if (job.result) payload.result = job.result;
  if (job.errorCode) payload.error = { code: job.errorCode };

  return payload;
}

async function processJob(job) {
  if (!job || job.started || job.state !== "queued") return;

  job.started = true;
  job.state = "processing";
  job.progress = 0;
  job.controller = new AbortController();

  const outputDir = jobDir(job.id);
  await fsp.mkdir(outputDir, { recursive: true });

  const outputSegments = [];

  try {
    for (let index = 0; index < job.segments.length; index++) {
      if (job.cancelRequested || job.controller.signal.aborted) {
        throw jobError("CANCELLED", "Voice generation was cancelled.");
      }

      const segment = job.segments[index];
      const voiceId = job.assignments.bySpeaker[segment.speaker] || job.assignments.defaultVoiceId;

      const generated = await voiceProvider.synthesize({
        text: segment.text,
        voiceId,
        language: job.language,
        signal: job.controller.signal
      });

      if (job.cancelRequested || job.controller.signal.aborted) {
        throw jobError("CANCELLED", "Voice generation was cancelled.");
      }

      const fileName = safeFileName(segment.id);
      const filePath = path.join(outputDir, fileName);
      await fsp.writeFile(filePath, generated.buffer);

      const timing = timingMeta(segment, generated.duration);

      outputSegments.push({
        id: segment.id,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        speaker: segment.speaker,
        voiceId,
        audioDuration: timing.audioDuration,
        slotDuration: timing.slotDuration,
        durationRatio: timing.durationRatio,
        timingRisk: timing.timingRisk,
        audioUrl: audioRoute(job.id, segment.id),
        fileName
      });

      job.progress = Math.min(99, Math.round(((index + 1) / job.segments.length) * 100));
    }

    job.result = {
      version: 1,
      language: job.language,
      aiGenerated: true,
      segments: outputSegments.map(({ fileName, ...item }) => item),
      speakers: [...new Set(outputSegments.map(item => item.speaker))].map(speaker => ({
        speaker,
        voiceId: job.assignments.bySpeaker[speaker] || job.assignments.defaultVoiceId
      })),
      meta: {
        providerMode: "cloud",
        timingPreserved: true,
        warningCount: outputSegments.filter(item => item.timingRisk).length,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + RESULT_TTL_MS).toISOString()
      }
    };

    job.segmentFiles = new Map(outputSegments.map(item => [item.id, item.fileName]));
    job.state = "completed";
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    scheduleCleanup(job);
  } catch (error) {
    if (job.cancelRequested || job.controller?.signal.aborted || ["CANCELLED", "PROVIDER_CANCELLED"].includes(error?.code)) {
      job.state = "cancelled";
      job.progress = 0;
    } else {
      job.state = "failed";
      job.progress = 0;
      job.errorCode = publicErrorCode(error);
      console.error("[VoiceProvider]", error?.code || "ERROR", error?.message || String(error));
    }

    cleanupDir(job.id);
  } finally {
    job.controller = null;
  }
}

function status() {
  const configured = voiceProvider.isConfigured();

  return {
    ready: configured,
    code: configured ? "READY" : "VOICE_PROVIDER_NOT_CONFIGURED",
    limits: {
      maxSegments: MAX_SEGMENTS,
      maxCharacters: MAX_TOTAL_CHARS,
      maxSegmentCharacters: MAX_SEGMENT_CHARS
    },
    catalog: configured ? voiceProvider.publicCatalog() : []
  };
}

function catalog() {
  return {
    ready: voiceProvider.isConfigured(),
    voices: voiceProvider.publicCatalog()
  };
}

function create(userId, idempotencyKey, body) {
  const input = validateCreateBody(body);

  if (input.clientJobId !== idempotencyKey) {
    throw jobError("VOICE_INPUT_INVALID", "Idempotency key mismatch.");
  }

  const scopedKey = userId + ":" + idempotencyKey;
  const inputFingerprint = fingerprint(input);
  const existingId = idempotency.get(scopedKey);

  if (existingId) {
    const existing = jobs.get(existingId);

    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw jobError("JOB_CONFLICT", "Idempotency key was reused with different voice input.");
      }
      return { created: false, job: publicJob(existing) };
    }

    idempotency.delete(scopedKey);
  }

  if (!voiceProvider.isConfigured()) {
    throw jobError("SERVICE_UNAVAILABLE", "Voice provider is not configured.");
  }

  const job = {
    id: stableJobId(),
    userId,
    clientJobId: input.clientJobId,
    fingerprint: inputFingerprint,
    language: input.language,
    segments: input.segments,
    assignments: input.assignments,
    totalChars: input.totalChars,
    state: "queued",
    progress: 0,
    result: null,
    errorCode: null,
    segmentFiles: new Map(),
    started: false,
    cancelRequested: false,
    controller: null,
    cleanupTimer: null,
    filesExpired: false,
    createdAt: new Date().toISOString()
  };

  jobs.set(job.id, job);
  idempotency.set(scopedKey, job.id);
  setImmediate(() => processJob(job));

  return { created: true, job: publicJob(job) };
}

function get(userId, jobId) {
  const job = jobs.get(String(jobId || ""));

  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "Voice job was not found.");
  }

  return publicJob(job);
}

function cancel(userId, jobId) {
  const job = jobs.get(String(jobId || ""));

  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "Voice job was not found.");
  }

  if (["completed", "failed", "cancelled"].includes(job.state)) {
    return { cancelled: job.state === "cancelled" };
  }

  job.cancelRequested = true;

  if (job.state === "processing") {
    job.state = "cancelling";
    try { job.controller?.abort(); } catch {}
  } else {
    job.state = "cancelled";
    job.progress = 0;
    cleanupDir(job.id);
  }

  return { cancelled: true };
}

function getAudio(userId, jobId, segmentId) {
  const job = jobs.get(String(jobId || ""));

  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "Voice job was not found.");
  }
  if (job.state !== "completed" || job.filesExpired) {
    throw jobError("VOICE_AUDIO_EXPIRED", "Voice audio is no longer available.");
  }

  const fileName = job.segmentFiles?.get(String(segmentId || ""));
  if (!fileName) {
    throw jobError("VOICE_AUDIO_NOT_FOUND", "Voice segment audio was not found.");
  }

  const filePath = path.join(jobDir(job.id), fileName);
  if (!fs.existsSync(filePath)) {
    throw jobError("VOICE_AUDIO_EXPIRED", "Voice audio is no longer available.");
  }

  return {
    filePath,
    contentType: "audio/wav"
  };
}

async function preview(userId, body, signal) {
  if (!voiceProvider.isConfigured()) {
    throw jobError("SERVICE_UNAVAILABLE", "Voice provider is not configured.");
  }

  const now = Date.now();
  const previous = Number(previewTimes.get(userId) || 0);

  if (now - previous < PREVIEW_COOLDOWN_MS) {
    throw jobError("VOICE_PREVIEW_RATE_LIMITED", "Voice preview is temporarily rate limited.");
  }

  const text = String(body?.text || "").trim();
  const language = normalizeLanguage(body?.language);

  if (!text || text.length > PREVIEW_MAX_CHARS || !language || language === "auto") {
    throw jobError("VOICE_PREVIEW_INVALID", "Voice preview input is invalid.");
  }

  previewTimes.set(userId, now);

  const generated = await voiceProvider.synthesize({
    text,
    voiceId: body?.voiceId,
    language,
    signal
  });

  return {
    buffer: generated.buffer,
    duration: generated.duration,
    contentType: "audio/wav"
  };
}

module.exports = {
  status,
  catalog,
  create,
  get,
  cancel,
  getAudio,
  preview,
  VoiceJobError
};
