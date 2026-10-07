(function sanitizeCoreStartupState() {
  "use strict";

  const KEY = "viral-ai-tool-state";
  const prototypeNames = new Set([
    "Douyin_Product_042.mp4",
    "UGC_Beauty_118.mp4",
    "Review_Camera_090.mp4",
    "Short_Fashion_031.mp4"
  ]);

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    saved = {};
  }

  const jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
  saved.jobs = jobs.filter(job => {
    if (!job || typeof job !== "object") return false;
    if (prototypeNames.has(String(job.name || "")) && !job.sourcePath && !job.outputPath) return false;
    return Boolean(job.sourcePath || job.outputPath || job.isRenderOutput);
  });

  const hasAvailableSource = saved.jobs.some(job =>
    job?.sourcePath &&
    !job?.isRenderOutput &&
    job?.fileState !== "missing" &&
    job?.fileState !== "trashed"
  );
  const savedPage = String(saved.page || "");
  if (["automation", "workflow", "workflow-builder"].includes(savedPage)) {
    saved.page = "download";
  } else if (savedPage === "ai-video" && !hasAvailableSource) {
    saved.page = "download";
  }

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

  document.addEventListener("DOMContentLoaded", () => {
    loadProductionOverride("core-accounts-real-data.css", "style");
    loadProductionOverride("core-accounts-real-data.js", "script");
    loadProductionOverride("core-library-output-recovery.js", "script");
    loadProductionOverride("core-settings-production.js", "script");
    loadProductionOverride("core-creator-home-production.js", "script");
    loadProductionOverride("core-export-folder-recovery.js", "script");
  }, { once: true });
})();
