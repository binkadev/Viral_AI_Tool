(function installAutomationMetaMuseUi() {
  "use strict";

  let queued = false;
  let busySceneId = null;
  let controller = null;
  let lastProgress = null;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() { return appState()?.locale === 'en' ? 'en' : 'vi'; }

  function copy() {
    return locale() === 'en' ? {
      title: 'Meta Muse',
      eyebrow: 'AI VIDEO · muse.ai',
      ready: 'Connected',
      disconnected: 'Not connected',
      waiting: 'Waiting for sign-in',
      descReady: 'Generate scene footage through your own Muse account. The result is downloaded into this project as a normal local asset.',
      descMissing: 'Muse currently works through your signed-in browser session, not an API key. Open Muse once and sign in with your own Meta account.',
      open: 'Open Muse & sign in',
      refresh: 'Check connection',
      generate: 'Generate this scene with Muse',
      regenerate: 'Regenerate with Muse',
      stock: 'Use stock instead',
      stop: 'Stop',
      generating: 'Muse is generating the scene…',
      downloading: 'Downloading the generated video…',
      done: 'Muse video is ready in the project.',
      loginRequired: 'Open Muse and sign in first.',
      browser: 'Chrome/Edge session',
      noVideo: 'Muse finished without a downloadable video. Try the scene again.',
      failed: 'Muse could not finish this scene.'
    } : {
      title: 'Meta Muse',
      eyebrow: 'AI VIDEO · muse.ai',
      ready: 'Đã kết nối',
      disconnected: 'Chưa kết nối',
      waiting: 'Đang chờ đăng nhập',
      descReady: 'Tạo footage cho từng cảnh bằng chính tài khoản Muse của bạn. Video hoàn tất sẽ được tải về project như một tư liệu local bình thường.',
      descMissing: 'Muse hiện được nối qua phiên đăng nhập trên trình duyệt, không phải API key. Chỉ cần mở Muse một lần và đăng nhập Meta bằng tài khoản của bạn.',
      open: 'Mở Muse & đăng nhập',
      refresh: 'Kiểm tra kết nối',
      generate: 'Tạo cảnh này bằng Muse',
      regenerate: 'Tạo lại bằng Muse',
      stock: 'Dùng stock thay thế',
      stop: 'Dừng',
      generating: 'Muse đang tạo cảnh…',
      downloading: 'Đang tải video Muse về project…',
      done: 'Video Muse đã sẵn sàng trong project.',
      loginRequired: 'Hãy mở Muse và đăng nhập trước.',
      browser: 'Phiên Chrome/Edge',
      noVideo: 'Muse đã trả lời nhưng chưa có video tải được. Hãy thử tạo lại cảnh.',
      failed: 'Muse không thể hoàn tất cảnh này.'
    };
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function status() {
    return window.ViralAutomationMetaMuseStatus || window.ViralAutomationMetaMuseProvider?.getStatus?.() || null;
  }

  function selectedSceneId() {
    const selected = document.querySelector('.automation-asset-nav-item.is-selected[data-asset-scene]');
    if (selected) return String(selected.getAttribute('data-asset-scene') || '');
    return String(window.ViralAutomationAssetState?.requests?.()?.[0]?.sceneId || '');
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

  function notify(message) {
    try { if (typeof toast === 'function') toast(message); } catch {}
  }

  function friendlyError(code) {
    const c = copy();
    if (code === 'LOGIN_REQUIRED' || code === 'PROVIDER_NOT_CONFIGURED') return c.loginRequired;
    if (code === 'MUSE_NO_VIDEO') return c.noVideo;
    if (code === 'CANCELLED') return locale() === 'vi' ? 'Đã dừng tạo video bằng Muse.' : 'Muse generation stopped.';
    return c.failed;
  }

  function progressLabel() {
    const c = copy();
    const phase = String(lastProgress?.phase || '');
    return phase === 'downloading' || phase === 'generated' || phase === 'finalizing' ? c.downloading : c.generating;
  }

  function markup() {
    const c = copy();
    const s = status() || {};
    const sceneId = selectedSceneId();
    const request = requestForScene(sceneId);
    const asset = assetForScene(sceneId);
    const generated = String(request?.strategy || '') === 'generated';
    const ready = s.loggedIn === true && s.composerReady === true;
    const running = Boolean(busySceneId);
    const percent = Math.max(1, Math.min(99, Number(lastProgress?.progress || 1)));
    const stateText = ready ? c.ready : s.browserRunning ? c.waiting : c.disconnected;

    return '<section class="automation-meta-muse-card' + (ready ? ' is-ready' : '') + (running ? ' is-running' : '') + '">' +
      '<div class="automation-meta-muse-head"><div class="automation-meta-muse-brand"><span class="automation-meta-muse-mark">M</span><div><span class="eyebrow">' + esc(c.eyebrow) + '</span><h4>' + esc(c.title) + '</h4><p>' + esc(ready ? c.descReady : c.descMissing) + '</p></div></div><span class="automation-meta-muse-state"><i></i>' + esc(stateText) + '</span></div>' +
      '<div class="automation-meta-muse-actions">' +
        (!ready ? '<button class="button primary" type="button" data-meta-muse-open>' + esc(c.open) + '</button><button class="button ghost" type="button" data-meta-muse-refresh>' + esc(c.refresh) + '</button>' : '') +
        (ready && !running ? '<button class="button primary" type="button" data-meta-muse-generate' + (!sceneId ? ' disabled aria-disabled="true"' : '') + '>' + esc(generated && asset ? c.regenerate : c.generate) + '</button>' + (generated ? '<button class="button ghost" type="button" data-meta-muse-stock>' + esc(c.stock) + '</button>' : '') + '<button class="button ghost" type="button" data-meta-muse-refresh>' + esc(c.refresh) + '</button>' : '') +
        (running ? '<button class="button danger" type="button" data-meta-muse-cancel>' + esc(c.stop) + '</button>' : '') +
      '</div>' +
      (running ? '<div class="automation-meta-muse-progress"><div><span>' + esc(progressLabel()) + '</span><b>' + Math.round(percent) + '%</b></div><i><b style="width:' + percent + '%"></b></i></div>' : '') +
      '<small class="automation-meta-muse-foot">' + esc(c.browser + (s.channel ? ' · ' + s.channel : '')) + '</small>' +
    '</section>';
  }

  function render() {
    queued = false;
    if (appState()?.page !== 'automation') return;
    const panel = document.querySelector('.automation-assets-panel:not(.is-locked)');
    if (!(panel instanceof HTMLElement)) return;
    let mount = panel.querySelector(':scope > .automation-meta-muse-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'automation-meta-muse-mount';
      const summary = panel.querySelector(':scope > .automation-assets-summary');
      if (summary) summary.insertAdjacentElement('afterend', mount);
      else panel.prepend(mount);
    }
    const html = markup();
    if (mount.innerHTML !== html) mount.innerHTML = html;
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  async function refreshStatus() {
    try { await window.ViralAutomationMetaMuseProvider?.refreshStatus?.(); } catch {}
    queueRender();
  }

  async function openMuse() {
    try {
      await window.ViralAutomationMetaMuseProvider?.openLogin?.();
      notify(locale() === 'vi' ? 'Muse đã mở. Đăng nhập Meta trong cửa sổ trình duyệt rồi quay lại tool.' : 'Muse is open. Sign in with Meta, then return to the tool.');
    } catch (error) {
      notify(friendlyError(error?.code));
    }
    queueRender();
  }

  async function generateScene() {
    const sceneId = selectedSceneId();
    if (!sceneId || busySceneId) return;
    busySceneId = sceneId;
    controller = new AbortController();
    lastProgress = { phase: 'preparing', progress: 1 };
    queueRender();
    try {
      const switched = window.ViralAutomationAssetState?.setSceneStrategy?.(sceneId, 'generated');
      if (!switched?.ok) throw Object.assign(new Error(switched?.code || 'ASSET_STRATEGY_UNSUPPORTED'), { code: switched?.code });
      const result = await window.ViralAutomationAssetState?.resolveScene?.(sceneId, { signal: controller.signal });
      if (!result?.ok) throw Object.assign(new Error(result?.message || result?.code || 'META_MUSE_FAILED'), { code: result?.code });
      notify(copy().done);
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    } catch (error) {
      notify(friendlyError(error?.code));
    } finally {
      busySceneId = null;
      controller = null;
      lastProgress = null;
      queueRender();
    }
  }

  function useStock() {
    const sceneId = selectedSceneId();
    if (!sceneId || busySceneId) return;
    const result = window.ViralAutomationAssetState?.setSceneStrategy?.(sceneId, 'stock');
    if (result?.ok) {
      notify(locale() === 'vi' ? 'Cảnh đã chuyển lại về stock.' : 'Scene switched back to stock.');
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    }
    queueRender();
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-meta-muse-open]')) { event.preventDefault(); openMuse(); return; }
    if (target.closest('[data-meta-muse-refresh]')) { event.preventDefault(); refreshStatus(); return; }
    if (target.closest('[data-meta-muse-generate]')) { event.preventDefault(); generateScene(); return; }
    if (target.closest('[data-meta-muse-stock]')) { event.preventDefault(); useStock(); return; }
    if (target.closest('[data-meta-muse-cancel]')) { event.preventDefault(); controller?.abort(); }
  }, true);

  window.addEventListener('viral-ai:automation-meta-muse-status', event => {
    window.ViralAutomationMetaMuseStatus = event.detail || null;
    queueRender();
  });
  window.addEventListener('viral-ai:automation-meta-muse-progress', event => {
    lastProgress = event.detail || null;
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

  window.ViralAutomationMetaMuseUi = { refresh: queueRender, refreshStatus, generateScene };
})();
