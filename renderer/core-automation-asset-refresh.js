(function installAutomationAssetRefresh() {
  "use strict";

  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function tr(key, vars, fallback = "") {
    try {
      if (typeof t === "function") return t(key, vars);
      if (window.I18N?.t) return window.I18N.t(appState()?.locale === "en" ? "en" : "vi", key, vars);
    } catch {}
    return fallback || key;
  }

  function hasReadyProvider() {
    const providers = Array.isArray(window.ViralAutomationStockStatus?.providers)
      ? window.ViralAutomationStockStatus.providers
      : [];
    return providers.some(provider => provider?.ready === true);
  }

  function enhance() {
    if (appState()?.page !== "automation") return;
    const inspector = document.querySelector(".automation-asset-inspector");
    const selected = document.querySelector(".automation-asset-nav-item.is-selected[data-asset-scene]");
    if (!(inspector instanceof HTMLElement) || !(selected instanceof HTMLElement)) return;
    const sceneId = selected.getAttribute("data-asset-scene") || "";
    if (!sceneId) return;

    const providerState = inspector.querySelector(".automation-asset-provider-state");
    const openButton = providerState?.querySelector("[data-asset-open]");
    if (!(providerState instanceof HTMLElement) || !(openButton instanceof HTMLButtonElement)) return;

    let actions = providerState.querySelector(":scope > .automation-asset-refresh-actions");
    if (!(actions instanceof HTMLElement)) {
      actions = document.createElement("div");
      actions.className = "automation-asset-refresh-actions";
      providerState.appendChild(actions);
    }
    if (openButton.parentElement !== actions) actions.appendChild(openButton);

    let replace = actions.querySelector("[data-asset-refresh-scene]");
    if (!(replace instanceof HTMLButtonElement)) {
      replace = document.createElement("button");
      replace.type = "button";
      replace.className = "button ghost automation-asset-refresh-button";
      replace.setAttribute("data-asset-refresh-scene", "true");
      actions.prepend(replace);
    }
    replace.setAttribute("data-asset-resolve", sceneId);
    replace.textContent = "↻ " + tr("common.choose");
    replace.disabled = !hasReadyProvider();
    replace.setAttribute("aria-disabled", replace.disabled ? "true" : "false");
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  }

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
