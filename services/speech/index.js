const { probeVideo, assertVideoPath } = require("../ffmpeg");
const { LocalSpeechProvider } = require("./local-provider");
const { CloudSpeechProvider } = require("./cloud-provider");
const { normalizeSpeechResult } = require("./result-normalizer");

const activeJobs = new Map();
const reservations = new Map();

class SpeechError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SpeechError";
    this.code = code;
    this.details = details;
  }
}

function speechError(code, message, details) {
  return new SpeechError(code, message, details);
}

function validateMode(mode) {
  if (mode !== "local" && mode !== "cloud") {
    throw speechError("MODE_INVALID", "Unsupported speech processing mode.");
  }
  return mode;
}

function createProviders({ userDataPath, backendUrl }) {
  return {
    local: new LocalSpeechProvider({ userDataPath }),
    cloud: new CloudSpeechProvider({ backendUrl })
  };
}

function duplicateForInput(inputPath) {
  const active = [...activeJobs.values()].find(job => job.inputPath === inputPath);
  if (active) return active;
  const reserved = [...reservations.values()].find(item => item.inputPath === inputPath);
  return reserved || null;
}

async function preflightSpeech({ inputPath, mode, consent = false, providers }) {
  const safeInput = assertVideoPath(inputPath);
  const safeMode = validateMode(mode);

  if (duplicateForInput(safeInput)) {
    throw speechError("DUPLICATE_ACTIVE", "Speech recognition is already active for this video.");
  }

  const metadata = await probeVideo(safeInput);
  if (!metadata.audioCodec) {
    throw speechError("NO_AUDIO", "The source video does not contain an audio track.");
  }

  if (safeMode === "cloud" && consent !== true) {
    throw speechError("CLOUD_CONSENT_REQUIRED", "Cloud processing requires explicit consent.");
  }

  const provider = providers[safeMode];
  const providerStatus = provider.status();

  if (!providerStatus.ready) {
    throw speechError(providerStatus.code, "Speech provider is not ready.", {
      providerStatus
    });
  }

  return {
    inputPath: safeInput,
    mode: safeMode,
    metadata: {
      duration: metadata.duration,
      audioCodec: metadata.audioCodec,
      sizeBytes: metadata.sizeBytes
    },
    providerStatus
  };
}

async function startSpeech({ jobId, inputPath, mode, consent = false, language = "auto", providers, onProgress }) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) {
    throw speechError("JOB_INVALID", "Invalid speech job id.");
  }

  const preflight = await preflightSpeech({ inputPath, mode, consent, providers });
  reservations.set(jobId, {
    jobId,
    inputPath: preflight.inputPath,
    mode: preflight.mode,
    createdAt: Date.now()
  });

  const provider = providers[preflight.mode];

  try {
    activeJobs.set(jobId, {
      jobId,
      inputPath: preflight.inputPath,
      mode: preflight.mode,
      startedAt: Date.now(),
      provider
    });

    reservations.delete(jobId);
    onProgress?.({ jobId, state: "preparing", percent: 0 });

    const raw = await provider.transcribe({
      jobId,
      inputPath: preflight.inputPath,
      language,
      onProgress: payload => onProgress?.({ jobId, ...payload })
    });

    return {
      cancelled: false,
      result: normalizeSpeechResult({
        ...raw,
        meta: {
          ...(raw?.meta || {}),
          providerMode: preflight.mode
        }
      })
    };
  } catch (error) {
    if (error instanceof SpeechError) throw error;
    throw speechError(error?.code || "SPEECH_FAILED", error?.message || "Speech recognition failed.");
  } finally {
    activeJobs.delete(jobId);
    reservations.delete(jobId);
  }
}

async function cancelSpeech(jobId) {
  const active = activeJobs.get(jobId);
  if (!active) {
    if (reservations.delete(jobId)) return true;
    return false;
  }

  try {
    return Boolean(await active.provider.cancel(jobId));
  } catch {
    return false;
  }
}

async function cancelAllSpeech() {
  const ids = new Set([...activeJobs.keys(), ...reservations.keys()]);
  let cancelled = 0;
  for (const jobId of ids) {
    if (await cancelSpeech(jobId)) cancelled++;
  }
  return cancelled;
}

function activeSpeechCount() {
  return new Set([...activeJobs.keys(), ...reservations.keys()]).size;
}

function serializeSpeechError(error) {
  return {
    code: error?.code || "SPEECH_FAILED",
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  createProviders,
  preflightSpeech,
  startSpeech,
  cancelSpeech,
  cancelAllSpeech,
  activeSpeechCount,
  serializeSpeechError
};
