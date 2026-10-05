(function installCorePlayer() {
  "use strict";

  const model = window.ViralCorePlayerModel;
  if (!model) return;

  const EDIT_STORE_KEY = "viral-ai-core-transcript-edits-v1";
  const enhancedVideos = new WeakSet();
  const enhancedRows = new WeakSet();
  let activeVideo = null;
  let lastActiveRow = null;
  let rafId = 0;

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function editStore() {
    return safeJsonParse(localStorage.getItem(EDIT_STORE_KEY) || "{}", {});
  }

  function saveEdit(key, value) {
    const store = editStore();
    store[key] = String(value || "");
    localStorage.setItem(EDIT_STORE_KEY, JSON.stringify(store));
  }

  function videoIdentity(video) {
    return String(video.currentSrc || video.src || "unknown-video");
  }

  function transcriptRows() {
    return Array.from(document.querySelectorAll(".transcript-list .transcript-row"));
  }

  function parseRows(video) {
    const rows = transcriptRows();
    const raw = rows.map((row, index) => {
      const time = row.querySelector("time");
      const text = row.querySelector("p");
      return {
        id: row.dataset.segmentId || ("segment-" + (index + 1)),
        start: model.parseTimeLabel(time?.textContent),
        end: Number(row.dataset.end || 0),
        text: String(text?.textContent || "")
      };
    });
    const normalized = model.normalizeSegments(raw, Number(video?.duration || 0));
    normalized.forEach((segment, index) => {
      const row = rows[index];
      if (!row) return;
      row.dataset.segmentId = segment.id;
      row.dataset.start = String(segment.start);
      row.dataset.end = String(segment.end);
    });
    return { rows, segments: normalized };
  }

  function isTextSelectionInside(row) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    return Boolean(common && row.contains(common));
  }

  function persistTranscriptEdit(video, row, paragraph) {
    const start = Number(row.dataset.start || 0).toFixed(3);
    const key = videoIdentity(video) + "::" + start;
    saveEdit(key, paragraph.textContent || "");
    row.classList.add("is-edited");
    window.dispatchEvent(new CustomEvent("viral-ai:transcript-edit", {
      detail: {
        source: videoIdentity(video),
        segmentId: row.dataset.segmentId || null,
        start: Number(row.dataset.start || 0),
        end: Number(row.dataset.end || 0),
        text: paragraph.textContent || ""
      }
    }));
  }

  function applyStoredTranscriptEdit(video, row, paragraph) {
    const start = Number(row.dataset.start || 0).toFixed(3);
    const key = videoIdentity(video) + "::" + start;
    const stored = editStore()[key];
    if (typeof stored === "string" && paragraph.textContent !== stored) {
      paragraph.textContent = stored;
      row.classList.add("is-edited");
    }
  }

  function enhanceTranscriptRows(video) {
    const { rows } = parseRows(video);
    rows.forEach(row => {
      const paragraph = row.querySelector("p");
      if (!paragraph) return;
      applyStoredTranscriptEdit(video, row, paragraph);
      paragraph.setAttribute("contenteditable", "plaintext-only");
      paragraph.setAttribute("spellcheck", "true");
      paragraph.setAttribute("aria-label", "Transcript text");
      row.tabIndex = 0;
      row.setAttribute("role", "group");

      if (enhancedRows.has(row)) return;
      enhancedRows.add(row);

      row.addEventListener("click", event => {
        if (!activeVideo || event.defaultPrevented) return;
        if (isTextSelectionInside(row)) return;
        if (event.target instanceof HTMLElement && event.target.closest("p[contenteditable]")) return;
        activeVideo.currentTime = model.clampTime(Number(row.dataset.start || 0), activeVideo.duration);
        updateFromPlayback(activeVideo, { forceScroll: true });
      });

      row.addEventListener("keydown", event => {
        if (!activeVideo) return;
        if ((event.key === "Enter" || event.key === " ") && event.target === row) {
          event.preventDefault();
          activeVideo.currentTime = model.clampTime(Number(row.dataset.start || 0), activeVideo.duration);
          updateFromPlayback(activeVideo, { forceScroll: true });
        }
      });

      paragraph.addEventListener("input", () => {
        row.classList.add("is-editing");
      });

      paragraph.addEventListener("blur", () => {
        row.classList.remove("is-editing");
        persistTranscriptEdit(activeVideo || video, row, paragraph);
      });
    });
  }

  function controlsFor(video) {
    return video.closest(".preview")?.querySelector(".core-player-controls") || null;
  }

  function setPlayingUi(video) {
    const controls = controlsFor(video);
    const play = controls?.querySelector("[data-core-play]");
    if (play) {
      play.textContent = video.paused ? "▶" : "❚❚";
      play.setAttribute("aria-label", video.paused ? "Play" : "Pause");
      play.title = video.paused ? "Play" : "Pause";
    }
  }

  function updateTranscript(video, currentTime, forceScroll) {
    enhanceTranscriptRows(video);
    const { rows, segments } = parseRows(video);
    const activeIndex = model.activeSegmentIndex(segments, currentTime);
    const activeRow = activeIndex >= 0 ? rows[activeIndex] : null;

    rows.forEach((row, index) => {
      const active = index === activeIndex;
      row.classList.toggle("is-active", active);
      row.setAttribute("aria-current", active ? "true" : "false");
    });

    if (activeRow && activeRow !== lastActiveRow) {
      const paragraph = activeRow.querySelector("p");
      const editing = paragraph && document.activeElement === paragraph;
      if (!editing && (forceScroll || !video.paused)) {
        activeRow.scrollIntoView({ block: "nearest", behavior: forceScroll ? "auto" : "smooth" });
      }
      lastActiveRow = activeRow;
    }
  }

  function updateFromPlayback(video, { forceScroll = false } = {}) {
    if (!video || video !== activeVideo) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const current = model.clampTime(video.currentTime, video.duration);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const controls = controlsFor(video);
      const seek = controls?.querySelector("[data-core-seek]");
      const time = controls?.querySelector("[data-core-time]");
      if (seek) seek.value = String(Math.round(model.seekRatio(current, duration) * 1000));
      if (time) time.textContent = model.formatClock(current) + " / " + model.formatClock(duration);
      setPlayingUi(video);
      updateTranscript(video, current, forceScroll);
    });
  }

  async function toggleFullscreen(host) {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (host?.requestFullscreen) await host.requestFullscreen();
    } catch {}
  }

  function makeControls(video, host) {
    let controls = host.querySelector(".core-player-controls");
    if (controls) return controls;

    controls = document.createElement("div");
    controls.className = "core-player-controls";
    controls.setAttribute("data-core-player-controls", "true");
    controls.innerHTML = [
      '<button type="button" class="core-player-button" data-core-play aria-label="Play" title="Play">▶</button>',
      '<input class="core-player-seek" data-core-seek type="range" min="0" max="1000" step="1" value="0" aria-label="Video position">',
      '<output class="core-player-time" data-core-time>00:00 / 00:00</output>',
      '<button type="button" class="core-player-button" data-core-fullscreen aria-label="Fullscreen" title="Fullscreen">⛶</button>'
    ].join("");
    host.appendChild(controls);

    controls.querySelector("[data-core-play]")?.addEventListener("click", async () => {
      if (video.paused) {
        try { await video.play(); } catch {}
      } else {
        video.pause();
      }
      updateFromPlayback(video);
    });

    const seek = controls.querySelector("[data-core-seek]");
    seek?.addEventListener("input", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration) return;
      video.currentTime = model.clampTime((Number(seek.value) / 1000) * duration, duration);
      updateFromPlayback(video, { forceScroll: true });
    });

    controls.querySelector("[data-core-fullscreen]")?.addEventListener("click", () => toggleFullscreen(host));
    return controls;
  }

  function enhanceVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    activeVideo = video;
    const host = video.closest(".preview");
    if (!host) return;

    host.classList.add("core-player-host");
    video.classList.add("core-player-media");
    video.controls = false;
    video.playsInline = true;
    video.removeAttribute("width");
    video.removeAttribute("height");
    video.style.objectFit = "contain";
    video.style.objectPosition = "center center";
    video.style.transform = "none";
    video.style.scale = "1";
    makeControls(video, host);
    enhanceTranscriptRows(video);

    if (enhancedVideos.has(video)) {
      updateFromPlayback(video);
      return;
    }
    enhancedVideos.add(video);

    ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended"].forEach(name => {
      video.addEventListener(name, () => updateFromPlayback(video, { forceScroll: name === "seeked" }));
    });

    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        host.style.setProperty("--core-video-ratio", video.videoWidth + " / " + video.videoHeight);
        host.dataset.videoRatio = (video.videoWidth / video.videoHeight).toFixed(4);
      }
      updateFromPlayback(video);
    });

    video.addEventListener("dblclick", event => {
      event.preventDefault();
      toggleFullscreen(host);
    });

    updateFromPlayback(video);
  }

  function scan() {
    const video = document.querySelector(".preview-video");
    if (video) enhanceVideo(video);
  }

  const observer = new MutationObserver(() => scan());
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true });
    scan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.addEventListener("resize", () => activeVideo && updateFromPlayback(activeVideo));
  document.addEventListener("fullscreenchange", () => activeVideo && updateFromPlayback(activeVideo));
})();
