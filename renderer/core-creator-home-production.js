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
    if (current?.cloud?.accountOffline === true) return { label: en ? "Offline" : "Ngoại tuyến", tone: "offline" };
    if (current?.cloud?.auth?.authenticated === true) return { label: en ? "Connected" : "Đã kết nối", tone: "connected" };
    return { label: en ? "Not connected" : "Chưa kết nối", tone: "idle" };
  }

  function localCopy() {
    const current = appState();
    const en = current?.locale === "en";
    const local = current?.speech?.providerStatus?.local;
    if (!local) return { label: en ? "Checking" : "Đang kiểm tra", tone: "idle" };
    if (local.ready === true) return { label: en ? "Ready" : "Sẵn sàng", tone: "ready" };
    return { label: en ? "Setup required" : "Cần thiết lập", tone: "idle" };
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
    const chips = [...document.querySelectorAll(".creator-status-strip .creator-status-chip")];
    const find = name => chips.find(chip => String(chip.querySelector("b")?.textContent || "").trim().toLowerCase() === name);
    updateChip(find("local"), localCopy());
    updateChip(find("cloud"), cloudCopy());
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
