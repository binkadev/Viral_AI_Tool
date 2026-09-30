class TranslationProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TranslationProviderError";
    this.code = code;
    this.details = details;
  }
}

function providerError(code, message, details) {
  return new TranslationProviderError(code, message, details);
}

function config() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.VIRAL_AI_OPENAI_TRANSLATION_MODEL || "gpt-5-mini").trim(),
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
    return providerError("PROVIDER_AUTH_FAILED", "Translation provider authentication failed.", { status, type, code });
  }
  if (status === 429) {
    return providerError("PROVIDER_RATE_LIMITED", "Translation provider rate limit reached.", { status, type, code });
  }
  if (status >= 500) {
    return providerError("PROVIDER_UNAVAILABLE", "Translation provider is unavailable.", { status, type, code });
  }
  return providerError("PROVIDER_REQUEST_FAILED", "Translation provider rejected the request.", { status, type, code });
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("");
}

function validateTranslatedSegments(original, translated) {
  if (!Array.isArray(translated) || translated.length !== original.length) {
    throw providerError("PROVIDER_SCHEMA_INVALID", "Translation result segment count does not match.");
  }

  const byId = new Map(translated.map(item => [String(item?.id || ""), item]));
  const output = [];

  for (const source of original) {
    const item = byId.get(String(source.id));
    if (!item || typeof item.text !== "string" || !item.text.trim()) {
      throw providerError("PROVIDER_SCHEMA_INVALID", "Translation result is missing a segment.");
    }
    output.push({
      id: String(source.id),
      text: item.text.trim()
    });
  }

  return output;
}

async function translate({
  segments,
  sourceLanguage = "auto",
  targetLanguage,
  preserveTone = true,
  signal
}) {
  const current = config();
  if (!current.apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "Translation provider is not configured.");
  }

  if (!Array.isArray(segments) || !segments.length) {
    throw providerError("TRANSLATION_INPUT_INVALID", "Translation input is empty.");
  }

  let url;
  try {
    url = new URL("/v1/responses", current.baseUrl);
  } catch {
    throw providerError("PROVIDER_CONFIG_INVALID", "Translation provider URL is invalid.");
  }

  const inputSegments = segments.map(item => ({
    id: String(item.id),
    text: String(item.text || "")
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["segments"],
    properties: {
      segments: {
        type: "array",
        minItems: inputSegments.length,
        maxItems: inputSegments.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text"],
          properties: {
            id: { type: "string" },
            text: { type: "string" }
          }
        }
      }
    }
  };

  const instructions = [
    "You translate subtitle segments for short-form and long-form video.",
    "Translate every segment into the requested target language.",
    "Preserve meaning, names, numbers, product names, and natural spoken tone.",
    preserveTone
      ? "Keep the speaker's intent and conversational tone natural."
      : "Prefer a neutral, clear translation.",
    "Do not merge, split, add, remove, or reorder segments.",
    "Return only the structured result required by the schema."
  ].join(" ");

  const body = {
    model: current.model,
    instructions,
    input: JSON.stringify({
      sourceLanguage,
      targetLanguage,
      segments: inputSegments
    }),
    text: {
      format: {
        type: "json_schema",
        name: "viral_ai_translation",
        strict: true,
        schema
      }
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + current.apiKey,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw providerError("PROVIDER_CANCELLED", "Translation provider request was cancelled.");
    }
    throw providerError("PROVIDER_NETWORK", "Could not reach translation provider.", {
      technicalMessage: error?.message || String(error)
    });
  }

  let payload = null;
  try { payload = await response.json(); } catch {}

  if (!response.ok) {
    throw stableProviderError(response.status, payload || {});
  }

  const outputText = extractOutputText(payload || {});
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw providerError("PROVIDER_SCHEMA_INVALID", "Translation provider returned invalid structured output.");
  }

  return {
    model: current.model,
    segments: validateTranslatedSegments(inputSegments, parsed?.segments)
  };
}

module.exports = {
  isConfigured,
  translate,
  config,
  TranslationProviderError
};
