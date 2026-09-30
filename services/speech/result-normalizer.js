function asFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSegment(segment, index) {
  const start = Math.max(0, asFinite(segment?.start));
  const end = Math.max(start, asFinite(segment?.end, start));
  const text = String(segment?.text || "").trim();

  return {
    id: String(segment?.id || `segment-${index + 1}`),
    start,
    end,
    text,
    speaker: segment?.speaker ? String(segment.speaker) : null,
    words: Array.isArray(segment?.words)
      ? segment.words.map((word, wordIndex) => ({
          id: String(word?.id || `word-${index + 1}-${wordIndex + 1}`),
          start: Math.max(start, asFinite(word?.start, start)),
          end: Math.max(start, asFinite(word?.end, start)),
          text: String(word?.text || "").trim()
        })).filter(word => word.text)
      : []
  };
}

function normalizeSpeechResult(input = {}) {
  const segments = Array.isArray(input.segments)
    ? input.segments.map(normalizeSegment).filter(segment => segment.text)
    : [];

  return {
    version: 1,
    language: String(input.language || "unknown"),
    duration: Math.max(0, asFinite(input.duration)),
    text: String(input.text || segments.map(segment => segment.text).join(" ")).trim(),
    segments,
    meta: {
      providerMode: input?.meta?.providerMode === "cloud" ? "cloud" : "local",
      timingAvailable: input?.meta?.timingAvailable === true,
      createdAt: input?.meta?.createdAt || new Date().toISOString()
    }
  };
}

module.exports = { normalizeSpeechResult };
