(function installCoreMediaHealth() {
  "use strict";

  const wired = new WeakSet();
  const wiredRetries = new WeakSet();
  const retryCount = new WeakMap();
  const timers = new WeakMap();
  const surfaceStates = new WeakMap();

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function copy() {
    return locale() === "en"
      ? {
          loading: "Opening video…",
          loadingBody: "Your video is being prepared for playback.",
          waiting: "Preparing video…",
          waitingBody: "Playback will continue when the video is ready.",
          failedTitle: "Video could not be played",
          failedBody: "Your original video is safe. You can try again or continue processing.",
          unsupportedBody: "This video format cannot be viewed directly in the app yet. Your original video is unchanged.",
          retry: "Try again"
        }
      : {
          loading: "Đang mở video…",
          loadingBody: "Video của bạn đang được chuẩn bị để phát.",
          waiting: "Đang chuẩn bị video…",
          waitingBody: "Video sẽ tiếp tục phát khi sẵn sàng.",
          failedTitle: "Chưa thể phát video",
          failedBody: "Video gốc vẫn an toàn. Bạn có thể thử lại hoặc tiếp tục xử lý.",
          unsupportedBody: "Định dạng video này chưa thể xem trực tiếp trong ứng dụng. Video gốc vẫn được giữ nguyên.",
          retry: "Thử lại"
        };
  }

  function hostFor(video) {
    return video?.closest?.(".preview.core-player-host, .preview.preview-real") || null;
  }

  function mediaFor(host) {
    const video = host?.querySelector?.("video.preview-video, video.core-player-media");
    return video instanceof HTMLVideoElement ? video : null;
  }

  function clearTimer(video) {
    const timer = timers.get(video);
    if (timer) clearTimeout(timer);
    timers.delete(video);
  }

  function ensureOverlay(host) {
    let overlay = host?.querySelector?.(".core-media-state");
    if (overlay || !(host instanceof HTMLElement)) return overlay;
    overlay = document.createElement("div");
    overlay.className = "core-media-state";
    overlay.hidden = true;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-atomic", "true");
    overlay.innerHTML = [
      '<div class="core-media-state-panel">',
      '<div class="core-media-state-icon" aria-hidden="true"><span data-media-state-symbol></span></div>',
      '<div class="core-media-state-copy"><b data-media-state-title></b><span data-media-state-body></span></div>',
      '<div class="core-media-progress" aria-hidden="true"><i></i></div>',
      '<button type="button" class="core-media-retry" data-media-retry></button>',
      '</div>'
    ].join("");
    host.appendChild(overlay);
    return overlay;
  }

  function wireRetry(host, overlay) {
    const retry = overlay?.querySelector?.("[data-media-retry]");
    if (!(host instanceof HTMLElement) || !(retry instanceof HTMLButtonElement) || wiredRetries.has(retry)) return;
    wiredRetries.add(retry);
    retry.addEventListener("click", () => {
      const video = mediaFor(host);
      if (!(video instanceof HTMLVideoElement)) return;
      retryCount.set(video, 0);
      setState(video, "loading");
      try { video.load(); } catch {}
      armMetadataTimeout(video);
    });
  }

  function renderState(video, state, details = {}, logFailure = false) {
    const host = hostFor(video);
    if (!(host instanceof HTMLElement)) return;
    const overlay = ensureOverlay(host);
    if (!(overlay instanceof HTMLElement)) return;
    wireRetry(host, overlay);

    const c = copy();
    host.dataset.coreMediaState = state;
    overlay.dataset.state = state;

    if (state === "ready") {
      overlay.hidden = true;
      return;
    }

    const title = overlay.querySelector("[data-media-state-title]");
    const body = overlay.querySelector("[data-media-state-body]");
    const symbol = overlay.querySelector("[data-media-state-symbol]");
    const retry = overlay.querySelector("[data-media-retry]");

    overlay.hidden = false;

    if (state === "loading" || state === "waiting") {
      if (title) title.textContent = state === "loading" ? c.loading : c.waiting;
      if (body) body.textContent = state === "loading" ? c.loadingBody : c.waitingBody;
      if (symbol) symbol.textContent = "";
      if (retry) retry.hidden = true;
      return;
    }

    const unsupported = Number(details.errorCode) === 4;
    if (title) title.textContent = c.failedTitle;
    if (body) body.textContent = unsupported ? c.unsupportedBody : c.failedBody;
    if (symbol) symbol.textContent = "!";
    if (retry) {
      retry.hidden = false;
      retry.textContent = c.retry;
    }

    if (logFailure) {
      console.warn("[CoreMediaPreview]", {
        state,
        errorCode: details.errorCode || null,
        networkState: video.networkState,
        readyState: video.readyState,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        videoWidth: video.videoWidth || 0,
        videoHeight: video.videoHeight || 0,
        src: String(video.currentSrc || video.src || "")
      });
    }
  }

  function setState(video, state, details = {}) {
    surfaceStates.set(video, { state, details });
    renderState(video, state, details, state === "failed");
  }

  function syncSurface(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const host = hostFor(video);
    if (!(host instanceof HTMLElement)) return;
    const overlay = ensureOverlay(host);
    wireRetry(host, overlay);

    const saved = surfaceStates.get(video);
    if (saved) {
      renderState(video, saved.state, saved.details, false);
      return;
    }

    if (video.error) renderState(video, "failed", { errorCode: video.error?.code || 0 }, false);
    else if (video.readyState >= 1 && Number(video.duration) > 0) renderState(video, "ready", {}, false);
    else renderState(video, "loading", {}, false);
  }

  function armMetadataTimeout(video) {
    clearTimer(video);
    const timer = setTimeout(() => {
      if (!video.isConnected || video.readyState >= 1 || Number(video.duration) > 0) return;
      const attempts = retryCount.get(video) || 0;
      if (attempts < 1) {
        retryCount.set(video, attempts + 1);
        try { video.load(); } catch {}
        setState(video, "waiting");
        armMetadataTimeout(video);
        return;
      }
      setState(video, "failed", { errorCode: video.error?.code || 0 });
    }, 2600);
    timers.set(video, timer);
  }

  function wire(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    syncSurface(video);
    if (wired.has(video)) return;
    wired.add(video);

    video.addEventListener("loadstart", () => {
      setState(video, "loading");
      armMetadataTimeout(video);
    });
    video.addEventListener("loadedmetadata", () => {
      clearTimer(video);
      setState(video, "ready");
    });
    video.addEventListener("canplay", () => {
      clearTimer(video);
      setState(video, "ready");
    });
    video.addEventListener("waiting", () => {
      if (video.readyState < 3) setState(video, "waiting");
    });
    video.addEventListener("stalled", () => {
      if (video.readyState < 2) setState(video, "waiting");
    });
    video.addEventListener("error", () => {
      clearTimer(video);
      setState(video, "failed", { errorCode: video.error?.code || 0 });
    });

    try {
      const current = typeof state !== "undefined"
        ? state?.jobs?.find?.(job => !job?.isRenderOutput && job?.sourcePath)
        : null;
      if (current?.thumbnail && !video.poster) video.poster = current.thumbnail;
    } catch {}

    if (video.readyState >= 1 && Number(video.duration) > 0) setState(video, "ready");
    else {
      setState(video, "loading");
      armMetadataTimeout(video);
    }
  }

  function scan() {
    document.querySelectorAll("video.preview-video, video.core-player-media").forEach(wire);
  }

  const observer = new MutationObserver(scan);
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", scan);
    scan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
