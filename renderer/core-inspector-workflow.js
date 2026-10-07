(function installCoreInspectorWorkflowDefault() {
  "use strict";

  const KEY = "viral-ai-core-editor-inspector-tab";
  const VALID = new Set(["speech", "translate", "voice", "output"]);
  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function recommendedTab() {
    const current = appState();
    if (!current?.speech?.result) return "speech";
    if (!current?.translation?.result) return "translate";
    if (!current?.voice?.result) return "voice";
    return "output";
  }

  function sync() {
    queued = false;
    const inspector = document.querySelector("#page .core-editor-inspector");
    if (!(inspector instanceof HTMLElement) || inspector.dataset.workflowDefaulted === "true") return;

    const saved = localStorage.getItem(KEY);
    if (VALID.has(saved)) {
      inspector.dataset.workflowDefaulted = "true";
      return;
    }

    const target = recommendedTab();
    const button = inspector.querySelector('[data-inspector-tab="' + target + '"]');
    if (button instanceof HTMLButtonElement) button.click();
    inspector.dataset.workflowDefaulted = "true";
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
