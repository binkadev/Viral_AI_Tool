(function attachCoreTranscriptModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreTranscriptModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreTranscriptModel() {
  "use strict";

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeSegment(segment, index = 0) {
    const start = Math.max(0, finite(segment?.start, 0));
    const end = Math.max(start, finite(segment?.end, start));
    const sourceText = String(segment?.sourceText ?? segment?.text ?? "");
    return {
      ...segment,
      id: String(segment?.id ?? ("segment-" + (index + 1))),
      start,
      end,
      text: sourceText,
      sourceText,
      translatedText: String(segment?.translatedText ?? segment?.translated ?? ""),
      speaker: segment?.speaker ? String(segment.speaker) : null,
      voice: segment?.voice ? String(segment.voice) : null,
      status: String(segment?.status || "ready")
    };
  }

  function normalizeDocument(result = {}) {
    const segments = (Array.isArray(result?.segments) ? result.segments : [])
      .map((segment, index) => normalizeSegment(segment, index));
    return {
      ...result,
      text: segments.map(segment => segment.sourceText).join(" ").trim(),
      segments
    };
  }

  function findSegmentIndex(segments, { segmentId, start } = {}) {
    const list = Array.isArray(segments) ? segments : [];
    if (segmentId != null) {
      const byId = list.findIndex(segment => String(segment.id) === String(segmentId));
      if (byId >= 0) return byId;
    }
    const targetStart = finite(start, NaN);
    if (!Number.isFinite(targetStart)) return -1;
    return list.findIndex(segment => Math.abs(finite(segment.start, 0) - targetStart) <= 0.01);
  }

  function applySourceEdit(result, edit = {}) {
    const normalized = normalizeDocument(result);
    const index = findSegmentIndex(normalized.segments, edit);
    if (index < 0) return { changed: false, result: normalized, segment: null };

    const nextText = String(edit.text ?? "");
    const current = normalized.segments[index];
    if (current.sourceText === nextText) {
      return { changed: false, result: normalized, segment: current };
    }

    const nextSegment = {
      ...current,
      text: nextText,
      sourceText: nextText,
      status: "source-edited"
    };
    const segments = normalized.segments.slice();
    segments[index] = nextSegment;

    return {
      changed: true,
      segment: nextSegment,
      result: {
        ...normalized,
        text: segments.map(segment => segment.sourceText).join(" ").trim(),
        segments,
        editedAt: new Date().toISOString()
      }
    };
  }

  function sourceMatches(result, sourcePath) {
    if (!result || !sourcePath) return false;
    return !result.sourcePath || String(result.sourcePath) === String(sourcePath);
  }

  return {
    normalizeSegment,
    normalizeDocument,
    findSegmentIndex,
    applySourceEdit,
    sourceMatches
  };
});
