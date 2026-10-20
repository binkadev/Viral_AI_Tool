(function installSourceHealthContext() {
  "use strict";

  let queued = false;

  function currentState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function sourceProject() {
    const jobs = currentState()?.jobs;
    if (!Array.isArray(jobs)) return null;
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function sync() {
    queued = false;
    const current = currentState();
    // Source text belongs to editor-assets; this module only annotates its health.
    const sourceLabel = document.querySelector("#page .core-editor-assets-panel [data-source-name]");
    if (!(sourceLabel instanceof HTMLElement) || !current) return;

    if (current.page !== "ai-video") {
      delete sourceLabel.dataset.sourceContext;
      delete sourceLabel.dataset.sourceState;
      return;
    }

    const project = sourceProject();
    if (!project) {
      delete sourceLabel.dataset.sourceContext;
      delete sourceLabel.dataset.sourceState;
      return;
    }

    sourceLabel.dataset.sourceContext = "true";
    sourceLabel.dataset.sourceState = project.fileState === "missing" || project.fileState === "trashed"
      ? "needs-action"
      : "ready";
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: false });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
