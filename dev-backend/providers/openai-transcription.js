const fs = require("fs/promises");

class SpeechProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SpeechProviderError";
    this.code = code;
    this.details = details;
  }
}

function providerError(code, message, details) {
  return new SpeechProviderError(code, message, details);
}

function config() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.VIRAL_AI_OPENAI_TRANSCRIBE_MODEL || "whisper-1").trim(),
    baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "")
  };
}

function isConfigured() {
  return Boolean(config().apiKey);
}

function stableProviderError(status, payload) {
  const type = payload?.error?.type || "";
  const code = payload?.error?.code || "";

  if (status === 401 || status === 403) {
    return providerError("PROVIDER_AUTH_FAILED", "Speech provider authentication failed.", { status, type, code });
  }
  if (status === 429) {
    return providerError("PROVIDER_RATE_LIMITED", "Speech provider rate limit reached.", { status, type, code });
  }
  if (status === 413) {
    return providerError("PROVIDER_FILE_TOO_LARGE", "Speech provider rejected the audio size.", { status, type, code });
  }
  if (status >= 500) {
    return providerError("PROVIDER_UNAVAILABLE", "Speech provider is unavailable.", { status, type, code });
  }
  return providerError("PROVIDER_REQUEST_FAILED", "Speech provider rejected the request.", { status, type, code });
}

function normalizeSegments(payload, duration) {
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : [];

  if (rawSegments.length) {
    return rawSegments
      .filter(segment => segment && typeof segment.text === "string")
      .map((segment, index) => ({
        id: String(segment.id ?? ("segment-" + (index + 1))),
        start: Math.max(0, Number(segment.start || 0)),
        end: Math.max(0, Number(segment.end || 0)),
        text: String(segment.text || "").trim(),
        speaker: segment.speaker ? String(segment.speaker) : null,
        words: []
      }))
      .filter(segment => segment.text);
  }

  const text = String(payload?.text || "").trim();
  if (!text) return [];

  return [{
    id: "segment-1",
    start: 0,
    end: Math.max(0, Number(payload?.duration || duration || 0)),
    text,
    speaker: null,
    words: []
  }];
}

function normalizeResult(payload, requestedLanguage, duration, model) {
  const text = String(payload?.text || "").trim();
  const segments = normalizeSegments(payload, duration);
  const resolvedDuration = Math.max(
    0,
    Number(payload?.duration || duration || segments.at(-1)?.end || 0)
  );

  return {
    version: 1,
    language: requestedLanguage && requestedLanguage !== "auto"
      ? requestedLanguage
      : String(payload?.language || "unknown"),
    duration: resolvedDuration,
    text,
    segments,
    meta: {
      providerMode: "cloud",
      timingAvailable: segments.some(segment => segment.end > segment.start),
      speakerLabels: segments.some(segment => Boolean(segment.speaker)),
      createdAt: new Date().toISOString(),
      providerModel: model
    }
  };
}

async function transcribe({ filePath, language = "auto", duration = 0, signal }) {
  const current = config();

  if (!current.apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "Speech provider is not configured.");
  }

  let url;
  try {
    url = new URL("/v1/audio/transcriptions", current.baseUrl);
  } catch {
    throw providerError("PROVIDER_CONFIG_INVALID", "Speech provider URL is invalid.");
  }

  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/flac" }), "speech.flac");
  form.append("model", current.model);

  if (language && language !== "auto") {
    form.append("language", language);
  }

  if (current.model === "whisper-1") {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  } else if (current.model === "gpt-4o-transcribe-diarize") {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
  } else {
    form.append("response_format", "json");
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + current.apiKey
      },
      body: form,
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw providerError("PROVIDER_CANCELLED", "Speech provider request was cancelled.");
    }
    throw providerError("PROVIDER_NETWORK", "Could not reach speech provider.", {
      technicalMessage: error?.message || String(error)
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw stableProviderError(response.status, payload || {});
  }

  return normalizeResult(payload || {}, language, duration, current.model);
}

module.exports = {
  isConfigured,
  transcribe,
  config,
  SpeechProviderError
};
