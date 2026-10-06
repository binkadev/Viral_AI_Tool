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

  function copy() {
    return locale() === "en"
      ? {
          title: "Assets",
          project: "Project",
          source: "Source video",
          transcript: "Transcript",
          noTranscript: "Run Speech first",
          segments: count => count + " segments",
          collapse: "Collapse assets",
          expand: "Expand assets"
        }
      : {
          title: "Tài nguyên",
          project: "Dự án",
          source: "Video nguồn",
          transcript: "Transcript",
          noTranscript: "Cần nhận diện lời nói trước",
          segments: count => count + " đoạn",
          collapse: "Thu gọn tài nguyên",
          expand: "Mở tài nguyên"
        };
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

  function durationFor(video) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
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

  function applyCollapsed(panel, value) {
    const c = copy();
    panel.classList.toggle("is-collapsed", value);
    const button = panel.querySelector("[data-assets-collapse]");
    if (button instanceof HTMLButtonElement) {
      button.textContent = value ? "›" : "‹";
      button.title = value ? c.expand : c.collapse;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", value ? "false" : "true");
    }
    localStorage.setItem(COLLAPSED_KEY, value ? "true" : "false");
  }

  function ensurePanel(grid) {
    let panel = grid.querySelector(":scope > .core-editor-assets-panel");
    if (panel instanceof HTMLElement) return panel;

    const c = copy();
    panel = document.createElement("aside");
    panel.className = "core-editor-assets-panel";
    panel.setAttribute("aria-label", c.title);
    panel.innerHTML =
      '<div class="core-assets-head"><strong>' + c.title + '</strong><button type="button" data-assets-collapse>‹</button></div>' +
      '<div class="core-assets-body">' +
        '<div class="core-assets-section-label">' + c.project + '</div>' +
        '<button type="button" class="core-asset-item core-source-asset" data-source-asset>' +
          '<span class="core-asset-icon">▶</span>' +
          '<span class="core-asset-copy"><b>' + c.source + '</b><small data-source-name>—</small><em data-source-meta>—</em></span>' +
        '</button>' +
        '<button type="button" class="core-asset-item core-transcript-asset" data-transcript-asset>' +
          '<span class="core-asset-icon">TXT</span>' +
          '<span class="core-asset-copy"><b>' + c.transcript + '</b><small data-transcript-status>' + c.noTranscript + '</small></span>' +
        '</button>' +
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
    applyCollapsed(panel, collapsed());
    return panel;
  }

  function updatePanel(panel, grid) {
    const c = copy();
    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const name = panel.querySelector("[data-source-name]");
    const meta = panel.querySelector("[data-source-meta]");
    const transcript = panel.querySelector("[data-transcript-asset]");
    const transcriptStatus = panel.querySelector("[data-transcript-status]");

    if (name) name.textContent = basename(video?.currentSrc || video?.src);
    if (meta) {
      const width = Number(video?.videoWidth || 0);
      const height = Number(video?.videoHeight || 0);
      const duration = durationFor(video);
      const dimensions = width > 0 && height > 0 ? width + "×" + height : "—";
      meta.textContent = dimensions + " · " + formatDuration(duration);
    }

    const count = document.querySelectorAll(".transcript-list .transcript-row").length;
    if (transcript instanceof HTMLButtonElement) {
      transcript.disabled = count === 0;
      transcript.classList.toggle("is-disabled", count === 0);
      transcript.title = count === 0 ? c.noTranscript : c.segments(count);
    }
    if (transcriptStatus) transcriptStatus.textContent = count === 0 ? c.noTranscript : c.segments(count);
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-workbench-page")) return;
    const focus = page.querySelector(":scope > .core-editor-focus-section");
    const grid = focus?.querySelector(".editor-grid");
    if (!(grid instanceof HTMLElement) || !grid.querySelector("video.preview-video, video.core-player-media")) return;

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
