(function installCoreEditorBottomDock() {
  "use strict";

  const TAB_KEY = "viral-ai-core-editor-bottom-tab";
  const wiredVideos = new WeakSet();
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
          label: "Timeline and transcript",
          timeline: "Timeline",
          transcript: "Transcript",
          timelineEmpty: "Transcript segments will appear here after speech recognition.",
          transcriptEmpty: "No transcript yet. Run Speech to create editable timed segments."
        }
      : {
          label: "Dòng thời gian và transcript",
          timeline: "Dòng thời gian",
          transcript: "Transcript",
          timelineEmpty: "Các phân đoạn sẽ xuất hiện tại đây sau khi nhận diện lời nói.",
          transcriptEmpty: "Chưa có transcript. Chạy Nhận diện lời nói để tạo các đoạn có mốc thời gian."
        };
  }

  function formatClock(value) {
    const total = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function selectedTab() {
    const value = localStorage.getItem(TAB_KEY);
    return value === "transcript" ? "transcript" : "timeline";
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

  function ensureDock(page, focus) {
    let dock = page.querySelector(":scope > .core-editor-bottom-dock");
    if (dock instanceof HTMLElement) return dock;

    const c = copy();
    dock = document.createElement("section");
    dock.className = "core-editor-bottom-dock";
    dock.setAttribute("aria-label", c.label);
    dock.innerHTML =
      '<div class="core-bottom-dock-head">' +
        '<div class="core-bottom-tabs" role="tablist" aria-label="' + c.label + '">' +
          '<button type="button" class="core-bottom-tab" data-bottom-tab="timeline" role="tab">' + c.timeline + '</button>' +
          '<button type="button" class="core-bottom-tab" data-bottom-tab="transcript" role="tab">' + c.transcript + '</button>' +
        '</div>' +
        '<output class="core-bottom-time" data-bottom-time>00:00 / 00:00</output>' +
      '</div>' +
      '<div class="core-bottom-pane core-bottom-timeline-pane" data-bottom-pane="timeline">' +
        '<div class="core-bottom-timeline-track" data-bottom-track role="slider" aria-label="Video timeline" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">' +
          '<span class="core-bottom-playhead" data-bottom-playhead></span>' +
        '</div>' +
        '<div class="core-bottom-empty" data-bottom-timeline-empty>' + c.timelineEmpty + '</div>' +
      '</div>' +
      '<div class="core-bottom-pane core-bottom-transcript-pane" data-bottom-pane="transcript" hidden>' +
        '<div class="core-bottom-empty" data-bottom-transcript-empty>' + c.transcriptEmpty + '</div>' +
      '</div>';

    focus.insertAdjacentElement("afterend", dock);

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

    setTab(dock, selectedTab());
    return dock;
  }

  function activeVideo(focus) {
    return focus?.querySelector("video.preview-video, video.core-player-media") || null;
  }

  function seek(video, time) {
    if (!(video instanceof HTMLVideoElement)) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) return;
    video.currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
  }

  function segmentData() {
    return Array.from(document.querySelectorAll(".transcript-list .transcript-row")).map((row, index) => ({
      row,
      index,
      start: Number(row.dataset.start || 0),
      end: Number(row.dataset.end || 0)
    }));
  }

  function renderSegments(dock, video) {
    const track = dock.querySelector("[data-bottom-track]");
    const empty = dock.querySelector("[data-bottom-timeline-empty]");
    if (!(track instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    const duration = Number.isFinite(video?.duration) ? video.duration : 0;
    const segments = segmentData().filter(item => Number.isFinite(item.start));
    const signature = String(duration) + "|" + segments.map(item => item.start + ":" + item.end).join("|");
    if (track.dataset.segmentSignature === signature) return;
    track.dataset.segmentSignature = signature;
    track.querySelectorAll(".core-bottom-segment").forEach(node => node.remove());

    empty.hidden = segments.length > 0;
    if (!duration || !segments.length) return;

    segments.forEach(item => {
      const start = Math.max(0, Math.min(duration, item.start));
      const rawEnd = Number.isFinite(item.end) && item.end > start ? item.end : start + Math.max(.15, duration * .015);
      const end = Math.max(start, Math.min(duration, rawEnd));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "core-bottom-segment";
      button.style.left = (start / duration * 100) + "%";
      button.style.width = Math.max(.35, (end - start) / duration * 100) + "%";
      button.title = formatClock(start) + " – " + formatClock(end);
      button.setAttribute("aria-label", "Seek to transcript segment " + (item.index + 1));
      button.addEventListener("click", event => {
        event.stopPropagation();
        seek(video, start);
      });
      track.appendChild(button);
    });
  }

  function sync(dock, video) {
    if (!(dock instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Math.max(0, Math.min(duration || 0, Number(video.currentTime || 0)));
    const ratio = duration > 0 ? current / duration : 0;
    const playhead = dock.querySelector("[data-bottom-playhead]");
    const time = dock.querySelector("[data-bottom-time]");
    const track = dock.querySelector("[data-bottom-track]");

    if (playhead instanceof HTMLElement) playhead.style.left = (ratio * 100) + "%";
    if (time instanceof HTMLOutputElement) time.textContent = formatClock(current) + " / " + formatClock(duration);
    if (track instanceof HTMLElement) {
      track.setAttribute("aria-valuemax", String(duration || 0));
      track.setAttribute("aria-valuenow", String(current));
      track.classList.toggle("is-disabled", !(duration > 0));
    }
    renderSegments(dock, video);
  }

  function wireVideo(dock, video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!wiredVideos.has(video)) {
      wiredVideos.add(video);
      ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended"].forEach(name => {
        video.addEventListener(name, () => sync(dock, video));
      });
    }

    const track = dock.querySelector("[data-bottom-track]");
    if (track instanceof HTMLElement && track.dataset.seekWired !== "true") {
      track.dataset.seekWired = "true";
      track.addEventListener("click", event => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!duration) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        seek(video, ratio * duration);
      });
    }
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
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
