(function installCoreWorkflowMotion() {
  "use strict";

  let lastProgress = null;
  let lastCurrentStage = "";
  let lastMode = "";
  let lastCompleted = null;
  let lastSourceKey = "";
  let queued = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let animatingRail = null;
  let animationPending = false;
  let completionTimer = 0;

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

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function sourceKey() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    const source = jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
    return source ? String(source.id || source.sourcePath || source.name || "source") : "";
  }

  function cancelPendingAnimation() {
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    firstFrame = 0;
    secondFrame = 0;
    animatingRail = null;
    animationPending = false;
  }

  function stagesOf(rail) {
    return Array.from(rail.querySelectorAll(":scope > .core-workflow-stage"));
  }

  function contiguousCompleted(stages) {
    let count = 0;
    while (count < stages.length && stages[count].classList.contains("is-completed")) count += 1;
    return count;
  }

  function currentStage(rail, stages = stagesOf(rail)) {
    return rail.querySelector(".core-workflow-stage.is-current, .core-workflow-stage.is-processing, .core-workflow-stage.is-active:not(.is-completed)") ||
      stages.find(stage => !stage.classList.contains("is-completed")) ||
      stages[stages.length - 1] || null;
  }

  function workflowMode(stage, completed, total) {
    if (total > 0 && completed === total) return "complete";
    if (!(stage instanceof HTMLElement)) return "idle";
    if (stage.classList.contains("is-processing")) return "processing";
    if (stage.classList.contains("is-failed")) return "failed";
    if (stage.classList.contains("is-cancelled")) return "cancelled";
    if (stage.classList.contains("is-active") || stage.classList.contains("is-current")) return "ready";
    return "idle";
  }

  function ensureFlow(rail) {
    let flow = rail.querySelector(":scope > .core-workflow-flow");
    if (flow instanceof HTMLElement) return flow;
    flow = document.createElement("span");
    flow.className = "core-workflow-flow";
    flow.setAttribute("aria-hidden", "true");
    rail.prepend(flow);
    return flow;
  }

  function syncFlowGeometry(rail, stages, stage, completed, mode) {
    const flow = ensureFlow(rail);
    if (!(stage instanceof HTMLElement) || !stages.length || mode === "complete") {
      flow.style.width = "0px";
      flow.style.opacity = "0";
      return;
    }

    const currentIndex = Math.max(0, stages.indexOf(stage));
    const startIndex = completed > 0 ? Math.min(completed - 1, currentIndex) : currentIndex;
    const startStage = stages[startIndex] || stage;
    const start = startStage.offsetLeft + startStage.offsetWidth / 2;
    const end = stage.offsetLeft + stage.offsetWidth / 2;
    const left = Math.min(start, end);
    const width = Math.max(0, Math.abs(end - start));

    flow.style.left = left.toFixed(2) + "px";
    flow.style.width = width.toFixed(2) + "px";
    flow.style.opacity = width > 2 ? "1" : "0";
  }

  function syncStageViewport(rail, stage) {
    if (!(stage instanceof HTMLElement)) return;
    const id = String(stage.dataset.coreStage || "");
    rail.dataset.currentStage = id;
    if (!id || id === lastCurrentStage) return;
    lastCurrentStage = id;

    const scroller = rail.closest(".core-workflow-scroll");
    if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= scroller.clientWidth + 2) return;
    requestAnimationFrame(() => {
      try { stage.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "center" }); } catch {}
    });
  }

  function celebrateCompletion(rail, mode, completed) {
    if (completionTimer) clearTimeout(completionTimer);
    if (mode !== "complete" || lastMode === "complete" || lastCompleted === null || completed <= lastCompleted || reducedMotion()) {
      rail.classList.remove("is-completing");
      return;
    }
    rail.classList.add("is-completing");
    completionTimer = window.setTimeout(() => {
      rail.classList.remove("is-completing");
      completionTimer = 0;
    }, 980);
  }

  function resetForSource(rail, nextSourceKey) {
    if (!lastSourceKey) {
      lastSourceKey = nextSourceKey;
      return false;
    }
    if (nextSourceKey === lastSourceKey) return false;

    lastSourceKey = nextSourceKey;
    lastProgress = 0;
    lastCurrentStage = "";
    lastMode = "";
    lastCompleted = 0;
    cancelPendingAnimation();
    rail.classList.remove("is-completing");
    rail.style.setProperty("--workflow-progress", "0.0000");
    return true;
  }

  function syncProgress() {
    queued = false;
    const rail = document.querySelector(".core-workflow-rail");
    if (!(rail instanceof HTMLElement)) return;

    const stages = stagesOf(rail);
    if (!stages.length) return;

    const nextSourceKey = sourceKey();
    const sourceChanged = resetForSource(rail, nextSourceKey);
    const completed = contiguousCompleted(stages);
    const total = stages.length;
    const stage = currentStage(rail, stages);
    const mode = workflowMode(stage, completed, total);
    const completedProgress = total <= 1
      ? (completed === total ? 1 : 0)
      : clampProgress(Math.max(0, completed - 1) / (total - 1));

    rail.dataset.mode = mode;
    rail.dataset.live = mode === "processing" ? "true" : "false";
    rail.dataset.completed = String(completed);
    rail.dataset.progress = completedProgress.toFixed(4);

    syncFlowGeometry(rail, stages, stage, completed, mode);
    syncStageViewport(rail, stage);
    celebrateCompletion(rail, mode, completed);

    if (animationPending && rail === animatingRail) return;
    if (animationPending && rail !== animatingRail) cancelPendingAnimation();

    if (lastProgress === null || reducedMotion()) {
      cancelPendingAnimation();
      lastProgress = completedProgress;
      rail.style.setProperty("--workflow-progress", completedProgress.toFixed(4));
      lastMode = mode;
      lastCompleted = completed;
      return;
    }

    const previous = sourceChanged ? 0 : lastProgress;
    lastProgress = completedProgress;
    lastMode = mode;
    lastCompleted = completed;

    if (Math.abs(completedProgress - previous) < 0.0001) {
      rail.style.setProperty("--workflow-progress", completedProgress.toFixed(4));
      return;
    }

    cancelPendingAnimation();
    animatingRail = rail;
    animationPending = true;
    rail.style.setProperty("--workflow-progress", previous.toFixed(4));

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const currentRail = document.querySelector(".core-workflow-rail");
        if (currentRail === rail) rail.style.setProperty("--workflow-progress", completedProgress.toFixed(4));
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
