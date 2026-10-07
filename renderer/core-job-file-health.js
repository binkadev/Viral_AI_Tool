(function installCoreJobFileHealth() {
  "use strict";

  let checking = false;
  let queued = false;
  let recoveryQueued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function normalizedStatus(value) {
    const raw = String(value || "").toLowerCase();
    if (/(complete|hoàn|xong)/.test(raw)) return "completed";
    if (/(process|render|upload|queue|prepar|validat|đang|xử lý|chờ)/.test(raw)) return "processing";
    if (/(fail|error|lỗi|thất)/.test(raw)) return "failed";
    if (/(cancel|hủy|dừng)/.test(raw)) return "cancelled";
    return raw || "idle";
  }

  function pathFor(job) {
    return job?.isRenderOutput ? job?.outputPath : job?.sourcePath;
  }

  function shouldCheck(job) {
    const path = pathFor(job);
    if (!path) return false;
    if (!job?.isRenderOutput) return true;
    return normalizedStatus(job.status) === "completed";
  }

  function jobsToCheck() {
    const jobs = Array.isArray(appState()?.jobs) ? appState().jobs : [];
    return jobs.filter(shouldCheck).slice(0, 50);
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

  function refreshUi(changedIds) {
    try { if (typeof render === "function") render(); } catch {}
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "job-file-health", jobIds: changedIds }
    }));
  }

  function recoverableOutput(job) {
    return Boolean(job?.isRenderOutput) &&
      normalizedStatus(job?.status) === "completed" &&
      (job?.fileState === "missing" || job?.fileState === "trashed");
  }

  function syncRecoveryActions() {
    recoveryQueued = false;
    const jobs = Array.isArray(appState()?.jobs) ? appState().jobs : [];
    const byId = new Map(jobs.map(job => [String(job?.id || ""), job]));
    const english = appState()?.locale === "en";

    document.querySelectorAll(".job-menu-button[data-job-menu]").forEach(menuButton => {
      const id = String(menuButton.dataset.jobMenu || "");
      if (!id) return;
      const popover = document.querySelector('[data-job-menu-popover="' + CSS.escape(id) + '"]');
      if (!(popover instanceof HTMLElement)) return;
      const existing = popover.querySelector('[data-job-action="retry-export"][data-job-id="' + CSS.escape(id) + '"]');
      if (!recoverableOutput(byId.get(id))) {
        existing?.remove();
        return;
      }
      if (existing) return;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.jobAction = "retry-export";
      button.dataset.jobId = id;
      button.innerHTML = '↻ <span>' + (english ? "Render again" : "Render lại") + '</span>';
      popover.appendChild(button);
    });
  }

  function queueRecoveryActions() {
    if (recoveryQueued) return;
    recoveryQueued = true;
    requestAnimationFrame(syncRecoveryActions);
  }

  async function checkAll() {
    queued = false;
    if (checking || typeof window.desktopAPI?.fileStatus !== "function") return;
    const candidates = jobsToCheck();
    if (!candidates.length) {
      queueRecoveryActions();
      return;
    }

    checking = true;
    const changedIds = [];
    try {
      const results = await Promise.all(candidates.map(async job => {
        const path = pathFor(job);
        try {
          const result = await window.desktopAPI.fileStatus(path);
          return { job, exists: result?.exists === true };
        } catch {
          return { job, exists: null };
        }
      }));

      results.forEach(({ job, exists }) => {
        if (exists === null) return;
        const next = exists ? "available" : "missing";
        if (job.fileState === next) return;
        job.fileState = next;
        changedIds.push(String(job.id || pathFor(job)));
      });

      if (changedIds.length) {
        persist();
        refreshUi(changedIds);
      }
      queueRecoveryActions();
    } finally {
      checking = false;
    }
  }

  function queueCheck() {
    if (queued || checking) return;
    queued = true;
    requestAnimationFrame(() => checkAll().catch(() => { checking = false; }));
  }

  function start() {
    window.addEventListener("focus", queueCheck);
    window.addEventListener("viral-ai:job-file-health-request", queueCheck);
    window.addEventListener("viral-ai:core-state-changed", queueRecoveryActions);
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueRecoveryActions).observe(page, { childList: true, subtree: true });
    queueCheck();
    queueRecoveryActions();
    document.documentElement.dataset.coreJobFileHealth = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
