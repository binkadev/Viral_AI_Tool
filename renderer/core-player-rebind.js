(function installCorePlayerRebind() {
  "use strict";

  const wired = new WeakSet();
  const wiredSeeks = new WeakSet();
  const wiredTracks = new WeakSet();
  const surfaceObservers = new WeakMap();
  let queued = false;

  function parseDurationHint(video) {
    const direct = Number(video?.dataset?.coreDurationHint || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return 0;
  }

  function seekableDuration(video) {
    try {
      if (video.seekable?.length) {
        const end = Number(video.seekable.end(video.seekable.length - 1));
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch {}
    return 0;
  }

  function effectiveDuration(video) {
    const nativeDuration = Number(video?.duration || 0);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    return seekableDuration(video) || parseDurationHint(video);
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (h ? String(h).padStart(2, "0") + ":" : "") +
      String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function normalizeVideoSurface(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = video.closest(".preview");
    if (!(host instanceof HTMLElement)) return;

    video.style.setProperty("object-fit", "contain", "important");
    video.style.setProperty("object-position", "center center", "important");
    video.style.setProperty("max-width", "100%", "important");
    video.style.setProperty("max-height", "100%", "important");
    video.style.setProperty("width", "100%", "important");
    video.style.setProperty("height", "100%", "important");
    video.style.setProperty("transform", "none", "important");

    host.dataset.coreMediaFit = "contain";
  }

  function syncEditorDock(video, duration, current) {
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-docked-page")) return;

    const currentVideo = page.querySelector(".core-editor-focus-section video.preview-video, .core-editor-focus-section video.core-player-media");
    if (currentVideo !== video) return;

    const dock = page.querySelector(".core-editor-bottom-dock");
    if (!(dock instanceof HTMLElement)) return;

    const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
    const playhead = dock.querySelector("[data-bottom-playhead]");
    const time = dock.querySelector("[data-bottom-time]");

    if (playhead instanceof HTMLElement) playhead.style.left = String(ratio * 100) + "%";
    if (time instanceof HTMLOutputElement) {
      time.textContent = duration > 0
        ? formatClock(current) + " / " + formatClock(duration)
        : formatClock(current) + " / --:--";
    }

    dock.querySelectorAll(".core-bottom-segment").forEach(segment => {
      const start = Number(segment.dataset.start || 0);
      const end = Number(segment.dataset.end || start);
      const active = duration > 0 && current >= start && (current < end || (current === duration && end === duration));
      segment.classList.toggle("is-active", active);
      segment.setAttribute("aria-current", active ? "true" : "false");
    });

    dock.dataset.corePlaybackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
    dock.dataset.coreMediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
  }

  function refresh(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = video.closest(".preview");
    if (!(host instanceof HTMLElement)) return;

    normalizeVideoSurface(video);

    const duration = effectiveDuration(video);
    const rawCurrent = Number(video.currentTime || 0);
    const current = Math.max(0, Math.min(rawCurrent, duration || rawCurrent));
    const controls = host.querySelector(".core-player-controls");
    const time = controls?.querySelector("[data-core-time]");
    const seek = controls?.querySelector("[data-core-seek]");
    const playhead = host.querySelector("[data-core-playhead]");
    const playButton = controls?.querySelector("[data-core-play], [data-core-toggle-play]");

    if (time) {
      time.textContent = duration > 0
        ? formatClock(current) + " / " + formatClock(duration)
        : formatClock(current) + " / --:--";
    }

    if (seek instanceof HTMLInputElement) {
      seek.disabled = !(duration > 0);
      if (duration > 0) seek.value = String(Math.round((current / duration) * 1000));
    }

    if (playhead instanceof HTMLElement) {
      playhead.style.left = duration > 0
        ? String(Math.max(0, Math.min(100, (current / duration) * 100))) + "%"
        : "0%";
    }

    if (playButton instanceof HTMLElement) {
      playButton.dataset.playing = video.paused ? "false" : "true";
      playButton.setAttribute("aria-pressed", video.paused ? "false" : "true");
    }

    host.dataset.coreDurationResolved = duration > 0 ? "true" : "false";
    host.dataset.corePlaybackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
    host.dataset.coreMediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
    syncEditorDock(video, duration, current);
  }

  function bindSurfaceResize(video, host) {
    if (!(video instanceof HTMLVideoElement) || !(host instanceof HTMLElement) || typeof ResizeObserver !== "function") return;
    const current = surfaceObservers.get(video);
    if (current?.host === host) return;
    try { current?.observer?.disconnect?.(); } catch {}

    const observer = new ResizeObserver(() => {
      if (video.closest(".preview") !== host) return;
      refresh(video);
    });
    observer.observe(host);
    surfaceObservers.set(video, { host, observer });
  }

  function nudgeCorePlayer(video) {
    const host = video?.closest?.(".preview");
    if (!(host instanceof HTMLElement)) return;
    const marker = document.createComment("core-player-rebind");
    host.appendChild(marker);
    marker.remove();
  }

  function seekToRatio(video, ratio) {
    const duration = effectiveDuration(video);
    if (!duration) return false;
    const safeRatio = Math.max(0, Math.min(1, Number(ratio || 0)));
    try {
      video.currentTime = safeRatio * duration;
      refresh(video);
      return true;
    } catch {
      return false;
    }
  }

  function currentSurfaceVideo(host, fallback) {
    const current = host?.querySelector?.("video.preview-video, video.core-player-media");
    return current instanceof HTMLVideoElement ? current : fallback;
  }

  function wireSurface(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = video.closest(".preview");
    if (!(host instanceof HTMLElement)) return;

    bindSurfaceResize(video, host);

    const seek = host.querySelector("[data-core-seek]");
    if (seek instanceof HTMLInputElement && !wiredSeeks.has(seek)) {
      wiredSeeks.add(seek);
      seek.addEventListener("input", event => {
        const currentVideo = currentSurfaceVideo(host, video);
        const duration = effectiveDuration(currentVideo);
        if (!duration) return;
        event.stopPropagation();
        seekToRatio(currentVideo, Number(seek.value || 0) / 1000);
      }, true);
    }

    const track = host.querySelector("[data-core-timeline-track]");
    if (track instanceof HTMLElement && !wiredTracks.has(track)) {
      wiredTracks.add(track);
      track.addEventListener("click", event => {
        const currentVideo = currentSurfaceVideo(host, video);
        const duration = effectiveDuration(currentVideo);
        if (!duration) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        event.preventDefault();
        event.stopImmediatePropagation();
        seekToRatio(currentVideo, ratio);
      }, true);
    }
  }

  function wire(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    refresh(video);
    wireSurface(video);
    if (wired.has(video)) return;
    wired.add(video);

    [
      "loadedmetadata", "durationchange", "loadeddata", "canplay", "canplaythrough",
      "progress", "timeupdate", "seeking", "seeked", "play", "pause", "ended",
      "emptied", "stalled", "suspend", "waiting", "resize"
    ].forEach(name => {
      video.addEventListener(name, () => refresh(video));
    });
  }

  function scan() {
    queued = false;
    document.querySelectorAll("#page video.preview-video, #page video.core-player-media").forEach(video => {
      if (video instanceof HTMLVideoElement) wire(video);
    });
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(queue).observe(page, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "class"]
      });
    }

    window.addEventListener("resize", queue, { passive: true });
    window.addEventListener("viral-ai:editor-preview-preserved", () => {
      document.querySelectorAll("#page video.preview-video, #page video.core-player-media").forEach(video => {
        if (video instanceof HTMLVideoElement) {
          nudgeCorePlayer(video);
          wireSurface(video);
          refresh(video);
        }
      });
      queue();
    });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
