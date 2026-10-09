(function installCorePlayerSync() {
  "use strict";

  const wiredVideos = new WeakSet();
  let queued = false;

  function setTextIfChanged(node, value) {
    if (!(node instanceof Node)) return;
    const next = String(value ?? "");
    if (node.textContent !== next) node.textContent = next;
  }

  function model() { return window.ViralCorePlayerModel || null; }

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
    if (api && typeof api.resolveDuration === "function") return api.resolveDuration(nativeDuration, seekable, hint);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    if (seekable > 0) return seekable;
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

  function formatClock(value) {
    const api = model();
    if (api && typeof api.formatClock === "function") return api.formatClock(value);
    const total = Math.max(0, Math.floor(Number(value) || 0));
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function currentVideo() {
    const focused = document.querySelector("#page .core-editor-focus-section video.preview-video, #page .core-editor-focus-section video.core-player-media");
    if (focused instanceof HTMLVideoElement) return focused;
    const any = document.querySelector("#page video.preview-video, #page video.core-player-media");
    return any instanceof HTMLVideoElement ? any : null;
  }

  function isAuthoritativeVideo(video) {
    return video instanceof HTMLVideoElement && video.isConnected && currentVideo() === video;
  }

  function sync(video) {
    if (!isAuthoritativeVideo(video)) return;
    const duration = durationFor(video);
    const current = duration > 0 ? clamp(Number(video.currentTime || 0), 0, duration) : Math.max(0, Number(video.currentTime || 0));
    const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;
    const timeCopy = duration > 0 ? formatClock(current) + " / " + formatClock(duration) : formatClock(current) + " / --:--";

    document.querySelectorAll("#page [data-core-playhead]").forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      const nextLeft = (ratio * 100) + "%";
      if (node.style.left !== nextLeft) node.style.left = nextLeft;
    });
    document.querySelectorAll("#page [data-core-seek]").forEach(node => {
      if (!(node instanceof HTMLInputElement)) return;
      const disabled = !(duration > 0);
      if (node.disabled !== disabled) node.disabled = disabled;
      if (duration > 0) {
        const nextValue = String(Math.round(ratio * 1000));
        if (node.value !== nextValue) node.value = nextValue;
      }
    });
    document.querySelectorAll("#page [data-core-time]").forEach(node => {
      setTextIfChanged(node, timeCopy);
    });

    const dock = document.querySelector("#page .core-editor-bottom-dock");
    if (dock instanceof HTMLElement) {
      const bottomPlayhead = dock.querySelector("[data-bottom-playhead]");
      const bottomTime = dock.querySelector("[data-bottom-time]");
      if (bottomPlayhead instanceof HTMLElement) {
        const nextLeft = (ratio * 100) + "%";
        if (bottomPlayhead.style.left !== nextLeft) bottomPlayhead.style.left = nextLeft;
      }
      if (bottomTime instanceof HTMLElement) setTextIfChanged(bottomTime, timeCopy);
      const playbackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
      if (dock.dataset.playbackState !== playbackState) dock.dataset.playbackState = playbackState;
      const mediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
      if (dock.dataset.mediaReady !== mediaReady) dock.dataset.mediaReady = mediaReady;
    }

    const host = video.closest(".preview");
    if (host instanceof HTMLElement) {
      const resolved = duration > 0 ? "true" : "false";
      if (host.dataset.coreDurationResolved !== resolved) host.dataset.coreDurationResolved = resolved;
      const playbackState = video.ended ? "ended" : video.paused ? "paused" : "playing";
      if (host.dataset.corePlaybackState !== playbackState) host.dataset.corePlaybackState = playbackState;
      const mediaReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? "true" : "false";
      if (host.dataset.coreMediaReady !== mediaReady) host.dataset.coreMediaReady = mediaReady;
    }

    window.dispatchEvent(new CustomEvent("viral-ai:player-sync", { detail: { currentTime: current, duration, ratio, paused: video.paused, ended: video.ended } }));
  }

  function wire(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    sync(video);
    if (wiredVideos.has(video)) return;
    wiredVideos.add(video);
    ["loadedmetadata", "durationchange", "loadeddata", "canplay", "progress", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "emptied"]
      .forEach(name => video.addEventListener(name, () => {
        if (!isAuthoritativeVideo(video)) return;
        sync(video);
      }, { passive: true }));
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
