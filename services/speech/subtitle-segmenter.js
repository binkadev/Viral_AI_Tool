const SPECIAL_TOKEN = /^<\|.*\|>$/;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanToken(value) {
  const raw = String(value || "");
  if (!raw || SPECIAL_TOKEN.test(raw.trim())) return "";
  return raw
    .replace(/▁/g, " ")
    .replace(/Ġ/g, " ")
    .replace(/Ċ/g, "\n");
}

function normalizeSpacing(value) {
  return String(value || "")
    .replace(/\s+([,.;:!?%。，！？；：])/g, "$1")
    .replace(/([([{“‘])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function appendToken(text, token) {
  if (!token) return text;
  if (!text) return token.trimStart();

  if (/^\s/.test(token)) return text + token;
  if (/^[,.;:!?%。，！？；：)\]}”’]/.test(token)) return text + token;
  if (/[([{“‘\s]$/.test(text)) return text + token;
  return text + " " + token;
}

function timedItems(raw = {}) {
  const tokens = Array.isArray(raw.tokens) ? raw.tokens : [];
  const timestamps = Array.isArray(raw.timestamps) ? raw.timestamps : [];
  const durations = Array.isArray(raw.durations) ? raw.durations : [];

  if (!tokens.length || timestamps.length !== tokens.length) return [];

  const items = [];
  for (let index = 0; index < tokens.length; index++) {
    const text = cleanToken(tokens[index]);
    if (!text) continue;

    const start = Math.max(0, finite(timestamps[index]));
    const nextStart = index + 1 < timestamps.length
      ? Math.max(start, finite(timestamps[index + 1], start))
      : start;
    const explicitDuration = Math.max(0, finite(durations[index]));
    const end = explicitDuration > 0
      ? start + explicitDuration
      : nextStart > start
        ? nextStart
        : start + 0.25;

    items.push({ start, end, text });
  }

  return items;
}

function segmentTimedResult(raw = {}, options = {}) {
  const maxDuration = Math.max(2, finite(options.maxDuration, 5.5));
  const maxChars = Math.max(24, finite(options.maxChars, 72));
  const maxGap = Math.max(0.2, finite(options.maxGap, 0.9));
  const items = timedItems(raw);

  if (!items.length) {
    return {
      text: normalizeSpacing(raw.text || ""),
      segments: [],
      hasTiming: false
    };
  }

  const segments = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const text = normalizeSpacing(current.text);
    if (text) {
      segments.push({
        start: current.start,
        end: Math.max(current.start, current.end),
        text
      });
    }
    current = null;
  };

  for (const item of items) {
    if (!current) {
      current = { start: item.start, end: item.end, text: item.text };
      continue;
    }

    const gap = Math.max(0, item.start - current.end);
    const candidateText = appendToken(current.text, item.text);
    const candidateDuration = Math.max(0, item.end - current.start);
    const punctuationBoundary = /[.!?。！？]["'”’)]?$/.test(normalizeSpacing(current.text));

    if (
      gap > maxGap ||
      candidateDuration > maxDuration ||
      normalizeSpacing(candidateText).length > maxChars ||
      (punctuationBoundary && current.end - current.start >= 1.2)
    ) {
      flush();
      current = { start: item.start, end: item.end, text: item.text };
      continue;
    }

    current.text = candidateText;
    current.end = Math.max(current.end, item.end);
  }

  flush();

  return {
    text: normalizeSpacing(raw.text || segments.map(segment => segment.text).join(" ")),
    segments,
    hasTiming: segments.length > 0
  };
}

module.exports = {
  segmentTimedResult,
  normalizeSpacing
};
