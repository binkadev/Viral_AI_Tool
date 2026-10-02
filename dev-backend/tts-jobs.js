const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const ttsProvider = require("./providers/tts");

const MAX_SEGMENTS = 300;
const MAX_TOTAL_CHARS = 60000;
const MAX_SEGMENT_CHARS = 4096;
const DATA_DIR = path.join(__dirname, "data", "tts");
fs.mkdirSync(DATA_DIR, { recursive: true });

const jobs = new Map();
const idempotency = new Map();

class TtsJobError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TtsJobError";
    this.code = code;
    this.details = details;
  }
}

function jobError(code, message, details) {
  return new TtsJobError(code, message, details);
}

function jobId() {
  return "tts_" + crypto.randomBytes(12).toString("hex");
}

function safeId(value, fallback) {
  const id = String(value || fallback || "").trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(id) ? id : "";
}

function safeVoiceMap(input) {
  const output = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;

  for (const [speaker, voice] of Object.entries(input)) {
    const speakerId = safeId(speaker);
    const voiceId = safeId(voice);
    if (speakerId && voiceId) output[speakerId] = voiceId;
  }
  return output;
}

function normalizeSegments(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SEGMENTS) {
    throw jobError("TTS_INPUT_INVALID", "TTS segments are invalid.");
  }

  const ids = new Set();
  let totalChars = 0;

  const segments = input.map((item, index) => {
    const id = safeId(item?.id, "segment-" + (index + 1));
    const text = String(item?.text || "").trim();
    const start = Math.max(0, Number(item?.start || 0));
    const end = Math.max(start, Number(item?.end || start));
    const speaker = safeId(item?.speaker, "speaker-1") || "speaker-1";

    if (!id || ids.has(id) || !text || text.length > MAX_SEGMENT_CHARS) {
      throw jobError("TTS_INPUT_INVALID", "A TTS segment is invalid.");
    }

    ids.add(id);
    totalChars += text.length;

    return { id, text, start, end, speaker };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw jobError("TTS_TOO_LARGE", "TTS input is too large.", {
      maxCharacters: MAX_TOTAL_CHARS,
      totalCharacters: totalChars
    });
  }

  return { segments, totalChars };
}

function validateCreateBody(body) {
  const clientJobId = String(body?.clientJobId || "").trim();
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(clientJobId)) {
    throw jobError("TTS_INPUT_INVALID", "Client job ID is invalid.");
  }

  const defaultVoiceId = safeId(body?.defaultVoiceId, "linh");
  if (!defaultVoiceId) {
    throw jobError("TTS_VOICE_INVALID", "Default voice is invalid.");
  }

  const speed = Number(body?.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw jobError("TTS_SPEED_INVALID", "TTS speed is invalid.");
  }

  const style = ["natural", "calm", "energetic"].includes(body?.style)
    ? body.style
    : "natural";

  const normalized = normalizeSegments(body?.segments);

  return {
    clientJobId,
    defaultVoiceId,
    voiceMap: safeVoiceMap(body?.voiceMap),
    speed,
    style,
    segments: normalized.segments,
    totalChars: normalized.totalChars
  };
}

function fingerprint(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      defaultVoiceId: input.defaultVoiceId,
      voiceMap: input.voiceMap,
      speed: input.speed,
      style: input.style,
      segments: input.segments.map(item => ({
        id: item.id,
        text: item.text,
        speaker: item.speaker
      }))
    }))
    .digest("hex");
}

function jobDir(serverJobId) {
  return path.join(DATA_DIR, serverJobId);
}

function assetFilePath(serverJobId, assetId) {
  return path.join(jobDir(serverJobId), assetId + ".wav");
}

function durationRisk(segment, generatedDuration) {
  const slot = Math.max(0, Number(segment.end || 0) - Number(segment.start || 0));
  if (slot <= 0 || generatedDuration <= 0) return false;
  return generatedDuration > slot * 1.08;
}

function publicSegment(item) {
  return {
    id: item.id,
    speaker: item.speaker,
    voiceId: item.voiceId,
    start: item.start,
    end: item.end,
    text: item.text,
    state: item.state,
    assetId: item.assetId || null,
    generatedDuration: Number(item.generatedDuration || 0),
    timingRisk: item.timingRisk === true,
    error: item.errorCode ? { code: item.errorCode } : null
  };
}

function publicJob(job) {
  const payload = {
    jobId: job.id,
    state: job.state,
    progress: Number(job.progress || 0),
    completedSegments: job.segmentStates.filter(item => item.state === "completed").length,
    totalSegments: job.segmentStates.length,
    segments: job.segmentStates.map(publicSegment)
  };

  if (job.errorCode) payload.error = { code: job.errorCode };

  if (job.state === "completed") {
    payload.result = {
      version: 1,
      segments: job.segmentStates.map(publicSegment),
      meta: {
        providerMode: "cloud",
        timingPreserved: true,
        warningCount: job.segmentStates.filter(item => item.timingRisk).length,
        createdAt: job.completedAt || new Date().toISOString()
      }
    };
  }

  return payload;
}

function providerPublicCode(error) {
  const code = error?.code || "";
  if (code === "PROVIDER_CANCELLED") return "CANCELLED";
  if (code === "TTS_TEXT_INVALID") return "TTS_INPUT_INVALID";
  if (code === "TTS_VOICE_INVALID") return "TTS_VOICE_INVALID";
  if ([
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_NETWORK",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_CONFIG_INVALID"
  ].includes(code)) {
    return "SERVICE_UNAVAILABLE";
  }
  return "TTS_FAILED";
}

function nextIncomplete(job) {
  return job.segmentStates.find(item => item.state !== "completed") || null;
}

async function processJob(job) {
  if (!job || job.processing || !["queued", "failed", "cancelled"].includes(job.state)) return;

  job.processing = true;
  job.cancelRequested = false;
  job.state = "synthesizing";
  job.errorCode = null;
  job.controller = new AbortController();

  try {
    await fsp.mkdir(jobDir(job.id), { recursive: true });

    while (true) {
      if (job.cancelRequested || job.controller.signal.aborted) {
        job.state = "cancelled";
        break;
      }

      const segment = nextIncomplete(job);
      if (!segment) {
        job.state = "completed";
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        break;
      }

      segment.state = "synthesizing";
      segment.errorCode = null;

      const selectedVoice = job.voiceMap[segment.speaker] || job.defaultVoiceId;
      segment.voiceId = selectedVoice;

      try {
        const response = await ttsProvider.synthesize({
          text: segment.text,
          voiceId: selectedVoice,
          speed: job.speed,
          style: job.style,
          signal: job.controller.signal
        });

        const assetId = crypto
          .createHash("sha256")
          .update(job.id + ":" + segment.id + ":" + selectedVoice + ":" + segment.text)
          .digest("hex")
          .slice(0, 24);

        const finalPath = assetFilePath(job.id, assetId);
        const tempPath = finalPath + ".tmp";

        await fsp.writeFile(tempPath, response.audio);
        await fsp.rename(tempPath, finalPath);

        segment.assetId = assetId;
        segment.generatedDuration = Number(response.duration || 0);
        segment.timingRisk = durationRisk(segment, segment.generatedDuration);
        segment.state = "completed";

        const completed = job.segmentStates.filter(item => item.state === "completed").length;
        job.progress = Math.min(99, Math.round((completed / job.segmentStates.length) * 100));
      } catch (error) {
        if (job.cancelRequested || job.controller.signal.aborted || error?.code === "PROVIDER_CANCELLED") {
          segment.state = "pending";
          job.state = "cancelled";
          break;
        }

        segment.state = "failed";
        segment.errorCode = providerPublicCode(error);
        job.state = "failed";
        job.errorCode = segment.errorCode;
        console.error("[TtsProvider]", error?.code || "ERROR", error?.message || String(error));
        break;
      }
    }
  } finally {
    job.controller = null;
    job.processing = false;
  }
}

function status() {
  const configured = ttsProvider.isConfigured();

  return {
    ready: configured,
    code: configured ? "READY" : "TTS_PROVIDER_NOT_CONFIGURED",
    voices: ttsProvider.publicVoices(),
    limits: {
      maxSegments: MAX_SEGMENTS,
      maxCharacters: MAX_TOTAL_CHARS,
      maxSegmentCharacters: MAX_SEGMENT_CHARS
    }
  };
}

function create(userId, idemKey, body) {
  const input = validateCreateBody(body);
  if (input.clientJobId !== idemKey) {
    throw jobError("TTS_INPUT_INVALID", "Idempotency key mismatch.");
  }

  const scoped = userId + ":" + idemKey;
  const inputFingerprint = fingerprint(input);
  const existingId = idempotency.get(scoped);

  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw jobError("JOB_CONFLICT", "Idempotency key was reused with different TTS input.");
      }

      if (["failed", "cancelled"].includes(existing.state) && !existing.processing) {
        for (const segment of existing.segmentStates) {
          if (segment.state === "failed" || segment.state === "synthesizing") {
            segment.state = "pending";
            segment.errorCode = null;
          }
        }
        existing.state = "queued";
        existing.errorCode = null;
        setImmediate(() => processJob(existing));
      }

      return { created: false, job: publicJob(existing) };
    }

    idempotency.delete(scoped);
  }

  if (!ttsProvider.isConfigured()) {
    throw jobError("SERVICE_UNAVAILABLE", "TTS provider is not configured.");
  }

  const serverJobId = jobId();
  const segmentStates = input.segments.map(item => ({
    ...item,
    voiceId: input.voiceMap[item.speaker] || input.defaultVoiceId,
    state: "pending",
    assetId: null,
    generatedDuration: 0,
    timingRisk: false,
    errorCode: null
  }));

  const job = {
    id: serverJobId,
    userId,
    clientJobId: input.clientJobId,
    fingerprint: inputFingerprint,
    defaultVoiceId: input.defaultVoiceId,
    voiceMap: input.voiceMap,
    speed: input.speed,
    style: input.style,
    totalChars: input.totalChars,
    segmentStates,
    state: "queued",
    progress: 0,
    errorCode: null,
    cancelRequested: false,
    controller: null,
    processing: false,
    createdAt: new Date().toISOString()
  };

  jobs.set(job.id, job);
  idempotency.set(scoped, job.id);
  setImmediate(() => processJob(job));

  return { created: true, job: publicJob(job) };
}

function get(userId, serverJobId) {
  const job = jobs.get(String(serverJobId || ""));
  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "TTS job was not found.");
  }
  return publicJob(job);
}

function cancel(userId, serverJobId) {
  const job = jobs.get(String(serverJobId || ""));
  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "TTS job was not found.");
  }

  if (["completed", "failed", "cancelled"].includes(job.state)) {
    return { cancelled: job.state === "cancelled" };
  }

  job.cancelRequested = true;
  if (job.state === "synthesizing") {
    job.state = "cancelling";
    try { job.controller?.abort(); } catch {}
  } else {
    job.state = "cancelled";
  }

  return { cancelled: true };
}

function asset(userId, serverJobId, assetId) {
  const job = jobs.get(String(serverJobId || ""));
  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "TTS job was not found.");
  }

  const segment = job.segmentStates.find(item => item.assetId === assetId && item.state === "completed");
  if (!segment) {
    throw jobError("ASSET_NOT_FOUND", "TTS asset was not found.");
  }

  const filePath = assetFilePath(job.id, assetId);
  if (!fs.existsSync(filePath)) {
    throw jobError("ASSET_NOT_FOUND", "TTS asset file is missing.");
  }

  return {
    filePath,
    contentType: "audio/wav",
    fileName: assetId + ".wav",
    sizeBytes: fs.statSync(filePath).size
  };
}

module.exports = {
  status,
  create,
  get,
  cancel,
  asset,
  TtsJobError
};
