(function sanitizeCoreStartupState() {
  "use strict";

  const KEY = "viral-ai-tool-state";
  const prototypeNames = new Set([
    "Douyin_Product_042.mp4",
    "UGC_Beauty_118.mp4",
    "Review_Camera_090.mp4",
    "Short_Fashion_031.mp4"
  ]);
  const root = document.documentElement;

  // Never paint an intermediate legacy page. The shell stays visible; only the
  // page content waits until production routing has settled. No fade/animation.
  root.dataset.coreFirstPaint = "pending";
  const firstPaintStyle = document.createElement("style");
  firstPaintStyle.id = "coreFirstPaintGuard";
  firstPaintStyle.textContent = 'html[data-core-first-paint="pending"] #page{visibility:hidden!important;pointer-events:none!important}';
  document.head.appendChild(firstPaintStyle);

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    saved = {};
  }

  function primeCommercialChrome() {
    const en = saved.locale === "en";
    const workspaceLabel = document.getElementById("workspaceLabel");
    const workspaceName = document.querySelector(".workspace strong");
    const accountName = document.querySelector('[data-core-placeholder="account-profile"] b');
    const accountStatus = document.querySelector('[data-core-placeholder="account-profile"] span');
    const projectAction = document.getElementById("newProjectLabel");

    if (workspaceLabel) workspaceLabel.textContent = en ? "Workspace" : "Khu làm việc";
    if (workspaceName) workspaceName.textContent = en ? "Video Studio" : "Studio video";
    if (accountName) accountName.textContent = en ? "Cloud account" : "Tài khoản Cloud";
    if (accountStatus) accountStatus.textContent = en ? "Not synced" : "Chưa đồng bộ";
    if (projectAction) projectAction.textContent = en ? "Import video" : "Nhập video";
  }

  primeCommercialChrome();

  const jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
  saved.jobs = jobs.filter(job => {
    if (!job || typeof job !== "object") return false;
    if (prototypeNames.has(String(job.name || "")) && !job.sourcePath && !job.outputPath) return false;
    return Boolean(job.sourcePath || job.outputPath || job.isRenderOutput);
  });

  // A missing source file is still a real project. Start directly in Core Editor
  // so the relink/recovery UI is available instead of bouncing through Import.
  const hasProjectSource = saved.jobs.some(job => job?.sourcePath && !job?.isRenderOutput);
  saved.page = hasProjectSource ? "ai-video" : "download";
  localStorage.setItem(KEY, JSON.stringify(saved));

  function loadProductionOverride(href, kind) {
    const selector = kind === "style" ? 'link[href="' + href + '"]' : 'script[src="' + href + '"]';
    if (document.querySelector(selector)) return;
    if (kind === "style") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      return;
    }
    const script = document.createElement("script");
    script.src = href;
    script.async = false;
    document.body.appendChild(script);
  }

  function settleFirstPaint() {
    try {
      if (typeof state !== "undefined" && state) {
        const project = Array.isArray(state.jobs) && state.jobs.some(job => job?.sourcePath && !job?.isRenderOutput);
        const target = project ? "ai-video" : "download";
        if (state.page !== target) {
          state.page = target;
          if (typeof render === "function") render();
        }
      }
    } catch {}

    root.dataset.coreFirstPaint = "ready";
    firstPaintStyle.remove();
    try {
      window.dispatchEvent(new CustomEvent("viral-ai:core-first-paint-ready", {
        detail: { route: typeof state !== "undefined" && state ? state.page : null }
      }));
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadProductionOverride("core-accounts-real-data.css", "style");
    loadProductionOverride("core-accounts-real-data.js", "script");
    loadProductionOverride("core-library-output-recovery.js", "script");
    loadProductionOverride("core-settings-production.js", "script");
    loadProductionOverride("core-creator-home-production.js", "script");
    loadProductionOverride("core-export-folder-recovery.js", "script");
    settleFirstPaint();
  }, { once: true });
})();
