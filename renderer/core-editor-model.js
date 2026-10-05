(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CoreEditorModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BUSY_STATES = new Set([
    "validating",
    "preparing",
    "uploading",
    "queued",
    "processing",
    "translating",
    "generating",
    "downloading",
    "cancelling"
  ]);

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampTime(value, duration) {
    const max = Math.max(0, finite(duration));
    return Math.max(0, Math.min(max, finite(value)));
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(finite(seconds)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return (hours ? String(hours).padStart(2, "0") + ":" : "") +
      String(minutes).padStart(2, "0") + ":" +
      String(secs).padStart(2, "0");
  }

  function containRect(containerWidth, containerHeight, mediaWidth, mediaHeight) {
    const cw = Math.max(0, finite(containerWidth));
    const ch = Math.max(0, finite(containerHeight));
    const mw = Math.max(0, finite(mediaWidth));
    const mh = Math.max(0, finite(mediaHeight));

    if (!cw || !ch || !mw || !mh) {
      return { width: 0, height: 0, x: 0, y: 0, scale: 0 };
    }

    const scale = Math.min(cw / mw, ch / mh);
    const width = mw * scale;
    const height = mh * scale;
    return {
      width,
      height,
      x: (cw - width) / 2,
      y: (ch - height) / 2,
      scale
    };
  }

  function segmentId(segment, index) {
    const value = String(segment?.id || "").trim();
    return value || "segment-" + (index + 1);
  }

  function normalizeSegments(speechResult, translationResult, voiceAssignments) {
    const sourceSegments = Array.isArray(speechResult?.segments) ? speechResult.segments : [];
    const translatedSegments = Array.isArray(translationResult?.segments) ? translationResult.segments : [];
    const translatedById = new Map(
      translatedSegments.map((segment, index) => [segmentId(segment, index), segment])
    );
    const assignments = voiceAssignments && typeof voiceAssignments === "object" ? voiceAssignments : {};

    return sourceSegments.map((segment, index) => {
      const id = segmentId(segment, index);
      const translated = translatedById.get(id) || translatedSegments[index] || null;
      const speaker = String(segment?.speaker || translated?.speaker || "speaker-1");
      return {
        id,
        index,
        sourceText: String(segment?.text || ""),
        translatedText: String(translated?.text || ""),
        start: Math.max(0, finite(segment?.start)),
        end: Math.max(0, finite(segment?.end, finite(segment?.start))),
        speaker,
        voice: String(assignments[speaker] || ""),
        status: translated ? "localized" : "transcribed"
      };
    });
  }

  function findActiveSegmentIndex(segments, currentTime) {
    if (!Array.isArray(segments) || !segments.length) return -1;
    const time = Math.max(0, finite(currentTime));

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index] || {};
      const start = Math.max(0, finite(segment.start));
      const end = Math.max(start, finite(segment.end, start));
      if (time >= start && (time < end || (index === segments.length - 1 && time <= end))) {
        return index;
      }
    }

    // Silence is a real playback state. Do not highlight an unrelated transcript
    // row before the first utterance, between segments, or after the last one.
    return -1;
  }

  function isBusy(job) {
    return Boolean(job && BUSY_STATES.has(String(job.status || "")));
  }

  function failed(job) {
    return String(job?.status || "") === "failed";
  }

  function completedRenderForSource(jobs, sourcePath) {
    if (!sourcePath || !Array.isArray(jobs)) return null;
    return jobs.find(job =>
      job?.isRenderOutput === true &&
      job?.sourcePath === sourcePath &&
      String(job?.status || "") === "completed" &&
      job?.fileState !== "missing" &&
      job?.fileState !== "trashed"
    ) || null;
  }

  function deriveWorkflow({
    source,
    speechJob,
    speechResult,
    translationJob,
    translationResult,
    voiceJob,
    voiceResult,
    jobs,
    editorTouched = false,
    translationStale = false,
    voiceStale = false
  } = {}) {
    const imported = Boolean(source?.sourcePath && source?.fileState !== "missing" && source?.fileState !== "trashed");
    const analyzed = imported && Boolean(source?.meta) && source?.mediaState !== "reading" && source?.mediaState !== "failed";
    const transcriptReady = Boolean(speechResult?.segments?.length || String(speechResult?.text || "").trim());
    const hasTranslation = Boolean(translationResult?.segments?.length);
    const hasVoice = Boolean(voiceResult?.segments?.length);
    const localized = hasTranslation && !translationStale;
    const voiced = hasVoice && localized && !voiceStale;
    const existingRender = completedRenderForSource(jobs, source?.sourcePath);
    const rendered = existingRender && !translationStale && !voiceStale ? existingRender : null;

    const status = (complete, busy, hasFailed, ready) => {
      if (complete) return "complete";
      if (hasFailed) return "failed";
      if (busy) return "active";
      return ready ? "ready" : "blocked";
    };

    const steps = [
      {
        id: "import",
        status: imported ? "complete" : "ready",
        enabled: true
      },
      {
        id: "analyze",
        status: status(analyzed, source?.mediaState === "reading", source?.mediaState === "failed", imported),
        enabled: imported
      },
      {
        id: "transcript",
        status: status(transcriptReady, isBusy(speechJob), failed(speechJob), analyzed),
        enabled: analyzed && !isBusy(speechJob)
      },
      {
        id: "edit",
        status: transcriptReady ? (editorTouched || localized ? "complete" : "ready") : "blocked",
        enabled: transcriptReady
      },
      {
        id: "localize",
        status: translationStale && hasTranslation
          ? "stale"
          : status(localized, isBusy(translationJob) || isBusy(voiceJob), failed(translationJob) || failed(voiceJob), transcriptReady),
        enabled: transcriptReady
      },
      {
        id: "render",
        status: (translationStale || voiceStale) && (hasTranslation || hasVoice || existingRender)
          ? "stale"
          : status(Boolean(rendered), false, false, localized && voiced),
        enabled: localized && voiced,
        rendered
      }
    ];

    return {
      imported,
      analyzed,
      transcriptReady,
      hasTranslation,
      hasVoice,
      translationStale: Boolean(translationStale),
      voiceStale: Boolean(voiceStale),
      localized,
      voiced,
      rendered,
      steps,
      can: {
        import: true,
        analyze: imported,
        transcribe: analyzed && !isBusy(speechJob),
        edit: transcriptReady,
        translate: transcriptReady && !isBusy(translationJob),
        voice: localized && !isBusy(voiceJob),
        render: localized && voiced && !Boolean(rendered)
      }
    };
  }

  return {
    BUSY_STATES,
    clampTime,
    formatClock,
    containRect,
    normalizeSegments,
    findActiveSegmentIndex,
    isBusy,
    completedRenderForSource,
    deriveWorkflow
  };
});
