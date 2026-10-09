(function installCoreEditorBottomDock() {
  "use strict";

  const TAB_KEY = "viral-ai-core-editor-bottom-tab";
  const HEIGHT_KEY = "viral-ai-core-editor-bottom-height";
  const COLLAPSED_KEY = "viral-ai-core-editor-bottom-collapsed";
  const ZOOM_KEY = "viral-ai-core-editor-timeline-zoom";
  const DEFAULT_HEIGHT = 190;
  const MIN_HEIGHT = 132;
  const MAX_HEIGHT = 420;
  const wiredVideos = new WeakSet();
  let queued = false;

  function setTextIfChanged(node, value) {
    if (!(node instanceof Node)) return;
    const next = String(value ?? "");
    if (node.textContent !== next) node.textContent = next;
  }

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
          label: "Timeline and transcript",
          timeline: "Timeline",
          transcript: "Transcript",
          timelineEmpty: "Transcript clips will appear on SUB after speech recognition.",
          transcriptEmpty: "No transcript yet. Run Speech to create editable timed segments.",
          sourceVideo: "Source video",
          sourceAudio: "Source audio",
          subtitles: "Transcript",
          collapse: "Collapse timeline",
          expand: "Expand timeline",
          zoom: "Timeline zoom"
        }
      : {
          label: "Dòng thời gian và transcript",
          timeline: "Dòng thời gian",
          transcript: "Transcript",
          timelineEmpty: "Các clip transcript sẽ xuất hiện trên track SUB sau khi nhận diện lời nói.",
          transcriptEmpty: "Chưa có transcript. Chạy Nhận diện lời nói để tạo các đoạn có mốc thời gian.",
          sourceVideo: "Video nguồn",
          sourceAudio: "Âm thanh nguồn",
          subtitles: "Transcript",
          collapse: "Thu gọn timeline",
          expand: "Mở timeline",
          zoom: "Thu phóng timeline"
        };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function formatClock(value) {
    const total = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    if (hours > 0) return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function durationFor(video) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function selectedTab() {
    return localStorage.getItem(TAB_KEY) === "transcript" ? "transcript" : "timeline";
  }

  function storedHeight() {
    return clamp(localStorage.getItem(HEIGHT_KEY) || DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT) || DEFAULT_HEIGHT;
  }

  function storedZoom() {
    return clamp(localStorage.getItem(ZOOM_KEY) || 1, 1, 4) || 1;
  }

  function isCollapsed() {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  }

  function setTab(dock, value) {
    const next = value === "transcript" ? "transcript" : "timeline";
    localStorage.setItem(TAB_KEY, next);
    dock.querySelectorAll("[data-bottom-tab]").forEach(button => {
      const active = button.dataset.bottomTab === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    dock.querySelectorAll("[data-bottom-pane]").forEach(pane => {
      pane.hidden = pane.dataset.bottomPane !== next;
    });
  }

  function applyHeight(dock, value, persist = true) {
    const height = clamp(value, MIN_HEIGHT, MAX_HEIGHT) || DEFAULT_HEIGHT;
    dock.style.setProperty("--core-bottom-dock-height", height + "px");
    if (persist) localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
  }

  function applyCollapsed(dock, collapsed, persist = true) {
    const c = copy();
    dock.classList.toggle("is-collapsed", collapsed);
    const button = dock.querySelector("[data-bottom-collapse]");
    if (button instanceof HTMLButtonElement) {
      setTextIfChanged(button, collapsed ? "⌃" : "⌄");
      const nextTitle = collapsed ? c.expand : c.collapse;
      if (button.title !== nextTitle) button.title = nextTitle;
      button.setAttribute("aria-label", nextTitle);
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    if (persist) localStorage.setItem(COLLAPSED_KEY, collapsed ? "true" : "false");
  }

  function applyZoom(dock, zoom, persist = true) {
    const value = clamp(zoom, 1, 4) || 1;
    const stage = dock.querySelector("[data-timeline-stage]");
    const input = dock.querySelector("[data-bottom-zoom]");
    if (stage instanceof HTMLElement) stage.style.width = (value * 100) + "%";
    if (input instanceof HTMLInputElement) input.value = String(value);
    if (persist) localStorage.setItem(ZOOM_KEY, String(value));
  }

  function ensureDock(page, focus) {
    let dock = page.querySelector(":scope > .core-editor-bottom-dock");
    if (dock instanceof HTMLElement) return dock;

    const c = copy();
    dock = document.createElement("section");
    dock.className = "core-editor-bottom-dock";
    dock.setAttribute("aria-label", c.label);
    dock.innerHTML =
      '<button type="button" class="core-bottom-resize-handle" data-bottom-resize aria-label="Resize timeline"></button>' +
      '<div class="core-bottom-dock-head">' +
        '<div class="core-bottom-tabs" role="tablist" aria-label="' + c.label + '">' +
          '<button type="button" class="core-bottom-tab" data-bottom-tab="timeline" role="tab">' + c.timeline + '</button>' +
          '<button type="button" class="core-bottom-tab" data-bottom-tab="transcript" role="tab">' + c.transcript + '</button>' +
        '</div>' +
        '<div class="core-bottom-tools">' +
          '<label class="core-bottom-zoom" title="' + c.zoom + '"><span>−</span><input type="range" min="1" max="4" step="0.25" value="1" data-bottom-zoom aria-label="' + c.zoom + '"><span>+</span></label>' +
          '<output class="core-bottom-time" data-bottom-time>00:00 / 00:00</output>' +
          '<button type="button" class="core-bottom-collapse" data-bottom-collapse aria-expanded="true">⌄</button>' +
        '</div>' +
      '</div>' +
      '<div class="core-bottom-pane core-bottom-timeline-pane" data-bottom-pane="timeline">' +
        '<div class="core-timeline-workspace">' +
          '<div class="core-track-labels" aria-hidden="true">' +
            '<div class="core-track-label ruler-label"></div>' +
            '<div class="core-track-label"><b>V1</b><span>' + c.sourceVideo + '</span></div>' +
            '<div class="core-track-label" data-audio-label><b>A1</b><span>' + c.sourceAudio + '</span></div>' +
            '<div class="core-track-label"><b>SUB</b><span>' + c.subtitles + '</span></div>' +
          '</div>' +
          '<div class="core-timeline-scroll" data-timeline-scroll>' +
            '<div class="core-timeline-stage" data-timeline-stage>' +
              '<div class="core-time-ruler" data-time-ruler></div>' +
              '<div class="core-track-lane core-track-video" data-track-video></div>' +
              '<div class="core-track-lane core-track-audio" data-track-audio></div>' +
              '<div class="core-track-lane core-track-subtitle" data-track-subtitle></div>' +
              '<span class="core-bottom-playhead" data-bottom-playhead></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="core-bottom-empty" data-bottom-timeline-empty>' + c.timelineEmpty + '</div>' +
      '</div>' +
      '<div class="core-bottom-pane core-bottom-transcript-pane" data-bottom-pane="transcript" hidden>' +
        '<div class="core-bottom-empty" data-bottom-transcript-empty>' + c.transcriptEmpty + '</div>' +
      '</div>';

    focus.insertAdjacentElement("afterend", dock);
    applyHeight(dock, storedHeight(), false);
    applyZoom(dock, storedZoom(), false);
    applyCollapsed(dock, isCollapsed(), false);

    dock.querySelectorAll("[data-bottom-tab]").forEach(button => {
      button.addEventListener("click", () => setTab(dock, button.dataset.bottomTab));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const next = button.dataset.bottomTab === "timeline" ? "transcript" : "timeline";
        setTab(dock, next);
        dock.querySelector('[data-bottom-tab="' + next + '"]')?.focus();
      });
    });

    const zoom = dock.querySelector("[data-bottom-zoom]");
    zoom?.addEventListener("input", () => applyZoom(dock, Number(zoom.value)));

    dock.querySelector("[data-bottom-collapse]")?.addEventListener("click", () => {
      applyCollapsed(dock, !dock.classList.contains("is-collapsed"));
    });

    const handle = dock.querySelector("[data-bottom-resize]");
    handle?.addEventListener("dblclick", () => applyHeight(dock, DEFAULT_HEIGHT));
    handle?.addEventListener("pointerdown", event => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = dock.getBoundingClientRect().height;
      handle.setPointerCapture?.(event.pointerId);
      document.documentElement.classList.add("core-timeline-resizing");

      const move = moveEvent => {
        const next = startHeight + (startY - moveEvent.clientY);
        applyHeight(dock, next, false);
      };
      const end = endEvent => {
        handle.releasePointerCapture?.(endEvent.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        document.documentElement.classList.remove("core-timeline-resizing");
        applyHeight(dock, dock.getBoundingClientRect().height, true);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });

    setTab(dock, selectedTab());
    return dock;
  }

  function activeVideo(focus) {
    return focus?.querySelector("video.preview-video, video.core-player-media") || null;
  }

  function seek(video, time) {
    if (!(video instanceof HTMLVideoElement)) return;
    const duration = durationFor(video);
    if (!duration) return;
    video.currentTime = clamp(time, 0, duration);
    video.dispatchEvent(new Event("seeking"));
  }

  function segmentData() {
    return Array.from(document.querySelectorAll(".transcript-list .transcript-row")).map((row, index) => ({
      row,
      index,
      start: Number(row.dataset.start || 0),
      end: Number(row.dataset.end || 0),
      text: String(row.querySelector("p")?.textContent || "").trim()
    }));
  }

  function sourceHasAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    try {
      if (video.audioTracks && video.audioTracks.length > 0) return true;
    } catch {}
    try {
      if (Number(video.webkitAudioDecodedByteCount || 0) > 0) return true;
    } catch {}
    try {
      const capture = video.captureStream || video.mozCaptureStream;
      if (typeof capture === "function") {
        const stream = capture.call(video);
        if (stream?.getAudioTracks?.().length > 0) return true;
      }
    } catch {}
    return false;
  }

  function renderRuler(dock, duration) {
    const ruler = dock.querySelector("[data-time-ruler]");
    if (!(ruler instanceof HTMLElement)) return;
    const divisions = duration <= 30 ? 6 : duration <= 120 ? 8 : 10;
    const signature = duration.toFixed(3) + "|" + divisions;
    if (ruler.dataset.signature === signature) return;
    ruler.dataset.signature = signature;
    ruler.innerHTML = "";
    for (let index = 0; index <= divisions; index += 1) {
      const ratio = index / divisions;
      const tick = document.createElement("span");
      tick.className = "core-ruler-tick";
      tick.style.left = (ratio * 100) + "%";
      tick.innerHTML = '<i></i><time>' + formatClock(duration * ratio) + '</time>';
      ruler.appendChild(tick);
    }
  }

  function ensureSourceClips(dock, video, duration) {
    const videoLane = dock.querySelector("[data-track-video]");
    const audioLane = dock.querySelector("[data-track-audio]");
    const audioLabel = dock.querySelector("[data-audio-label]");
    if (videoLane instanceof HTMLElement && !videoLane.querySelector(".core-source-clip")) {
      const clip = document.createElement("button");
      clip.type = "button";
      clip.className = "core-source-clip core-video-clip";
      clip.innerHTML = '<span>V1</span><b>' + (locale() === "en" ? "Source" : "Nguồn") + '</b>';
      clip.addEventListener("click", event => { event.stopPropagation(); seek(video, 0); });
      videoLane.appendChild(clip);
    }

    const hasAudio = sourceHasAudio(video);
    audioLane?.classList.toggle("is-unavailable", !hasAudio);
    audioLabel?.classList.toggle("is-unavailable", !hasAudio);
    if (audioLane instanceof HTMLElement) {
      let clip = audioLane.querySelector(".core-source-clip");
      if (hasAudio && !clip) {
        clip = document.createElement("button");
        clip.type = "button";
        clip.className = "core-source-clip core-audio-clip";
        clip.innerHTML = '<span>A1</span><b>' + (locale() === "en" ? "Original" : "Gốc") + '</b>';
        clip.addEventListener("click", event => { event.stopPropagation(); seek(video, 0); });
        audioLane.appendChild(clip);
      } else if (!hasAudio && clip) {
        clip.remove();
      }
    }

    [videoLane, audioLane].forEach(lane => {
      const clip = lane?.querySelector(".core-source-clip");
      if (clip instanceof HTMLElement) clip.style.width = duration > 0 ? "100%" : "0%";
    });
  }

  function renderSegments(dock, video, duration) {
    const lane = dock.querySelector("[data-track-subtitle]");
    const empty = dock.querySelector("[data-bottom-timeline-empty]");
    if (!(lane instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    const segments = segmentData().filter(item => Number.isFinite(item.start));
    const signature = duration.toFixed(3) + "|" + segments.map(item => item.start + ":" + item.end + ":" + item.text).join("|");
    if (lane.dataset.segmentSignature === signature) return;
    lane.dataset.segmentSignature = signature;
    lane.querySelectorAll(".core-bottom-segment").forEach(node => node.remove());

    empty.hidden = segments.length > 0;
    if (!duration || !segments.length) return;

    segments.forEach(item => {
      const start = clamp(item.start, 0, duration);
      const rawEnd = Number.isFinite(item.end) && item.end > start ? item.end : start + Math.max(.15, duration * .015);
      const end = clamp(rawEnd, start, duration);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "core-bottom-segment";
      button.dataset.segmentIndex = String(item.index);
      button.dataset.start = String(start);
      button.dataset.end = String(end);
      button.style.left = (start / duration * 100) + "%";
      button.style.width = Math.max(.5, (end - start) / duration * 100) + "%";
      button.title = formatClock(start) + " – " + formatClock(end) + (item.text ? " · " + item.text : "");
      button.setAttribute("aria-label", "Seek to transcript segment " + (item.index + 1));
      if (item.text) button.innerHTML = '<span>' + item.text.replace(/[&<>\"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[char])) + '</span>';
      button.addEventListener("click", event => {
        event.stopPropagation();
        seek(video, start);
        item.row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      });
      lane.appendChild(button);
    });
  }

  function setActiveSegment(dock, current) {
    dock.querySelectorAll(".core-bottom-segment").forEach(segment => {
      const start = Number(segment.dataset.start || 0);
      const end = Number(segment.dataset.end || start);
      const active = current >= start && current < end;
      segment.classList.toggle("is-active", active);
      segment.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function sync(dock, video) {
    if (!(dock instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;
    const duration = durationFor(video);
    const current = clamp(video.currentTime || 0, 0, duration || 0);
    const ratio = duration > 0 ? current / duration : 0;
    const playhead = dock.querySelector("[data-bottom-playhead]");
    const time = dock.querySelector("[data-bottom-time]");

    if (playhead instanceof HTMLElement) playhead.style.left = (ratio * 100) + "%";
    if (time instanceof HTMLOutputElement) setTextIfChanged(time, formatClock(current) + " / " + formatClock(duration));

    renderRuler(dock, duration);
    ensureSourceClips(dock, video, duration);
    renderSegments(dock, video, duration);
    setActiveSegment(dock, current);
  }

  function wireTimelineSeeking(dock, video) {
    const stage = dock.querySelector("[data-timeline-stage]");
    if (!(stage instanceof HTMLElement) || stage.dataset.seekWired === "true") return;
    stage.dataset.seekWired = "true";
    stage.addEventListener("click", event => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      const duration = durationFor(video);
      if (!duration) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      seek(video, ratio * duration);
    });
  }

  function wireVideo(dock, video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!wiredVideos.has(video)) {
      wiredVideos.add(video);
      ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "progress"].forEach(name => {
        video.addEventListener(name, () => sync(dock, video));
      });
    }
    wireTimelineSeeking(dock, video);
    sync(dock, video);
  }

  function dockTranscript(page, dock) {
    const pane = dock.querySelector('[data-bottom-pane="transcript"]');
    const empty = dock.querySelector("[data-bottom-transcript-empty]");
    if (!(pane instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    const result = page.querySelector(".speech-result");
    if (result instanceof HTMLElement) {
      if (result.parentElement !== pane) pane.appendChild(result);
      result.classList.add("core-transcript-dock");
      empty.hidden = true;
    } else {
      empty.hidden = false;
    }
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-focused-page")) return;
    const focus = page.querySelector(":scope > .core-editor-focus-section");
    if (!(focus instanceof HTMLElement)) return;

    const dock = ensureDock(page, focus);
    const video = activeVideo(focus);
    if (video instanceof HTMLVideoElement) wireVideo(dock, video);
    dockTranscript(page, dock);
    page.classList.add("core-editor-docked-page");
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
    window.addEventListener("viral-ai:bottom-dock-tab", event => {
      const page = document.getElementById("page");
      const dock = page?.querySelector(".core-editor-bottom-dock");
      if (!(dock instanceof HTMLElement)) return;
      applyCollapsed(dock, false);
      setTab(dock, event?.detail?.tab === "transcript" ? "transcript" : "timeline");
    });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
