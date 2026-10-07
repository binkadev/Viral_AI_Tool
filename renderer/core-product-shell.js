(function installCoreProductShell() {
  "use strict";

  const LEGACY_DEMO_NAMES = new Set([
    "Douyin_Product_042.mp4",
    "UGC_Beauty_118.mp4",
    "Review_Camera_090.mp4",
    "Short_Fashion_031.mp4"
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
          workflow: "Create video",
          manage: "Manage",
          import: "Import video",
          editor: "Video studio",
          importTitle: "Import video",
          importBreadcrumb: "Create video / Import",
          editorTitle: "Video studio",
          editorBreadcrumb: "Create video / Studio",
          localEyebrow: "From this computer",
          localTitle: "Choose your source video",
          localBody: "Choose a video from your computer to start editing, translating, generating voice and exporting in one place.",
          dropTitle: "Click to choose or drop a video here",
          dropBody: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          urlEyebrow: "From a link",
          urlTitle: "Import from a video URL",
          urlBody: "Importing from a link is not available yet. You can use a video saved on this computer now.",
          urlPlaceholder: "Paste a video URL...",
          comingSoon: "Coming soon",
          sourceTitle: "Project source",
          sourceBody: "Your original source video stays here. Finished videos are available from Library.",
          emptyTitle: "No source video yet",
          emptyBody: "Import a video from this computer to begin.",
          importAction: "Import video"
        }
      : {
          workflow: "Tạo video",
          manage: "Quản lý",
          import: "Nhập video",
          editor: "Studio video",
          importTitle: "Nhập video",
          importBreadcrumb: "Tạo video / Nhập video",
          editorTitle: "Studio video",
          editorBreadcrumb: "Tạo video / Studio",
          localEyebrow: "Từ máy tính",
          localTitle: "Chọn video nguồn",
          localBody: "Chọn video trong máy để bắt đầu chỉnh sửa, dịch nội dung, tạo giọng và xuất video ngay trong một nơi.",
          dropTitle: "Bấm để chọn hoặc kéo video vào đây",
          dropBody: "MP4 · MOV · MKV · WEBM · AVI · M4V",
          urlEyebrow: "Từ liên kết",
          urlTitle: "Nhập video từ URL",
          urlBody: "Nhập video từ liên kết chưa khả dụng. Hiện tại bạn có thể dùng video đã lưu trên máy.",
          urlPlaceholder: "Dán liên kết video...",
          comingSoon: "Sắp có",
          sourceTitle: "Video nguồn của dự án",
          sourceBody: "Video gốc của dự án được giữ tại đây. Video đã xuất được quản lý trong Thư viện.",
          emptyTitle: "Chưa có video nguồn",
          emptyBody: "Nhập một video từ máy tính để bắt đầu.",
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
    if (!Array.isArray(current?.jobs) || current.jobs.length === 0) return;

    const productionJobs = current.jobs.filter(job => {
      const isLegacyDemo = LEGACY_DEMO_NAMES.has(String(job?.name || "")) &&
        !job?.sourcePath &&
        !job?.outputPath;
      return !isLegacyDemo;
    });

    if (productionJobs.length === current.jobs.length) return;
    current.jobs = productionJobs;
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

    const startupPage = hasSourceVideo() ? "ai-video" : "download";
    if (current.page === startupPage) return;
    current.page = startupPage;
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
