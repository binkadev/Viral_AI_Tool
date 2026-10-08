(function installCoreTranscriptStateBridge() {
  "use strict";

  const model = window.ViralCoreTranscriptModel;
  if (!model) return;

  function appState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch {
      return null;
    }
  }

  function persistState() {
    try {
      if (typeof save === "function") save();
      else {
        const current = appState();
        if (current) localStorage.setItem("viral-ai-tool-state", JSON.stringify(current));
      }
    } catch {}
  }

  function staleValue(value, sourcePath, reason) {
    if (!value) return value;
    if (sourcePath && !model.sourceMatches(value, sourcePath)) return value;
    return {
      ...value,
      status: "stale",
      staleReason: reason,
      staleAt: new Date().toISOString()
    };
  }

  function markRenderOutputsStale(current, sourcePath) {
    if (!Array.isArray(current?.jobs)) return;
    current.jobs = current.jobs.map(job => {
      if (!job?.isRenderOutput) return job;
      if (sourcePath && job.sourcePath && String(job.sourcePath) !== String(sourcePath)) return job;
      return {
        ...job,
        status: "stale",
        staleReason: "transcript-edited"
      };
    });
  }

  function invalidateDownstream(current, sourcePath) {
    if (current?.translation?.result) {
      current.translation.result = staleValue(current.translation.result, sourcePath, "source-transcript-edited");
    }
    if (current?.translation?.job) {
      current.translation.job = staleValue(current.translation.job, sourcePath, "source-transcript-edited");
    }
    if (current?.voice?.result) {
      current.voice.result = staleValue(current.voice.result, sourcePath, "source-transcript-edited");
    }
    if (current?.voice?.job) {
      current.voice.job = staleValue(current.voice.job, sourcePath, "source-transcript-edited");
    }
    markRenderOutputsStale(current, sourcePath);
  }

  function onTranscriptEdit(event) {
    const current = appState();
    if (!current?.speech?.result) return;

    const edit = event?.detail || {};
    const sourcePath = current.speech.result.sourcePath || null;
    const applied = model.applySourceEdit(current.speech.result, edit);
    if (!applied.changed) return;

    current.speech.result = applied.result;
    invalidateDownstream(current, sourcePath);
    persistState();

    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: {
        reason: "transcript-edited",
        sourcePath,
        segmentId: applied.segment?.id || null
      }
    }));
  }

  window.addEventListener("viral-ai:transcript-edit", onTranscriptEdit);
})();
