(function installAutomationMetaMuseUi() {
  "use strict";

  let queued = false;
  let busySceneId = null;
  let controller = null;
  let lastProgress = null;
  let connectionError = null;
  let refreshTimer = null;

  function appState() { try { return typeof state !== "undefined" ? state : null; } catch { return null; } }
  function locale() { return appState()?.locale === 'en' ? 'en' : 'vi'; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function status() { return window.ViralAutomationMetaMuseStatus || window.ViralAutomationMetaMuseProvider?.getStatus?.() || null; }
  function notify(message) { try { if (typeof toast === 'function') toast(message); } catch {} }

  function copy() {
    return locale() === 'en' ? {
      title:'Meta Muse',eyebrow:'AI VIDEO · muse.ai',ready:'Connected',disconnected:'Chrome bridge not connected',choose:'Choose Muse session',waiting:'Muse tab needs sign-in',
      descReady:'Uses the Muse tab already signed in inside your current Chrome profile. No account cookies or passwords are copied into Viral AI Tool.',
      descMissing:'Install the Viral AI Muse Bridge extension in the Chrome profile you want to use, then keep a muse.ai tab open in that profile.',
      install:'Open extension folder',open:'Open Muse',refresh:'Check connection',generate:'Generate this scene with Muse',regenerate:'Regenerate with Muse',stock:'Use stock instead',stop:'Stop',
      installHint:'Chrome → chrome://extensions → Developer mode → Load unpacked → choose the folder opened by Viral AI Tool.',session:'Muse session',noSessions:'No Chrome profile with the bridge extension is connected yet.',
      generating:'Muse is generating the scene…',downloading:'Downloading the generated video…',done:'Muse video is ready in the project.',loginRequired:'Open muse.ai in the selected Chrome profile and sign in first.',
      sessionRequired:'Choose which Chrome profile / Muse tab to use.',extensionMissing:'The Chrome bridge extension is not connected.',noVideo:'Muse finished without a downloadable video.',failed:'Muse could not finish this scene.'
    } : {
      title:'Meta Muse',eyebrow:'AI VIDEO · muse.ai',ready:'Đã kết nối',disconnected:'Chưa nối Chrome',choose:'Chọn phiên Muse',waiting:'Tab Muse cần đăng nhập',
      descReady:'Dùng chính tab Muse đã đăng nhập trong profile Chrome hiện tại của bạn. Tool không sao chép cookie, mật khẩu hay token tài khoản Meta.',
      descMissing:'Cài tiện ích Viral AI Muse Bridge vào đúng profile Chrome muốn dùng, sau đó giữ một tab muse.ai đang mở trong profile đó.',
      install:'Mở thư mục tiện ích',open:'Mở Muse',refresh:'Kiểm tra kết nối',generate:'Tạo cảnh này bằng Muse',regenerate:'Tạo lại bằng Muse',stock:'Dùng stock thay thế',stop:'Dừng',
      installHint:'Chrome → chrome://extensions → bật Chế độ dành cho nhà phát triển → Tải tiện ích đã giải nén → chọn thư mục Viral AI Tool vừa mở.',session:'Phiên Muse',noSessions:'Chưa có profile Chrome nào chạy tiện ích bridge.',
      generating:'Muse đang tạo cảnh…',downloading:'Đang tải video Muse về project…',done:'Video Muse đã sẵn sàng trong project.',loginRequired:'Hãy mở muse.ai trong đúng profile Chrome đã chọn và đăng nhập trước.',
      sessionRequired:'Hãy chọn profile Chrome / tab Muse muốn dùng.',extensionMissing:'Tiện ích Chrome bridge chưa kết nối.',noVideo:'Muse đã trả lời nhưng chưa có video tải được.',failed:'Muse không thể hoàn tất cảnh này.'
    };
  }

  function selectedSceneId() {
    const selected = document.querySelector('.automation-asset-nav-item.is-selected[data-asset-scene]');
    if (selected) return String(selected.getAttribute('data-asset-scene') || '');
    return String(window.ViralAutomationAssetState?.requests?.()?.[0]?.sceneId || '');
  }

  function requestForScene(sceneId) { return window.ViralAutomationAssetState?.requestForScene?.(sceneId) || null; }

  function assetForScene(sceneId) {
    const automation = appState()?.automation;
    const request = requestForScene(sceneId);
    if (!automation || !request) return null;
    const stale = new Set(Array.isArray(automation?.stale?.assets) ? automation.stale.assets.map(String) : []);
    return (Array.isArray(automation.resolvedAssets) ? automation.resolvedAssets : []).find(asset =>
      String(asset?.requestSignature || '') === String(request.requestSignature || '') && !stale.has(String(asset?.id || ''))
    ) || null;
  }

  function friendlyError(code, fallback = '') {
    const c = copy();
    if (code === 'LOGIN_REQUIRED') return c.loginRequired;
    if (['MUSE_SESSION_REQUIRED','MUSE_SESSION_NOT_FOUND','MUSE_TAB_NOT_FOUND'].includes(code)) return c.sessionRequired;
    if (['EXTENSION_DISCONNECTED','BRIDGE_UNAVAILABLE'].includes(code)) return c.extensionMissing;
    if (code === 'MUSE_NO_VIDEO') return c.noVideo;
    if (code === 'CANCELLED') return locale() === 'vi' ? 'Đã dừng tạo video bằng Muse.' : 'Muse generation stopped.';
    return fallback || c.failed;
  }

  function progressLabel() {
    const c = copy();
    const phase = String(lastProgress?.phase || '');
    return ['downloading','generated','finalizing'].includes(phase) ? c.downloading : c.generating;
  }

  function sessionOptions(snapshot) {
    const selected = snapshot?.selectedSession || null;
    const options = [];
    for (const session of Array.isArray(snapshot?.sessions) ? snapshot.sessions : []) {
      for (const tab of Array.isArray(session.tabs) ? session.tabs : []) {
        const value = `${session.instanceId}|${tab.tabId}`;
        const active = selected && selected.instanceId === session.instanceId && Number(selected.tabId) === Number(tab.tabId);
        const tabState = tab.composerReady ? (locale() === 'vi' ? 'sẵn sàng' : 'ready') : (locale() === 'vi' ? 'cần đăng nhập' : 'sign in');
        const label = `${session.browserName || 'Chrome'} · ${session.profileLabel || 'Profile'} · ${tab.title || 'Muse'} · ${tabState}`;
        options.push(`<option value="${esc(value)}"${active ? ' selected' : ''}>${esc(label)}</option>`);
      }
    }
    return options.join('');
  }

  function markup() {
    const c = copy();
    const s = status() || {};
    const sceneId = selectedSceneId();
    const request = requestForScene(sceneId);
    const asset = assetForScene(sceneId);
    const generated = String(request?.strategy || '') === 'generated';
    const ready = s.extensionConnected === true && s.loggedIn === true && s.composerReady === true;
    const running = Boolean(busySceneId);
    const percent = Math.max(1, Math.min(99, Number(lastProgress?.progress || 1)));
    const options = sessionOptions(s);
    const stateText = ready ? c.ready : s.requiresSelection ? c.choose : s.extensionConnected ? c.waiting : c.disconnected;
    const selectedLabel = s.selectedSession ? `${s.selectedSession.browserName || 'Chrome'} · ${s.selectedSession.profileLabel || ''} · ${s.selectedSession.title || 'Muse'}` : (s.extensionPath || '');

    return '<section class="automation-meta-muse-card' + (ready ? ' is-ready' : '') + (running ? ' is-running' : '') + '">' +
      '<div class="automation-meta-muse-head"><div class="automation-meta-muse-brand"><span class="automation-meta-muse-mark">M</span><div><span class="eyebrow">' + esc(c.eyebrow) + '</span><h4>' + esc(c.title) + '</h4><p>' + esc(ready ? c.descReady : c.descMissing) + '</p></div></div><span class="automation-meta-muse-state"><i></i>' + esc(stateText) + '</span></div>' +
      (options ? '<div class="automation-meta-muse-session"><label>' + esc(c.session) + '</label><select class="select" data-meta-muse-session><option value="">— ' + esc(c.choose) + ' —</option>' + options + '</select></div>' : '<div class="automation-meta-muse-install-note">' + esc(c.noSessions) + '<small>' + esc(c.installHint) + '</small></div>') +
      '<div class="automation-meta-muse-actions">' +
        (!s.extensionConnected ? '<button class="button primary" type="button" data-meta-muse-install>' + esc(c.install) + '</button>' : '') +
        '<button class="button ghost" type="button" data-meta-muse-open>' + esc(c.open) + '</button>' +
        '<button class="button ghost" type="button" data-meta-muse-refresh>' + esc(c.refresh) + '</button>' +
        (ready && !running ? '<button class="button primary" type="button" data-meta-muse-generate' + (!sceneId ? ' disabled aria-disabled="true"' : '') + '>' + esc(generated && asset ? c.regenerate : c.generate) + '</button>' + (generated ? '<button class="button ghost" type="button" data-meta-muse-stock>' + esc(c.stock) + '</button>' : '') : '') +
        (running ? '<button class="button danger" type="button" data-meta-muse-cancel>' + esc(c.stop) + '</button>' : '') +
      '</div>' +
      (connectionError ? '<div class="automation-meta-muse-error"><strong>' + esc(friendlyError(connectionError.code, connectionError.message)) + '</strong>' + (connectionError.message ? '<small>' + esc(connectionError.message) + '</small>' : '') + '</div>' : '') +
      (running ? '<div class="automation-meta-muse-progress"><div><span>' + esc(progressLabel()) + '</span><b>' + Math.round(percent) + '%</b></div><i><b style="width:' + percent + '%"></b></i></div>' : '') +
      '<small class="automation-meta-muse-foot">' + esc(selectedLabel) + '</small></section>';
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
      if (summary) summary.insertAdjacentElement('afterend', mount); else panel.prepend(mount);
    }
    if (mount.dataset.metaMuseWired !== '1') {
      mount.dataset.metaMuseWired = '1';
      mount.addEventListener('click', handleClick, true);
      mount.addEventListener('change', handleChange, true);
    }
    const html = markup();
    if (mount.innerHTML !== html) mount.innerHTML = html;
  }

  function queueRender() { if (!queued) { queued = true; requestAnimationFrame(render); } }

  async function refreshStatus({ quiet = false } = {}) {
    try {
      const snapshot = await window.ViralAutomationMetaMuseProvider?.refreshStatus?.();
      if (snapshot?.extensionConnected) connectionError = null;
      return snapshot;
    } catch (error) {
      if (!quiet) connectionError = { code: error?.code || 'META_MUSE_FAILED', message: error?.message || '' };
      return null;
    } finally { queueRender(); }
  }

  async function openMuse() {
    try {
      await window.ViralAutomationMetaMuseProvider?.openMuse?.();
      setTimeout(() => refreshStatus({ quiet: true }), 800);
    } catch (error) {
      connectionError = { code: error?.code || 'META_MUSE_FAILED', message: error?.message || '' };
      notify(friendlyError(connectionError.code, connectionError.message));
      queueRender();
    }
  }

  async function revealExtension() {
    try {
      const result = await window.ViralAutomationMetaMuseProvider?.revealExtension?.();
      if (result?.extensionPath) notify((locale() === 'vi' ? 'Đã mở thư mục tiện ích: ' : 'Extension folder opened: ') + result.extensionPath);
    } catch (error) {
      connectionError = { code: error?.code || 'EXTENSION_INSTALL_FAILED', message: error?.message || '' };
      queueRender();
    }
  }

  async function selectSession(value) {
    const [instanceId, tabId] = String(value || '').split('|');
    if (!instanceId || !tabId) return;
    try {
      await window.ViralAutomationMetaMuseProvider?.selectSession?.(instanceId, Number(tabId));
      connectionError = null;
    } catch (error) {
      connectionError = { code: error?.code || 'MUSE_SESSION_NOT_FOUND', message: error?.message || '' };
    } finally { queueRender(); }
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

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-meta-muse-install]')) { event.preventDefault(); revealExtension(); return; }
    if (target.closest('[data-meta-muse-open]')) { event.preventDefault(); openMuse(); return; }
    if (target.closest('[data-meta-muse-refresh]')) { event.preventDefault(); refreshStatus(); return; }
    if (target.closest('[data-meta-muse-generate]')) { event.preventDefault(); generateScene(); return; }
    if (target.closest('[data-meta-muse-stock]')) { event.preventDefault(); useStock(); return; }
    if (target.closest('[data-meta-muse-cancel]')) { event.preventDefault(); controller?.abort(); }
  }

  function handleChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.matches('[data-meta-muse-session]')) selectSession(target.value);
  }

  window.addEventListener('viral-ai:automation-meta-muse-status', event => { window.ViralAutomationMetaMuseStatus = event.detail || null; queueRender(); });
  window.addEventListener('viral-ai:automation-meta-muse-progress', event => { lastProgress = event.detail || null; queueRender(); });
  window.addEventListener('viral-ai:core-state-changed', queueRender);
  window.addEventListener('viral-ai:navigation-committed', queueRender);

  const start = () => {
    const page = document.getElementById('page');
    if (page) new MutationObserver(queueRender).observe(page, { childList: true, subtree: true });
    refreshStatus({ quiet: true });
    refreshTimer = setInterval(() => { if (appState()?.page === 'automation') refreshStatus({ quiet: true }); }, 2500);
    window.addEventListener('beforeunload', () => { if (refreshTimer) clearInterval(refreshTimer); }, { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  window.ViralAutomationMetaMuseUi = { refresh: queueRender, refreshStatus, generateScene, selectSession };
})();