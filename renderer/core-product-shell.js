(function installCoreProductShell() {
  "use strict";

  const LEGACY_DEMO_NAMES = new Set([
    "Douyin_Product_042.mp4",
    "UGC_Beauty_118.mp4",
    "Review_Camera_090.mp4",
    "Short_Fashion_031.mp4"
  ]);

  const CORE_PAGES = new Set([
    "download",
    "ai-video",
    "library",
    "accounts",
    "usage",
    "billing",
    "settings"
  ]);

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    const current = appState();
    return current?.locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          workflow: "Core workflow",
          manage: "Manage",
          import: "Import",
          editor: "Core Editor",
          importTitle: "Import video",
          importBreadcrumb: "Core workflow / Import",
          editorTitle: "Core Editor",
          editorBreadcrumb: "Core workflow / Editor",
          localEyebrow: "Local video",
          localTitle: "Import from this computer",
          localBody: "Choose a video from your computer. This is the supported production import path for the current core workflow.",
          dropTitle: "Click to choose or drop a video here",
          dropBody: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          urlEyebrow: "Link import",
          urlTitle: "Import from a video URL",
          urlBody: "Link analysis is not connected to the production pipeline yet.",
          urlPlaceholder: "Paste a video URL...",
          comingSoon: "Coming soon",
          sourceTitle: "Project source",
          sourceBody: "Only original source videos appear here. Rendered outputs belong in Library/Export history.",
          emptyTitle: "No source video yet",
          emptyBody: "Import a local video to start the core workflow.",
          importAction: "Import video"
        }
      : {
          workflow: "Quy trình chính",
          manage: "Quản lý",
          import: "Nhập video",
          editor: "Core Editor",
          importTitle: "Nhập video",
          importBreadcrumb: "Quy trình chính / Nhập video",
          editorTitle: "Core Editor",
          editorBreadcrumb: "Quy trình chính / Editor",
          localEyebrow: "Video trong máy",
          localTitle: "Nhập video từ máy tính",
          localBody: "Chọn video trong máy. Đây là đường nhập production đang được hỗ trợ cho workflow lõi hiện tại.",
          dropTitle: "Bấm để chọn hoặc kéo video vào đây",
          dropBody: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          urlEyebrow: "Tải bằng liên kết",
          urlTitle: "Nhập video từ URL",
          urlBody: "Phân tích liên kết chưa được nối với pipeline production.",
          urlPlaceholder: "Dán liên kết video...",
          comingSoon: "Sắp có",
          sourceTitle: "Video nguồn của dự án",
          sourceBody: "Chỉ hiển thị video nguồn tại đây. File render được quản lý ở Thư viện/lịch sử xuất.",
          emptyTitle: "Chưa có video nguồn",
          emptyBody: "Nhập một video local để bắt đầu workflow lõi.",
          importAction: "Nhập video"
        };
  }

  function persist() {
    try {
      if (typeof save === "function") save();
    } catch {}
  }

  function hasSourceVideo() {
    const current = appState();
    return Array.isArray(current?.jobs) && current.jobs.some(job => job?.sourcePath && !job?.isRenderOutput);
  }

  function removeLegacyDemoJobs() {
    const current = appState();
    if (!Array.isArray(current?.jobs) || current.jobs.length !== LEGACY_DEMO_NAMES.size) return;

    const demoOnly = current.jobs.every(job =>
      LEGACY_DEMO_NAMES.has(String(job?.name || "")) &&
      !job?.sourcePath &&
      !job?.outputPath
    );

    if (!demoOnly) return;
    current.jobs = [];
    persist();
  }

  function installCoreNav() {
    if (typeof navItems === "undefined" || !Array.isArray(navItems)) return;

    navItems.splice(0, navItems.length,
      { group: "core-workflow" },
      { id: "download", icon: "⇩", label: "core-import" },
      { id: "ai-video", icon: "◫", label: "core-editor" },
      { group: "core-manage" },
      { id: "library", icon: "▦", label: "nav.library" },
      { id: "accounts", icon: "◎", label: "nav.accounts" },
      { id: "usage", icon: "◔", label: "nav.usage" },
      { id: "billing", icon: "◇", label: "nav.billing" },
      { id: "settings", icon: "⚙", label: "nav.settings" }
    );

    try {
      navRender = function coreNavRender() {
        const nav = document.getElementById("nav");
        if (!nav) return;
        const c = copy();

        nav.innerHTML = navItems.map(item => {
          if (item.group) {
            const groupLabel = item.group === "core-workflow" ? c.workflow : c.manage;
            return '<div class="nav-group">' + groupLabel + '</div>';
          }

          const label = item.id === "download"
            ? c.import
            : item.id === "ai-video"
              ? c.editor
              : (typeof t === "function" ? t(item.label) : item.label);

          return '<button class="nav-item ' + (appState()?.page === item.id ? "active" : "") + '" data-page="' + item.id + '" type="button">' +
            '<span class="nav-icon" aria-hidden="true">' + item.icon + '</span>' +
            '<span>' + label + '</span>' +
          '</button>';
        }).join("");
      };
    } catch {}
  }

  function installCoreImportPage() {
    if (typeof pages === "undefined" || !pages || typeof jobsTable !== "function") return;

    pages.download = function coreImportPage() {
      const c = copy();
      const current = appState();
      const sources = Array.isArray(current?.jobs)
        ? current.jobs.filter(job => !job?.isRenderOutput)
        : [];

      const sourceContent = sources.length
        ? jobsTable(sources)
        : '<div class="card card-pad core-empty-state"><div class="core-empty-icon">⇧</div><h3>' + c.emptyTitle + '</h3><p class="muted">' + c.emptyBody + '</p></div>';

      return '<div class="grid-2 core-import-grid">' +
        '<div class="card card-pad core-import-primary"><div class="eyebrow">' + c.localEyebrow + '</div><h3>' + c.localTitle + '</h3>' +
          '<p class="muted">' + c.localBody + '</p>' +
          '<div id="dropzone" class="dropzone" tabindex="0" role="button"><div class="dropzone-icon">⇧</div><strong>' + c.dropTitle + '</strong><p>' + c.dropBody + '</p></div>' +
        '</div>' +
        '<div class="card card-pad core-import-secondary" data-core-capability="coming-soon"><div class="eyebrow">' + c.urlEyebrow + '</div>' +
          '<div class="core-card-title-row"><h3>' + c.urlTitle + '</h3><span class="core-coming-soon-pill">' + c.comingSoon + '</span></div>' +
          '<p class="muted">' + c.urlBody + '</p>' +
          '<div class="row"><input id="url" class="input" placeholder="' + c.urlPlaceholder + '" disabled aria-disabled="true">' +
          '<button id="analyze" class="button primary" type="button" disabled aria-disabled="true" data-core-capability="coming-soon" title="' + c.urlBody + '">' + c.comingSoon + '</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="section-head core-source-head"><div><h3>' + c.sourceTitle + '</h3><p>' + c.sourceBody + '</p></div></div>' +
      sourceContent;
    };
  }

  function normalizeCurrentPage() {
    const current = appState();
    if (!current) return;
    if (CORE_PAGES.has(String(current.page || ""))) return;
    current.page = hasSourceVideo() ? "ai-video" : "download";
    persist();
  }

  function applyCoreLabels() {
    const current = appState();
    if (!current) return;
    const c = copy();
    const title = document.getElementById("pageTitle");
    const breadcrumb = document.getElementById("breadcrumb");
    const projectLabel = document.getElementById("newProjectLabel");

    if (projectLabel) projectLabel.textContent = c.importAction;

    if (current.page === "download") {
      if (title) title.textContent = c.importTitle;
      if (breadcrumb) breadcrumb.textContent = c.importBreadcrumb;
    } else if (current.page === "ai-video") {
      if (title) title.textContent = c.editorTitle;
      if (breadcrumb) breadcrumb.textContent = c.editorBreadcrumb;
    }
  }

  function routeQuickProject() {
    const button = document.getElementById("quickProject");
    if (!(button instanceof HTMLButtonElement) || button.dataset.coreShellWired === "true") return;
    button.dataset.coreShellWired = "true";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = appState();
      if (!current) return;
      current.page = "download";
      if (typeof render === "function") render();
    }, true);
  }

  function scan() {
    applyCoreLabels();
    routeQuickProject();
  }

  function start() {
    removeLegacyDemoJobs();
    installCoreNav();
    installCoreImportPage();
    normalizeCurrentPage();

    try {
      if (typeof render === "function") render();
    } catch {}

    scan();

    const page = document.getElementById("page");
    const nav = document.getElementById("nav");
    const observer = new MutationObserver(scan);
    if (page) observer.observe(page, { childList: true, subtree: true });
    if (nav) observer.observe(nav, { childList: true, subtree: true });

    document.documentElement.dataset.coreProductShell = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
