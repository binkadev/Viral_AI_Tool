(function installCoreMediaDiscovery() {
  "use strict";

  const DRAWER_ID = "core-media-discovery";
  const SEARCH_PAGE_SIZE = 18;
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  let activeRequest = 0;
  let lastResults = [];
  let currentView = "closed";
  let opener = null;
  let inertSnapshot = [];

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved?.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function t(key, vars = {}) {
    return window.I18N?.t?.(locale(), "mediaWorkbench." + key, vars) || key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function library() {
    const current = appState();
    return current?.media || { schemaVersion: 1, assets: [], selectedAssetId: null };
  }

  function selectedVariant(result) {
    const variants = Array.isArray(result?.variants) ? result.variants : [];
    if (!variants.length) return null;
    return variants
      .slice()
      .sort((a, b) => (Number(b?.width || 0) * Number(b?.height || 0)) - (Number(a?.width || 0) * Number(a?.height || 0)))[0] || null;
  }

  function toProjectAsset(result) {
    if (!result || !result.provider || !result.providerAssetId) return null;
    const variant = selectedVariant(result);
    return {
      id: result.provider + ":" + result.providerAssetId,
      kind: result.kind || "video",
      origin: "stock",
      provider: result.provider,
      providerAssetId: String(result.providerAssetId),
      name: result.name || (result.kind === "image" ? t("images") : t("video")),
      previewUrl: result.previewUrl || result.thumbnailUrl || null,
      remoteUrl: variant?.url || null,
      status: "ready",
      fileState: "remote",
      progress: 100,
      favorite: false,
      meta: {
        width: Number(result?.meta?.width || variant?.width || 0),
        height: Number(result?.meta?.height || variant?.height || 0),
        duration: Number(result?.meta?.duration || 0),
        sizeBytes: Number(variant?.sizeBytes || 0),
        mime: variant?.mime || null,
        orientation: result?.meta?.orientation || null
      },
      attribution: result.attribution || {}
    };
  }

  function existingIdentity(result) {
    const model = window.ViralCoreMediaLibraryModel;
    const candidate = toProjectAsset(result);
    if (!model || !candidate) return false;
    const identity = model.assetIdentity(candidate);
    return (Array.isArray(library()?.assets) ? library().assets : []).some(asset => model.assetIdentity(asset) === identity);
  }

  function addToProject(result) {
    const model = window.ViralCoreMediaLibraryModel;
    const current = appState();
    const candidate = toProjectAsset(result);
    if (!model || !current || !candidate) return { status: "invalid" };
    if (existingIdentity(result)) return { status: "duplicate" };
    const count = Array.isArray(current?.media?.assets) ? current.media.assets.length : 0;
    if (count >= Number(model.MAX_PROJECT_ASSETS || 500)) return { status: "capacity" };

    const next = model.addAssets(current.media, [candidate]);
    if (!next.added.length) {
      const atCapacity = next.library?.assets?.length >= Number(model.MAX_PROJECT_ASSETS || 500);
      return { status: atCapacity ? "capacity" : "duplicate" };
    }

    current.media = next.library;
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "media-library", addedAssetIds: next.added.map(item => item.id) }
    }));
    return { status: "added", asset: next.added[0] };
  }

  function focusableElements(drawer) {
    return Array.from(drawer.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
      return element.getClientRects().length > 0;
    });
  }

  function makeBackgroundInert(drawer) {
    inertSnapshot = [];
    for (const element of Array.from(document.body.children)) {
      if (!(element instanceof HTMLElement) || element === drawer) continue;
      inertSnapshot.push({ element, inert: Boolean(element.inert), ariaHidden: element.getAttribute("aria-hidden") });
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
  }

  function restoreBackground() {
    for (const snapshot of inertSnapshot) {
      if (!snapshot?.element?.isConnected) continue;
      snapshot.element.inert = snapshot.inert;
      if (snapshot.ariaHidden == null) snapshot.element.removeAttribute("aria-hidden");
      else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
    inertSnapshot = [];
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return false;
    const drawer = document.getElementById(DRAWER_ID);
    if (!(drawer instanceof HTMLElement) || drawer.classList.contains("hidden")) return false;
    const focusable = focusableElements(drawer);
    if (!focusable.length) {
      event.preventDefault();
      drawer.querySelector(".core-media-discovery-panel")?.focus?.();
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !drawer.contains(active))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (active === last || !drawer.contains(active))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function ensureDrawer() {
    let drawer = document.getElementById(DRAWER_ID);
    if (drawer instanceof HTMLElement) return drawer;

    drawer = document.createElement("div");
    drawer.id = DRAWER_ID;
    drawer.className = "core-media-discovery hidden";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML =
      '<div class="core-media-discovery-backdrop" data-media-close></div>' +
      '<aside class="core-media-discovery-panel" role="dialog" aria-modal="true" aria-labelledby="core-media-discovery-title" tabindex="-1">' +
        '<header class="core-media-discovery-head">' +
          '<div><span class="core-media-kicker">MEDIA</span><h2 id="core-media-discovery-title"></h2><p data-media-desc></p></div>' +
          '<button type="button" class="core-media-close" data-media-close aria-label=""></button>' +
        '</header>' +
        '<form class="core-media-searchbar" data-media-form>' +
          '<div class="core-media-search-input"><span aria-hidden="true">⌕</span><input type="search" data-media-query autocomplete="off" /></div>' +
          '<button class="core-media-search-button" type="submit" data-media-search></button>' +
        '</form>' +
        '<div class="core-media-filters">' +
          '<label><span data-media-type-label></span><select data-media-kind><option value="video"></option><option value="image"></option></select></label>' +
          '<label><span data-media-orientation-label></span><select data-media-orientation><option value="any"></option><option value="portrait"></option><option value="landscape"></option><option value="square"></option></select></label>' +
        '</div>' +
        '<div class="core-media-result-summary"><strong data-media-results-label></strong><span data-media-result-count></span></div>' +
        '<div class="core-media-results" data-media-results></div>' +
      '</aside>';

    document.body.appendChild(drawer);
    drawer.querySelectorAll("[data-media-close]").forEach(button => button.addEventListener("click", close));
    drawer.querySelector("[data-media-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      runSearch();
    });
    drawer.querySelector("[data-media-results]")?.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest("[data-media-action]") : null;
      if (!(target instanceof HTMLElement)) return;
      const index = Number(target.dataset.resultIndex);
      const result = lastResults[index];
      if (!result) return;
      if (target.dataset.mediaAction === "source") {
        const url = result?.attribution?.sourceUrl;
        if (url && typeof window.desktopAPI?.openExternal === "function") window.desktopAPI.openExternal(url);
        return;
      }
      if (target.dataset.mediaAction === "add") {
        const outcome = addToProject(result);
        if (outcome.status === "capacity") {
          renderState("capacity", "libraryFullTitle", "libraryFullBody");
          return;
        }
        renderResults(lastResults);
      }
    });
    updateCopy(drawer);
    return drawer;
  }

  function updateCopy(drawer) {
    const title = drawer.querySelector("#core-media-discovery-title");
    const desc = drawer.querySelector("[data-media-desc]");
    const closeButton = drawer.querySelector(".core-media-close");
    const query = drawer.querySelector("[data-media-query]");
    const search = drawer.querySelector("[data-media-search]");
    const typeLabel = drawer.querySelector("[data-media-type-label]");
    const orientationLabel = drawer.querySelector("[data-media-orientation-label]");
    const kind = drawer.querySelector("[data-media-kind]");
    const orientation = drawer.querySelector("[data-media-orientation]");
    const resultsLabel = drawer.querySelector("[data-media-results-label]");
    if (title) title.textContent = t("discoveryTitle");
    if (desc) desc.textContent = t("discoveryDesc");
    if (closeButton) { closeButton.textContent = "×"; closeButton.setAttribute("aria-label", t("close")); }
    if (query instanceof HTMLInputElement) query.placeholder = t("searchPlaceholder");
    if (search) search.textContent = t("search");
    if (typeLabel) typeLabel.textContent = t("mediaType");
    if (orientationLabel) orientationLabel.textContent = t("orientation");
    if (kind instanceof HTMLSelectElement) {
      kind.options[0].textContent = t("video");
      kind.options[1].textContent = t("images");
    }
    if (orientation instanceof HTMLSelectElement) {
      orientation.options[0].textContent = t("any");
      orientation.options[1].textContent = t("portrait");
      orientation.options[2].textContent = t("landscape");
      orientation.options[3].textContent = t("square");
    }
    if (resultsLabel) resultsLabel.textContent = t("results");
  }

  function renderState(kind, titleKey, bodyKey) {
    const drawer = ensureDrawer();
    const root = drawer.querySelector("[data-media-results]");
    const count = drawer.querySelector("[data-media-result-count]");
    currentView = kind;
    lastResults = [];
    if (count) count.textContent = "";
    if (!root) return;
    root.innerHTML =
      '<div class="core-media-state core-media-state-' + esc(kind) + '">' +
        '<span class="core-media-state-icon" aria-hidden="true">' + (kind === "loading" ? "···" : "✦") + '</span>' +
        '<strong>' + esc(t(titleKey)) + '</strong>' +
        '<p>' + esc(t(bodyKey)) + '</p>' +
      '</div>';
  }

  function renderResults(results) {
    const drawer = ensureDrawer();
    const root = drawer.querySelector("[data-media-results]");
    const count = drawer.querySelector("[data-media-result-count]");
    const normalized = Array.isArray(results) ? results : [];
    if (!normalized.length) {
      renderState("empty", "noResultsTitle", "noResultsBody");
      return;
    }
    currentView = "results";
    lastResults = normalized;
    if (count) count.textContent = t("items", { count: lastResults.length });
    if (!root) return;

    root.innerHTML = lastResults.map((result, index) => {
      const added = existingIdentity(result);
      const preview = result.thumbnailUrl || result.previewUrl || "";
      const creator = result?.attribution?.creatorName || "";
      const duration = Number(result?.meta?.duration || 0);
      const meta = [
        result?.meta?.width && result?.meta?.height ? result.meta.width + "×" + result.meta.height : "",
        duration > 0 ? t("duration", { seconds: Math.round(duration) }) : ""
      ].filter(Boolean).join(" · ");
      return '<article class="core-media-card" data-result-card="' + index + '">' +
        '<div class="core-media-thumb">' + (preview ? '<img src="' + esc(preview) + '" alt="" loading="lazy" />' : '<span>MEDIA</span>') + '</div>' +
        '<div class="core-media-card-copy"><strong>' + esc(result.name || t(result.kind === "image" ? "images" : "video")) + '</strong>' +
          '<small>' + esc(meta || result?.meta?.orientation || "") + '</small>' +
          (creator ? '<em>' + esc(t("sourceBy", { name: creator })) + '</em>' : '') +
        '</div>' +
        '<div class="core-media-card-actions">' +
          '<button type="button" data-media-action="add" data-result-index="' + index + '"' + (added ? ' disabled class="is-added"' : '') + '>' + (added ? "✓" : "+") + '<span>' + esc(t("addProject")) + '</span></button>' +
          (result?.attribution?.sourceUrl ? '<button type="button" data-media-action="source" data-result-index="' + index + '"><span>' + esc(t("preview")) + '</span>↗</button>' : '') +
        '</div>' +
      '</article>';
    }).join("");
  }

  async function runSearch() {
    const drawer = ensureDrawer();
    const queryEl = drawer.querySelector("[data-media-query]");
    const kindEl = drawer.querySelector("[data-media-kind]");
    const orientationEl = drawer.querySelector("[data-media-orientation]");
    const query = queryEl instanceof HTMLInputElement ? queryEl.value.trim() : "";
    const requestId = ++activeRequest;
    lastResults = [];
    currentView = "validating";

    if (query.length < 2) {
      renderState("empty", "emptyTitle", "emptyBody");
      queryEl?.focus?.();
      return;
    }

    if (typeof window.desktopAPI?.searchMedia !== "function") {
      renderState("unavailable", "unavailableTitle", "unavailableBody");
      return;
    }

    renderState("loading", "searching", "emptyBody");
    try {
      const payload = await window.desktopAPI.searchMedia({
        query,
        kind: kindEl instanceof HTMLSelectElement ? kindEl.value : "video",
        orientation: orientationEl instanceof HTMLSelectElement ? orientationEl.value : "any",
        page: 1,
        perPage: SEARCH_PAGE_SIZE,
        provider: "auto"
      });
      if (requestId !== activeRequest) return;
      if (payload?.ok === false) {
        const code = payload?.error?.code || payload?.code;
        if (code === "MEDIA_AUTH_REQUIRED" || code === "AUTH_REQUIRED") {
          renderState("auth", "signInTitle", "signInBody");
        } else {
          renderState("error", "failedTitle", "failedBody");
        }
        return;
      }
      renderResults(payload?.results || payload?.data?.results || []);
    } catch {
      if (requestId !== activeRequest) return;
      renderState("error", "failedTitle", "failedBody");
    }
  }

  function open(detail = {}) {
    const drawer = ensureDrawer();
    if (!drawer.classList.contains("hidden")) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateCopy(drawer);
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    makeBackgroundInert(drawer);
    document.documentElement.classList.add("core-media-discovery-open");
    const kind = drawer.querySelector("[data-media-kind]");
    if (kind instanceof HTMLSelectElement && ["video", "image"].includes(detail.kind)) kind.value = detail.kind;
    renderState("empty", "emptyTitle", "emptyBody");
    requestAnimationFrame(() => drawer.querySelector("[data-media-query]")?.focus?.());
  }

  function close() {
    const drawer = document.getElementById(DRAWER_ID);
    if (!(drawer instanceof HTMLElement) || drawer.classList.contains("hidden")) return;
    activeRequest += 1;
    currentView = "closed";
    lastResults = [];
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("core-media-discovery-open");
    restoreBackground();
    const target = opener;
    opener = null;
    requestAnimationFrame(() => {
      if (target?.isConnected && typeof target.focus === "function") target.focus();
    });
  }

  window.addEventListener("viral-ai:media-discovery-open", event => open(event?.detail || {}));
  window.addEventListener("keydown", event => {
    if (!document.documentElement.classList.contains("core-media-discovery-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(event);
  });
  window.addEventListener("viral-ai:core-state-changed", () => {
    if (document.documentElement.classList.contains("core-media-discovery-open") && currentView === "results" && lastResults.length) {
      renderResults(lastResults);
    }
  });
})();
