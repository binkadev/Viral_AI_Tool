(function installCreatorHomeProductionGuard() {
  "use strict";

  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function availableSource() {
    const current = appState();
    if (!Array.isArray(current?.jobs)) return null;
    return current.jobs.find(job =>
      job?.sourcePath &&
      !job?.isRenderOutput &&
      job?.fileState !== "missing" &&
      job?.fileState !== "trashed"
    ) || null;
  }

  function cloudCopy() {
    const current = appState();
    const en = current?.locale === "en";
    if (current?.cloud?.accountOffline === true) return { label: en ? "Offline" : "Ngoại tuyến", tone: "offline" };
    if (current?.cloud?.auth?.authenticated === true) return { label: en ? "Connected" : "Đã kết nối", tone: "connected" };
    return { label: en ? "Not connected" : "Chưa kết nối", tone: "idle" };
  }

  function syncCloudChip() {
    queued = false;
    const chips = [...document.querySelectorAll(".creator-status-strip .creator-status-chip")];
    const cloud = chips.find(chip => String(chip.querySelector("b")?.textContent || "").trim().toLowerCase() === "cloud");
    if (!(cloud instanceof HTMLElement)) return;
    const status = cloudCopy();
    cloud.classList.remove("is-connected", "is-offline", "is-idle");
    cloud.classList.add("is-" + status.tone);
    const label = cloud.querySelector("span");
    if (label) label.textContent = status.label;
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(syncCloudChip);
  }

  function restoreStartupRoute() {
    const current = appState();
    if (!current || current.page !== "download" || !availableSource()) return;
    current.page = "ai-video";
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  function start() {
    restoreStartupRoute();
    syncCloudChip();
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueSync).observe(page, { childList:true, subtree:false });
    window.addEventListener("viral-ai:core-state-changed", queueSync);
    document.documentElement.dataset.creatorHomeProduction = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
