(function installAutomationMuseUi() {
  "use strict";

  let queued = false;
  let configOpen = false;
  let busySceneId = null;
  let sceneController = null;
  let batchController = null;
  let batchProgress = null;
  let lastMuseProgress = null;

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
          title: "Muse Video",
          configured: "API configured",
          missing: "Connect Muse Video",
          descReady: "Generate original scene footage through the Muse Video API and keep the downloaded result as a local project asset.",
          descMissing: "Add your Muse Video API key once. The key is encrypted by the desktop app and never exposed to project data.",
          configure: "Configure",
          close: "Close settings",
          apiKey: "API key",
          apiHint: "Create a key in Muse Video → Settings → API Keys.",
          apiEnv: "API key is supplied by the app environment.",
          model: "Video model",
          resolution: "Resolution",
          audio: "Generate model audio when supported",
          save: "Save Muse settings",
          saved: "Muse Video settings saved.",
          secureUnavailable: "Secure OS storage is unavailable. Use MUSE_VIDEO_API_KEY for this machine.",
          scene: "Generate this scene with Muse",
          regenerate: "Regenerate this scene with Muse",
          all: "Generate all scenes with Muse",
          stock: "Use stock for this scene",
          stop: "Stop Muse generation",
          generating: "Generating with Muse…",
          queued: "Muse accepted the task",
          downloading: "Downloading generated video…",
          done: "Muse video is ready in the project.",
          batchTitle: "Generate all scenes with Muse?",
          batchBody: "This can consume Muse credits for every unresolved scene. Scenes are generated sequentially and downloaded into the project cache.",
          batchConfirm: "Generate all",
          batchCancel: "Not now",
          auth: "Muse API key is missing or invalid.",
          quota: "Muse does not have enough credits for this generation.",
          rate: "Muse is busy or rate-limited. Wait a moment and try again.",
          timeout: "Muse took too long to finish this scene. You can retry without losing the rest of the project.",
          rejected: "Muse could not generate this scene. Adjust the scene description or model and try again.",
          cancelled: "Muse generation stopped.",
          strategyGenerated: "Muse generated",
          strategyStock: "Stock",
          credits: "Credits are charged by Muse according to the selected model and duration.",
          modelFallback: "Model"
        }
      : {
          title: "Muse Video",
          configured: "Đã cấu hình API",
          missing: "Kết nối Muse Video",
          descReady: "Tạo footage gốc cho từng cảnh qua Muse Video API rồi tải file về project để tiếp tục dựng và xuất như tư liệu bình thường.",
          descMissing: "Nhập API key Muse một lần. Ứng dụng desktop mã hóa khóa và không ghi khóa vào dữ liệu project.",
          configure: "Cấu hình",
          close: "Đóng cấu hình",
          apiKey: "API key",
          apiHint: "Tạo khóa tại Muse Video → Settings → API Keys.",
          apiEnv: "API key đang được cấp từ biến môi trường của ứng dụng.",
          model: "Model video",
          resolution: "Độ phân giải",
          audio: "Tạo audio của model khi model hỗ trợ",
          save: "Lưu cấu hình Muse",
          saved: "Đã lưu cấu hình Muse Video.",
          secureUnavailable: "Windows Secure Storage chưa sẵn sàng. Hãy dùng MUSE_VIDEO_API_KEY trên máy này.",
          scene: "Tạo cảnh này bằng Muse",
          regenerate: "Tạo lại cảnh này bằng Muse",
          all: "Tạo tất cả cảnh bằng Muse",
          stock: "Dùng stock cho cảnh này",
          stop: "Dừng tạo bằng Muse",
          generating: "Muse đang tạo video…",
          queued: "Muse đã nhận tác vụ",
          downloading: "Đang tải video Muse về project…",
          done: "Video Muse đã sẵn sàng trong project.",
          batchTitle: "Tạo toàn bộ cảnh bằng Muse?",
          batchBody: "Muse sẽ tính credit cho từng cảnh cần tạo. Tool sẽ tạo tuần tự từng cảnh và tải file về cache của project.",
          batchConfirm: "Tạo tất cả",
          batchCancel: "Chưa tạo",
          auth: "API key Muse đang thiếu hoặc không hợp lệ.",
          quota: "Tài khoản Muse không đủ credit cho lần tạo này.",
          rate: "Muse đang bận hoặc bị giới hạn tốc độ. Hãy thử lại sau một lúc.",
          timeout: "Muse xử lý cảnh này quá lâu. Bạn có thể thử lại mà không mất các phần khác của project.",
          rejected: "Muse không thể tạo cảnh này. Hãy chỉnh mô tả cảnh hoặc đổi model rồi thử lại.",
          cancelled: "Đã dừng tạo video bằng Muse.",
          strategyGenerated: "Muse tạo",
          strategyStock: "Stock",
          credits: "Credit được Muse tính theo model và thời lượng đã chọn.",
          modelFallback: "Model"
        };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function museStatus() {
    return window.ViralAutomationMuseStatus || window.ViralAutomationMuseProvider?.getStatus?.() || null;
  }

  function selectedSceneId() {
    const node = document.querySelector('.automation-asset-nav-item.is-selected[data-asset-scene]');
    if (node) return String(node.getAttribute('data-asset-scene') || '');
    const request = window.ViralAutomationAssetState?.requests?.()?.[0];
    return String(request?.sceneId || '');
  }

  function requestForScene(sceneId) {
    return window.ViralAutomationAssetState?.requestForScene?.(sceneId) || null;
  }

  function assetForScene(sceneId) {
    const automation = appState()?.automation;
    const request = requestForScene(sceneId);
    if (!automation || !request) return null;
    const stale = new Set(Array.isArray(automation?.stale?.assets) ? automation.stale.assets.map(String) : []);
    return (Array.isArray(automation.resolvedAssets) ? automation.resolvedAssets : []).find(asset =>
      String(asset?.requestSignature || '') === String(request.requestSignature || '') && !stale.has(String(asset?.id || ''))
    ) || null;
  }

  function modelLabel(status) {
    const modelId = String(status?.config?.model || '');
    const models = Array.isArray(status?.models) ? status.models : [];
    return models.find(item => String(item?.id || '') === modelId)?.label || modelId || copy().modelFallback;
  }

  function modelOptions(status) {
    const current = String(status?.config?.model || '');
    return (Array.isArray(status?.models) ? status.models : []).map(model =>
      '<option value="' + esc(model.id) + '"' + (String(model.id) === current ? ' selected' : '') + '>' + esc(model.label + ' · ' + model.minDuration + '–' + model.maxDuration + 's') + '</option>'
    ).join('');
  }

  function progressText() {
    const c = copy();
    const phase = String(lastMuseProgress?.phase || '');
    if (phase === 'queued' || phase === 'submitting') return c.queued;
    if (phase === 'generated' || phase === 'materializing') return c.downloading;
    return c.generating;
  }

  function friendlyError(code) {
    const c = copy();
    const value = String(code || '');
    if (value === 'AUTH_REQUIRED' || value === 'PROVIDER_NOT_CONFIGURED') return c.auth;
    if (value === 'QUOTA_EXCEEDED') return c.quota;
    if (value === 'RATE_LIMITED') return c.rate;
    if (value === 'PROVIDER_TIMEOUT' || value === 'NETWORK_ERROR') return c.timeout;
    if (value === 'CANCELLED') return c.cancelled;
    return c.rejected;
  }

  function notify(message) {
    try {
      if (typeof toast === 'function') toast(message);
      else window.dispatchEvent(new CustomEvent('viral-ai:toast', { detail: { message } }));
    } catch {}
  }

  async function confirmBatch() {
    const c = copy();
    if (typeof confirmAction === 'function') {
      try {
        return Boolean(await confirmAction({
          title: c.batchTitle,
          body: c.batchBody,
          confirmLabel: c.batchConfirm,
          cancelLabel: c.batchCancel,
          danger: false
        }));
      } catch { return false; }
    }
    return window.confirm(c.batchTitle + '\n\n' + c.batchBody);
  }

  function configMarkup(status) {
    const c = copy();
    const config = status?.config || {};
    const envLocked = config.environmentLocked === true;
    const secureReady = config.secureStorageAvailable !== false;
    return '<div class="automation-muse-config">' +
      '<div class="automation-muse-field span-2"><label>' + esc(c.apiKey) + '</label><input class="input" type="password" autocomplete="off" data-muse-api-key placeholder="sk-••••••••"' + (envLocked ? ' disabled aria-disabled="true"' : '') + '><small>' + esc(envLocked ? c.apiEnv : secureReady ? c.apiHint : c.secureUnavailable) + '</small></div>' +
      '<div class="automation-muse-field"><label>' + esc(c.model) + '</label><select class="select" data-muse-model>' + modelOptions(status) + '</select></div>' +
      '<div class="automation-muse-field"><label>' + esc(c.resolution) + '</label><select class="select" data-muse-resolution><option value="720p"' + (config.resolution !== '1080p' ? ' selected' : '') + '>720p</option><option value="1080p"' + (config.resolution === '1080p' ? ' selected' : '') + '>1080p</option></select></div>' +
      '<label class="automation-muse-check span-2"><input type="checkbox" data-muse-audio' + (config.generateAudio === true ? ' checked' : '') + '><span>' + esc(c.audio) + '</span></label>' +
      '<div class="automation-muse-config-actions span-2"><button class="button primary" type="button" data-muse-save>' + esc(c.save) + '</button></div>' +
    '</div>';
  }

  function cardMarkup() {
    const c = copy();
    const status = museStatus();
    const ready = status?.ready === true;
    const sceneId = selectedSceneId();
    const request = requestForScene(sceneId);
    const asset = assetForScene(sceneId);
    const generated = String(request?.strategy || '') === 'generated';
    const busy = Boolean(busySceneId || batchController);
    const progress = Number(lastMuseProgress?.progress || batchProgress?.percent || 0);

    return '<section class="automation-muse-card ' + (ready ? 'is-ready' : 'is-missing') + (busy ? ' is-running' : '') + '">' +
      '<div class="automation-muse-head"><div class="automation-muse-brand"><span class="automation-muse-mark">M</span><div><span class="eyebrow">AI VIDEO PROVIDER</span><h4>' + esc(c.title) + '</h4><p>' + esc(ready ? c.descReady : c.descMissing) + '</p></div></div>' +
      '<div class="automation-muse-head-actions"><span class="automation-muse-status"><i></i>' + esc(ready ? c.configured + ' · ' + modelLabel(status) : c.missing) + '</span><button class="button ghost" type="button" data-muse-config-toggle>' + esc(configOpen ? c.close : c.configure) + '</button></div></div>' +
      (configOpen || !ready ? configMarkup(status || { config: {}, models: [] }) : '') +
      (ready ? '<div class="automation-muse-actions"><div><strong>' + esc(generated ? c.strategyGenerated : c.strategyStock) + '</strong><span>' + esc(c.credits) + '</span></div><div class="automation-muse-buttons">' +
        (busy
          ? '<button class="button danger" type="button" data-muse-cancel>' + esc(c.stop) + '</button>'
          : '<button class="button primary" type="button" data-muse-scene' + (!sceneId ? ' disabled aria-disabled="true"' : '') + '>' + esc(generated && asset ? c.regenerate : c.scene) + '</button>' +
            '<button class="button ghost" type="button" data-muse-all>' + esc(c.all) + '</button>' +
            (generated ? '<button class="button ghost" type="button" data-muse-stock>' + esc(c.stock) + '</button>' : '')) +
      '</div></div>' : '') +
      (busy ? '<div class="automation-muse-progress"><div><span>' + esc(progressText()) + '</span><b>' + Math.max(0, Math.min(100, Math.round(progress))) + '%</b></div><i><b style="width:' + Math.max(2, Math.min(100, progress)) + '%"></b></i></div>' : '') +
    '</section>';
  }

  function ensureEngineChip() {
    const strip = document.querySelector('.automation-creator > .automation-engine-strip');
    if (!(strip instanceof HTMLElement)) return;
    let chip = strip.querySelector('[data-muse-engine-chip]');
    if (!(chip instanceof HTMLElement)) {
      chip = document.createElement('div');
      chip.className = 'automation-engine-chip';
      chip.dataset.museEngineChip = 'true';
      strip.appendChild(chip);
    }
    const status = museStatus();
    const ready = status?.ready === true;
    chip.classList.toggle('is-ready', ready);
    chip.innerHTML = '<i></i><div><strong>Muse Video</strong><small>' + esc(ready ? (locale() === 'vi' ? 'Đã cấu hình' : 'Configured') : (locale() === 'vi' ? 'Chưa kết nối' : 'Not connected')) + '</small></div>';
  }

  function render() {
    queued = false;
    if (appState()?.page !== 'automation') return;
    const panel = document.querySelector('.automation-assets-panel:not(.is-locked)');
    if (!(panel instanceof HTMLElement)) {
      ensureEngineChip();
      return;
    }
    let mount = panel.querySelector(':scope > .automation-muse-card-mount');
    const html = cardMarkup();
    if (!(mount instanceof HTMLElement)) {
      const summary = panel.querySelector(':scope > .automation-assets-summary');
      const header = panel.querySelector(':scope > .automation-assets-head');
      mount = document.createElement('div');
      mount.className = 'automation-muse-card-mount';
      if (summary) summary.insertAdjacentElement('afterend', mount);
      else if (header) header.insertAdjacentElement('afterend', mount);
      else panel.prepend(mount);
    }
    if (mount.innerHTML !== html) mount.innerHTML = html;
    ensureEngineChip();
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  async function refreshStatus() {
    try { await window.ViralAutomationMuseProvider?.refreshStatus?.(); }
    catch {}
    queueRender();
  }

  async function saveConfig() {
    const status = museStatus();
    const apiKey = document.querySelector('[data-muse-api-key]')?.value || '';
    const model = document.querySelector('[data-muse-model]')?.value || status?.config?.model || '';
    const resolution = document.querySelector('[data-muse-resolution]')?.value || '720p';
    const generateAudio = document.querySelector('[data-muse-audio]')?.checked === true;
    const result = await window.ViralAutomationMuseProvider?.saveConfig?.({ apiKey, model, resolution, generateAudio });
    if (!result?.ok) {
      notify(friendlyError(result?.error?.code));
      return;
    }
    configOpen = false;
    notify(copy().saved);
    await refreshStatus();
  }

  function resetProgress() {
    busySceneId = null;
    batchProgress = null;
    lastMuseProgress = null;
    sceneController = null;
    batchController = null;
    queueRender();
  }

  async function generateScene(sceneId) {
    if (!sceneId || busySceneId || batchController) return;
    busySceneId = sceneId;
    sceneController = new AbortController();
    lastMuseProgress = { phase: 'submitting', progress: 1 };
    queueRender();
    try {
      const switched = window.ViralAutomationAssetState?.setSceneStrategy?.(sceneId, 'generated');
      if (!switched?.ok) throw Object.assign(new Error(switched?.code || 'ASSET_STRATEGY_UNSUPPORTED'), { code: switched?.code });
      const result = await window.ViralAutomationAssetState?.resolveScene?.(sceneId, { signal: sceneController.signal });
      if (!result?.ok) throw Object.assign(new Error(result?.message || result?.code || 'PROVIDER_REJECTED'), { code: result?.code });
      notify(copy().done);
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    } catch (error) {
      notify(friendlyError(error?.code));
    } finally {
      resetProgress();
    }
  }

  async function generateAll() {
    if (busySceneId || batchController) return;
    if (!(await confirmBatch())) return;
    const switched = window.ViralAutomationAssetState?.setAllStrategies?.('generated');
    if (!switched?.ok) {
      notify(friendlyError(switched?.code));
      return;
    }
    batchController = new AbortController();
    batchProgress = { completed: 0, total: switched.requests?.length || 0, percent: 0 };
    queueRender();
    try {
      const result = await window.ViralAutomationAssetState?.resolveAll?.({
        signal: batchController.signal,
        includeResolved: false,
        onProgress: progress => {
          const total = Number(progress?.total || switched.requests?.length || 1);
          const completed = Number(progress?.completed || 0);
          batchProgress = { ...progress, total, completed, percent: total ? completed / total * 100 : 0 };
          queueRender();
        }
      });
      if (!result?.ok) {
        if (result?.code === 'CANCELLED') notify(copy().cancelled);
        else notify(friendlyError(result?.failures?.[0]?.code || result?.code));
      } else {
        notify(copy().done);
      }
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    } finally {
      resetProgress();
    }
  }

  function useStock(sceneId) {
    if (!sceneId || busySceneId || batchController) return;
    const result = window.ViralAutomationAssetState?.setSceneStrategy?.(sceneId, 'stock');
    if (!result?.ok) notify(friendlyError(result?.code));
    else {
      notify(locale() === 'vi' ? 'Cảnh đã chuyển về nguồn stock.' : 'Scene switched back to stock.');
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    }
    queueRender();
  }

  function cancelActive() {
    if (sceneController) sceneController.abort();
    if (batchController) batchController.abort();
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-muse-config-toggle]')) {
      event.preventDefault();
      configOpen = !configOpen;
      queueRender();
      return;
    }
    if (target.closest('[data-muse-save]')) {
      event.preventDefault();
      saveConfig().catch(() => notify(copy().rejected));
      return;
    }
    if (target.closest('[data-muse-scene]')) {
      event.preventDefault();
      generateScene(selectedSceneId());
      return;
    }
    if (target.closest('[data-muse-all]')) {
      event.preventDefault();
      generateAll();
      return;
    }
    if (target.closest('[data-muse-stock]')) {
      event.preventDefault();
      useStock(selectedSceneId());
      return;
    }
    if (target.closest('[data-muse-cancel]')) {
      event.preventDefault();
      cancelActive();
    }
  }, true);

  window.addEventListener('viral-ai:automation-muse-status', event => {
    window.ViralAutomationMuseStatus = event.detail || null;
    queueRender();
  });
  window.addEventListener('viral-ai:automation-muse-progress', event => {
    lastMuseProgress = event.detail || null;
    queueRender();
  });
  window.addEventListener('viral-ai:core-state-changed', queueRender);
  window.addEventListener('viral-ai:navigation-committed', queueRender);

  const start = () => {
    const page = document.getElementById('page');
    if (page) new MutationObserver(queueRender).observe(page, { childList: true, subtree: true });
    refreshStatus().catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.ViralAutomationMuseUi = { refresh: queueRender, refreshStatus, generateScene, generateAll, cancelActive };
})();