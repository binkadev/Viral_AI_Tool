(function installNavigationStability() {
  "use strict";

  const root = document.documentElement;
  let installed = false;
  let lastLocale = "";
  let lastEditorSignature = "";

  function currentLocale() {
    try { return typeof state !== "undefined" && state?.locale === "en" ? "en" : "vi"; }
    catch { return root.lang === "en" ? "en" : "vi"; }
  }

  function currentPage() {
    try { return typeof state !== "undefined" ? String(state?.page || "") : ""; }
    catch { return ""; }
  }

  function expectedPageIds() {
    try {
      if (!Array.isArray(navItems)) return [];
      return navItems.filter(item => item?.id).map(item => String(item.id));
    } catch { return []; }
  }

  function editorSignature() {
    try {
      if (typeof state === "undefined" || !state) return "";
      const sources = Array.isArray(state.jobs) ? state.jobs.filter(job => job?.sourcePath && !job?.isRenderOutput) : [];
      const source = sources[0] || null;
      const renders = Array.isArray(state.jobs) ? state.jobs.filter(job => job?.isRenderOutput) : [];
      const output = renders[renders.length - 1] || null;
      const summary = result => result ? {
        sourcePath: result.sourcePath || "",
        language: result.language || "",
        segments: Array.isArray(result.segments) ? result.segments.length : 0
      } : null;
      return JSON.stringify({
        page: String(state.page || ""),
        locale: currentLocale(),
        source: source ? {
          id: source.id || "",
          sourcePath: source.sourcePath || "",
          fileState: source.fileState || "",
          analyzed: Boolean(source.meta && (Number(source.meta.duration) > 0 || Number(source.meta.width) > 0 || Number(source.meta.height) > 0))
        } : null,
        speech: summary(state.speech?.result),
        translation: summary(state.translation?.result),
        voice: summary(state.voice?.result),
        output: output ? {
          id: output.id || "",
          outputPath: output.outputPath || "",
          fileState: output.fileState || "",
          status: String(output.status || "")
        } : null
      });
    } catch { return ""; }
  }

  function installStableRender() {
    try {
      if (typeof render !== "function" || render.__coreStableRender === true) return;
      const legacyRender = render;
      const stableRender = function coreStableRender(...args) {
        const page = currentPage();
        if (page !== "ai-video") {
          lastEditorSignature = "";
          return legacyRender(...args);
        }

        const nextSignature = editorSignature();
        const pageNode = document.getElementById("page");
        const editorMounted = pageNode?.classList?.contains("core-editor-docked-page") || Boolean(pageNode?.querySelector?.(".preview-video, .core-editor-focus-section"));
        if (editorMounted && nextSignature && nextSignature === lastEditorSignature) {
          // Keep the existing video/timeline/inspector DOM alive. State-specific
          // production modules update progress, gating and selection in place.
          try { if (typeof applyChromeLocale === "function") applyChromeLocale(); } catch {}
          try { if (typeof navRender === "function") navRender(); } catch {}
          window.dispatchEvent(new CustomEvent("viral-ai:editor-render-preserved", { detail: { reason: "structural-signature-unchanged" } }));
          return;
        }

        const result = legacyRender(...args);
        lastEditorSignature = editorSignature();
        return result;
      };
      stableRender.__coreStableRender = true;
      render = stableRender;
    } catch {}
  }

  function install() {
    if (installed || typeof navRender !== "function") return;
    installed = true;

    const legacyNavRender = navRender;
    navRender = function stableNavRender() {
      const nav = document.getElementById("nav");
      if (!(nav instanceof HTMLElement)) return legacyNavRender();

      const expected = expectedPageIds();
      const buttons = Array.from(nav.querySelectorAll(":scope > .nav-item[data-page]"));
      const locale = currentLocale();
      const structureMatches = expected.length > 0 && buttons.length === expected.length && buttons.every((button, index) => String(button.dataset.page || "") === expected[index]);

      if (!structureMatches || locale !== lastLocale) {
        legacyNavRender();
        lastLocale = locale;
        return;
      }

      const page = currentPage();
      buttons.forEach(button => {
        const active = String(button.dataset.page || "") === page;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
    };

    const nav = document.getElementById("nav");
    if (nav instanceof HTMLElement && nav.dataset.stableNavigationWired !== "true") {
      nav.dataset.stableNavigationWired = "true";
      nav.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target.closest(".nav-item[data-page]") : null;
        if (!(target instanceof HTMLButtonElement)) return;
        if (String(target.dataset.page || "") !== currentPage()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    installStableRender();
    if (currentPage() === "ai-video") lastEditorSignature = editorSignature();
    lastLocale = currentLocale();
    root.dataset.stableNavigation = "enabled";
    root.dataset.stableEditorRender = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(install), { once: true });
  else requestAnimationFrame(install);
})();
