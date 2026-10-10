(function installAutomationCompositionUi() {
  "use strict";

  let queued = false;
  let selectedClipId = null;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function automation() {
    return appState()?.automation || null;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function copy() {
    return locale() === "en"
      ? {
          eyebrow: "05 · Timeline",
          title: "Composition plan",
          intro: "Combine approved scenes and local assets into one editable timeline plan before Studio projection.",
          locked: "Resolve media for every scene before composing the timeline.",
          build: "Build timeline plan",
          rebuild: "Refresh timeline plan",
          scenes: "scenes",
          duration: "Duration",
          video: "Video clips",
          audio: "Audio clips",
          subtitles: "Subtitle clips",
          empty: "No timeline plan yet",
          emptyBody: "Build a composition from the accepted Scene Plan and resolved local media. Nothing is rendered at this step.",
          scene: "Scene",
          source: "Local source",
          timing: "Timeline timing",
          subtitle: "Subtitle",
          clip: "Video clip",
          ready: "Plan ready",
          built: "Timeline plan created.",
          failed: "Could not create the timeline plan.",
          videoTrack: "V1 · Video",
          subtitleTrack: "SUB · Subtitles",
          audioTrack: "A1 · Voice",
          noVoice: "Voice track will remain empty until narration audio is available."
        }
      : {
          eyebrow: "05 · Timeline",
          title: "Bố cục timeline",
          intro: "Ghép các phân cảnh và tư liệu đã chốt thành một kế hoạch timeline có thể chỉnh sửa trước khi đưa sang Studio.",
          locked: "Cần có tư liệu hợp lệ cho tất cả cảnh trước khi dựng timeline.",
          build: "Tạo bố cục timeline",
          rebuild: "Làm mới bố cục",
          scenes: "cảnh",
          duration: "Thời lượng",
          video: "Clip video",
          audio: "Clip âm thanh",
          subtitles: "Clip phụ đề",
          empty: "Chưa có bố cục timeline",
          emptyBody: "Tạo Composition Plan từ Scene Plan và các file tư liệu cục bộ đã chốt. Bước này chưa render video.",
          scene: "Cảnh",
          source: "Nguồn cục bộ",
          timing: "Vị trí timeline",
          subtitle: "Phụ đề",
          clip: "Clip video",
          ready: "Bố cục sẵn sàng",
          built: "Đã tạo bố cục timeline.",
          failed: "Không thể tạo bố cục timeline.",
          videoTrack: "V1 · Video",
          subtitleTrack: "SUB · Phụ đề",
          audioTrack: "A1 · Giọng đọc",
          noVoice: "Track giọng đọc sẽ để trống cho đến khi có audio narration."
        };
  }

  function plan() {
    return automation()?.composition || null;
  }

  function readiness() {
    return window.ViralAutomationCompositionState?.readiness?.() || { ready: false, total: 0, assets: 0, missingSceneIds: [] };
  }

  function ensureHost() {
    const creator = document.querySelector(".automation-creator");
    if (!(creator instanceof HTMLElement)) return null;
    let host = creator.querySelector(":scope > .automation-composition-host");
    if (host instanceof HTMLElement) return host;
    host = document.createElement("div");
    host.className = "automation-composition-host";
    host.dataset.compositionMount = "true";
    const assets = creator.querySelector(":scope > .automation-assets-host");
    if (assets instanceof HTMLElement) assets.insertAdjacentElement("afterend", host);
    else creator.appendChild(host);
    return host;
  }

  function videoClips() {
    return Array.isArray(plan()?.tracks?.video) ? plan().tracks.video : [];
  }

  function ensureSelection(clips = videoClips()) {
    if (!clips.length) {
      selectedClipId = null;
      return null;
    }
    if (!selectedClipId || !clips.some(item => item.id === selectedClipId)) selectedClipId = clips[0].id;
    return clips.find(item => item.id === selectedClipId) || clips[0];
  }

  function sceneForClip(clip) {
    const scenes = Array.isArray(automation()?.scenePlan?.scenes) ? automation().scenePlan.scenes : [];
    return scenes.find(scene => String(scene?.id || "") === String(clip?.sceneId || "")) || null;
  }

  function formatSec(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toFixed(number % 1 ? 1 : 0) + "s" : "0s";
  }

  function signature() {
    const current = plan();
    const ready = readiness();
    return JSON.stringify({
      locale: locale(),
      ready: ready.ready,
      assets: ready.assets,
      total: ready.total,
      selectedClipId,
      id: current?.id || null,
      input: current?.inputSignature || null,
      output: current?.outputSignature || null,
      stale: automation()?.stale?.composition === true
    });
  }

  function clipItem(clip, index, selected) {
    const c = copy();
    const scene = sceneForClip(clip);
    return '<button class="automation-composition-clip' + (selected ? ' is-selected' : '') + '" type="button" data-composition-clip="' + esc(clip.id) + '">' +
      '<span class="automation-composition-clip-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="automation-composition-clip-copy"><b>' + esc(c.scene) + ' ' + (index + 1) + '</b><small>' + esc(formatSec(clip.startSec)) + ' → ' + esc(formatSec(clip.endSec)) + '</small><em>' + esc(scene?.narration || clip.sourcePath) + '</em></span>' +
    '</button>';
  }

  function inspector(clip, index) {
    const c = copy();
    const scene = sceneForClip(clip);
    const subtitle = (Array.isArray(plan()?.tracks?.subtitle) ? plan().tracks.subtitle : []).find(item => item.sceneId === clip.sceneId);
    return '<section class="automation-composition-inspector">' +
      '<header class="automation-composition-inspector-head"><div><div class="eyebrow">' + esc(c.scene) + ' ' + (index + 1) + '</div><h4>' + esc(scene?.narration || c.clip) + '</h4><p>' + esc(clip.id) + '</p></div><span class="automation-composition-status">' + esc(c.ready) + '</span></header>' +
      '<div class="automation-composition-preview">' +
        '<div class="automation-composition-preview-card"><span>' + esc(c.source) + '</span><strong class="automation-composition-path">' + esc(clip.sourcePath) + '</strong><p>' + esc(scene?.visualIntent || '') + '</p></div>' +
        '<div class="automation-composition-preview-card"><span>' + esc(c.timing) + '</span><strong>' + esc(formatSec(clip.startSec)) + ' → ' + esc(formatSec(clip.endSec)) + '</strong><p>' + esc(c.duration) + ': ' + esc(formatSec(clip.durationSec)) + '</p></div>' +
        '<div class="automation-composition-preview-card" style="grid-column:1/-1"><span>' + esc(c.subtitle) + '</span><strong>' + esc(subtitle?.text || '—') + '</strong></div>' +
      '</div>' +
      trackStrip() +
    '</section>';
  }

  function stripItems(items, total) {
    if (!items.length || !total) return '<span class="automation-composition-strip-item" style="flex:1 1 auto">—</span>';
    return items.map((item, index) => {
      const width = Math.max(5, Number(item.durationSec || 0) / total * 100);
      return '<span class="automation-composition-strip-item" style="flex:0 0 ' + width.toFixed(2) + '%" title="' + esc(item.sceneId || item.id) + '">' + (index + 1) + '</span>';
    }).join("");
  }

  function trackStrip() {
    const c = copy();
    const current = plan();
    const total = Number(current?.durationSec || 0);
    const video = Array.isArray(current?.tracks?.video) ? current.tracks.video : [];
    const subtitle = Array.isArray(current?.tracks?.subtitle) ? current.tracks.subtitle : [];
    const audio = Array.isArray(current?.tracks?.audio) ? current.tracks.audio : [];
    return '<div class="automation-composition-track"><div class="automation-composition-track-head"><b>' + esc(c.videoTrack) + '</b><span>' + video.length + '</span></div><div class="automation-composition-strip">' + stripItems(video, total) + '</div></div>' +
      '<div class="automation-composition-track"><div class="automation-composition-track-head"><b>' + esc(c.subtitleTrack) + '</b><span>' + subtitle.length + '</span></div><div class="automation-composition-strip">' + stripItems(subtitle, total) + '</div></div>' +
      '<div class="automation-composition-track"><div class="automation-composition-track-head"><b>' + esc(c.audioTrack) + '</b><span>' + (audio.length ? audio.length : esc(c.noVoice)) + '</span></div><div class="automation-composition-strip">' + stripItems(audio, total) + '</div></div>';
  }

  function markup() {
    const c = copy();
    const ready = readiness();
    if (!ready.ready) {
      return '<section class="automation-composition-panel is-locked"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.locked) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(c.build) + '</button></section>';
    }

    const current = plan();
    if (!current || automation()?.stale?.composition === true) {
      return '<section class="automation-composition-panel"><header class="automation-composition-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationBuildComposition" class="button primary" type="button">' + esc(c.build) + '</button></header><div class="automation-composition-empty"><div class="automation-composition-empty-icon">05</div><div><h4>' + esc(c.empty) + '</h4><p>' + esc(c.emptyBody) + '</p><button id="automationBuildCompositionEmpty" class="button primary" type="button">' + esc(c.build) + '</button></div></div></section>';
    }

    const clips = videoClips();
    const selected = ensureSelection(clips);
    const selectedIndex = selected ? clips.findIndex(item => item.id === selected.id) : -1;
    const audio = Array.isArray(current.tracks?.audio) ? current.tracks.audio.length : 0;
    const subtitles = Array.isArray(current.tracks?.subtitle) ? current.tracks.subtitle.length : 0;
    return '<section class="automation-composition-panel">' +
      '<header class="automation-composition-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationBuildComposition" class="button ghost" type="button">' + esc(c.rebuild) + '</button></header>' +
      '<div class="automation-composition-summary">' +
        '<div class="automation-composition-stat"><span>' + esc(c.scenes) + '</span><strong>' + clips.length + '</strong></div>' +
        '<div class="automation-composition-stat"><span>' + esc(c.duration) + '</span><strong>' + esc(formatSec(current.durationSec)) + '</strong></div>' +
        '<div class="automation-composition-stat"><span>' + esc(c.video) + '</span><strong>' + clips.length + '</strong></div>' +
        '<div class="automation-composition-stat"><span>' + esc(c.subtitles) + ' / ' + esc(c.audio) + '</span><strong>' + subtitles + ' / ' + audio + '</strong></div>' +
      '</div>' +
      '<div class="automation-composition-workbench"><aside class="automation-composition-sequence">' + clips.map((clip, index) => clipItem(clip, index, clip.id === selected?.id)).join("") + '</aside>' + (selected ? inspector(selected, selectedIndex) : '') + '</div>' +
    '</section>';
  }

  function render({ force = false } = {}) {
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    const next = signature();
    if (!force && host.dataset.compositionUiSignature === next) return;
    host.dataset.compositionUiSignature = next;
    const html = markup();
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function build() {
    const result = window.ViralAutomationCompositionState?.compose?.();
    if (result?.ok) {
      selectedClipId = result.composition?.tracks?.video?.[0]?.id || null;
      render({ force: true });
      try { if (typeof toast === "function") toast(copy().built); } catch {}
    } else {
      try { if (typeof toast === "function") toast(copy().failed); } catch {}
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
    if (target.closest("#automationBuildComposition, #automationBuildCompositionEmpty")) {
      event.preventDefault();
      build();
      return;
    }
    const clip = target.closest("[data-composition-clip]");
    if (clip) {
      event.preventDefault();
      const id = clip.getAttribute("data-composition-clip");
      if (id && id !== selectedClipId) {
        selectedClipId = id;
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
    document.documentElement.dataset.automationComposition = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationCompositionUi = { refresh: queue, render };
})();
