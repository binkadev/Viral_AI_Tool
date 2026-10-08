(function installCorePlayerInteractions() {
  "use strict";

  let activeScrub = null;
  let suppressClickUntil = 0;

  function activeVideoFor(node) {
    const host = node?.closest?.(".preview.core-player-host, .preview.preview-real");
    return host?.querySelector?.("video.preview-video, video.core-player-media") || null;
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
    const api = window.ViralCorePlayerModel;
    if (api && typeof api.resolveDuration === "function") return api.resolveDuration(nativeDuration, seekableEnd(video), hint);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const seekable = seekableEnd(video);
    if (seekable > 0) return seekable;
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function announceSeek(video, source) {
    if (!(video instanceof HTMLVideoElement)) return;
    window.dispatchEvent(new CustomEvent("viral-ai:player-seek", {
      detail: {
        currentTime: Number(video.currentTime || 0),
        duration: durationFor(video),
        source: String(source || "interaction")
      }
    }));
  }

  function seekFromPointer(track, video, clientX) {
    if (!(track instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;
    const duration = durationFor(video);
    if (!duration) return;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (Number(clientX) - rect.left) / rect.width));
    video.currentTime = ratio * duration;
    video.dispatchEvent(new Event("seeking"));
    announceSeek(video, "pointer");
  }

  function wireTrack(track) {
    if (!(track instanceof HTMLElement) || track.dataset.coreScrubWired === "true") return;
    track.dataset.coreScrubWired = "true";

    track.addEventListener("click", event => {
      if (Date.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    track.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const video = activeVideoFor(track);
      if (!video) return;
      activeScrub = { track, video, pointerId: event.pointerId };
      try { track.setPointerCapture(event.pointerId); } catch {}
      seekFromPointer(track, video, event.clientX);
      event.preventDefault();
    });

    track.addEventListener("pointermove", event => {
      if (!activeScrub || activeScrub.track !== track || activeScrub.pointerId !== event.pointerId) return;
      seekFromPointer(track, activeScrub.video, event.clientX);
      event.preventDefault();
    });

    const finish = event => {
      if (!activeScrub || activeScrub.track !== track || activeScrub.pointerId !== event.pointerId) return;
      seekFromPointer(track, activeScrub.video, event.clientX);
      try { track.releasePointerCapture(event.pointerId); } catch {}
      const video = activeScrub.video;
      activeScrub = null;
      suppressClickUntil = Date.now() + 350;
      video.dispatchEvent(new Event("seeked"));
      announceSeek(video, "pointer-end");
    };

    track.addEventListener("pointerup", finish);
    track.addEventListener("pointercancel", event => {
      if (!activeScrub || activeScrub.track !== track || activeScrub.pointerId !== event.pointerId) return;
      activeScrub = null;
      suppressClickUntil = Date.now() + 350;
    });
  }

  function wireHost(host) {
    if (!(host instanceof HTMLElement) || host.dataset.coreKeyboardWired === "true") return;
    if (!(activeVideoFor(host) instanceof HTMLVideoElement)) return;
    host.dataset.coreKeyboardWired = "true";
    if (!host.hasAttribute("tabindex")) host.tabIndex = 0;
    host.setAttribute("aria-keyshortcuts", "Space K ArrowLeft ArrowRight");

    host.addEventListener("keydown", async event => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']")) return;

      const video = activeVideoFor(host);
      if (!(video instanceof HTMLVideoElement)) return;
      const duration = durationFor(video);
      if (event.key === " " || event.key === "k" || event.key === "K") {
        event.preventDefault();
        if (video.paused) {
          try { await video.play(); } catch {}
        } else video.pause();
        return;
      }

      if (!duration) return;
      let delta = 0;
      if (event.key === "ArrowLeft") delta = event.shiftKey ? -10 : -5;
      if (event.key === "ArrowRight") delta = event.shiftKey ? 10 : 5;
      if (!delta) return;
      event.preventDefault();
      video.currentTime = Math.max(0, Math.min(duration, Number(video.currentTime || 0) + delta));
      video.dispatchEvent(new Event("seeking"));
      video.dispatchEvent(new Event("seeked"));
      announceSeek(video, "keyboard");
    });
  }

  function scan() {
    document.querySelectorAll("[data-core-timeline-track]").forEach(wireTrack);
    document.querySelectorAll(".preview.core-player-host, .preview.preview-real").forEach(wireHost);
  }

  const observer = new MutationObserver(scan);
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true });
    scan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
