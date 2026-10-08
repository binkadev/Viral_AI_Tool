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

  function staleSnapshot(value) {
    if (!value || typeof value !== "object") return value || null;
    return {
      ...value,
      status: "stale",
      staleReason: "transcript-edited"
    };
  }

  function retainStaleSlot(container, key) {
    if (!container || !container[key]) return;
    const staleKey = key === "result" ? "staleResult" : "staleJob";
    container[staleKey] = staleSnapshot(container[key]);
    container[key] = null;
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
    if (model.sourceMatches(current?.translation?.result, sourcePath)) {
      retainStaleSlot(current.translation, "result");
    }
    if (model.sourceMatches(current?.translation?.job, sourcePath)) {
      retainStaleSlot(current.translation, "job");
    }
    if (model.sourceMatches(current?.voice?.result, sourcePath)) {
      retainStaleSlot(current.voice, "result");
    }
    if (model.sourceMatches(current?.voice?.job, sourcePath)) {
      retainStaleSlot(current.voice, "job");
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
