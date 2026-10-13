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
  let activeSearchRequestId = null;
  let lastResults = [];
  let nextPage = null;
  let searchContext = null;
  let loadingMore = false;
  let currentView = "closed";
  let opener = null;
  let inertSnapshot = [];
  const acquisitions = new Map();

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

  function tc(key, vars = {}) {
    return window.I18N?.t?.(locale(), key, vars) || key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function providerLabel(value) {
    const provider = String(value || "").trim().toLowerCase();
    if (provider === "pexels") return "Pexels";
    if (provider === "pixabay") return "Pixabay";
    return String(value || "").trim();
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function library() {
    const current = appState();
    return current?.media || { schemaVersion: 1, assets: [], selectedAssetId: null };
  }

  function currentProjectId() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    const source = jobs.find(job => job?.sourcePath && !job?.isRenderOutput);
    return String(source?.id || source?.sourcePath || "").trim();
  }

  function resultIdentity(result) {
    const provider = String(result?.provider || "").trim().toLowerCase();
    const providerAssetId = String(result?.providerAssetId || "").trim();
    return provider && providerAssetId ? provider + ":" + providerAssetId : "";
  }

  function mergeResults(current, additions) {
    const merged = [];
    const seen = new Set();
    for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(additions) ? additions : [])]) {
      const identity = resultIdentity(item) || "fallback:" + String(item?.id || item?.name || merged.length);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(item);
    }
    return merged;
  }

  function requestId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return String(prefix || "media") + "_" + Date.now().toString(36) + "_" + random;
  }

  function identityCandidate(result) {
    if (!result || !result.provider || !result.providerAssetId) return null;
    return {
      id: resultIdentity(result),
      kind: result.kind || "video",
      origin: "stock",
      provider: result.provider,
      providerAssetId: String(result.providerAssetId),
      name: result.name || (result.kind === "image" ? t("images") : t("video")),
      previewUrl: null,
      remoteUrl: null,
      status: "ready",
      fileState: "remote",
      progress: 100,
      meta: result.meta || {},
      attribution: result.attribution || {}
    };
  }

  function existingIdentity(result) {
    const model = window.ViralCoreMediaLibraryModel;
    const candidate = identityCandidate(result);
    if (!model || !candidate) return false;
    const identity = model.assetIdentity(candidate);
    return (Array.isArray(library()?.assets) ? library().assets : []).some(asset => model.assetIdentity(asset) === identity);
  }

  function addAcquiredAsset(rawAsset, expectedProjectId) {
    const model = window.ViralCoreMediaLibraryModel;
    const current = appState();
    if (!model || !current || !rawAsset) return { status: "invalid" };
    if (!expectedProjectId || currentProjectId() !== expectedProjectId) return { status: "project-changed" };
    const count = Array.isArray(current?.media?.assets) ? current.media.assets.length : 0;
    if (count >= Number(model.MAX_PROJECT_ASSETS || 500)) return { status: "capacity" };

    const candidate = {
      ...rawAsset,
      previewUrl: null,
      remoteUrl: null,
      status: "ready",
      fileState: "available",
      progress: 100
    };
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

  function acquisitionState(result) {
    return acquisitions.get(resultIdentity(result)) || null;
  }

  function acquisitionErrorKey(code) {
    const value = String(code || "");
    if (value === "MEDIA_DISK_SPACE_LOW") return "acquisitionDiskBody";
    if (value === "MEDIA_DESTINATION_UNAVAILABLE") return "acquisitionDestinationBody";
    if (value === "MEDIA_SOURCE_UNAVAILABLE") return "acquisitionSourceBody";
    if (value === "MEDIA_VERIFY_FAILED") return "acquisitionVerifyBody";
    if (value === "MEDIA_DOWNLOAD_DUPLICATE") return "acquisitionDuplicateBody";
    if (value === "MEDIA_AUTH_REQUIRED") return "acquisitionAuthBody";
    if (value === "MEDIA_PROJECT_CHANGED") return "acquisitionProjectChangedBody";
    return "acquisitionDownloadBody";
  }

  async function acquireToProject(result) {
    const identity = resultIdentity(result);
    if (!identity || existingIdentity(result)) return;
    if (acquisitions.has(identity)) return;

    const model = window.ViralCoreMediaLibraryModel;
    const current = appState();
    const count = Array.isArray(current?.media?.assets) ? current.media.assets.length : 0;
    if (!model || !current || count >= Number(model.MAX_PROJECT_ASSETS || 500)) {
      renderState("capacity", "libraryFullTitle", "libraryFullBody");
      return;
    }

    const ticket = String(result?.acquisition?.ticket || "").trim();
    const projectId = currentProjectId();
    if (!ticket || !projectId || typeof window.desktopAPI?.acquireMedia !== "function") {
      acquisitions.set(identity, { state: "failed", progress: 0, error: "MEDIA_SOURCE_UNAVAILABLE" });
      renderResults(lastResults);
      return;
    }

    const jobId = requestId("acquire");
    acquisitions.set(identity, { jobId, state: "validating", progress: 0, error: null });
    renderResults(lastResults);

    try {
      const payload = await window.desktopAPI.acquireMedia({ jobId, projectId, ticket });
      const active = acquisitions.get(identity);
      if (!active || active.jobId !== jobId) return;

      if (payload?.ok === false) {
        const code = payload?.error?.code || "MEDIA_DOWNLOAD_FAILED";
        if (code === "MEDIA_CANCELLED") acquisitions.delete(identity);
        else acquisitions.set(identity, { ...active, state: "failed", error: code });
        renderResults(lastResults);
        return;
      }

      const acquired = payload?.data?.asset || payload?.asset || null;
      const outcome = addAcquiredAsset(acquired, projectId);
      if (outcome.status === "project-changed") {
        acquisitions.set(identity, { ...active, state: "failed", error: "MEDIA_PROJECT_CHANGED" });
        renderResults(lastResults);
        return;
      }
      acquisitions.delete(identity);
      if (outcome.status === "capacity") {
        renderState("capacity", "libraryFullTitle", "libraryFullBody");
        return;
      }
      renderResults(lastResults);
    } catch {
      const active = acquisitions.get(identity);
      if (active?.jobId === jobId) {
        acquisitions.set(identity, { ...active, state: "failed", error: "MEDIA_DOWNLOAD_FAILED" });
        renderResults(lastResults);
      }
    }
  }

  function cancelAcquisition(result) {
    const identity = resultIdentity(result);
    const active = acquisitions.get(identity);
    if (!active?.jobId) return;
    acquisitions.set(identity, { ...active, state: "cancelling" });
    renderResults(lastResults);
    if (typeof window.desktopAPI?.cancelMediaAcquisition === "function") {
      Promise.resolve(window.desktopAPI.cancelMediaAcquisition(active.jobId)).catch(() => {});
    }
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
          '<div><span class="core-media-kicker" data-media-kicker></span><h2 id="core-media-discovery-title"></h2><p data-media-desc></p></div>' +
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
      runSearch({ append: false, page: 1 });
    });
    drawer.querySelector("[data-media-results]")?.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest("[data-media-action]") : null;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.mediaAction === "load-more") {
        if (nextPage != null && !loadingMore) runSearch({ append: true, page: nextPage });
        return;
      }
      const index = Number(target.dataset.resultIndex);
      const result = lastResults[index];
      if (!result) return;
      if (target.dataset.mediaAction === "source") {
        const url = result?.attribution?.sourceUrl;
        if (url && typeof window.desktopAPI?.openExternal === "function") window.desktopAPI.openExternal(url);
        return;
      }
      if (target.dataset.mediaAction === "cancel-add") {
        cancelAcquisition(result);
        return;
      }
      if (target.dataset.mediaAction === "add") acquireToProject(result);
    });
    updateCopy(drawer);
    return drawer;
  }

  function updateCopy(drawer) {
    const title = drawer.querySelector("#core-media-discovery-title");
    const desc = drawer.querySelector("[data-media-desc]");
    const kicker = drawer.querySelector("[data-media-kicker]");
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
    if (kicker) kicker.textContent = t("media");
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

  function resetContinuation() {
    nextPage = null;
    searchContext = null;
    loadingMore = false;
  }

  function renderState(kind, titleKey, bodyKey) {
    const drawer = ensureDrawer();
    const root = drawer.querySelector("[data-media-results]");
    const count = drawer.querySelector("[data-media-result-count]");
    currentView = kind;
    lastResults = [];
    resetContinuation();
    if (count) count.textContent = "";
    if (!root) return;
    root.innerHTML =
      '<div class="core-media-state core-media-state-' + esc(kind) + '">' +
        '<span class="core-media-state-icon" aria-hidden="true">' + (kind === "loading" ? "···" : "✦") + '</span>' +
        '<strong>' + esc(t(titleKey)) + '</strong>' +
        '<p>' + esc(t(bodyKey)) + '</p>' +
      '</div>';
  }

  function progressLabel(active) {
    if (!active) return "";
    const value = Math.max(0, Math.min(100, Math.round(Number(active.progress || 0))));
    if (active.state === "failed") return t("failedTitle");
    if (active.state === "cancelling") return tc("common.cancelling");
    if (active.state === "verifying") return tc("common.processing");
    return tc("common.processing") + " · " + value + "%";
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

    const cards = lastResults.map((result, index) => {
      const added = existingIdentity(result);
      const active = acquisitionState(result);
      const preview = result.thumbnailUrl || result.previewUrl || "";
      const creator = result?.attribution?.creatorName || "";
      const provider = providerLabel(result?.provider);
      const sourceIdentity = [provider, creator].filter(Boolean).join(" · ");
      const duration = Number(result?.meta?.duration || 0);
      const meta = [
        result?.meta?.width && result?.meta?.height ? result.meta.width + "×" + result.meta.height : "",
        duration > 0 ? t("duration", { seconds: Math.round(duration) }) : ""
      ].filter(Boolean).join(" · ");
      const working = active && !["failed", "cancelled"].includes(active.state);
      const label = added ? t("addProject") : active ? progressLabel(active) : t("addProject");
      const action = working ? "cancel-add" : "add";
      const disabled = added || (active?.state === "cancelling");
      const progress = active && working ? Math.max(0, Math.min(100, Number(active.progress || 0))) : 0;
      return '<article class="core-media-card' + (working ? ' is-acquiring' : '') + '" data-result-card="' + index + '">' +
        '<div class="core-media-thumb">' + (preview ? '<img src="' + esc(preview) + '" alt="" loading="lazy" />' : '<span>' + esc(t("media")) + '</span>') + '</div>' +
        '<div class="core-media-card-copy"><strong>' + esc(result.name || t(result.kind === "image" ? "images" : "video")) + '</strong>' +
          '<small>' + esc(meta || result?.meta?.orientation || "") + '</small>' +
          (sourceIdentity ? '<em>' + esc(t("sourceBy", { name: sourceIdentity })) + '</em>' : '') +
          (active?.state === "failed" ? '<em class="core-media-acquire-error">' + esc(t(acquisitionErrorKey(active.error))) + '</em>' : '') +
        '</div>' +
        '<div class="core-media-card-actions">' +
          '<button type="button" data-media-action="' + action + '" data-result-index="' + index + '"' + (disabled ? ' disabled' : '') + (added ? ' class="is-added"' : '') + '>' + (added ? "✓" : working ? "×" : "+") + '<span>' + esc(label) + '</span></button>' +
          (result?.attribution?.sourceUrl && provider ? '<button type="button" data-media-action="source" data-result-index="' + index + '" aria-label="' + esc(t("preview") + " — " + provider) + '"><span>' + esc(provider) + '</span>↗</button>' : '') +
        '</div>' +
        (working ? '<div class="core-media-acquire-progress" aria-hidden="true"><span style="width:' + progress + '%"></span></div>' : '') +
      '</article>';
    }).join("");

    const continuation = nextPage != null
      ? '<div class="core-media-continuation"><button type="button" data-media-action="load-more"' + (loadingMore ? ' disabled' : '') + '>' + esc(loadingMore ? t("searching") : tc("dashboard.next")) + '</button></div>'
      : '';
    root.innerHTML = cards + continuation;
  }

  function cancelActiveSearch() {
    const requestIdValue = activeSearchRequestId;
    activeSearchRequestId = null;
    if (requestIdValue && typeof window.desktopAPI?.cancelMediaSearch === "function") {
      Promise.resolve(window.desktopAPI.cancelMediaSearch(requestIdValue)).catch(() => {});
    }
  }

  async function runSearch({ append = false, page = 1 } = {}) {
    const drawer = ensureDrawer();
    const queryEl = drawer.querySelector("[data-media-query]");
    const kindEl = drawer.querySelector("[data-media-kind]");
    const orientationEl = drawer.querySelector("[data-media-orientation]");
    const context = append && searchContext
      ? searchContext
      : {
          query: queryEl instanceof HTMLInputElement ? queryEl.value.trim() : "",
          kind: kindEl instanceof HTMLSelectElement ? kindEl.value : "video",
          orientation: orientationEl instanceof HTMLSelectElement ? orientationEl.value : "any",
          provider: "auto"
        };
    const query = context.query;

    cancelActiveSearch();
    const requestNumber = ++activeRequest;
    const searchRequestId = requestId("search");
    activeSearchRequestId = searchRequestId;
    if (!append) {
      lastResults = [];
      nextPage = null;
      searchContext = context;
      currentView = "validating";
    } else {
      loadingMore = true;
      renderResults(lastResults);
    }

    if (query.length < 2) {
      activeSearchRequestId = null;
      loadingMore = false;
      renderState("empty", "emptyTitle", "emptyBody");
      queryEl?.focus?.();
      return;
    }

    if (typeof window.desktopAPI?.searchMedia !== "function") {
      activeSearchRequestId = null;
      loadingMore = false;
      renderState("unavailable", "unavailableTitle", "unavailableBody");
      return;
    }

    if (!append) renderState("loading", "searching", "emptyBody");
    try {
      const payload = await window.desktopAPI.searchMedia({
        requestId: searchRequestId,
        query,
        kind: context.kind,
        orientation: context.orientation,
        page: Math.max(1, Number(page || 1)),
        perPage: SEARCH_PAGE_SIZE,
        provider: context.provider
      });
      if (requestNumber !== activeRequest) return;
      if (activeSearchRequestId === searchRequestId) activeSearchRequestId = null;
      loadingMore = false;
      if (payload?.ok === false) {
        const code = payload?.error?.code || payload?.code;
        if (append && lastResults.length) {
          renderResults(lastResults);
          return;
        }
        if (code === "MEDIA_CANCELLED") {
          return;
        } else if (code === "MEDIA_AUTH_REQUIRED" || code === "AUTH_REQUIRED") {
          renderState("auth", "signInTitle", "signInBody");
        } else if (["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_NOT_CONFIGURED", "MEDIA_CONFIG_INVALID", "MEDIA_HTTPS_REQUIRED"].includes(code)) {
          renderState("unavailable", "providerUnavailableTitle", "providerUnavailableBody");
        } else if (code === "MEDIA_QUOTA_EXCEEDED") {
          renderState("quota", "quotaTitle", "quotaBody");
        } else {
          renderState("error", "failedTitle", "failedBody");
        }
        return;
      }

      const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      const received = Array.isArray(data?.results) ? data.results : [];
      lastResults = append ? mergeResults(lastResults, received) : mergeResults([], received);
      nextPage = Number.isFinite(Number(data?.nextPage)) && Number(data.nextPage) > 0 ? Number(data.nextPage) : null;
      searchContext = context;
      renderResults(lastResults);
    } catch {
      if (requestNumber !== activeRequest) return;
      if (activeSearchRequestId === searchRequestId) activeSearchRequestId = null;
      loadingMore = false;
      if (append && lastResults.length) renderResults(lastResults);
      else renderState("error", "failedTitle", "failedBody");
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
    cancelActiveSearch();
    currentView = "closed";
    lastResults = [];
    resetContinuation();
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

  if (typeof window.desktopAPI?.onMediaAcquisitionProgress === "function") {
    window.desktopAPI.onMediaAcquisitionProgress(payload => {
      const jobId = String(payload?.jobId || "");
      if (!jobId) return;
      for (const [identity, active] of acquisitions.entries()) {
        if (active?.jobId !== jobId) continue;
        const stateValue = String(payload?.state || active.state || "downloading");
        if (stateValue === "cancelled") acquisitions.delete(identity);
        else acquisitions.set(identity, {
          ...active,
          state: stateValue,
          progress: Math.max(0, Math.min(100, Number(payload?.progress || active.progress || 0))),
          error: payload?.error?.code || active.error || null
        });
        if (document.documentElement.classList.contains("core-media-discovery-open") && currentView === "results" && lastResults.length) {
          renderResults(lastResults);
        }
        break;
      }
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
