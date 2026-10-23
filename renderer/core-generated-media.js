(function installGeneratedMediaHandoff() {
  "use strict";

  const running = new Map(), failures = new Map(), awaitingEnrollment = new Map();
  const persistence = () => window.ViralCoreProjectPersistence;
  const entries = () => persistence()?.generationOutputJobs?.() || [];
  const entry = id => entries().find(item => item.jobId === id);

  function notify(id) {
    // Presentation failure cannot undo or misreport an authoritative commit.
    try { window.dispatchEvent(new CustomEvent("viral-ai:generation-attachment-changed", { detail: { jobId: id } })); }
    catch { console.warn("[GeneratedMedia] Attachment presentation could not refresh"); }
  }

  // Observation of explicitly enrolled jobs only. Never prepare, submit,
  // recover, inspect a provider operation, acquire, or list historical jobs.
  function observe(id) {
    if (awaitingEnrollment.has(id)) {
      try {
        persistence().registerGenerationJob(awaitingEnrollment.get(id));
        awaitingEnrollment.delete(id);
      } catch {
        failures.set(id, true);
        notify(id);
        return Promise.resolve();
      }
    }
    const enrolled = entry(id);
    if (!enrolled || enrolled.assetId) return Promise.resolve();
    const existing = running.get(id);
    if (existing) { existing.dirty = true; return existing.promise; }
    const task = { dirty: true };
    running.set(id, task);
    task.promise = (async () => {
      do {
        task.dirty = false;
        try {
          const response = await window.desktopAPI.getGenerationJob(id);
          const job = response?.value;
          if (!response?.ok || job?.id !== id || job.projectId !== enrolled.projectId || job.sceneId !== enrolled.sceneId) throw Error("PROJECT_GENERATION_MISMATCH");
          if (job.status !== "completed") continue;
          const output = await window.desktopAPI.getGenerationOutput(id);
          if (!output?.ok || output.value?.verified !== true || output.value.jobId !== id ||
              output.value.projectId !== enrolled.projectId || output.value.sceneId !== enrolled.sceneId ||
              output.value.fileName !== job.output?.fileName) throw Error("GENERATED_OUTPUT_UNVERIFIED");
          const meta = await window.desktopAPI.probeVideo(output.value.path);
          // Persistence resolves the ORIGINAL project again after every await.
          persistence().attachGeneratedOutput(job, output.value, meta);
          failures.delete(id);
          notify(id);
        } catch {
          failures.set(id, true);
          notify(id);
          // A local handoff failure must never request another generation.
          break;
        }
      } while (task.dirty && !entry(id)?.assetId);
    })().finally(() => running.delete(id));
    return task.promise;
  }

  function track(job) {
    awaitingEnrollment.set(job.id, job);
    return observe(job.id);
  }

  window.ViralCoreGeneratedMedia = {
    track, observe,
    status(id) { return failures.has(id) ? "error" : entry(id)?.assetId ? "attached" : entry(id) ? "pending" : "untracked"; }
  };

  function start() {
    window.desktopAPI?.onGenerationChanged?.(event => { if (entry(event.id)) observe(event.id); });
    const resume = () => { for (const item of entries()) if (!item.assetId) observe(item.jobId); };
    window.addEventListener("focus", resume);
    resume();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
