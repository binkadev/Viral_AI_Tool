(function installAutomationAssetsUi() {
  "use strict";

  let queued = false;
  let selectedSceneId = null;
  let resolvingSceneId = null;
  let batchController = null;
  let batchProgress = null;
  let healthScanning = false;
  let healthScanKey = "";
  const assetHealth = new Map();

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          eyebrow: "04 · Assets",
          title: "Media requests",
          intro: "Resolve every scene through the configured stock source. Downloaded files remain editable project assets and are verified on reopen.",
          sync: "Prepare requests",
          refresh: "Refresh requests",
          required: "Create and review scenes before preparing media requests.",
          scene: "Scene",
          query: "Search query",
          type: "Media type",
          ratio: "Aspect ratio",
          duration: "Target duration",
          strategy: "Source strategy",
          constraints: "Constraints",
          provider: "Media source",
          providerMissing: "No media source connected",
          providerHint: "Connect Pexels with PEXELS_API_KEY, or enable the development stock provider for offline workflow verification.",
          ready: "Request ready",
          prepared: "Media requests are ready.",
          resolved: "Resolved",
          stale: "Needs refresh",
          missingFile: "Local file missing",
          noRequests: "No media requests yet",
          noRequestsBody: "Prepare requests from the accepted Scene Plan. This does not download media yet.",
          total: "requests",
          find: "Find & download media",
          finding: "Finding media...",
          open: "Show downloaded file",
          recover: "Recover media",
          cacheHit: "Cache reused",
          downloaded: "Downloaded",
          resolveFailed: "Could not resolve media for this scene.",
          resolveAll: "Resolve all scenes",
          resolvingAll: "Resolving assets",
          cancelAll: "Stop",
          allReady: "All scene assets are ready",
          batchPartial: "Some scenes still need attention",
          batchCancelled: "Asset resolution stopped"
        }
      : {
          eyebrow: "04 · Tư liệu",
          title: "Yêu cầu tư liệu",
          intro: "Tìm tư liệu cho từng cảnh qua nguồn stock đã cấu hình. File tải về thuộc project và được kiểm tra lại khi mở project.",
          sync: "Chuẩn hóa yêu cầu",
          refresh: "Làm mới yêu cầu",
          required: "Hãy tạo và kiểm tra phân cảnh trước khi chuẩn bị tư liệu.",
          scene: "Cảnh",
          query: "Từ khóa tìm tư liệu",
          type: "Loại tư liệu",
          ratio: "Tỷ lệ khung hình",
          duration: "Thời lượng mục tiêu",
          strategy: "Chiến lược nguồn",
          constraints: "Ràng buộc",
          provider: "Nguồn tư liệu",
          providerMissing: "Chưa kết nối nguồn tư liệu",
          providerHint: "Có thể dùng Pexels với PEXELS_API_KEY, hoặc bật nguồn stock phát triển để kiểm thử offline.",
          ready: "Yêu cầu sẵn sàng",
          prepared: "Đã chuẩn bị yêu cầu tư liệu.",
          resolved: "Đã có tư liệu",
          stale: "Cần làm mới",
          missingFile: "File cục bộ bị thiếu",
          noRequests: "Chưa có yêu cầu tư liệu",
          noRequestsBody: "Chuẩn hóa yêu cầu từ Scene Plan đã chốt. Bước này chưa tải media.",
          total: "yêu cầu",
          find: "Tìm & tải tư liệu",
          finding: "Đang tìm tư liệu...",
          open: "Mở file đã tải",
          recover: "Khôi phục tư liệu",
          cacheHit: "Đã dùng lại cache",
          downloaded: "Đã tải về",
          resolveFailed: "Không thể tìm tư liệu phù hợp cho cảnh này.",
          resolveAll: "Tải tư liệu cho tất cả cảnh",
          resolvingAll: "Đang xử lý tư liệu",
          cancelAll: "Dừng",
          allReady: "Tất cả cảnh đã có tư liệu",
          batchPartial: "Một số cảnh vẫn cần xử lý",
          batchCancelled: "Đã dừng xử lý tư liệu"
        };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function automation() {
    return appState()?.automation || null;
  }

  function requests() {
    const list = automation()?.assetRequests;
    return Array.isArray(list) ? list : [];
  }

  function staleAssetIds() {
    return new Set(Array.isArray(automation()?.stale?.assets) ? automation().stale.assets.map(String) : []);
  }

  function assetRecordFor(request) {
    const assets = Array.isArray(automation()?.resolvedAssets) ? automation().resolvedAssets : [];
    return assets.find(asset => String(asset?.requestSignature || "") === String(request?.requestSignature || "")) || null;
  }

  function assetStateFor(request) {
    const asset = assetRecordFor(request);
    if (!asset) return { asset: null, state: "ready" };
    const health = assetHealth.get(String(asset.id || ""));
    if (health === "missing") return { asset, state: "missing" };
    if (staleAssetIds().has(String(asset.id || ""))) return { asset, state: "stale" };
    return { asset, state: "resolved" };
  }

  function resolvedAssetFor(request) {
    const result = assetStateFor(request);
    return result.state === "resolved" ? result.asset : null;
  }

  function stockStatus() {
    return window.ViralAutomationStockStatus || null;
  }

  function readyProviders() {
    const list = Array.isArray(stockStatus()?.providers) ? stockStatus().providers : [];
    return list.filter(item => item?.ready === true);
  }

  function completion() {
    const list = requests();
    let resolved = 0;
    for (const request of list) if (resolvedAssetFor(request)) resolved += 1;
    return { total: list.length, resolved, missing: Math.max(0, list.length - resolved), complete: list.length > 0 && resolved === list.length };
  }

  function ensureSelection(list = requests()) {
    if (!list.length) {
      selectedSceneId = null;
      return null;
    }
    if (!selectedSceneId || !list.some(request => request.sceneId === selectedSceneId)) selectedSceneId = list[0].sceneId;
    return list.find(request => request.sceneId === selectedSceneId) || list[0];
  }

  function ensureHost() {
    const creator = document.querySelector(".automation-creator");
    if (!(creator instanceof HTMLElement)) return null;
    let host = creator.querySelector(":scope > .automation-assets-host");
    if (host instanceof HTMLElement) return host;
    host = document.createElement("div");
    host.className = "automation-assets-host";
    host.dataset.assetRouterMount = "true";
    const scenes = creator.querySelector(":scope > .automation-scenes-host");
    if (scenes instanceof HTMLElement) scenes.insertAdjacentElement("afterend", host);
    else creator.appendChild(host);
    return host;
  }

  function healthSignature() {
    return (Array.isArray(automation()?.resolvedAssets) ? automation().resolvedAssets : [])
      .map(asset => [asset?.id, asset?.localPath].join("@"))
      .sort()
      .join("|");
  }

  async function validateAssetHealth({ force = false } = {}) {
    const key = healthSignature();
    if (!key) {
      assetHealth.clear();
      healthScanKey = "";
      return;
    }
    if (healthScanning || (!force && key === healthScanKey)) return;
    healthScanning = true;
    healthScanKey = key;
    try {
      const result = await window.ViralAutomationAssetState?.validateLocalAssets?.();
      const missing = new Set(Array.isArray(result?.missing) ? result.missing.map(String) : []);
      const available = new Set(Array.isArray(result?.available) ? result.available.map(String) : []);
      for (const id of missing) assetHealth.set(id, "missing");
      for (const id of available) assetHealth.set(id, "available");
    } finally {
      healthScanning = false;
      render({ force: true });
    }
  }

  function signature() {
    const current = automation();
    return JSON.stringify({
      locale: locale(),
      plan: current?.scenePlan?.outputSignature || null,
      selectedSceneId,
      resolvingSceneId,
      batch: batchProgress,
      requests: requests().map(request => ({ id: request.id, sceneId: request.sceneId, signature: request.requestSignature })),
      assets: (Array.isArray(current?.resolvedAssets) ? current.resolvedAssets : []).map(asset => ({ id: asset.id, signature: asset.requestSignature, localPath: asset.localPath, health: assetHealth.get(String(asset.id || "")) || "unknown" })),
      stale: current?.stale?.assets || [],
      providers: (Array.isArray(stockStatus()?.providers) ? stockStatus().providers : []).map(provider => ({ id: provider.id, ready: provider.ready }))
    });
  }

  function stateLabel(state, resolving) {
    const c = copy();
    if (resolving) return c.finding;
    if (state === "resolved") return c.resolved;
    if (state === "missing") return c.missingFile;
    if (state === "stale") return c.stale;
    return c.ready;
  }

  function navItem(request, index, selected) {
    const result = assetStateFor(request);
    const resolving = resolvingSceneId === request.sceneId;
    const stateClass = result.state === "resolved" ? "is-resolved" : result.state === "missing" ? "is-missing" : result.state === "stale" ? "is-stale" : "";
    return '<button class="automation-asset-nav-item' + (selected ? ' is-selected' : '') + '" type="button" data-asset-scene="' + esc(request.sceneId) + '">' +
      '<span class="automation-asset-nav-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="automation-asset-nav-copy"><b>' + esc(copy().scene) + ' ' + (index + 1) + '</b><small>' + esc(request.desiredDurationSec) + 's · ' + esc(request.aspectRatio) + '</small><em>' + esc(request.query) + '</em></span>' +
      '<span class="automation-asset-nav-state ' + stateClass + '">' + esc(stateLabel(result.state, resolving)) + '</span>' +
    '</button>';
  }

  function inspector(request, index) {
    const c = copy();
    const result = assetStateFor(request);
    const asset = result.asset;
    const healthyAsset = result.state === "resolved" ? asset : null;
    const providers = readyProviders();
    const providerText = asset?.provider || providers.map(provider => provider.id).join(", ") || c.providerMissing;
    const constraints = Array.isArray(request.negativeConstraints) && request.negativeConstraints.length
      ? request.negativeConstraints.join(", ")
      : "—";
    const resolving = resolvingSceneId === request.sceneId;
    let action = "";
    if (healthyAsset) {
      action = '<button class="button primary" type="button" data-asset-open="' + esc(healthyAsset.localPath) + '">' + esc(c.open) + '</button>';
    } else {
      const label = result.state === "missing" || result.state === "stale" ? c.recover : c.find;
      action = '<button class="button primary" type="button" data-asset-resolve="' + esc(request.sceneId) + '"' + (providers.length && !resolving && !batchController ? '' : ' disabled aria-disabled="true"') + '>' + esc(resolving ? c.finding : providers.length ? label : c.providerMissing) + '</button>';
    }
    const assetMeta = asset
      ? '<div class="automation-asset-resolved ' + (result.state !== "resolved" ? 'is-unhealthy' : '') + '"><span>' + esc(result.state === "missing" ? c.missingFile : result.state === "stale" ? c.stale : asset.cacheKey ? c.downloaded : c.resolved) + '</span><strong>' + esc(asset.localPath) + '</strong><small>' + esc([asset.provider, asset.attribution, asset.license].filter(Boolean).join(' · ')) + '</small></div>'
      : '';

    return '<section class="automation-asset-inspector">' +
      '<header class="automation-asset-inspector-head"><div><div class="eyebrow">' + esc(c.scene) + ' ' + (index + 1) + '</div><h4>' + esc(request.query) + '</h4><p>' + esc(request.requestSignature) + '</p></div><span class="automation-asset-status ' + (result.state === "resolved" ? 'is-resolved' : result.state === "missing" ? 'is-missing' : result.state === "stale" ? 'is-stale' : '') + '">' + esc(stateLabel(result.state, resolving)) + '</span></header>' +
      '<div class="automation-asset-spec-grid">' +
        '<div class="automation-asset-spec span-2"><span>' + esc(c.query) + '</span><strong>' + esc(request.query) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.type) + '</span><strong>' + esc(request.mediaType) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.ratio) + '</span><strong>' + esc(request.aspectRatio) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.duration) + '</span><strong>' + esc(request.desiredDurationSec) + 's</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.strategy) + '</span><strong>' + esc(request.strategy) + '</strong></div>' +
        '<div class="automation-asset-spec span-2"><span>' + esc(c.constraints) + '</span><strong>' + esc(constraints) + '</strong></div>' +
      '</div>' +
      assetMeta +
      '<div class="automation-asset-provider-state"><div><span>' + esc(c.provider) + '</span><b>' + esc(providerText) + '</b><p>' + esc(c.providerHint) + '</p></div>' + action + '</div>' +
    '</section>';
  }

  function batchMarkup(list) {
    const c = copy();
    const progress = batchProgress;
    const done = completion();
    const providers = readyProviders();
    if (!list.length) return "";
    if (batchController) {
      const completed = Number(progress?.completed || 0);
      const total = Number(progress?.total || list.length);
      const percent = total ? Math.round((completed / total) * 100) : 0;
      return '<div class="automation-assets-batch is-running"><div><b>' + esc(c.resolvingAll) + '</b><span>' + completed + '/' + total + ' · ' + percent + '%</span><div class="automation-assets-batch-bar"><i style="width:' + percent + '%"></i></div></div><button class="button ghost" type="button" data-asset-cancel-all>' + esc(c.cancelAll) + '</button></div>';
    }
    if (done.complete) {
      return '<div class="automation-assets-batch is-complete"><div><b>' + esc(c.allReady) + '</b><span>' + done.resolved + '/' + done.total + '</span></div><button class="button ghost" type="button" data-asset-validate>' + esc(c.refresh) + '</button></div>';
    }
    return '<div class="automation-assets-batch"><div><b>' + done.resolved + '/' + done.total + ' ' + esc(c.resolved.toLowerCase()) + '</b><span>' + done.missing + ' ' + esc(c.total) + ' ' + esc(c.ready.toLowerCase()) + '</span></div><button class="button primary" type="button" data-asset-resolve-all' + (providers.length ? '' : ' disabled aria-disabled="true"') + '>' + esc(providers.length ? c.resolveAll : c.providerMissing) + '</button></div>';
  }

  function markup() {
    const c = copy();
    const current = automation();
    if (!current?.scenePlan || current?.stale?.scenes === true) {
      return '<section class="automation-assets-panel is-locked"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.required) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(c.sync) + '</button></section>';
    }

    const list = requests();
    const selected = ensureSelection(list);
    const selectedIndex = selected ? list.findIndex(request => request.sceneId === selected.sceneId) : -1;
    return '<section class="automation-assets-panel">' +
      '<header class="automation-assets-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationSyncAssetRequests" class="button ghost" type="button"' + (batchController ? ' disabled aria-disabled="true"' : '') + '>' + esc(list.length ? c.refresh : c.sync) + '</button></header>' +
      (list.length
        ? '<div class="automation-assets-summary"><b>' + list.length + ' ' + esc(c.total) + '</b><span>provider-neutral</span><span>stock-first</span><span>' + esc(readyProviders().length ? readyProviders().map(item => item.id).join(', ') : c.providerMissing) + '</span></div>' + batchMarkup(list) + '<div class="automation-assets-workbench"><aside class="automation-assets-nav">' + list.map((request, index) => navItem(request, index, request.sceneId === selected?.sceneId)).join("") + '</aside>' + (selected ? inspector(selected, selectedIndex) : '') + '</div>'
        : '<div class="automation-assets-empty"><div class="automation-assets-empty-icon">04</div><div><h4>' + esc(c.noRequests) + '</h4><p>' + esc(c.noRequestsBody) + '</p><button id="automationSyncAssetRequestsEmpty" class="button primary" type="button">' + esc(c.sync) + '</button></div></div>') +
    '</section>';
  }

  function render({ force = false } = {}) {
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    ensureSelection();
    const next = signature();
    if (!force && host.dataset.assetUiSignature === next) return;
    host.dataset.assetUiSignature = next;
    const html = markup();
    if (host.innerHTML !== html) host.innerHTML = html;
    validateAssetHealth().catch(() => {});
  }

  function sync() {
    const result = window.ViralAutomationAssetState?.syncRequests?.();
    if (result?.ok) {
      selectedSceneId = result.requests?.[0]?.sceneId || selectedSceneId;
      healthScanKey = "";
      render({ force: true });
      try { if (typeof toast === "function") toast(copy().prepared); } catch {}
    }
  }

  async function resolveScene(sceneId) {
    if (!sceneId || resolvingSceneId || batchController) return;
    resolvingSceneId = sceneId;
    render({ force: true });
    try {
      const result = await window.ViralAutomationAssetState?.resolveScene?.(sceneId);
      if (!result?.ok) {
        try { if (typeof toast === "function") toast(copy().resolveFailed); } catch {}
      } else {
        healthScanKey = "";
        await validateAssetHealth({ force: true });
      }
    } finally {
      resolvingSceneId = null;
      render({ force: true });
      window.ViralAutomationDesktopStockProvider?.refreshStatus?.().catch?.(() => {});
    }
  }

  async function resolveAll() {
    if (batchController || !readyProviders().length) return;
    batchController = new AbortController();
    batchProgress = { completed: 0, total: requests().length, resolved: 0, skipped: 0, state: "starting" };
    render({ force: true });
    try {
      const result = await window.ViralAutomationAssetState?.resolveAll?.({
        signal: batchController.signal,
        onProgress: progress => {
          batchProgress = progress;
          resolvingSceneId = progress?.state === "resolving" ? progress.sceneId : null;
          if (progress?.sceneId) selectedSceneId = progress.sceneId;
          render({ force: true });
        }
      });
      if (result?.code === "CANCELLED") {
        try { if (typeof toast === "function") toast(copy().batchCancelled); } catch {}
      } else if (!result?.ok) {
        try { if (typeof toast === "function") toast(copy().batchPartial); } catch {}
      } else {
        try { if (typeof toast === "function") toast(copy().allReady); } catch {}
      }
      healthScanKey = "";
      await validateAssetHealth({ force: true });
    } finally {
      batchController = null;
      batchProgress = null;
      resolvingSceneId = null;
      render({ force: true });
      window.ViralAutomationDesktopStockProvider?.refreshStatus?.().catch?.(() => {});
    }
  }

  function cancelAll() {
    if (!batchController) return;
    try { batchController.abort(); } catch {}
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (appState()?.page !== "automation") return;
      render();
    });
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#automationSyncAssetRequests, #automationSyncAssetRequestsEmpty")) {
      event.preventDefault();
      sync();
      return;
    }
    if (target.closest("[data-asset-resolve-all]")) {
      event.preventDefault();
      resolveAll();
      return;
    }
    if (target.closest("[data-asset-cancel-all]")) {
      event.preventDefault();
      cancelAll();
      return;
    }
    if (target.closest("[data-asset-validate]")) {
      event.preventDefault();
      healthScanKey = "";
      validateAssetHealth({ force: true }).catch(() => {});
      return;
    }
    const resolve = target.closest("[data-asset-resolve]");
    if (resolve) {
      event.preventDefault();
      resolveScene(resolve.getAttribute("data-asset-resolve"));
      return;
    }
    const open = target.closest("[data-asset-open]");
    if (open) {
      event.preventDefault();
      const localPath = open.getAttribute("data-asset-open");
      if (localPath) window.desktopAPI?.showFile?.(localPath).catch?.(() => {});
      return;
    }
    const scene = target.closest("[data-asset-scene]");
    if (scene) {
      event.preventDefault();
      const id = scene.getAttribute("data-asset-scene");
      if (id && id !== selectedSceneId) {
        selectedSceneId = id;
        render({ force: true });
      }
    }
  }, true);

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);
  window.addEventListener("viral-ai:automation-stock-status", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
    document.documentElement.dataset.automationAssetRouter = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationAssetsUi = { refresh: queue, render, resolveAll, validateAssetHealth };
})();
