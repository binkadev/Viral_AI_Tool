const BUILTIN_VOICES = Object.freeze({
  linh: { providerVoice: "coral", style: "Warm, clear, natural, friendly narration." },
  minh: { providerVoice: "cedar", style: "Calm, confident, natural, grounded narration." },
  an: { providerVoice: "marin", style: "Smooth, expressive, polished narration." },
  vy: { providerVoice: "shimmer", style: "Bright, lively, friendly narration." },
  kai: { providerVoice: "alloy", style: "Neutral, versatile, natural narration." }
});

class TtsProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TtsProviderError";
    this.code = code;
    this.details = details;
  }
}

function providerError(code, message, details) {
  return new TtsProviderError(code, message, details);
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

function publicVoices() {
  return Object.keys(BUILTIN_VOICES).map(id => ({ id }));
}

function parseWavDuration(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 ||
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE") {
    return 0;
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && payloadStart + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(payloadStart + 8);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, Math.max(0, buffer.length - payloadStart));
      break;
    }

    offset = payloadStart + chunkSize + (chunkSize % 2);
  }

  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
}

function stableProviderError(status, payload) {
  const type = payload?.error?.type || "";
  const code = payload?.error?.code || "";

  if (status === 401 || status === 403) {
    return providerError("PROVIDER_AUTH_FAILED", "TTS provider authentication failed.", { status, type, code });
  }
  if (status === 429) {
    return providerError("PROVIDER_RATE_LIMITED", "TTS provider rate limit reached.", { status, type, code });
  }
  if (status >= 500) {
    return providerError("PROVIDER_UNAVAILABLE", "TTS provider is unavailable.", { status, type, code });
  }
  return providerError("PROVIDER_REQUEST_FAILED", "TTS provider rejected the request.", { status, type, code });
}

async function synthesize({
  text,
  voiceId,
  speed = 1,
  style = "natural",
  signal
}) {
  const current = config();

  if (!current.apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "TTS provider is not configured.");
  }

  const cleanText = String(text || "").trim();
  if (!cleanText || cleanText.length > 4096) {
    throw providerError("TTS_TEXT_INVALID", "TTS text must contain between 1 and 4096 characters.");
  }

  const selected = BUILTIN_VOICES[String(voiceId || "")];
  if (!selected) {
    throw providerError("TTS_VOICE_INVALID", "TTS voice is not supported.");
  }

  const safeSpeed = Math.max(0.5, Math.min(2, Number(speed || 1)));
  const instructions = [
    selected.style,
    style === "energetic" ? "Speak with slightly more energy." : "",
    style === "calm" ? "Speak calmly and evenly." : "",
    "Keep pronunciation natural and do not add words that are not in the input."
  ].filter(Boolean).join(" ");

  let url;
  try {
    url = new URL("/v1/audio/speech", current.baseUrl);
  } catch {
    throw providerError("PROVIDER_CONFIG_INVALID", "TTS provider URL is invalid.");
  }

  const body = {
    model: current.model,
    input: cleanText,
    voice: selected.providerVoice,
    response_format: "wav",
    speed: safeSpeed
  };

  if (!["tts-1", "tts-1-hd"].includes(current.model)) {
    body.instructions = instructions;
  }

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
      throw providerError("PROVIDER_CANCELLED", "TTS provider request was cancelled.");
    }
    throw providerError("PROVIDER_NETWORK", "Could not reach TTS provider.", {
      technicalMessage: error?.message || String(error)
    });
  }

  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    throw stableProviderError(response.status, payload || {});
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw providerError("PROVIDER_AUDIO_INVALID", "TTS provider returned empty audio.");
  }

  return {
    audio,
    duration: parseWavDuration(audio),
    contentType: "audio/wav",
    extension: "wav",
    model: current.model
  };
}

module.exports = {
  isConfigured,
  synthesize,
  config,
  publicVoices,
  TtsProviderError
};
