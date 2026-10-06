(function installPremiumStartupExperience() {
  "use strict";

  const root = document.documentElement;
  let revealed = false;
  let pageObserver = null;
  let pageTimer = 0;

  function reducedMotion() {
    if (root.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
  }

  function readyForReveal() {
    const page = document.getElementById("page");
    const nav = document.getElementById("nav");
    return Boolean(page?.children?.length && nav?.children?.length);
  }

  function animatePage(page) {
    if (!(page instanceof HTMLElement) || reducedMotion()) return;
    page.classList.remove("core-page-enter");
    void page.offsetWidth;
    page.classList.add("core-page-enter");
    clearTimeout(pageTimer);
    pageTimer = window.setTimeout(() => page.classList.remove("core-page-enter"), 520);
  }

  function wirePageTransitions() {
    if (pageObserver) return;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;

    pageObserver = new MutationObserver(records => {
      if (root.dataset.startup !== "ready") return;
      if (!records.some(record => record.type === "childList")) return;
      animatePage(page);
    });
    pageObserver.observe(page, { childList: true, subtree: false });
  }

  function reveal() {
    if (revealed) return;
    revealed = true;

    const splash = document.getElementById("appStartup");
    root.dataset.startup = "revealing";
    splash?.classList?.add("is-exiting");

    const finishDelay = reducedMotion() ? 20 : 470;
    window.setTimeout(() => {
      splash?.remove?.();
      root.dataset.startup = "ready";
      wirePageTransitions();
      window.dispatchEvent(new CustomEvent("viral-ai:startup-complete"));
    }, finishDelay);
  }

  function waitForApp(startedAt) {
    if (revealed) return;
    const minimum = reducedMotion() ? 120 : 980;
    const elapsed = performance.now() - startedAt;

    if (elapsed >= minimum && readyForReveal()) {
      requestAnimationFrame(() => requestAnimationFrame(reveal));
      return;
    }

    requestAnimationFrame(() => waitForApp(startedAt));
  }

  function start() {
    root.dataset.startup = "booting";
    const startedAt = performance.now();
    waitForApp(startedAt);

    // Fail safe: a renderer feature must never leave the user trapped behind the splash.
    window.setTimeout(reveal, 2800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
