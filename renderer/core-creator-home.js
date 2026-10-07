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

  function locale() {
    return currentState()?.locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          kicker: "Creator workspace",
          title: "Start a new video project",
          body: "Import one source video and continue directly in the production editor.",
          importAction: "Import video",
          dropTitle: "Drop a video here or choose a file",
          dropMeta: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          local: "Local",
          localReady: "Ready",
          cloud: "Cloud",
          cloudConnected: "Connected",
          cloudOffline: "Offline",
          cloudNotConnected: "Not connected",
          currentProject: "Current project",
          recent: "Recent projects",
          continue: "Continue editing",
          noProject: "No project yet",
          noProjectBody: "Import a source video to create your first project.",
          relink: "Relink source"
        }
      : {
          kicker: "Không gian sáng tạo",
          title: "Bắt đầu dự án video mới",
          body: "Nhập một video nguồn và tiếp tục trực tiếp trong trình chỉnh sửa production.",
          importAction: "Nhập video",
          dropTitle: "Kéo video vào đây hoặc chọn tệp",
          dropMeta: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          local: "Local",
          localReady: "Sẵn sàng",
          cloud: "Cloud",
          cloudConnected: "Đã kết nối",
          cloudOffline: "Ngoại tuyến",
          cloudNotConnected: "Chưa kết nối",
          currentProject: "Dự án đang làm",
          recent: "Dự án gần đây",
          continue: "Tiếp tục chỉnh sửa",
          noProject: "Chưa có dự án",
          noProjectBody: "Nhập video nguồn để bắt đầu dự án đầu tiên.",
          relink: "Chọn lại video nguồn"
        };
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

  function cloudStatus() {
    const current = currentState();
    const c = copy();
    if (current?.cloud?.accountOffline) return { label: c.cloudOffline, tone: "offline" };
    if (current?.cloud?.auth?.authenticated === true || Boolean(current?.cloud?.account)) {
      return { label: c.cloudConnected, tone: "connected" };
    }
    return { label: c.cloudNotConnected, tone: "idle" };
  }

  function statusStrip() {
    const c = copy();
    const cloud = cloudStatus();
    return '<div class="creator-status-strip" aria-label="Workspace status">' +
      '<span class="creator-status-chip is-ready"><i></i><b>' + esc(c.local) + '</b><span>' + esc(c.localReady) + '</span></span>' +
      '<span class="creator-status-chip is-' + cloud.tone + '"><i></i><b>' + esc(c.cloud) + '</b><span>' + esc(cloud.label) + '</span></span>' +
    '</div>';
  }

  function currentProject(source) {
    const c = copy();
    if (!source) {
      return '<section class="creator-current-project is-empty">' +
        '<div class="creator-section-heading compact"><div><span class="creator-section-kicker">' + esc(c.currentProject) + '</span><h3>' + esc(c.noProject) + '</h3><p>' + esc(c.noProjectBody) + '</p></div></div>' +
      '</section>';
    }

    const unavailable = source.fileState === "missing" || source.fileState === "trashed";
    const action = unavailable
      ? '<button class="button secondary creator-project-action" type="button" data-job-action="relink" data-job-id="' + esc(source.id) + '">' + esc(c.relink) + '</button>'
      : '<button class="button primary creator-project-action" type="button" data-creator-open="' + esc(source.id) + '">' + esc(c.continue) + '<span aria-hidden="true">→</span></button>';

    return '<section class="creator-current-project">' +
      '<div class="creator-section-heading compact"><div><span class="creator-section-kicker">' + esc(c.currentProject) + '</span></div></div>' +
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
    const c = copy();
    const recent = sources.slice(1, 5);
    if (!recent.length) return "";

    return '<section class="creator-recent-section">' +
      '<div class="creator-section-heading"><div><span class="creator-section-kicker">' + esc(c.recent) + '</span></div></div>' +
      '<div class="creator-recent-strip">' +
        recent.map(job => {
          const unavailable = job.fileState === "missing" || job.fileState === "trashed";
          const action = unavailable
            ? '<button class="creator-recent-relink" type="button" data-job-action="relink" data-job-id="' + esc(job.id) + '">' + esc(c.relink) + '</button>'
            : '<button class="creator-recent-open" type="button" data-creator-open="' + esc(job.id) + '" aria-label="' + esc(c.continue) + '">→</button>';
          return '<article class="creator-recent-item ' + (unavailable ? "is-unavailable" : "") + '">' +
            sourceThumbnail(job, "creator-recent-thumb") +
            '<div class="creator-recent-copy">' +
              '<strong title="' + esc(job.name || "") + '">' + esc(job.name || tr("common.video")) + '</strong>' +
              sourceAvailability(job) +
              '<span class="creator-recent-meta">' + esc(sourceMeta(job)) + '</span>' +
            '</div>' +
            action +
          '</article>';
        }).join("") +
      '</div>' +
    '</section>';
  }

  function creatorHomePage() {
    const c = copy();
    const sources = sourceJobs();
    const current = sources[0] || null;

    return '<div class="creator-home creator-home-professional" data-creator-home>' +
      '<section class="creator-home-hero">' +
        '<div class="creator-home-copy">' +
          '<div class="creator-home-eyebrow"><span></span>' + esc(c.kicker) + '</div>' +
          '<h2>' + esc(c.title) + '</h2>' +
          '<p>' + esc(c.body) + '</p>' +
          '<div class="creator-home-actions">' +
            '<button id="creatorPrimaryImport" class="button primary creator-primary-import" type="button">' +
              '<span class="creator-button-icon" aria-hidden="true">+</span><span>' + esc(c.importAction) + '</span>' +
            '</button>' +
            statusStrip() +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="creator-start-grid">' +
        '<div class="creator-import-surface">' +
          '<div class="creator-import-heading">' +
            '<div class="creator-import-icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div><h3>' + esc(c.importAction) + '</h3><p>' + esc(c.body) + '</p></div>' +
          '</div>' +
          '<button id="creatorImportZone" class="creator-import-zone" type="button">' +
            '<span class="creator-import-symbol" aria-hidden="true">+</span>' +
            '<strong>' + esc(c.dropTitle) + '</strong>' +
            '<span>' + esc(c.dropMeta) + '</span>' +
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
    current.page = "ai-video";
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}

    requestAnimationFrame(() => {
      preparing = false;
      setImportBusy(false);
    });
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
