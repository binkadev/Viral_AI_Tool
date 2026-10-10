(function installAutomationVoiceUi() {
  "use strict";

  let queued = false;

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
          eyebrow: "A1 · Voice",
          title: "Narration voice",
          intro: "Create one narration audio clip per scene, then attach it to the A1 track without changing scene timing.",
          generate: "Create voice track",
          regenerate: "Regenerate voice",
          cancel: "Stop",
          ready: "Voice track ready",
          stale: "Narration changed. Regenerate voice to update A1.",
          providerReady: "Voice provider ready",
          providerMissing: "Voice provider is not configured",
          dev: "Offline development audio",
          devBody: "This produces technical test audio only. It verifies timing, persistence, Studio playback and export without using a paid API.",
          scenes: "scenes have audio",
          generating: "Creating narration audio",
          completed: "Voice track created and timeline updated.",
          failed: "Could not create the voice track.",
          unavailable: "Enable a voice provider before generating narration."
        }
      : {
          eyebrow: "A1 · Giọng đọc",
          title: "Giọng đọc narration",
          intro: "Tạo audio riêng cho từng cảnh rồi gắn vào track A1 mà không thay đổi timing của cảnh.",
          generate: "Tạo giọng đọc",
          regenerate: "Tạo lại giọng đọc",
          cancel: "Dừng",
          ready: "Track giọng đọc đã sẵn sàng",
          stale: "Lời đọc đã thay đổi. Hãy tạo lại giọng để cập nhật A1.",
          providerReady: "Nguồn giọng đọc đã sẵn sàng",
          providerMissing: "Chưa cấu hình nguồn giọng đọc",
          dev: "Âm thanh kiểm thử offline",
          devBody: "Đây chỉ là audio kỹ thuật để kiểm tra timing, lưu project, phát trong Studio và export mà không cần API trả phí.",
          scenes: "cảnh đã có audio",
          generating: "Đang tạo audio narration",
          completed: "Đã tạo giọng đọc và cập nhật timeline.",
          failed: "Không thể tạo track giọng đọc.",
          unavailable: "Cần bật nguồn giọng đọc trước khi tạo narration."
        };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function snapshot() {
    return window.ViralAutomationVoiceState?.snapshot?.() || {
      providerStatus: null,
      active: false,
      progress: 0,
      phase: null,
      result: null,
      current: false,
      stale: false
    };
  }

  function ensureHost() {
    const compositionHost = document.querySelector(".automation-creator > .automation-composition-host");
    if (!(compositionHost instanceof HTMLElement)) return null;
    let host = compositionHost.querySelector(":scope > .automation-voice-host");
    if (host instanceof HTMLElement) return host;
    host = document.createElement("div");
    host.className = "automation-voice-host";
    compositionHost.prepend(host);
    return host;
  }

  function markup() {
    const c = copy();
    const snap = snapshot();
    const scenes = Array.isArray(appState()?.automation?.scenePlan?.scenes) ? appState().automation.scenePlan.scenes : [];
    const resultCount = Array.isArray(snap.result?.segments) ? snap.result.segments.length : 0;
    const provider = snap.providerStatus || {};
    const providerLabel = provider.ready ? c.providerReady : c.providerMissing;
    const dev = provider.developmentPreview === true || snap.result?.developmentPreview === true;
    const stateClass = snap.current ? " is-ready" : snap.stale ? " is-stale" : "";

    let statusText = providerLabel;
    if (snap.active) statusText = c.generating;
    else if (snap.current) statusText = c.ready;
    else if (snap.stale) statusText = c.stale;

    const buttonLabel = snap.active ? c.cancel : (snap.result ? c.regenerate : c.generate);
    const disabled = !snap.active && (!provider.ready || !scenes.length);

    return '<section class="automation-voice-panel' + stateClass + '">' +
      '<header class="automation-voice-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div>' +
      '<button class="button ' + (snap.active ? 'ghost' : 'primary') + '" type="button" data-automation-voice-action="' + (snap.active ? 'cancel' : 'generate') + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>' + esc(buttonLabel) + '</button></header>' +
      '<div class="automation-voice-status"><div><span class="automation-voice-dot"></span><strong>' + esc(statusText) + '</strong><small>' + esc(provider.provider || '—') + '</small></div>' +
      '<div class="automation-voice-count"><b>' + resultCount + '/' + scenes.length + '</b><span>' + esc(c.scenes) + '</span></div></div>' +
      (snap.active ? '<div class="automation-voice-progress"><i><b style="width:' + Math.max(2, Math.min(100, Number(snap.progress || 0))) + '%"></b></i><span>' + Math.round(Number(snap.progress || 0)) + '%</span></div>' : '') +
      (dev ? '<div class="automation-voice-dev"><strong>' + esc(c.dev) + '</strong><p>' + esc(c.devBody) + '</p></div>' : '') +
    '</section>';
  }

  function signature() {
    const snap = snapshot();
    const scenes = appState()?.automation?.scenePlan?.scenes || [];
    return JSON.stringify({
      locale: locale(),
      active: snap.active,
      progress: Math.round(Number(snap.progress || 0)),
      phase: snap.phase,
      current: snap.current,
      stale: snap.stale,
      provider: snap.providerStatus,
      resultId: snap.result?.id || null,
      segments: snap.result?.segments?.length || 0,
      scenes: Array.isArray(scenes) ? scenes.length : 0
    });
  }

  function render({ force = false } = {}) {
    if (appState()?.page !== "automation") return;
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    const next = signature();
    if (!force && host.dataset.signature === next) return;
    host.dataset.signature = next;
    host.innerHTML = markup();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  }

  async function generate() {
    const result = await window.ViralAutomationVoiceState?.generate?.();
    if (result?.ok) {
      if (appState()?.automation?.composition) {
        window.ViralAutomationCompositionState?.compose?.();
      }
      try { if (typeof toast === "function") toast(copy().completed); } catch {}
    } else if (!result?.cancelled && result?.code !== "AUTOMATION_VOICE_CANCELLED") {
      try { if (typeof toast === "function") toast(result?.code === "AUTOMATION_VOICE_NOT_CONFIGURED" ? copy().unavailable : copy().failed); } catch {}
    }
    render({ force: true });
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("[data-automation-voice-action]") : null;
    if (!target) return;
    event.preventDefault();
    const action = target.getAttribute("data-automation-voice-action");
    if (action === "cancel") window.ViralAutomationVoiceState?.cancel?.();
    else generate();
  }, true);

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.ViralAutomationVoiceState?.refreshStatus?.();
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationVoiceUi = { refresh: queue, render };
})();
