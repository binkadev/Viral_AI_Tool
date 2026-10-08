(function installCorePlayer() {
  "use strict";

  const model = window.ViralCorePlayerModel;
  if (!model) return;

  const EDIT_STORE_KEY = "viral-ai-core-transcript-edits-v1";
  const enhancedVideos = new WeakSet();
  const enhancedRows = new WeakSet();
  const frameCallbacks = new WeakMap();
  const resizeObservers = new WeakMap();
  const transcriptCaches = new WeakMap();
  const timelineSegmentCaches = new WeakMap();
  let activeVideo = null;
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

  function transcriptList() {
    return document.querySelector(".transcript-list");
  }

  function transcriptRows() {
    return Array.from(document.querySelectorAll(".transcript-list .transcript-row"));
  }

  function transcriptGeneration(list) {
    if (!(list instanceof HTMLElement)) return "none";
    const explicit = list.dataset.coreTranscriptGeneration;
    if (explicit) return "workstation:" + explicit;
    const first = list.firstElementChild;
    const last = list.lastElementChild;
    return [
      "legacy",
      list.children.length,
      first?.dataset?.segmentId || first?.dataset?.start || "",
      last?.dataset?.segmentId || last?.dataset?.start || ""
    ].join(":");
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

  function seekVideo(video, time, { forceScroll = true } = {}) {
    if (!video) return;
    const target = model.clampTime(time, video.duration);
    if (Math.abs(Number(video.currentTime || 0) - target) > 0.002) video.currentTime = target;
    updateFromPlayback(video, { forceScroll });
  }

  function wireTranscriptRow(video, row) {
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
      seekVideo(activeVideo, Number(row.dataset.start || 0));
    });

    row.addEventListener("keydown", event => {
      if (!activeVideo) return;
      if ((event.key === "Enter" || event.key === " ") && event.target === row) {
        event.preventDefault();
        seekVideo(activeVideo, Number(row.dataset.start || 0));
      }
    });

    paragraph.addEventListener("input", () => {
      row.classList.add("is-editing");
    });

    paragraph.addEventListener("blur", () => {
      row.classList.remove("is-editing");
      persistTranscriptEdit(activeVideo || video, row, paragraph);
    });
  }

  function buildTranscriptCache(video, list, generation, duration) {
    const rows = transcriptRows();
    const raw = rows.map((row, index) => {
      const time = row.querySelector("time");
      const text = row.querySelector("p");
      return {
        id: row.dataset.segmentId || ("segment-" + (index + 1)),
        start: Number.isFinite(Number(row.dataset.start))
          ? Number(row.dataset.start)
          : model.parseTimeLabel(time?.textContent),
        end: Number(row.dataset.end || 0),
        text: String(text?.textContent || ""),
        translatedText: String(row.dataset.translatedText || ""),
        speaker: row.dataset.speaker || null,
        voice: row.dataset.voice || null,
        status: row.dataset.status || "ready"
      };
    });
    const segments = model.normalizeSegments(raw, duration);
    segments.forEach((segment, index) => {
      const row = rows[index];
      if (!row) return;
      row.dataset.segmentId = segment.id;
      row.dataset.start = String(segment.start);
      row.dataset.end = String(segment.end);
      wireTranscriptRow(video, row);
    });
    const cache = {
      list,
      generation,
      duration,
      rows,
      segments,
      activeIndex: -1
    };
    transcriptCaches.set(video, cache);
    return cache;
  }

  function transcriptCacheFor(video, { force = false } = {}) {
    const list = transcriptList();
    const generation = transcriptGeneration(list);
    const duration = Number.isFinite(video?.duration) ? Number(video.duration) : 0;
    const existing = transcriptCaches.get(video);
    if (!force && existing && existing.list === list && existing.generation === generation && existing.duration === duration) {
      return existing;
    }
    return buildTranscriptCache(video, list, generation, duration);
  }

  function parseRows(video) {
    const cache = transcriptCacheFor(video);
    return { rows: cache.rows, segments: cache.segments };
  }

  function enhanceTranscriptRows(video) {
    transcriptCacheFor(video);
  }

  function invalidateTranscriptCache(video) {
    if (!video) return;
    transcriptCaches.delete(video);
    timelineSegmentCaches.delete(video);
  }

  function controlsFor(video) {
    return video.closest(".preview")?.querySelector(".core-player-controls") || null;
  }

  function timelineFor(video) {
    return video.closest(".preview")?.querySelector(".core-player-timeline") || null;
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

  function renderTimelineSegments(video) {
    const timeline = timelineFor(video);
    if (!timeline) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const transcript = transcriptCacheFor(video);
    const track = timeline.querySelector("[data-core-timeline-track]");
    if (!track) return;

    const existing = timelineSegmentCaches.get(video);
    if (existing && existing.generation === transcript.generation && existing.duration === duration && existing.track === track) return;

    track.querySelectorAll(".core-timeline-segment").forEach(node => node.remove());
    const nodes = [];
    if (duration && transcript.segments.length) {
      const fragment = document.createDocumentFragment();
      transcript.segments.forEach((segment, index) => {
        const start = model.clampTime(segment.start, duration);
        const end = model.clampTime(Math.max(segment.end, start), duration);
        const segmentButton = document.createElement("button");
        segmentButton.type = "button";
        segmentButton.className = "core-timeline-segment";
        segmentButton.dataset.segmentIndex = String(index);
        segmentButton.dataset.start = String(start);
        segmentButton.style.left = String(model.seekRatio(start, duration) * 100) + "%";
        segmentButton.style.width = String(Math.max(0.35, model.seekRatio(end - start, duration) * 100)) + "%";
        segmentButton.title = model.formatClock(start) + " – " + model.formatClock(end);
        segmentButton.setAttribute("aria-label", "Seek to transcript segment " + (index + 1));
        segmentButton.addEventListener("click", event => {
          event.stopPropagation();
          seekVideo(video, start);
        });
        nodes.push(segmentButton);
        fragment.appendChild(segmentButton);
      });
      track.appendChild(fragment);
    }

    timelineSegmentCaches.set(video, {
      track,
      generation: transcript.generation,
      duration,
      nodes,
      activeIndex: -1
    });
  }

  function updateTimeline(video, currentTime, duration, activeIndex) {
    const timeline = timelineFor(video);
    if (!timeline) return;
    renderTimelineSegments(video);

    const playhead = timeline.querySelector("[data-core-playhead]");
    if (playhead) playhead.style.left = String(model.seekRatio(currentTime, duration) * 100) + "%";

    const cache = timelineSegmentCaches.get(video);
    if (!cache || cache.activeIndex === activeIndex) return;
    const previous = cache.nodes[cache.activeIndex];
    const next = cache.nodes[activeIndex];
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-current", "false");
    }
    if (next) {
      next.classList.add("is-active");
      next.setAttribute("aria-current", "true");
    }
    cache.activeIndex = activeIndex;
  }

  function updateTranscript(video, currentTime, forceScroll) {
    const cache = transcriptCacheFor(video);
    const activeIndex = model.activeSegmentIndex(cache.segments, currentTime);
    if (cache.activeIndex === activeIndex) return activeIndex;

    const previousRow = cache.rows[cache.activeIndex];
    const activeRow = activeIndex >= 0 ? cache.rows[activeIndex] : null;
    if (previousRow) {
      previousRow.classList.remove("is-active");
      previousRow.setAttribute("aria-current", "false");
    }
    if (activeRow) {
      activeRow.classList.add("is-active");
      activeRow.setAttribute("aria-current", "true");
      const paragraph = activeRow.querySelector("p");
      const editing = paragraph && document.activeElement === paragraph;
      if (!editing && (forceScroll || !video.paused)) {
        activeRow.scrollIntoView({ block: "nearest", behavior: forceScroll ? "auto" : "smooth" });
      }
    }
    cache.activeIndex = activeIndex;
    return activeIndex;
  }

  function updateFromPlayback(video, { forceScroll = false } = {}) {
    if (!video || video !== activeVideo) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      // video.currentTime is the single source of truth for player, timeline and transcript.
      const current = model.clampTime(video.currentTime, video.duration);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const controls = controlsFor(video);
      const seek = controls?.querySelector("[data-core-seek]");
      const time = controls?.querySelector("[data-core-time]");
      if (seek) seek.value = String(Math.round(model.seekRatio(video.currentTime, video.duration) * 1000));
      if (time) time.textContent = model.formatClock(current) + " / " + model.formatClock(duration);
      setPlayingUi(video);
      const activeIndex = updateTranscript(video, current, forceScroll);
      updateTimeline(video, current, duration, activeIndex);
    });
  }

  function stopFrameSync(video) {
    const id = frameCallbacks.get(video);
    if (id != null && typeof video.cancelVideoFrameCallback === "function") {
      try { video.cancelVideoFrameCallback(id); } catch {}
    }
    frameCallbacks.delete(video);
  }

  function startFrameSync(video) {
    stopFrameSync(video);
    if (typeof video.requestVideoFrameCallback !== "function" || video.paused || video.ended) return;
    const tick = () => {
      if (video !== activeVideo || video.paused || video.ended) {
        stopFrameSync(video);
        return;
      }
      updateFromPlayback(video);
      frameCallbacks.set(video, video.requestVideoFrameCallback(tick));
    };
    frameCallbacks.set(video, video.requestVideoFrameCallback(tick));
  }

  async function toggleFullscreen(host) {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (host?.requestFullscreen) await host.requestFullscreen();
    } catch {}
  }

  function makeTimeline(video, host) {
    let timeline = host.querySelector(".core-player-timeline");
    if (timeline) return timeline;

    timeline = document.createElement("div");
    timeline.className = "core-player-timeline";
    timeline.setAttribute("aria-label", "Transcript timeline");
    timeline.innerHTML = '<div class="core-timeline-track" data-core-timeline-track><span class="core-timeline-playhead" data-core-playhead></span></div>';
    host.appendChild(timeline);

    const track = timeline.querySelector("[data-core-timeline-track]");
    track?.addEventListener("click", event => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      seekVideo(video, ratio * video.duration);
    });
    return timeline;
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
      seekVideo(video, (Number(seek.value) / 1000) * duration);
    });

    controls.querySelector("[data-core-fullscreen]")?.addEventListener("click", () => toggleFullscreen(host));
    return controls;
  }

  function enhanceVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = video.closest(".preview");
    if (!host) return;
    activeVideo = video;

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
    makeTimeline(video, host);
    makeControls(video, host);
    enhanceTranscriptRows(video);
    renderTimelineSegments(video);

    if (!resizeObservers.has(video) && typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => updateFromPlayback(video));
      observer.observe(host);
      resizeObservers.set(video, observer);
    }

    if (enhancedVideos.has(video)) {
      updateFromPlayback(video);
      if (!video.paused) startFrameSync(video);
      return;
    }
    enhancedVideos.add(video);

    ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended"].forEach(name => {
      video.addEventListener(name, () => {
        if (name === "play") startFrameSync(video);
        if (name === "pause" || name === "ended") stopFrameSync(video);
        updateFromPlayback(video, { forceScroll: name === "seeked" });
      });
    });

    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        host.style.setProperty("--core-video-ratio", video.videoWidth + " / " + video.videoHeight);
        host.dataset.videoRatio = (video.videoWidth / video.videoHeight).toFixed(4);
      }
      invalidateTranscriptCache(video);
      enhanceTranscriptRows(video);
      renderTimelineSegments(video);
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

  window.addEventListener("viral-ai:transcript-workstation-ready", () => {
    if (!activeVideo) return;
    invalidateTranscriptCache(activeVideo);
    enhanceTranscriptRows(activeVideo);
    renderTimelineSegments(activeVideo);
    updateFromPlayback(activeVideo, { forceScroll: false });
  });
  window.addEventListener("resize", () => activeVideo && updateFromPlayback(activeVideo));
  document.addEventListener("fullscreenchange", () => activeVideo && updateFromPlayback(activeVideo));
})();
