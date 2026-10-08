(function attachCorePlayerModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCorePlayerModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCorePlayerModel() {
  "use strict";

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampTime(value, duration = Infinity) {
    const time = Math.max(0, finite(value, 0));
    const max = finite(duration, Infinity);
    return Number.isFinite(max) ? Math.min(time, Math.max(0, max)) : time;
  }

  function resolveDuration(nativeDuration, seekableEnd = 0, hint = 0) {
    const native = finite(nativeDuration, 0);
    if (native > 0) return native;
    const seekable = finite(seekableEnd, 0);
    if (seekable > 0) return seekable;
    const fallback = finite(hint, 0);
    return fallback > 0 ? fallback : 0;
  }

  function parseTimeLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const parts = raw.split(":").map(part => Number(part));
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return finite(parts[0], 0);
  }

  function formatClock(value) {
    const total = Math.max(0, Math.floor(finite(value, 0)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function fitContain(mediaWidth, mediaHeight, boxWidth, boxHeight) {
    const mw = Math.max(0, finite(mediaWidth, 0));
    const mh = Math.max(0, finite(mediaHeight, 0));
    const bw = Math.max(0, finite(boxWidth, 0));
    const bh = Math.max(0, finite(boxHeight, 0));
    if (!mw || !mh || !bw || !bh) return { width: 0, height: 0, scale: 0 };
    const scale = Math.min(bw / mw, bh / mh);
    return {
      width: mw * scale,
      height: mh * scale,
      scale
    };
  }

  function normalizeSegments(segments, duration = 0) {
    const safeDuration = Math.max(0, finite(duration, 0));
    const list = Array.isArray(segments) ? segments : [];
    return list
      .map((segment, index) => ({
        id: String(segment?.id ?? ("segment-" + (index + 1))),
        start: Math.max(0, finite(segment?.start, 0)),
        end: Math.max(0, finite(segment?.end, 0)),
        text: String(segment?.text || ""),
        translatedText: String(segment?.translatedText || segment?.translated || ""),
        speaker: segment?.speaker ? String(segment.speaker) : null,
        voice: segment?.voice ? String(segment.voice) : null,
        status: String(segment?.status || "ready")
      }))
      .sort((a, b) => a.start - b.start)
      .map((segment, index, sorted) => {
        const nextStart = sorted[index + 1]?.start;
        const fallbackEnd = Number.isFinite(nextStart)
          ? nextStart
          : safeDuration > 0
            ? safeDuration
            : segment.start;
        const end = segment.end > segment.start ? segment.end : Math.max(segment.start, fallbackEnd);
        return { ...segment, end };
      });
  }

  function activeSegmentIndex(segments, currentTime) {
    const list = Array.isArray(segments) ? segments : [];
    const time = Math.max(0, finite(currentTime, 0));
    if (!list.length) return -1;
    for (let index = 0; index < list.length; index += 1) {
      const segment = list[index];
      const start = Math.max(0, finite(segment.start, 0));
      const end = Math.max(start, finite(segment.end, start));
      if (time >= start && (time < end || (index === list.length - 1 && time <= end))) return index;
    }
    return time < finite(list[0]?.start, 0) ? -1 : list.length - 1;
  }

  function seekRatio(currentTime, duration) {
    const safeDuration = Math.max(0, finite(duration, 0));
    if (!safeDuration) return 0;
    return Math.max(0, Math.min(1, clampTime(currentTime, safeDuration) / safeDuration));
  }

  return {
    clampTime,
    resolveDuration,
    parseTimeLabel,
    formatClock,
    fitContain,
    normalizeSegments,
    activeSegmentIndex,
    seekRatio
  };
});
