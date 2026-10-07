(function installCoreWorkflowMotion() {
  "use strict";

  let lastProgress = null;
  let queued = false;
  let firstFrame = 0;
  let secondFrame = 0;

  function clampProgress(value) {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }

  function reducedMotion() {
    if (document.documentElement.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
  }

  function syncProgress() {
    queued = false;
    const rail = document.querySelector(".core-workflow-rail");
    if (!(rail instanceof HTMLElement)) return;

    const next = clampProgress(rail.style.getPropertyValue("--workflow-progress"));
    if (lastProgress === null || reducedMotion()) {
      lastProgress = next;
      rail.style.setProperty("--workflow-progress", next.toFixed(4));
      return;
    }

    const previous = lastProgress;
    lastProgress = next;
    if (Math.abs(next - previous) < 0.0001) return;

    rail.style.setProperty("--workflow-progress", previous.toFixed(4));
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const currentRail = document.querySelector(".core-workflow-rail");
        if (currentRail === rail) {
          rail.style.setProperty("--workflow-progress", next.toFixed(4));
        }
        firstFrame = 0;
        secondFrame = 0;
      });
    });
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(syncProgress);
  }

  function start() {
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;

    const observer = new MutationObserver(queueSync);
    observer.observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queueSync);
    queueSync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
