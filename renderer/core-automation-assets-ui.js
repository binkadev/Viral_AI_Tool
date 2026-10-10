(function installAutomationAssetsUi() {
  "use strict";

  let queued = false;
  let selectedSceneId = null;

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
          intro: "Each scene is converted into a provider-neutral media request before any stock or AI provider is called.",
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
          providerHint: "The router is ready. A stock provider can be connected without changing this project model.",
          ready: "Request ready",
          prepared: "Media requests are ready.",
          resolved: "Resolved",
          stale: "Needs refresh",
          noRequests: "No media requests yet",
          noRequestsBody: "Prepare requests from the accepted Scene Plan. This does not download media yet.",
          total: "requests"
        }
      : {
          eyebrow: "04 · Tư liệu",
          title: "Yêu cầu tư liệu",
          intro: "Mỗi cảnh được chuẩn hóa thành một yêu cầu media độc lập trước khi gọi bất kỳ nguồn stock hay AI nào.",
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
          providerHint: "Router đã sẵn sàng. Có thể nối nguồn stock mà không cần đổi cấu trúc dự án.",
          ready: "Yêu cầu sẵn sàng",
          prepared: "Đã chuẩn bị yêu cầu tư liệu.",
          resolved: "Đã có tư liệu",
          stale: "Cần làm mới",
          noRequests: "Chưa có yêu cầu tư liệu",
          noRequestsBody: "Chuẩn hóa yêu cầu từ Scene Plan đã chốt. Bước này chưa tải media.",
          total: "yêu cầu"
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

  function resolvedAssetFor(request) {
    const assets = Array.isArray(automation()?.resolvedAssets) ? automation().resolvedAssets : [];
    return assets.find(asset => String(asset?.requestSignature || "") === String(request?.requestSignature || "")) || null;
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

  function signature() {
    const current = automation();
    return JSON.stringify({
      locale: locale(),
      plan: current?.scenePlan?.outputSignature || null,
      selectedSceneId,
      requests: requests().map(request => ({ id: request.id, sceneId: request.sceneId, signature: request.requestSignature })),
      assets: (Array.isArray(current?.resolvedAssets) ? current.resolvedAssets : []).map(asset => ({ id: asset.id, signature: asset.requestSignature })),
      stale: current?.stale?.assets || [],
      providers: window.ViralAutomationAssetState?.snapshot?.()?.router?.providers?.map(provider => provider.id) || []
    });
  }

  function navItem(request, index, selected) {
    const c = copy();
    const asset = resolvedAssetFor(request);
    return '<button class="automation-asset-nav-item' + (selected ? ' is-selected' : '') + '" type="button" data-asset-scene="' + esc(request.sceneId) + '">' +
      '<span class="automation-asset-nav-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="automation-asset-nav-copy"><b>' + esc(c.scene) + ' ' + (index + 1) + '</b><small>' + esc(request.desiredDurationSec) + 's · ' + esc(request.aspectRatio) + '</small><em>' + esc(request.query) + '</em></span>' +
      '<span class="automation-asset-nav-state ' + (asset ? 'is-resolved' : '') + '">' + esc(asset ? c.resolved : c.ready) + '</span>' +
    '</button>';
  }

  function inspector(request, index) {
    const c = copy();
    const asset = resolvedAssetFor(request);
    const providers = window.ViralAutomationAssetState?.snapshot?.()?.router?.providers || [];
    const providerText = asset?.provider || providers.map(provider => provider.id).join(", ") || c.providerMissing;
    const constraints = Array.isArray(request.negativeConstraints) && request.negativeConstraints.length
      ? request.negativeConstraints.join(", ")
      : "—";
    return '<section class="automation-asset-inspector">' +
      '<header class="automation-asset-inspector-head"><div><div class="eyebrow">' + esc(c.scene) + ' ' + (index + 1) + '</div><h4>' + esc(request.query) + '</h4><p>' + esc(request.requestSignature) + '</p></div><span class="automation-asset-status' + (asset ? ' is-resolved' : '') + '">' + esc(asset ? c.resolved : c.ready) + '</span></header>' +
      '<div class="automation-asset-spec-grid">' +
        '<div class="automation-asset-spec span-2"><span>' + esc(c.query) + '</span><strong>' + esc(request.query) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.type) + '</span><strong>' + esc(request.mediaType) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.ratio) + '</span><strong>' + esc(request.aspectRatio) + '</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.duration) + '</span><strong>' + esc(request.desiredDurationSec) + 's</strong></div>' +
        '<div class="automation-asset-spec"><span>' + esc(c.strategy) + '</span><strong>' + esc(request.strategy) + '</strong></div>' +
        '<div class="automation-asset-spec span-2"><span>' + esc(c.constraints) + '</span><strong>' + esc(constraints) + '</strong></div>' +
      '</div>' +
      '<div class="automation-asset-provider-state"><div><span>' + esc(c.provider) + '</span><b>' + esc(providerText) + '</b><p>' + esc(c.providerHint) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(c.providerMissing) + '</button></div>' +
    '</section>';
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
      '<header class="automation-assets-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationSyncAssetRequests" class="button primary" type="button">' + esc(list.length ? c.refresh : c.sync) + '</button></header>' +
      (list.length
        ? '<div class="automation-assets-summary"><b>' + list.length + ' ' + esc(c.total) + '</b><span>provider-neutral</span><span>stock-first</span></div><div class="automation-assets-workbench"><aside class="automation-assets-nav">' + list.map((request, index) => navItem(request, index, request.sceneId === selected?.sceneId)).join("") + '</aside>' + (selected ? inspector(selected, selectedIndex) : '') + '</div>'
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
  }

  function sync() {
    const result = window.ViralAutomationAssetState?.syncRequests?.();
    if (result?.ok) {
      selectedSceneId = result.requests?.[0]?.sceneId || selectedSceneId;
      render({ force: true });
      try { if (typeof toast === "function") toast(copy().prepared); } catch {}
    }
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

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
    document.documentElement.dataset.automationAssetRouter = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationAssetsUi = { refresh: queue, render };
})();