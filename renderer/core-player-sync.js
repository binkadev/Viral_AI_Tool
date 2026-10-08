(function installCorePlayerSync() {
  "use strict";

  const wiredVideos = new WeakSet();
  let queued = false;

  function model() {
    return window.ViralCorePlayerModel || null;
  }

  function seekableEnd(video) {
    try {
      if (video?.seekable?.length) {
        const end = Number(video.seekable.end(video.seekable.length - 1));
        return Number.isFinite(end) && end > 0 ? end : 0;
      }
    } catch {}
    return 0;
  }

  function durationFor(video) {
    if (!(video instanceof HTMLVideoElement)) return 0;
    const nativeDuration = Number(video.duration || 0);
    const hint = Number(video.dataset.coreDurationHint || 0);
    const seekable = seekableEnd(video);
    const api = model();
    if (api && typeof api.resolveDuration === "function") {
      return api.resolveDuration(nativeDuration, seekable, hint);
    }
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    if (seekable > 0) return seekable;
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function formatClock(value) {
    const api = model();
    if (api && typeof api.formatClock === "function") return api.formatClock(value);
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function currentVideo() {
    const focused = document.querySelector("#page .core-editor-focus-section video.preview-video, #page .core-editor-focus-section video.core-player-media");
    if (focused instanceof HTMLVideoElement) return focused;
    const any = document.querySelector("#page video.preview-video, #page video.core-player-media");
    return any instanceof HTMLVideoElement ? any : null;
  }

  function sync(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const duration = durationFor(video);
    const current = duration > 0
      ? clamp(Number(video.currentTime || 0), 0, duration)
      : Math.max(0, Number(video.currentTime || 0));
    const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;

    document.querySelectorAll("#page [data-core-playhead]").forEach(node => {
      if (node instanceof HTMLElement) node.style.left = (ratio * 100) + "%";
    });
    document.querySelectorAll("#page [data-core-seek]").forEach(node => {
      if (!(node instanceof HTMLInputElement)) return;
      node.disabled = !(duration > 0);
      if (duration > 0) node.value = String(Math.round(ratio * 1000));
    });
    document.querySelectorAll("#page [data-core-time]").forEach(node => {
      node.textContent = duration > 0
        ? formatClock(current) + " / " + formatClock(duration)
        : formatClock(current) + " / --:--";
    });

    const dock = document.querySelector("#page .core-editor-bottom-dock");
    if (dock instanceof HTMLElement) {
      const bottomPlayhead = dock.querySelector("[data-bottom-playhead]");
      const bottomTime = dock.querySelector("[data-bottom-time]");
      if (bottomPlayhead instanceof HTMLElement) bottomPlayhead.style.left = (ratio * 100) + "%";
      if (bottomTime instanceof HTMLOutputElement || bottomTime instanceof HTMLElement) {
        bottomTime.textContent = duration > 0
          ? formatClock(current) + " / " + formatClock(duration)
          : formatClock(current) + " / --:--";
      }
      dock.dataset.playbackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
      dock.dataset.mediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
    }

    const host = video.closest(".preview");
    if (host instanceof HTMLElement) {
      host.dataset.coreDurationResolved = duration > 0 ? "true" : "false";
      host.dataset.corePlaybackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
      host.dataset.coreMediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
    }

    window.dispatchEvent(new CustomEvent("viral-ai:player-sync", {
      detail: { currentTime: current, duration, ratio, paused: video.paused, ended: video.ended }
    }));
  }

  function wire(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    sync(video);
    if (wiredVideos.has(video)) return;
    wiredVideos.add(video);
    [
      "loadedmetadata", "durationchange", "loadeddata", "canplay", "progress",
      "timeupdate", "seeking", "seeked", "play", "pause", "ended", "emptied"
    ].forEach(name => video.addEventListener(name, () => sync(video), { passive: true }));
  }

  function scan() {
    queued = false;
    document.querySelectorAll("#page video.preview-video, #page video.core-player-media").forEach(wire);
    const video = currentVideo();
    if (video) sync(video);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:player-seek", event => {
      const video = currentVideo();
      if (!video) return;
      const target = Number(event?.detail?.currentTime);
      if (Number.isFinite(target) && Math.abs(Number(video.currentTime || 0) - target) > 0.05) {
        try { video.currentTime = target; } catch {}
      }
      sync(video);
    });
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
