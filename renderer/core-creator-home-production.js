(function installCreatorHomeProductionGuard() {
  "use strict";

  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function projectSource() {
    const current = appState();
    if (!Array.isArray(current?.jobs)) return null;
    return current.jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function cloudCopy() {
    const current = appState();
    const en = current?.locale === "en";
    if (current?.cloud?.accountOffline === true) {
      return { label: en ? "Working offline" : "Đang làm việc ngoại tuyến", tone: "offline" };
    }
    if (current?.cloud?.auth?.authenticated === true) {
      return { label: en ? "Account sync is on" : "Đồng bộ tài khoản đã bật", tone: "connected" };
    }
    return { label: en ? "Saved on this device" : "Được lưu trên thiết bị", tone: "idle" };
  }

  function localCopy() {
    const current = appState();
    const en = current?.locale === "en";
    const local = current?.speech?.providerStatus?.local;
    if (!local) return { label: en ? "Checking device" : "Đang kiểm tra thiết bị", tone: "idle" };
    if (local.ready === true) return { label: en ? "Device ready" : "Thiết bị sẵn sàng", tone: "ready" };
    return { label: en ? "Device setup needed" : "Cần hoàn tất thiết lập trên thiết bị", tone: "idle" };
  }

  function updateChip(chip, status) {
    if (!(chip instanceof HTMLElement)) return;
    chip.classList.remove("is-connected", "is-offline", "is-idle", "is-ready");
    chip.classList.add("is-" + status.tone);
    const label = chip.querySelector("span");
    if (label) label.textContent = status.label;
  }

  function syncStatusChips() {
    queued = false;
    const device = document.querySelector('.creator-status-strip [data-status-kind="device"]');
    const sync = document.querySelector('.creator-status-strip [data-status-kind="sync"]');
    updateChip(device, localCopy());
    updateChip(sync, cloudCopy());
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(syncStatusChips);
  }

  function restoreStartupRoute() {
    const current = appState();
    if (!current || current.page !== "download" || !projectSource()) return;
    current.page = "ai-video";
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  function start() {
    restoreStartupRoute();
    syncStatusChips();
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueSync).observe(page, { childList:true, subtree:false });
    window.addEventListener("viral-ai:core-state-changed", queueSync);
    document.documentElement.dataset.creatorHomeProduction = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
