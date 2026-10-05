(function installCoreMediaRestore() {
  "use strict";

  const restoring = new Set();
  const completed = new Set();

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function latestSource(current) {
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function persist() {
    try {
      if (typeof save === "function") save();
      else {
        const current = appState();
        if (current) localStorage.setItem("viral-ai-tool-state", JSON.stringify(current));
      }
    } catch {}
  }

  function rerender(reason, sourcePath) {
    try {
      if (typeof render === "function") render();
    } catch {}
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason, sourcePath }
    }));
  }

  async function restoreLatestPreview() {
    const current = appState();
    const source = latestSource(current);
    if (!source?.sourcePath || source.previewUrl || source.fileState === "missing") return;

    const key = String(source.sourcePath);
    if (restoring.has(key) || completed.has(key)) return;
    if (!window.desktopAPI?.fileStatus || !window.desktopAPI?.getVideoUrl) return;

    restoring.add(key);
    source.mediaState = "reading";

    try {
      const status = await window.desktopAPI.fileStatus(source.sourcePath);
      if (!status?.exists) {
        source.fileState = "missing";
        source.mediaState = "missing";
        source.previewUrl = "";
        completed.add(key);
        persist();
        rerender("source-missing-on-reopen", source.sourcePath);
        return;
      }

      const previewUrl = await window.desktopAPI.getVideoUrl(source.sourcePath);
      if (!previewUrl) {
        source.mediaState = "preview-unavailable";
        return;
      }

      source.previewUrl = previewUrl;
      source.fileState = "available";
      source.mediaState = "ready";
      completed.add(key);
      persist();
      rerender("preview-restored", source.sourcePath);
    } catch {
      // User-facing rendering remains in the existing media/file state UI.
      // Technical failures stay in the desktop diagnostic logs.
      source.mediaState = "preview-unavailable";
    } finally {
      restoring.delete(key);
    }
  }

  const schedule = () => setTimeout(() => restoreLatestPreview().catch(() => {}), 0);
  const start = () => {
    schedule();
    window.addEventListener("focus", schedule);
    window.addEventListener("viral-ai:core-state-changed", event => {
      if (event?.detail?.reason !== "preview-restored") schedule();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
