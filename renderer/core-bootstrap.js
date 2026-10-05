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

  if (["ai-video", "automation", "workflow", "workflow-builder"].includes(String(saved.page || ""))) {
    saved.page = "download";
  }

  localStorage.setItem(KEY, JSON.stringify(saved));
})();
