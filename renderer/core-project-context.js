(function installProjectContextTopbar() {
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

  function sourceName(job) {
    const explicit = String(job?.name || "").trim();
    if (explicit) return explicit;
    const sourcePath = String(job?.sourcePath || "");
    return sourcePath.split(/[\\/]/).filter(Boolean).pop() || "";
  }

  function sync() {
    queued = false;
    const current = currentState();
    const breadcrumb = document.getElementById("breadcrumb");
    if (!(breadcrumb instanceof HTMLElement) || !current) return;

    if (current.page !== "ai-video") {
      delete breadcrumb.dataset.projectContext;
      delete breadcrumb.dataset.sourceState;
      breadcrumb.removeAttribute("title");
      return;
    }

    const project = sourceProject();
    const name = sourceName(project);
    if (!project || !name) {
      delete breadcrumb.dataset.projectContext;
      delete breadcrumb.dataset.sourceState;
      breadcrumb.removeAttribute("title");
      return;
    }

    breadcrumb.textContent = name;
    breadcrumb.title = name;
    breadcrumb.dataset.projectContext = "true";
    breadcrumb.dataset.sourceState = project.fileState === "missing" || project.fileState === "trashed"
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
