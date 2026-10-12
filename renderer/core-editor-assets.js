(function installCoreEditorAssetsPanel() {
  "use strict";

  const COLLAPSED_KEY = "viral-ai-core-editor-assets-collapsed";
  let queued = false;

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

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function currentSource() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function mediaAssets() {
    const current = appState();
    return Array.isArray(current?.media?.assets) ? current.media.assets : [];
  }

  function basename(value) {
    const raw = String(value || "");
    if (!raw) return "—";
    try {
      const url = new URL(raw);
      const path = decodeURIComponent(url.pathname || "");
      return path.split(/[\\/]/).filter(Boolean).pop() || raw;
    } catch {
      return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    }
  }

  function durationFor(video, source) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    if (Number.isFinite(hint) && hint > 0) return hint;
    const stored = Number(source?.meta?.duration || 0);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  }

  function collapsed() {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  }

  function countAssets({ kind, origin, favorite } = {}) {
    return mediaAssets().filter(asset => {
      if (kind && asset?.kind !== kind) return false;
      if (origin && asset?.origin !== origin) return false;
      if (favorite === true && asset?.favorite !== true) return false;
      return true;
    }).length;
  }

  function applyCollapsed(panel, value) {
    panel.classList.toggle("is-collapsed", value);
    const button = panel.querySelector("[data-assets-collapse]");
    if (button instanceof HTMLButtonElement) {
      button.textContent = value ? "›" : "‹";
      button.title = value ? t("expand") : t("collapse");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", value ? "false" : "true");
    }
    localStorage.setItem(COLLAPSED_KEY, value ? "true" : "false");
  }

  function sectionLabel(key) {
    return '<div class="core-assets-section-label">' + t(key) + '</div>';
  }

  function statRow(icon, labelKey, dataKey) {
    return '<div class="core-asset-item core-asset-stat" data-media-count="' + dataKey + '">' +
      '<span class="core-asset-icon">' + icon + '</span>' +
      '<span class="core-asset-copy"><b>' + t(labelKey) + '</b><small data-count-value>0</small></span>' +
    '</div>';
  }

  function ensurePanel(grid) {
    let panel = grid.querySelector(":scope > .core-editor-assets-panel");
    if (panel instanceof HTMLElement) return panel;

    panel = document.createElement("aside");
    panel.className = "core-editor-assets-panel";
    panel.setAttribute("aria-label", t("assets"));
    panel.innerHTML =
      '<div class="core-assets-head"><strong>' + t("assets") + '</strong><button type="button" data-assets-collapse>‹</button></div>' +
      '<div class="core-assets-body">' +
        sectionLabel("project") +
        '<button type="button" class="core-asset-item core-source-asset" data-source-asset>' +
          '<span class="core-asset-icon">▶</span>' +
          '<span class="core-asset-copy"><b>' + t("source") + '</b><small data-source-name>—</small><em data-source-meta>—</em></span>' +
        '</button>' +
        '<button type="button" class="core-asset-item core-transcript-asset" data-transcript-asset>' +
          '<span class="core-asset-icon">TXT</span>' +
          '<span class="core-asset-copy"><b>' + t("transcript") + '</b><small data-transcript-status>' + t("noTranscript") + '</small></span>' +
        '</button>' +
        sectionLabel("media") +
        statRow("VID", "video", "video") +
        statRow("IMG", "images", "image") +
        statRow("AUD", "audio", "audio") +
        sectionLabel("discover") +
        '<button type="button" class="core-asset-item core-discover-action" data-find-media>' +
          '<span class="core-asset-icon">⌕</span>' +
          '<span class="core-asset-copy"><b>' + t("findMedia") + '</b><small>' + t("findMediaHint") + '</small></span>' +
        '</button>' +
        '<div class="core-asset-item core-asset-stat is-upcoming" aria-disabled="true">' +
          '<span class="core-asset-icon">AI</span>' +
          '<span class="core-asset-copy"><b>' + t("generateAi") + '</b><small>' + t("generateAiHint") + '</small></span>' +
        '</div>' +
        sectionLabel("generated") +
        statRow("V", "aiVideo", "generated-video") +
        statRow("I", "aiImages", "generated-image") +
        statRow("A", "aiAudio", "generated-audio") +
        sectionLabel("favorites") +
        statRow("★", "saved", "favorites") +
      '</div>';

    grid.prepend(panel);
    panel.querySelector("[data-assets-collapse]")?.addEventListener("click", () => {
      applyCollapsed(panel, !panel.classList.contains("is-collapsed"));
    });
    panel.querySelector("[data-source-asset]")?.addEventListener("click", () => {
      grid.querySelector("video.preview-video, video.core-player-media")?.focus?.();
      grid.querySelector(".preview")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
    panel.querySelector("[data-transcript-asset]")?.addEventListener("click", event => {
      const button = event.currentTarget;
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      window.dispatchEvent(new CustomEvent("viral-ai:bottom-dock-tab", { detail: { tab: "transcript" } }));
    });
    panel.querySelector("[data-find-media]")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("viral-ai:media-discovery-open", { detail: { kind: "video" } }));
    });
    applyCollapsed(panel, collapsed());
    return panel;
  }

  function updateCount(panel, key, value) {
    const row = panel.querySelector('[data-media-count="' + key + '"]');
    const target = row?.querySelector("[data-count-value]");
    if (target) target.textContent = t("items", { count: value });
    row?.classList.toggle("has-items", value > 0);
  }

  function updatePanel(panel, grid) {
    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    const name = panel.querySelector("[data-source-name]");
    const meta = panel.querySelector("[data-source-meta]");
    const transcript = panel.querySelector("[data-transcript-asset]");
    const transcriptStatus = panel.querySelector("[data-transcript-status]");

    const sourceName = source?.name || source?.sourcePath || video?.currentSrc || video?.src;
    if (name) name.textContent = basename(sourceName);

    if (meta) {
      const nativeWidth = Number(video?.videoWidth || 0);
      const nativeHeight = Number(video?.videoHeight || 0);
      const storedWidth = Number(source?.meta?.width || 0);
      const storedHeight = Number(source?.meta?.height || 0);
      const width = nativeWidth > 0 ? nativeWidth : storedWidth;
      const height = nativeHeight > 0 ? nativeHeight : storedHeight;
      const duration = durationFor(video, source);
      const dimensions = width > 0 && height > 0 ? width + "×" + height : "—";
      meta.textContent = dimensions + " · " + formatDuration(duration);
    }

    const transcriptCount = document.querySelectorAll(".transcript-list .transcript-row").length;
    if (transcript instanceof HTMLButtonElement) {
      transcript.disabled = transcriptCount === 0;
      transcript.classList.toggle("is-disabled", transcriptCount === 0);
      transcript.title = transcriptCount === 0 ? t("noTranscript") : t("segments", { count: transcriptCount });
    }
    if (transcriptStatus) transcriptStatus.textContent = transcriptCount === 0 ? t("noTranscript") : t("segments", { count: transcriptCount });

    updateCount(panel, "video", countAssets({ kind: "video" }));
    updateCount(panel, "image", countAssets({ kind: "image" }));
    updateCount(panel, "audio", countAssets({ kind: "audio" }));
    updateCount(panel, "generated-video", countAssets({ kind: "video", origin: "generated" }));
    updateCount(panel, "generated-image", countAssets({ kind: "image", origin: "generated" }));
    updateCount(panel, "generated-audio", countAssets({ kind: "audio", origin: "generated" }));
    updateCount(panel, "favorites", countAssets({ favorite: true }));
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-workbench-page")) return;
    const focus = page.querySelector(":scope > .core-editor-focus-section");
    const grid = focus?.querySelector(".editor-grid");
    if (!(grid instanceof HTMLElement)) return;

    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    if (!video && !source) return;

    const panel = ensurePanel(grid);
    updatePanel(panel, grid);
    grid.classList.add("core-editor-assets-grid");
    page.classList.add("core-editor-assets-page");
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:transcript-edit", queue);
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
