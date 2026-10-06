(function installCoreEditorPremiumTheme() {
  "use strict";

  let queued = false;

  function apply() {
    queued = false;
    const page = document.getElementById("page");
    const active = Boolean(
      page && (
        page.classList.contains("core-editor-docked-page") ||
        page.classList.contains("core-editor-focused-page") ||
        page.querySelector(".core-editor-focus-section")
      )
    );

    document.documentElement.classList.toggle("core-editor-premium", active);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(queue).observe(page, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true
      });
    }
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
