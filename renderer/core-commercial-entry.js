(function installCommercialEntryChoreography() {
  "use strict";

  const root = document.documentElement;
  let observer = null;
  let queued = false;
  let generation = 0;
  let lastKind = "";
  let lastKey = "";
  let settleTarget = null;
  let settleHandler = null;

  function currentState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function activeSourceKey() {
    const jobs = currentState()?.jobs;
    if (!Array.isArray(jobs)) return "none";
    const source = jobs.find(job => job?.sourcePath && !job?.isRenderOutput);
    return String(source?.id || source?.sourcePath || "none");
  }

  function reducedMotion() {
    if (root.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
  }

  function surface() {
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return null;

    const home = page.querySelector("[data-creator-home]");
    if (home instanceof HTMLElement) return { kind: "home", key: "home" };

    const editor = page.querySelector(".core-editor-focus-section");
    if (editor instanceof HTMLElement) return { kind: "editor", key: "editor:" + activeSourceKey() };

    return null;
  }

  function detachSettleListener() {
    if (settleTarget instanceof HTMLElement && typeof settleHandler === "function") {
      settleTarget.removeEventListener("transitionend", settleHandler);
    }
    settleTarget = null;
    settleHandler = null;
  }

  function clearEntryState() {
    detachSettleListener();
    delete root.dataset.creatorEntry;
    delete root.dataset.editorEntry;
  }

  function armEditorCleanup(key, token) {
    detachSettleListener();
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    const target = page.querySelector(".core-editor-bottom-dock") || page.querySelector(".core-editor-focus-section");
    if (!(target instanceof HTMLElement)) return;

    settleTarget = target;
    settleHandler = event => {
      if (event.target !== target || event.propertyName !== "translate") return;
      if (token !== generation) return;
      const current = surface();
      if (!current || current.kind !== "editor" || current.key !== key) return;
      delete root.dataset.editorEntry;
      detachSettleListener();
    };
    target.addEventListener("transitionend", settleHandler);
  }

  function activate(kind, key) {
    const token = ++generation;
    const reduced = reducedMotion();

    detachSettleListener();
    if (kind === "home") {
      delete root.dataset.editorEntry;
      root.dataset.creatorEntry = reduced ? "ready" : "pending";
    } else {
      delete root.dataset.creatorEntry;
      root.dataset.editorEntry = reduced ? "ready" : "pending";
    }

    if (reduced) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (token !== generation) return;
        const current = surface();
        if (!current || current.kind !== kind || current.key !== key) return;
        if (kind === "home") {
          root.dataset.creatorEntry = "ready";
        } else {
          armEditorCleanup(key, token);
          root.dataset.editorEntry = "ready";
        }
      });
    });
  }

  function scan() {
    queued = false;
    const current = surface();
    if (!current) {
      if (lastKind || lastKey) {
        lastKind = "";
        lastKey = "";
        generation += 1;
        clearEntryState();
      }
      return;
    }

    if (current.kind === lastKind && current.key === lastKey) return;
    lastKind = current.kind;
    lastKey = current.key;
    activate(current.kind, current.key);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function start() {
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;

    observer = new MutationObserver(queue);
    observer.observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
