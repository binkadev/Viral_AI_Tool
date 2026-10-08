(function installCorePlayerWorkstationControls() {
  "use strict";

  const wiredVideos = new WeakSet();
  let scanQueued = false;

  function labels() {
    const vi = document.documentElement.lang !== "en";
    return vi
      ? { mute: "Tắt tiếng", unmute: "Bật tiếng", volume: "Âm lượng" }
      : { mute: "Mute", unmute: "Unmute", volume: "Volume" };
  }

  function volumeIcon(silent) {
    return silent
      ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="m17 9 4 6m0-6-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="M17 9.2c1 .8 1.5 1.7 1.5 2.8S18 14 17 14.8M19 7c1.7 1.4 2.6 3 2.6 5S20.7 15.6 19 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }

  function mediaFor(host) {
    const video = host?.querySelector?.("video.preview-video, video.core-player-media");
    return video instanceof HTMLVideoElement ? video : null;
  }

  function sync(host, controls) {
    const video = mediaFor(host);
    if (!(video instanceof HTMLVideoElement) || !(controls instanceof HTMLElement)) return;
    const button = controls.querySelector("[data-core-mute]");
    const slider = controls.querySelector("[data-core-volume]");
    const copy = labels();
    const silent = video.muted || Number(video.volume) <= 0.001;

    if (button instanceof HTMLButtonElement) {
      button.innerHTML = volumeIcon(silent);
      button.setAttribute("aria-label", silent ? copy.unmute : copy.mute);
      button.title = silent ? copy.unmute : copy.mute;
      button.setAttribute("aria-pressed", silent ? "true" : "false");
    }
    if (slider instanceof HTMLInputElement && document.activeElement !== slider) {
      slider.value = String(video.muted ? 0 : Number(video.volume));
      slider.setAttribute("aria-label", copy.volume);
      slider.title = copy.volume;
    }
  }

  function wireVideo(video, host, controls) {
    if (!(video instanceof HTMLVideoElement) || wiredVideos.has(video)) return;
    wiredVideos.add(video);
    video.addEventListener("volumechange", () => {
      if (mediaFor(host) !== video) return;
      sync(host, controls);
    });
  }

  function wire(host) {
    if (!(host instanceof HTMLElement)) return;
    const video = mediaFor(host);
    const controls = host.querySelector(".core-player-controls");
    if (!(video instanceof HTMLVideoElement) || !(controls instanceof HTMLElement)) return;

    wireVideo(video, host, controls);

    if (controls.dataset.coreVolumeWired === "true") {
      sync(host, controls);
      return;
    }
    controls.dataset.coreVolumeWired = "true";

    const fullscreen = controls.querySelector("[data-core-fullscreen]");
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "core-player-button core-player-mute";
    mute.dataset.coreMute = "true";
    mute.dataset.coreCapability = "functional";

    const volume = document.createElement("input");
    volume.className = "core-player-volume";
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = "0.01";
    volume.dataset.coreVolume = "true";

    if (fullscreen) {
      controls.insertBefore(mute, fullscreen);
      controls.insertBefore(volume, fullscreen);
    } else {
      controls.append(mute, volume);
    }

    mute.addEventListener("click", () => {
      const currentVideo = mediaFor(host);
      if (!(currentVideo instanceof HTMLVideoElement)) return;
      if (currentVideo.muted || Number(currentVideo.volume) <= 0.001) {
        if (Number(currentVideo.volume) <= 0.001) currentVideo.volume = 0.5;
        currentVideo.muted = false;
      } else {
        currentVideo.muted = true;
      }
      sync(host, controls);
    });

    volume.addEventListener("input", () => {
      const currentVideo = mediaFor(host);
      if (!(currentVideo instanceof HTMLVideoElement)) return;
      const next = Math.max(0, Math.min(1, Number(volume.value || 0)));
      currentVideo.volume = next;
      currentVideo.muted = next <= 0.001;
      sync(host, controls);
    });

    window.addEventListener("viral-ai:core-state-changed", () => sync(host, controls));
    new MutationObserver(() => sync(host, controls)).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    sync(host, controls);
  }

  function scan() {
    scanQueued = false;
    document.querySelectorAll(".preview.core-player-host, .preview.preview-real").forEach(wire);
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueScan).observe(page, { childList: true, subtree: true });
    queueScan();
    document.documentElement.dataset.corePlayerWorkstation = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
