(function installCommercialEntryChoreography() {
  "use strict";

  const root = document.documentElement;
  let observer = null;
  let queued = false;
  let generation = 0;
  let lastKind = "";
  let lastKey = "";

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

  function clearEntryState() {
    delete root.dataset.creatorEntry;
    delete root.dataset.editorEntry;
  }

  function activate(kind, key) {
    const token = ++generation;
    const reduced = reducedMotion();

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
        if (kind === "home") root.dataset.creatorEntry = "ready";
        else root.dataset.editorEntry = "ready";
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
