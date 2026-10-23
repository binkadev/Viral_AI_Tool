(function installCommercialMotion() {
  "use strict";
  const root = document.documentElement;
  const expressive = new Set(["home", "ai-create"]);
  const controlled = new Set(["generation-progress", "library", "productions", "batch-production", "settings"]);
  let installed = false, previous = null;
  function present() {
    const page = String(state.page || "");
    root.dataset.commercialPage = page;
    root.dataset.viralMotionZone = page === "ai-video" ? "workstation" : expressive.has(page) ? "expressive" : "controlled";
    return page;
  }
  function install() {
    if (installed || typeof render !== "function") return;
    installed = true;
    const original = render;
    render = function commercialPresentation(...args) {
      present(); // Scope styles before the existing renderer paints the route.
      const result = original(...args), page = present();
      if (page !== previous && (expressive.has(page) || controlled.has(page))) {
        // The existing renderer owns all DOM construction. Mark its new direct
        // surfaces only at a route boundary, never on progress/in-place updates.
        // Studio never enters this branch, including preserved editor renders.
        const host = document.getElementById("page");
        for (const node of Array.from(host?.children || [])) {
          if (node instanceof HTMLElement && !node.hidden) node.classList.add("viral-enter-surface");
        }
      }
      previous = page;
      return result;
    };
    // Initial presentation already exists; no second render or DOM replacement.
    present(); previous = String(state.page || "");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, {once:true}); else install();
})();
