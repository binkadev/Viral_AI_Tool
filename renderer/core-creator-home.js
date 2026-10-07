(function installCreatorHomeWorkspace() {
  "use strict";

  let pageObserver = null;
  let preparing = false;
  let dropSourceSignature = "";
  let importBusy = false;

  function currentState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function tr(key, vars) {
    try { return typeof t === "function" ? t(key, vars) : key; }
    catch { return key; }
  }

  function esc(value) {
    try { return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? ""); }
    catch { return String(value ?? ""); }
  }

  function sourceJobs() {
    const current = currentState();
    if (!Array.isArray(current?.jobs)) return [];
    return current.jobs.filter(job => job?.sourcePath && !job?.isRenderOutput);
  }

  function sourceSignature() {
    return sourceJobs().map(job => String(job.id || job.sourcePath || "")).join("|");
  }

  function sourceMeta(job) {
    try {
      const value = typeof mediaMetaText === "function" ? mediaMetaText(job) : "";
      return value || tr("media.readingInfo");
    } catch {
      return tr("media.readingInfo");
    }
  }

  function sourceAvailability(job) {
    const fileState = String(job?.fileState || "");
    const key = fileState === "trashed"
      ? "file.trashed"
      : fileState === "missing"
        ? "file.missing"
        : "";
    if (!key) return "";

    return '<span class="creator-source-availability is-' + fileState + '" role="status">' + esc(tr(key)) + '</span>';
  }

  function sourceThumbnail(job, className) {
    const unavailable = job?.fileState === "missing" || job?.fileState === "trashed";
    const classes = [className, unavailable ? "is-unavailable" : ""].filter(Boolean).join(" ");
    if (job?.thumbnail) {
      return '<div class="' + classes + '"><img src="' + esc(job.thumbnail) + '" alt="" /></div>';
    }
    return '<div class="' + classes + ' creator-source-fallback" aria-hidden="true">' +
      '<svg viewBox="0 0 48 48" focusable="false"><path d="M18 13.5v21l18-10.5-18-10.5Z" fill="currentColor"/></svg>' +
    '</div>';
  }

  function workflowRail() {
    const steps = [
      ["aiVideo.steps.import", "download"],
      ["aiVideo.steps.speech", "speech"],
      ["aiVideo.steps.translate", "translate"],
      ["aiVideo.steps.voices", "voice"],
      ["aiVideo.steps.render", "render"]
    ];

    return '<div class="creator-workflow-rail" aria-hidden="true">' +
      steps.map((step, index) =>
        '<div class="creator-workflow-step creator-workflow-' + step[1] + '">' +
          '<span class="creator-workflow-dot">' + (index + 1) + '</span>' +
          '<span>' + esc(tr(step[0])) + '</span>' +
        '</div>'
      ).join("") +
    '</div>';
  }

  function currentProject(source) {
    if (!source) return "";
    const unavailable = source.fileState === "missing" || source.fileState === "trashed";
    const action = unavailable
      ? '<button class="button secondary creator-project-action" type="button" data-job-action="relink" data-job-id="' + esc(source.id) + '">' + esc(tr("file.relink")) + '</button>'
      : '<button class="button primary creator-project-action" type="button" data-creator-open="' + esc(source.id) + '">' + esc(tr("aiVideo.editor")) + '</button>';

    return '<section class="creator-current-project" aria-label="' + esc(tr("app.workspace")) + '">' +
      '<div class="creator-section-kicker">' + esc(tr("app.workspace")) + '</div>' +
      '<div class="creator-project-body">' +
        sourceThumbnail(source, "creator-project-thumb") +
        '<div class="creator-project-copy">' +
          '<h3 title="' + esc(source.name || "") + '">' + esc(source.name || tr("common.video")) + '</h3>' +
          sourceAvailability(source) +
          '<p>' + esc(sourceMeta(source)) + '</p>' +
        '</div>' +
        action +
      '</div>' +
    '</section>';
  }

  function recentSources(sources) {
    const recent = sources.slice(1, 5);
    if (!recent.length) return "";

    return '<section class="creator-recent-section">' +
      '<div class="creator-section-heading">' +
        '<div><h3>' + esc(tr("dashboard.recentJobs")) + '</h3><p>' + esc(tr("dashboard.recentJobsDesc")) + '</p></div>' +
      '</div>' +
      '<div class="creator-recent-strip">' +
        recent.map(job => {
          const unavailable = job.fileState === "missing" || job.fileState === "trashed";
          return '<article class="creator-recent-item ' + (unavailable ? "is-unavailable" : "") + '">' +
            sourceThumbnail(job, "creator-recent-thumb") +
            '<div class="creator-recent-copy">' +
              '<strong title="' + esc(job.name || "") + '">' + esc(job.name || tr("common.video")) + '</strong>' +
              sourceAvailability(job) +
              '<span class="creator-recent-meta">' + esc(sourceMeta(job)) + '</span>' +
            '</div>' +
            (unavailable
              ? '<button class="creator-recent-relink" type="button" data-job-action="relink" data-job-id="' + esc(job.id) + '">' + esc(tr("file.relink")) + '</button>'
              : '') +
          '</article>';
        }).join("") +
      '</div>' +
    '</section>';
  }

  function creatorHomePage() {
    const sources = sourceJobs();
    const current = sources[0] || null;

    return '<div class="creator-home" data-creator-home>' +
      '<section class="creator-home-hero">' +
        '<div class="creator-home-copy">' +
          '<div class="creator-home-eyebrow"><span></span>' + esc(tr("dashboard.eyebrow")) + '</div>' +
          '<h2>' + esc(tr("dashboard.title")) + '</h2>' +
          '<p>' + esc(tr("dashboard.desc")) + '</p>' +
          '<button id="creatorPrimaryImport" class="button primary creator-primary-import" type="button">' +
            '<span class="creator-button-icon" aria-hidden="true">+</span><span>' + esc(tr("download.localTitle")) + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="creator-home-visual">' +
          '<div class="creator-visual-glow" aria-hidden="true"></div>' +
          '<div class="creator-visual-mark" aria-hidden="true"><img src="brand-mark.svg" alt="" /></div>' +
          workflowRail() +
        '</div>' +
      '</section>' +

      '<section class="creator-start-grid">' +
        '<div class="creator-import-surface">' +
          '<div class="creator-import-heading">' +
            '<div class="creator-import-icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div><h3>' + esc(tr("download.localTitle")) + '</h3><p>' + esc(tr("download.localDesc")) + '</p></div>' +
          '</div>' +
          '<button id="creatorImportZone" class="creator-import-zone" type="button">' +
            '<span class="creator-drop-orbit" aria-hidden="true"><i></i></span>' +
            '<strong>' + esc(tr("download.dropTitle")) + '</strong>' +
            '<span>' + esc(tr("download.dropDesc")) + '</span>' +
          '</button>' +
        '</div>' +
        currentProject(current) +
      '</section>' +
      recentSources(sources) +
    '</div>';
  }

  function installCreatorPage() {
    try {
      if (typeof pages === "undefined" || !pages) return false;
      pages.download = creatorHomePage;
      return true;
    } catch {
      return false;
    }
  }

  function setImportBusy(value) {
    importBusy = Boolean(value);
    ["creatorPrimaryImport", "creatorImportZone"].forEach(id => {
      const button = document.getElementById(id);
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = importBusy;
      button.setAttribute("aria-busy", importBusy ? "true" : "false");
    });
  }

  function ensurePreparingOverlay() {
    let overlay = document.getElementById("creatorWorkspacePreparing");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "creatorWorkspacePreparing";
    overlay.className = "creator-workspace-preparing";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML =
      '<div class="creator-preparing-card">' +
        '<div class="creator-preparing-mark"><img src="brand-mark.svg" alt="" /></div>' +
        '<div class="creator-preparing-spinner" aria-hidden="true"><i></i><i></i><i></i></div>' +
        '<strong>' + esc(tr("common.processing")) + '</strong>' +
        '<span>' + esc(tr("media.readingInfo")) + '</span>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function openEditor(jobId) {
    if (preparing) return;
    const current = currentState();
    if (!current || !Array.isArray(current.jobs)) return;

    if (jobId) {
      const index = current.jobs.findIndex(job => String(job.id) === String(jobId));
      if (index > 0) {
        const selected = current.jobs[index];
        current.jobs.splice(index, 1);
        current.jobs.unshift(selected);
      }
    }

    const source = sourceJobs()[0];
    if (!source || source.fileState === "missing" || source.fileState === "trashed") return;

    preparing = true;
    setImportBusy(true);
    const overlay = ensurePreparingOverlay();
    requestAnimationFrame(() => overlay.classList.add("is-visible"));

    window.setTimeout(() => {
      current.page = "ai-video";
      try { if (typeof save === "function") save(); } catch {}
      try { if (typeof render === "function") render(); } catch {}
      overlay.classList.add("is-leaving");
      window.setTimeout(() => {
        overlay.remove();
        preparing = false;
        setImportBusy(false);
      }, 360);
    }, document.documentElement.dataset.motion === "reduced" ? 60 : 520);
  }

  async function importAndOpen() {
    if (importBusy || preparing || typeof addFiles !== "function") return;
    const before = sourceSignature();
    setImportBusy(true);

    try {
      await addFiles();
    } catch {
      setImportBusy(false);
      return;
    }

    if (sourceSignature() !== before) {
      openEditor();
      return;
    }

    setImportBusy(false);
  }

  function wireHome() {
    const current = currentState();
    if (current?.page !== "download") return;

    const primary = document.getElementById("creatorPrimaryImport");
    const zone = document.getElementById("creatorImportZone");
    if (primary instanceof HTMLButtonElement && primary.dataset.creatorWired !== "true") {
      primary.dataset.creatorWired = "true";
      primary.addEventListener("click", importAndOpen);
    }
    if (zone instanceof HTMLButtonElement && zone.dataset.creatorWired !== "true") {
      zone.dataset.creatorWired = "true";
      zone.addEventListener("click", importAndOpen);
    }

    document.querySelectorAll("[data-creator-open]").forEach(node => {
      if (!(node instanceof HTMLButtonElement) || node.dataset.creatorWired === "true") return;
      node.dataset.creatorWired = "true";
      node.addEventListener("click", () => openEditor(node.dataset.creatorOpen));
    });

    setImportBusy(importBusy);
  }

  function watchDroppedImport(before, startedAt) {
    if (currentState()?.page !== "download") return;
    if (sourceSignature() !== before) {
      openEditor();
      return;
    }
    if (performance.now() - startedAt > 3200) return;
    window.setTimeout(() => watchDroppedImport(before, startedAt), 100);
  }

  function installDropHandoff() {
    document.addEventListener("drop", event => {
      if (currentState()?.page !== "download") return;
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.some(file => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name))) return;
      dropSourceSignature = sourceSignature();
    }, true);

    document.addEventListener("drop", event => {
      if (currentState()?.page !== "download") return;
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.some(file => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name))) return;
      watchDroppedImport(dropSourceSignature, performance.now());
    });
  }

  function start() {
    if (!installCreatorPage()) return;

    const current = currentState();
    if (current) current.page = "download";
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}

    wireHome();
    installDropHandoff();

    const page = document.getElementById("page");
    if (page && !pageObserver) {
      pageObserver = new MutationObserver(() => wireHome());
      pageObserver.observe(page, { childList: true, subtree: true });
    }

    document.documentElement.dataset.creatorHome = "enabled";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
