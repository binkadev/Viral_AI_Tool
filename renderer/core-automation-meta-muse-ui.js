(function installAutomationMetaMuseUi() {
  "use strict";

  let queued = false;
  let busySceneId = null;
  let controller = null;
  let lastProgress = null;
  let opening = false;
  let connectionError = null;
  let pointerOpenGuardUntil = 0;

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
      opening: 'Opening Muse…',
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
      browserUnavailable: 'Viral AI Tool could not open Chrome or Edge for Muse. Install/update Chrome or Edge, then try again.',
      navigationFailed: 'The browser opened but muse.ai could not load. Check your network and try again.',
      bridgeMissing: 'Muse browser bridge is not ready. Restart Viral AI Tool after running npm install.',
      noVideo: 'Muse finished without a downloadable video. Try the scene again.',
      failed: 'Muse could not finish this scene.'
    } : {
      title: 'Meta Muse',
      eyebrow: 'AI VIDEO · muse.ai',
      ready: 'Đã kết nối',
      disconnected: 'Chưa kết nối',
      waiting: 'Đang chờ đăng nhập',
      opening: 'Đang mở Muse…',
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
      browserUnavailable: 'Viral AI Tool chưa mở được Chrome hoặc Edge cho Muse. Hãy cập nhật/cài Chrome hoặc Edge rồi thử lại.',
      navigationFailed: 'Trình duyệt đã mở nhưng chưa tải được muse.ai. Hãy kiểm tra mạng rồi thử lại.',
      bridgeMissing: 'Bridge Muse chưa sẵn sàng. Hãy chạy npm install rồi khởi động lại Viral AI Tool.',
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

  function friendlyError(code, fallbackMessage = '') {
    const c = copy();
    if (code === 'LOGIN_REQUIRED' || code === 'PROVIDER_NOT_CONFIGURED') return c.loginRequired;
    if (code === 'BROWSER_UNAVAILABLE') return c.browserUnavailable;
    if (code === 'MUSE_NAVIGATION_FAILED') return c.navigationFailed;
    if (code === 'BRIDGE_UNAVAILABLE') return c.bridgeMissing;
    if (code === 'MUSE_NO_VIDEO') return c.noVideo;
    if (code === 'CANCELLED') return locale() === 'vi' ? 'Đã dừng tạo video bằng Muse.' : 'Muse generation stopped.';
    return fallbackMessage || c.failed;
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
    const stateText = opening ? c.opening : ready ? c.ready : s.browserRunning ? c.waiting : c.disconnected;

    return '<section class="automation-meta-muse-card' + (ready ? ' is-ready' : '') + (running || opening ? ' is-running' : '') + '">' +
      '<div class="automation-meta-muse-head"><div class="automation-meta-muse-brand"><span class="automation-meta-muse-mark">M</span><div><span class="eyebrow">' + esc(c.eyebrow) + '</span><h4>' + esc(c.title) + '</h4><p>' + esc(ready ? c.descReady : c.descMissing) + '</p></div></div><span class="automation-meta-muse-state"><i></i>' + esc(stateText) + '</span></div>' +
      '<div class="automation-meta-muse-actions">' +
        (!ready ? '<button class="button primary" type="button" data-meta-muse-open' + (opening ? ' disabled aria-disabled="true"' : '') + '>' + esc(opening ? c.opening : c.open) + '</button><button class="button ghost" type="button" data-meta-muse-refresh' + (opening ? ' disabled aria-disabled="true"' : '') + '>' + esc(c.refresh) + '</button>' : '') +
        (ready && !running ? '<button class="button primary" type="button" data-meta-muse-generate' + (!sceneId ? ' disabled aria-disabled="true"' : '') + '>' + esc(generated && asset ? c.regenerate : c.generate) + '</button>' + (generated ? '<button class="button ghost" type="button" data-meta-muse-stock>' + esc(c.stock) + '</button>' : '') + '<button class="button ghost" type="button" data-meta-muse-refresh>' + esc(c.refresh) + '</button>' : '') +
        (running ? '<button class="button danger" type="button" data-meta-muse-cancel>' + esc(c.stop) + '</button>' : '') +
      '</div>' +
      (connectionError ? '<div class="automation-meta-muse-error"><strong>' + esc(friendlyError(connectionError.code, connectionError.message)) + '</strong>' + (connectionError.message && friendlyError(connectionError.code, connectionError.message) !== connectionError.message ? '<small>' + esc(connectionError.message) + '</small>' : '') + '</div>' : '') +
      (running ? '<div class="automation-meta-muse-progress"><div><span>' + esc(progressLabel()) + '</span><b>' + Math.round(percent) + '%</b></div><i><b style="width:' + percent + '%"></b></i></div>' : '') +
      '<small class="automation-meta-muse-foot">' + esc(c.browser + (s.channel ? ' · ' + s.channel : '') + (s.executablePath ? ' · ' + s.executablePath : '')) + '</small>' +
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
    wireMount(mount);
    const html = markup();
    if (mount.innerHTML !== html) mount.innerHTML = html;
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  async function refreshStatus() {
    if (!window.ViralAutomationMetaMuseProvider?.refreshStatus) {
      connectionError = { code: 'BRIDGE_UNAVAILABLE', message: copy().bridgeMissing };
      queueRender();
      return null;
    }
    try {
      const snapshot = await window.ViralAutomationMetaMuseProvider.refreshStatus();
      if (snapshot?.browserRunning) connectionError = null;
      return snapshot;
    } catch (error) {
      connectionError = { code: error?.code || 'META_MUSE_FAILED', message: error?.message || '' };
      return null;
    } finally {
      queueRender();
    }
  }

  async function openMuse() {
    if (opening) return;
    if (!window.ViralAutomationMetaMuseProvider?.openLogin) {
      connectionError = { code: 'BRIDGE_UNAVAILABLE', message: copy().bridgeMissing };
      notify(connectionError.message);
      queueRender();
      return;
    }
    opening = true;
    connectionError = null;
    queueRender();
    try {
      const snapshot = await window.ViralAutomationMetaMuseProvider.openLogin();
      if (!snapshot?.browserRunning) throw Object.assign(new Error('Muse browser did not start.'), { code: 'BROWSER_UNAVAILABLE' });
      notify(locale() === 'vi' ? 'Muse đã mở. Đăng nhập Meta trong cửa sổ trình duyệt rồi quay lại tool.' : 'Muse is open. Sign in with Meta, then return to the tool.');
    } catch (error) {
      connectionError = { code: error?.code || 'META_MUSE_FAILED', message: error?.message || '' };
      notify(friendlyError(connectionError.code, connectionError.message));
    } finally {
      opening = false;
      queueRender();
    }
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
      notify(friendlyError(error?.code, error?.message || ''));
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

  function handleMountClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-meta-muse-open]')) {
      event.preventDefault();
      if (Date.now() >= pointerOpenGuardUntil) openMuse();
      return;
    }
    if (target.closest('[data-meta-muse-refresh]')) { event.preventDefault(); refreshStatus(); return; }
    if (target.closest('[data-meta-muse-generate]')) { event.preventDefault(); generateScene(); return; }
    if (target.closest('[data-meta-muse-stock]')) { event.preventDefault(); useStock(); return; }
    if (target.closest('[data-meta-muse-cancel]')) { event.preventDefault(); controller?.abort(); }
  }

  function handleMountPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-meta-muse-open]')) return;
    event.preventDefault();
    pointerOpenGuardUntil = Date.now() + 900;
    openMuse();
  }

  function wireMount(mount) {
    if (!(mount instanceof HTMLElement) || mount.dataset.metaMuseWired === '1') return;
    mount.dataset.metaMuseWired = '1';
    mount.addEventListener('pointerdown', handleMountPointerDown, true);
    mount.addEventListener('click', handleMountClick, true);
  }

  window.addEventListener('viral-ai:automation-meta-muse-status', event => {
    window.ViralAutomationMetaMuseStatus = event.detail || null;
    if (event.detail?.browserRunning) connectionError = null;
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

  window.ViralAutomationMetaMuseUi = { refresh: queueRender, refreshStatus, generateScene, openMuse };
})();