(function installNavigationStability() {
  "use strict";

  let installed = false;
  let lastLocale = "";

  function currentLocale() {
    try { return typeof state !== "undefined" && state?.locale === "en" ? "en" : "vi"; }
    catch { return document.documentElement.lang === "en" ? "en" : "vi"; }
  }

  function currentPage() {
    try { return typeof state !== "undefined" ? String(state?.page || "") : ""; }
    catch { return ""; }
  }

  function expectedPageIds() {
    try {
      if (!Array.isArray(navItems)) return [];
      return navItems.filter(item => item?.id).map(item => String(item.id));
    } catch {
      return [];
    }
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
      const structureMatches =
        expected.length > 0 &&
        buttons.length === expected.length &&
        buttons.every((button, index) => String(button.dataset.page || "") === expected[index]);

      // Rebuild only when the navigation structure or language actually changes.
      // Normal page switches update active state in place so the sidebar never flashes.
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

        // Clicking the already-active page must not destroy and recreate the workspace.
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    lastLocale = currentLocale();
    document.documentElement.dataset.stableNavigation = "enabled";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(install), { once: true });
  } else {
    requestAnimationFrame(install);
  }
})();
