(function installNavigationStability() {
  "use strict";

  const root = document.documentElement;
  let installed = false;
  let lastLocale = "";
  let lastEditorSignature = "";
  let transitionSerial = 0;

  function currentLocale() {
    try { return typeof state !== "undefined" && state?.locale === "en" ? "en" : "vi"; }
    catch { return root.lang === "en" ? "en" : "vi"; }
  }

  function currentPage() {
    try { return typeof state !== "undefined" ? String(state?.page || "") : ""; }
    catch { return ""; }
  }

  function reducedMotion() {
    if (root.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
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

  function syncPageEnhancers() {
    const page = currentPage();
    if (page === "automation") {
      try { window.ViralAutomationWorkspace?.syncNow?.(); } catch {}
      try { window.ViralAutomationMptUx?.syncNow?.(); } catch {}
      try { window.ViralAutomationWorkspace?.syncNow?.(); } catch {}
      return;
    }
    delete root.dataset.automationWorkspace;
    delete root.dataset.automationConsole;
  }

  function navigateToPage(nextPage, { source = "navigation" } = {}) {
    const next = String(nextPage || "");
    if (!next || next === currentPage()) return false;
    const serial = ++transitionSerial;

    const commit = () => {
      try {
        state.page = next;
        if (typeof render === "function") render();
        syncPageEnhancers();
        root.dataset.routePage = next;
      } catch {}
    };

    if (!reducedMotion() && typeof document.startViewTransition === "function") {
      root.dataset.routeTransition = "running";
      try {
        const transition = document.startViewTransition(commit);
        transition.finished.finally(() => {
          if (serial === transitionSerial) delete root.dataset.routeTransition;
        });
      } catch {
        commit();
        if (serial === transitionSerial) delete root.dataset.routeTransition;
      }
    } else {
      commit();
    }

    window.dispatchEvent(new CustomEvent("viral-ai:navigation-committed", { detail: { page: next, source } }));
    return true;
  }

  function installStableRender() {
    try {
      if (typeof render !== "function" || render.__coreStableRender === true) return;
      const legacyRender = render;
      const stableRender = function coreStableRender(...args) {
        const page = currentPage();
        if (page !== "ai-video") {
          lastEditorSignature = "";
          const result = legacyRender(...args);
          syncPageEnhancers();
          return result;
        }

        const nextSignature = editorSignature();
        const pageNode = document.getElementById("page");
        const editorMounted = pageNode?.classList?.contains("core-editor-docked-page") || Boolean(pageNode?.querySelector?.(".preview-video, .core-editor-focus-section"));
        if (editorMounted && nextSignature && nextSignature === lastEditorSignature) {
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
        const next = String(target.dataset.page || "");
        if (!next) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (next !== currentPage()) navigateToPage(next, { source: "sidebar" });
      }, true);
    }

    installStableRender();
    syncPageEnhancers();
    if (currentPage() === "ai-video") lastEditorSignature = editorSignature();
    lastLocale = currentLocale();
    root.dataset.stableNavigation = "enabled";
    root.dataset.stableEditorRender = "enabled";
    root.dataset.routePage = currentPage();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(install), { once: true });
  else requestAnimationFrame(install);

  window.ViralNavigationStability = {
    navigateToPage,
    syncPageEnhancers
  };
})();