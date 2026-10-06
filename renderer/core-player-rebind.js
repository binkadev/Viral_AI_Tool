(function installCorePlayerRebind() {
  "use strict";

  const wired = new WeakSet();
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

  function refresh(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = video.closest(".preview");
    if (!(host instanceof HTMLElement)) return;

    const duration = effectiveDuration(video);
    const current = Math.max(0, Math.min(Number(video.currentTime || 0), duration || Number(video.currentTime || 0)));
    const controls = host.querySelector(".core-player-controls");
    const time = controls?.querySelector("[data-core-time]");
    const seek = controls?.querySelector("[data-core-seek]");
    const playhead = host.querySelector("[data-core-playhead]");

    if (time && duration > 0) time.textContent = formatClock(current) + " / " + formatClock(duration);
    if (seek && duration > 0) seek.value = String(Math.round((current / duration) * 1000));
    if (playhead && duration > 0) playhead.style.left = String(Math.max(0, Math.min(100, (current / duration) * 100))) + "%";

    host.dataset.coreDurationResolved = duration > 0 ? "true" : "false";
  }

  function nudgeCorePlayer(video) {
    const host = video?.closest?.(".preview");
    if (!(host instanceof HTMLElement)) return;
    const marker = document.createComment("core-player-rebind");
    host.appendChild(marker);
    marker.remove();
  }

  function wire(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    refresh(video);
    if (wired.has(video)) return;
    wired.add(video);

    ["loadedmetadata", "durationchange", "loadeddata", "canplay", "progress", "timeupdate", "seeking", "seeked"].forEach(name => {
      video.addEventListener(name, () => refresh(video));
    });

    const host = video.closest(".preview");
    const seek = host?.querySelector("[data-core-seek]");
    if (seek instanceof HTMLInputElement) {
      seek.addEventListener("input", () => {
        const nativeDuration = Number(video.duration || 0);
        if (Number.isFinite(nativeDuration) && nativeDuration > 0) return;
        const duration = effectiveDuration(video);
        if (!duration) return;
        try { video.currentTime = (Number(seek.value || 0) / 1000) * duration; } catch {}
        refresh(video);
      }, true);
    }

    const track = host?.querySelector("[data-core-timeline-track]");
    if (track instanceof HTMLElement) {
      track.addEventListener("click", event => {
        const nativeDuration = Number(video.duration || 0);
        if (Number.isFinite(nativeDuration) && nativeDuration > 0) return;
        const duration = effectiveDuration(video);
        if (!duration) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        event.preventDefault();
        event.stopImmediatePropagation();
        try { video.currentTime = ratio * duration; } catch {}
        refresh(video);
      }, true);
    }
  }

  function scan() {
    queued = false;
    const video = document.querySelector("#page video.preview-video, #page video.core-player-media");
    if (video instanceof HTMLVideoElement) wire(video);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", () => {
      const video = document.querySelector("#page video.preview-video, #page video.core-player-media");
      if (video instanceof HTMLVideoElement) {
        nudgeCorePlayer(video);
        refresh(video);
      }
      queue();
    });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
