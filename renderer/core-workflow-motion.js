(function installCoreWorkflowMotion() {
  "use strict";

  let lastProgress = null;
  let lastCurrentStage = "";
  let queued = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let animatingRail = null;
  let animationPending = false;

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

  function cancelPendingAnimation() {
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    firstFrame = 0;
    secondFrame = 0;
    animatingRail = null;
    animationPending = false;
  }

  function currentStage(rail) {
    return rail.querySelector(".core-workflow-stage.is-current, .core-workflow-stage.is-processing, .core-workflow-stage.is-active:not(.is-completed)");
  }

  function syncStageViewport(rail) {
    const stage = currentStage(rail);
    if (!(stage instanceof HTMLElement)) return;
    const id = String(stage.dataset.coreStage || "");
    rail.dataset.currentStage = id;
    rail.dataset.live = stage.classList.contains("is-processing") ? "true" : "false";
    if (!id || id === lastCurrentStage) return;
    lastCurrentStage = id;

    const scroller = rail.closest(".core-workflow-scroll");
    if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= scroller.clientWidth + 2) return;
    requestAnimationFrame(() => {
      try { stage.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "center" }); } catch {}
    });
  }

  function syncProgress() {
    queued = false;
    const rail = document.querySelector(".core-workflow-rail");
    if (!(rail instanceof HTMLElement)) return;

    syncStageViewport(rail);

    if (animationPending && rail === animatingRail) return;
    if (animationPending && rail !== animatingRail) cancelPendingAnimation();

    const next = clampProgress(rail.style.getPropertyValue("--workflow-progress"));
    rail.dataset.progress = next.toFixed(4);

    if (lastProgress === null || reducedMotion()) {
      cancelPendingAnimation();
      lastProgress = next;
      rail.style.setProperty("--workflow-progress", next.toFixed(4));
      return;
    }

    const previous = lastProgress;
    lastProgress = next;
    if (Math.abs(next - previous) < 0.0001) return;

    cancelPendingAnimation();
    animatingRail = rail;
    animationPending = true;
    rail.style.setProperty("--workflow-progress", previous.toFixed(4));

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const currentRail = document.querySelector(".core-workflow-rail");
        if (currentRail === rail) rail.style.setProperty("--workflow-progress", next.toFixed(4));
        firstFrame = 0;
        secondFrame = 0;
        animatingRail = null;
        animationPending = false;
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
    observer.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-stage-state"] });
    window.addEventListener("viral-ai:core-state-changed", queueSync);
    window.addEventListener("viral-ai:navigation-committed", queueSync);
    window.addEventListener("resize", queueSync, { passive: true });
    queueSync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();