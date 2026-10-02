class VoiceProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VoiceProviderError";
    this.code = code;
    this.details = details;
  }
}

function providerError(code, message, details) {
  return new VoiceProviderError(code, message, details);
}

const PRODUCT_VOICES = [
  {
    id: "an",
    name: "An",
    styleKey: "warmNatural",
    internalVoice: "marin",
    instructions: "Speak naturally, warmly, and clearly. Keep a conversational pace and avoid exaggerated emotion."
  },
  {
    id: "minh",
    name: "Minh",
    styleKey: "clearCalm",
    internalVoice: "cedar",
    instructions: "Speak clearly and calmly with a confident, natural conversational rhythm."
  },
  {
    id: "vy",
    name: "Vy",
    styleKey: "brightFriendly",
    internalVoice: "coral",
    instructions: "Speak in a bright, friendly, natural tone. Keep the delivery smooth and conversational."
  },
  {
    id: "khoi",
    name: "Khôi",
    styleKey: "grounded",
    internalVoice: "onyx",
    instructions: "Speak with a grounded, steady, natural tone and clear articulation."
  },
  {
    id: "linh",
    name: "Linh",
    styleKey: "softStory",
    internalVoice: "shimmer",
    instructions: "Speak softly and naturally with a storytelling feel, while remaining clear and easy to understand."
  }
];

function publicCatalog() {
  return PRODUCT_VOICES.map(({ id, name, styleKey }) => ({ id, name, styleKey }));
}

function resolveVoice(voiceId) {
  const voice = PRODUCT_VOICES.find(item => item.id === String(voiceId || ""));
  if (!voice) throw providerError("VOICE_NOT_FOUND", "Voice is not available.");
  return voice;
}

function config() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.VIRAL_AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts").trim(),
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
    return providerError("PROVIDER_AUTH_FAILED", "Voice provider authentication failed.", { status, type, code });
  }
  if (status === 429) {
    return providerError("PROVIDER_RATE_LIMITED", "Voice provider rate limit reached.", { status, type, code });
  }
  if (status >= 500) {
    return providerError("PROVIDER_UNAVAILABLE", "Voice provider is unavailable.", { status, type, code });
  }
  return providerError("PROVIDER_REQUEST_FAILED", "Voice provider rejected the request.", { status, type, code });
}

function wavDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw providerError("PROVIDER_AUDIO_INVALID", "Voice provider returned an invalid WAV file.");
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (id === "fmt " && size >= 16 && dataOffset + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(dataOffset + 8);
    } else if (id === "data") {
      dataSize = Math.min(size, Math.max(0, buffer.length - dataOffset));
      break;
    }

    offset = dataOffset + size + (size % 2);
  }

  if (!byteRate || !dataSize) {
    throw providerError("PROVIDER_AUDIO_INVALID", "Voice provider returned an unreadable WAV file.");
  }

  return dataSize / byteRate;
}

async function synthesize({ text, voiceId, language, signal, instructions }) {
  const current = config();
  if (!current.apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "Voice provider is not configured.");
  }

  const input = String(text || "").trim();
  if (!input || input.length > 4096) {
    throw providerError("VOICE_TEXT_INVALID", "Voice input is invalid.");
  }

  const voice = resolveVoice(voiceId);

  let url;
  try {
    url = new URL("/v1/audio/speech", current.baseUrl);
  } catch {
    throw providerError("PROVIDER_CONFIG_INVALID", "Voice provider URL is invalid.");
  }

  const languageHint = language && language !== "auto"
    ? " Read the text in language code " + String(language) + "."
    : "";

  const body = {
    model: current.model,
    input,
    voice: voice.internalVoice,
    response_format: "wav",
    speed: 1,
    instructions: String(instructions || voice.instructions || "") + languageHint
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + current.apiKey,
        "content-type": "application/json",
        accept: "audio/wav"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw providerError("PROVIDER_CANCELLED", "Voice request was cancelled.");
    }
    throw providerError("PROVIDER_NETWORK", "Could not reach voice provider.", {
      technicalMessage: error?.message || String(error)
    });
  }

  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    throw stableProviderError(response.status, payload || {});
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const duration = wavDurationSeconds(buffer);

  return {
    buffer,
    duration,
    voiceId: voice.id
  };
}

module.exports = {
  isConfigured,
  synthesize,
  publicCatalog,
  resolveVoice,
  config,
  wavDurationSeconds,
  VoiceProviderError
};
