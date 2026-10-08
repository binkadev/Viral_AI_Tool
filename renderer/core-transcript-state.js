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

  function activeSourcePath(current, edit) {
    if (current?.speech?.result?.sourcePath) return String(current.speech.result.sourcePath);
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      if (!job?.isRenderOutput && job?.sourcePath) return String(job.sourcePath);
    }
    return edit?.source ? String(edit.source) : null;
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

  function archiveStale(bucket, activeKey, archiveKey, sourcePath, reason) {
    const active = bucket?.[activeKey];
    if (!active) return;
    const stale = staleValue(active, sourcePath, reason);
    if (stale === active) return;
    bucket[archiveKey] = stale;
    bucket[activeKey] = null;
  }

  function markRenderOutputsStale(current, sourcePath) {
    if (!Array.isArray(current?.jobs)) return;
    current.jobs = current.jobs.map(job => {
      if (!job?.isRenderOutput) return job;
      if (sourcePath && job.sourcePath && String(job.sourcePath) !== String(sourcePath)) return job;
      return {
        ...job,
        status: "failed",
        stale: true,
        staleReason: "transcript-edited",
        staleAt: new Date().toISOString()
      };
    });
  }

  function invalidateDownstream(current, sourcePath) {
    archiveStale(current?.translation, "result", "staleResult", sourcePath, "source-transcript-edited");
    archiveStale(current?.translation, "job", "staleJob", sourcePath, "source-transcript-edited");
    archiveStale(current?.voice, "result", "staleResult", sourcePath, "source-transcript-edited");
    archiveStale(current?.voice, "job", "staleJob", sourcePath, "source-transcript-edited");
    markRenderOutputsStale(current, sourcePath);
  }

  function onTranscriptEdit(event) {
    const current = appState();
    if (!current?.speech?.result) return;

    const edit = event?.detail || {};
    const sourcePath = activeSourcePath(current, edit);
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
