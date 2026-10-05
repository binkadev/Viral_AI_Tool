(function () {
  "use strict";

  let recoveryStarted = false;
  let recoveryFinished = false;

  function sourceJobs() {
    return Array.isArray(state?.jobs)
      ? state.jobs.filter(job => job?.sourcePath && !job?.isRenderOutput)
      : [];
  }

  async function recoverSource(job) {
    if (!job?.sourcePath || !window.desktopAPI) return { changed: false, missing: false };

    let status = null;
    try {
      status = await window.desktopAPI.fileStatus?.(job.sourcePath);
    } catch {}

    if (!status?.exists) {
      const changed = job.fileState !== "missing" || job.mediaState !== "missing" || Boolean(job.previewUrl);
      job.fileState = "missing";
      job.mediaState = "missing";
      delete job.previewUrl;
      delete job.thumbnail;
      return { changed, missing: true };
    }

    let changed = job.fileState !== "available";
    job.fileState = "available";

    if (!job.previewUrl && window.desktopAPI.getVideoUrl) {
      try {
        job.previewUrl = await window.desktopAPI.getVideoUrl(job.sourcePath);
        changed = true;
      } catch {}
    }

    if (!job.meta && window.desktopAPI.probeVideo) {
      try {
        const meta = await window.desktopAPI.probeVideo(job.sourcePath);
        if (meta && typeof meta === "object") {
          job.meta = meta;
          job.mediaState = "ready";
          changed = true;
        }
      } catch {
        job.mediaState = "failed";
        changed = true;
      }
    } else if (job.meta && job.mediaState === "missing") {
      job.mediaState = "ready";
      changed = true;
    }

    if (!job.thumbnail && window.desktopAPI.createThumbnail) {
      try {
        const thumbnail = await window.desktopAPI.createThumbnail(job.sourcePath);
        if (thumbnail) {
          job.thumbnail = thumbnail;
          changed = true;
        }
      } catch {}
    }

    return { changed, missing: false };
  }

  async function recoverSavedProject() {
    if (recoveryStarted || recoveryFinished) return;
    recoveryStarted = true;

    let changed = false;
    let missingCount = 0;

    try {
      for (const job of sourceJobs()) {
        const result = await recoverSource(job);
        changed = changed || result.changed;
        if (result.missing) missingCount++;
      }

      if (changed) save();
      if (state.page === "ai-video" && changed) render();

      if (missingCount > 0) {
        toast(state.locale === "vi"
          ? `${missingCount} video nguồn không còn ở vị trí cũ. Hãy liên kết lại để tiếp tục.`
          : `${missingCount} source video(s) are no longer at their saved location. Relink them to continue.`);
      }
    } finally {
      recoveryFinished = true;
      recoveryStarted = false;
    }
  }

  // State is already restored synchronously from localStorage by app.js before
  // this layer loads. Rehydrate only ephemeral file:// preview/thumbnail values;
  // never discard transcript/translation timestamps or edit history.
  queueMicrotask(() => recoverSavedProject().catch(() => {}));

  globalThis.CoreProjectRecovery = {
    recoverSavedProject,
    recoverSource
  };
})();
