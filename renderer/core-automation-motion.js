(function installAutomationMotion() {
  "use strict";

  let queued = false;
  let entered = false;
  let lastStage = null;
  let lastSignatures = null;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function reducedMotion() {
    if (document.documentElement.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
  }

  function automation() {
    return appState()?.automation || null;
  }

  function activeStage() {
    const apiStage = Number(window.ViralAutomationWorkspace?.getActiveStage?.() || 0);
    if (apiStage >= 1 && apiStage <= 5) return apiStage;
    const current = document.querySelector(".automation-stage[aria-current='step']");
    return Number(current?.getAttribute("data-workspace-stage") || 0) || 1;
  }

  function signatures() {
    const current = automation();
    const assets = Array.isArray(current?.resolvedAssets) ? current.resolvedAssets : [];
    return {
      script: String(current?.script?.outputSignature || ""),
      scenes: String(current?.scenePlan?.outputSignature || ""),
      assets: assets.map(asset => [asset?.id, asset?.requestSignature, asset?.localPath].map(value => String(value || "")).join(":"))
        .sort()
        .join("|"),
      voice: String(current?.voiceResult?.id || current?.voiceResult?.inputSignature || ""),
      composition: String(current?.composition?.outputSignature || "")
    };
  }

  function clearOnAnimationEnd(element, className) {
    const done = event => {
      if (event.target !== element) return;
      element.classList.remove(className);
    };
    element.addEventListener("animationend", done, { once: true });
  }

  function animate(element, className, delay = null) {
    if (!(element instanceof HTMLElement) || reducedMotion()) return;
    element.classList.remove(className);
    if (delay !== null) element.style.setProperty("--automation-motion-delay", delay + "ms");
    void element.getBoundingClientRect();
    element.classList.add(className);
    clearOnAnimationEnd(element, className);
  }

  function visibleStageSurface(stage) {
    if (stage === 1) return document.querySelector(".automation-brief-card:not([hidden])");
    if (stage === 2) return document.querySelector(".automation-script-card:not([hidden])");
    if (stage === 3) return document.querySelector(".automation-scenes-host:not([hidden]) .automation-scenes-panel");
    if (stage === 4) return document.querySelector(".automation-assets-host:not([hidden]) .automation-assets-panel");
    if (stage === 5) return document.querySelector(".automation-composition-host:not([hidden]) .automation-composition-panel, .automation-composition-host:not([hidden])");
    return null;
  }

  function artifactTarget(kind) {
    if (kind === "script") return document.querySelector(".automation-script-card");
    if (kind === "scenes") return document.querySelector(".automation-scenes-panel");
    if (kind === "assets") return document.querySelector(".automation-assets-panel");
    if (kind === "voice") return document.querySelector(".automation-voice-panel");
    if (kind === "composition") return document.querySelector(".automation-composition-panel, .automation-composition-host");
    return null;
  }

  function animateEntry(creator) {
    animate(creator.querySelector(":scope > .automation-hero"), "automation-motion-enter", 0);
    animate(creator.querySelector(":scope > .automation-mvp-controller"), "automation-motion-enter", 45);
    animate(creator.querySelector(":scope > .automation-stage-rail"), "automation-motion-enter", 80);
    const stages = Array.from(creator.querySelectorAll(":scope > .automation-stage-rail .automation-stage"));
    stages.forEach((stage, index) => animate(stage, "automation-motion-enter", 110 + index * 42));
    animate(creator.querySelector(":scope > .automation-step-context"), "automation-motion-enter", 165);
    animate(visibleStageSurface(activeStage()), "automation-motion-enter", 205);
  }

  function animateStageChange(stage) {
    const current = document.querySelector(`.automation-stage[data-workspace-stage="${stage}"]`);
    animate(current, "automation-motion-active");
    animate(document.querySelector(".automation-step-context"), "automation-motion-context");
    animate(visibleStageSurface(stage), "automation-motion-surface");
  }

  function animateNewArtifacts(next) {
    if (!lastSignatures) return;
    for (const kind of ["script", "scenes", "assets", "voice", "composition"]) {
      const before = String(lastSignatures[kind] || "");
      const after = String(next[kind] || "");
      if (!after || after === before) continue;
      animate(artifactTarget(kind), "automation-motion-artifact");
    }
  }

  function reset() {
    entered = false;
    lastStage = null;
    lastSignatures = null;
    delete document.documentElement.dataset.automationMotion;
  }

  function scan() {
    queued = false;
    if (appState()?.page !== "automation") {
      reset();
      return;
    }

    const creator = document.querySelector(".automation-creator.automation-workspace-v2");
    if (!(creator instanceof HTMLElement)) return;

    document.documentElement.dataset.automationMotion = "enabled";
    const stage = activeStage();
    const nextSignatures = signatures();

    if (!entered) {
      entered = true;
      lastStage = stage;
      lastSignatures = nextSignatures;
      animateEntry(creator);
      return;
    }

    if (stage !== lastStage) {
      lastStage = stage;
      animateStageChange(stage);
    }

    animateNewArtifacts(nextSignatures);
    lastSignatures = nextSignatures;
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);
  window.addEventListener("viral-ai:editor-preview-preserved", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationMotion = { refresh: queue };
})();
