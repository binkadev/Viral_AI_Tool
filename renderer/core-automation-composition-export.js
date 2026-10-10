(function installAutomationCompositionExport() {
  "use strict";

  let queued = false;
  let operationId = null;
  let progress = 0;
  let lastProgressSaved = 0;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function tr(key, vars, fallback = "") {
    try {
      if (typeof t === "function") return t(key, vars);
      const current = appState();
      if (window.I18N?.t) return window.I18N.t(current?.locale === "en" ? "en" : "vi", key, vars);
    } catch {}
    return fallback || key;
  }

  function toastMessage(message) {
    try { if (typeof toast === "function") toast(message); } catch {}
  }

  function persist() {
    try { if (typeof save === "function") save(); } catch {}
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", { detail: { reason } }));
    try { window.ViralCoreProjectPersistence?.schedule?.(reason); } catch {}
  }

  function automation() {
    return appState()?.automation || null;
  }

  function currentComposition() {
    const current = automation();
    if (!current?.composition || current?.stale?.composition === true) return null;
    const valid = window.ViralAutomationCompositionState?.isCurrent?.();
    return valid === false ? null : current.composition;
  }

  function projectName() {
    const current = automation();
    return String(current?.brief?.topic || current?.brief?.product || "Viral-AI").trim() || "Viral-AI";
  }

  function exportJobs() {
    const jobs = appState()?.jobs;
    return Array.isArray(jobs) ? jobs.filter(job => job?.isAutomationCompositionExport === true) : [];
  }

  function activeJob() {
    if (!operationId) return null;
    return exportJobs().find(job => String(job?.id || "") === operationId) || null;
  }

  function latestCompletedJob(composition = currentComposition()) {
    if (!composition) return null;
    return exportJobs().find(job =>
      job?.status === "completed" &&
      String(job?.automationCompositionId || "") === String(composition.id || "") &&
      String(job?.compositionSignature || "") === String(composition.outputSignature || "") &&
      job?.outputPath
    ) || null;
  }

  function fileName(filePath) {
    const value = String(filePath || "");
    return value.split(/[\\/]/).pop() || value;
  }

  function formatFileSize(bytes) {
    try { if (typeof formatBytes === "function") return formatBytes(bytes); } catch {}
    const value = Number(bytes || 0);
    if (!(value > 0)) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size >= 100 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
  }

  async function notice(titleKey, bodyKey, vars = {}) {
    try {
      if (typeof showNotice === "function") {
        await showNotice({
          title: tr(titleKey, vars),
          body: tr(bodyKey, vars),
          buttonLabel: tr("common.close")
        });
        return;
      }
    } catch {}
    toastMessage(tr(bodyKey, vars, tr("media.renderFailed")));
  }

  async function handleFailure(error) {
    const code = String(error?.code || "COMPOSITION_EXPORT_FAILED");
    const details = error?.details || {};
    if (code === "DUPLICATE_ACTIVE") {
      toastMessage(tr("export.duplicate"));
      return;
    }
    if (code === "LOW_DISK_SPACE") {
      await notice("export.lowSpaceTitle", "export.lowSpaceBody", {
        free: formatFileSize(details.freeBytes),
        needed: formatFileSize(details.requiredFreeBytes)
      });
      return;
    }
    if (["OUTPUT_REQUIRED", "OUTPUT_UNAVAILABLE"].includes(code)) {
      await notice("export.folderTitle", "export.folderBody");
      return;
    }
    if (["SOURCE_MISSING", "SOURCE_INVALID", "SOURCE_UNSUPPORTED", "AUDIO_SOURCE_INVALID", "AUDIO_SOURCE_UNSUPPORTED"].includes(code)) {
      try { await window.ViralAutomationAssetState?.validateLocalAssets?.({ forceEmit: true }); } catch {}
      try { window.ViralAutomationCompositionState?.markStale?.("automation-composition-export-source-invalid"); } catch {}
      await notice("export.sourceTitle", "export.sourceBody");
      return;
    }
    toastMessage(tr("media.renderFailed"));
  }

  function actionHost(head) {
    let host = head.querySelector(":scope > .automation-composition-actions");
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("div");
      host.className = "automation-composition-actions";
      head.appendChild(host);
    }

    const rebuild = head.querySelector(":scope > #automationBuildComposition");
    if (rebuild instanceof HTMLElement) host.appendChild(rebuild);
    const studio = head.querySelector(":scope > [data-composition-open-studio]");
    if (studio instanceof HTMLElement) host.appendChild(studio);
    return host;
  }

  function ensureAction() {
    const current = appState();
    if (current?.page !== "automation") return;
    const head = document.querySelector(".automation-composition-head");
    if (!(head instanceof HTMLElement)) return;
    const composition = currentComposition();
    const busy = Boolean(operationId);
    if (!composition && !busy) {
      head.querySelector("[data-composition-export]")?.remove();
      const panel = head.parentElement;
      panel?.querySelector(":scope > .automation-composition-export-status")?.remove();
      return;
    }

    const host = actionHost(head);
    const studio = head.querySelector("[data-composition-open-studio]");
    if (studio instanceof HTMLElement && studio.parentElement !== host) host.appendChild(studio);

    let button = host.querySelector("[data-composition-export]");
    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "button primary automation-composition-export-button";
      button.setAttribute("data-composition-export", "true");
      host.appendChild(button);
    }
    button.disabled = false;
    button.textContent = busy ? tr("common.cancel") : tr("common.export");
    button.classList.toggle("danger", busy);
    button.classList.toggle("primary", !busy);

    const panel = head.parentElement;
    let status = panel instanceof HTMLElement
      ? panel.querySelector(":scope > .automation-composition-export-status")
      : null;
    if (busy) {
      if (!(status instanceof HTMLElement)) {
        status = document.createElement("div");
        status.className = "automation-composition-export-status";
        head.insertAdjacentElement("afterend", status);
      }
      status.innerHTML = `<span>${tr("aiVideo.renderStarted")}</span><strong>${Math.max(0, Math.min(100, Math.round(progress)))}%</strong><i><b style="width:${Math.max(2, Math.min(100, progress))}%"></b></i>`;
    } else if (status instanceof HTMLElement) {
      status.remove();
    }
  }

  function ensureResult() {
    if (appState()?.page !== "automation") return;
    const panel = document.querySelector(".automation-composition-panel");
    if (!(panel instanceof HTMLElement)) return;
    const composition = currentComposition();
    const job = latestCompletedJob(composition);
    let result = panel.querySelector(":scope > .automation-composition-export-result");
    if (!job) {
      result?.remove();
      return;
    }
    if (!(result instanceof HTMLElement)) {
      result = document.createElement("div");
      result.className = "automation-composition-export-result";
      panel.appendChild(result);
    }
    const name = fileName(job.outputPath);
    const size = formatFileSize(job.meta?.sizeBytes || 0);
    const signature = `${job.outputPath}|${size}`;
    if (result.dataset.signature === signature) return;
    result.dataset.signature = signature;
    result.innerHTML = `<div><span>${tr("media.renderDone")}</span><strong>${name}</strong><small>${size}</small></div><button class="button ghost" type="button" data-composition-export-show="${encodeURIComponent(String(job.outputPath || ""))}">${tr("media.showFile")}</button>`;
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureAction();
      ensureResult();
    });
  }

  function createJob(id, composition) {
    const current = appState();
    if (!current) return null;
    const job = {
      id,
      name: projectName() + ".mp4",
      status: "validating",
      progress: 1,
      fileState: "unknown",
      isRenderOutput: true,
      isAutomationCompositionExport: true,
      automationCompositionId: composition.id,
      compositionSignature: composition.outputSignature,
      outputPath: null,
      startedAt: Date.now(),
      meta: {
        duration: Number(composition.durationSec || 0),
        width: 0,
        height: 0,
        sizeBytes: 0
      }
    };
    current.jobs = [job, ...(Array.isArray(current.jobs) ? current.jobs : [])];
    return job;
  }

  async function cancelExport() {
    const id = operationId;
    if (!id) return;
    const job = activeJob();
    if (job) job.status = "cancelling";
    persist();
    ensureAction();

    let response = null;
    try { response = await window.desktopAPI?.cancelAutomationCompositionExport?.(id); } catch {}
    if (response?.cancelled) {
      operationId = null;
      progress = 0;
      if (job) {
        job.status = "cancelled";
        job.progress = Math.max(0, Number(job.progress || 0));
        job.completedAt = Date.now();
      }
      persist();
      emit("automation-composition-export-cancelled");
      toastMessage(tr("export.stopped"));
      queue();
      return;
    }

    if (job) job.status = "processing";
    persist();
    toastMessage(tr("export.stopFailed"));
    ensureAction();
  }

  async function startExport() {
    if (operationId) {
      await cancelExport();
      return;
    }
    const composition = currentComposition();
    const current = appState();
    if (!composition || !current || !window.desktopAPI?.startAutomationCompositionExport) return;

    let outputDir = String(current.output || "").trim();
    if (!outputDir) {
      try { outputDir = String(await window.desktopAPI?.selectOutputFolder?.() || "").trim(); } catch { outputDir = ""; }
      if (!outputDir) {
        toastMessage(tr("media.chooseOutput"));
        return;
      }
      current.output = outputDir;
      persist();
    }

    const localOperationId = "composition-export-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const job = createJob(localOperationId, composition);
    operationId = localOperationId;
    progress = 1;
    lastProgressSaved = 0;
    persist();
    emit("automation-composition-export-started");
    queue();

    let response = null;
    try {
      response = await window.desktopAPI.startAutomationCompositionExport({
        operationId: localOperationId,
        composition,
        outputDir,
        projectName: projectName(),
        burnSubtitles: true
      });
    } catch {
      response = null;
    }

    if (operationId !== localOperationId) return;
    operationId = null;
    progress = 0;

    if (!response?.ok) {
      if (job) {
        job.status = "failed";
        job.failureCode = String(response?.error?.code || "COMPOSITION_EXPORT_FAILED");
        job.completedAt = Date.now();
      }
      persist();
      emit("automation-composition-export-failed");
      queue();
      await handleFailure(response?.error || {});
      return;
    }

    if (response.data?.cancelled) {
      if (job) {
        job.status = "cancelled";
        job.completedAt = Date.now();
      }
      persist();
      emit("automation-composition-export-cancelled");
      queue();
      toastMessage(tr("export.stopped"));
      return;
    }

    if (job) {
      job.status = "completed";
      job.progress = 100;
      job.outputPath = response.data.outputPath;
      job.name = fileName(response.data.outputPath) || job.name;
      job.fileState = "available";
      job.completedAt = Date.now();
      job.meta = {
        duration: Number(response.data.duration || composition.durationSec || 0),
        width: Number(response.data.width || 0),
        height: Number(response.data.height || 0),
        sizeBytes: Number(response.data.sizeBytes || 0)
      };
      job.pipeline = {
        subtitleCount: Number(response.data.subtitleCount || 0),
        audioCount: Number(response.data.audioCount || 0)
      };
    }
    persist();
    emit("automation-composition-export-completed");
    queue();
    toastMessage(tr("media.renderDone"));
  }

  async function recoverInterruptedJobs() {
    if (!window.desktopAPI?.getAutomationCompositionExportStatus) return;
    let status = null;
    try { status = await window.desktopAPI.getAutomationCompositionExportStatus(); } catch {}
    if (Number(status?.activeCount || 0) > 0) return;
    let changed = false;
    for (const job of exportJobs()) {
      if (!["validating", "processing", "queued", "cancelling"].includes(String(job?.status || ""))) continue;
      if (job?.outputPath) continue;
      job.status = "cancelled";
      job.failureCode = "INTERRUPTED";
      job.completedAt = Date.now();
      changed = true;
    }
    if (changed) {
      persist();
      emit("automation-composition-export-recovered");
    }
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-composition-export]")) {
      event.preventDefault();
      startExport();
      return;
    }
    const show = target.closest("[data-composition-export-show]");
    if (show) {
      event.preventDefault();
      const encoded = show.getAttribute("data-composition-export-show") || "";
      let outputPath = "";
      try { outputPath = decodeURIComponent(encoded); } catch {}
      if (outputPath) window.desktopAPI?.showFile?.(outputPath);
    }
  }, true);

  window.desktopAPI?.onAutomationCompositionExportProgress?.(payload => {
    if (!operationId || String(payload?.operationId || "") !== operationId) return;
    progress = Math.max(progress, Number(payload?.percent || 0));
    const job = activeJob();
    if (job) {
      const phase = String(payload?.phase || "");
      if (phase === "validating") job.status = "validating";
      else if (phase === "queued") job.status = "queued";
      else if (phase === "processing") job.status = "processing";
      job.progress = Math.max(Number(job.progress || 0), progress);
    }
    if (progress - lastProgressSaved >= 10) {
      lastProgressSaved = progress;
      persist();
    }
    ensureAction();
  });

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    recoverInterruptedJobs().finally(queue);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationCompositionExport = {
    start: startExport,
    cancel: cancelExport,
    active: () => Boolean(operationId),
    progress: () => progress
  };
})();
