(function installCoreEditorTimelineInteractions() {
  "use strict";

  const wiredDocks = new WeakSet();
  const wiredVideos = new WeakSet();
  let suppressClickUntil = 0;
  let activeScrub = null;
  let lastManualScrollAt = 0;
  let queued = false;

  function editorPage() {
    const page = document.getElementById("page");
    return page?.classList?.contains("core-editor-docked-page") ? page : null;
  }

  function activeVideo(page = editorPage()) {
    return page?.querySelector?.(".core-editor-focus-section video.preview-video, .core-editor-focus-section video.core-player-media") || null;
  }

  function durationFor(video) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function seek(video, time) {
    if (!(video instanceof HTMLVideoElement)) return false;
    const duration = durationFor(video);
    if (!duration) return false;
    const target = clamp(time, 0, duration);
    if (Math.abs(Number(video.currentTime || 0) - target) > 0.002) video.currentTime = target;
    return true;
  }

  function pointerTime(stage, video, clientX) {
    const duration = durationFor(video);
    const rect = stage.getBoundingClientRect();
    if (!duration || !rect.width) return null;
    const ratio = clamp((Number(clientX) - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  }

  function scrollParts(dock) {
    return {
      scroll: dock?.querySelector?.("[data-timeline-scroll]") || null,
      stage: dock?.querySelector?.("[data-timeline-stage]") || null,
      playhead: dock?.querySelector?.("[data-bottom-playhead]") || null
    };
  }

  function clampScrollLeft(scroll, value) {
    if (!(scroll instanceof HTMLElement)) return 0;
    const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    return clamp(value, 0, max);
  }

  function revealPlayhead(dock, video, { center = false, force = false } = {}) {
    if (!(dock instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;
    const { scroll, stage } = scrollParts(dock);
    if (!(scroll instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;
    if (!force && Date.now() - lastManualScrollAt < 1800) return;

    const duration = durationFor(video);
    if (!duration || scroll.scrollWidth <= scroll.clientWidth + 2) return;

    const ratio = clamp(Number(video.currentTime || 0) / duration, 0, 1);
    const x = ratio * stage.scrollWidth;
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    const margin = Math.min(90, Math.max(28, scroll.clientWidth * 0.14));
    const outOfView = x < left + margin || x > right - margin;
    if (!center && !outOfView) return;

    const anchor = center ? 0.5 : (x > right - margin ? 0.72 : 0.28);
    scroll.scrollLeft = clampScrollLeft(scroll, x - scroll.clientWidth * anchor);
  }

  function revealSelectedClip(dock, index, { center = false } = {}) {
    if (!(dock instanceof HTMLElement) || !Number.isInteger(index) || index < 0) return;
    const timelinePane = dock.querySelector('[data-bottom-pane="timeline"]');
    if (timelinePane instanceof HTMLElement && timelinePane.hidden) return;
    const { scroll } = scrollParts(dock);
    const clip = dock.querySelector('.core-bottom-segment[data-segment-index="' + index + '"]');
    if (!(scroll instanceof HTMLElement) || !(clip instanceof HTMLElement)) return;
    if (scroll.scrollWidth <= scroll.clientWidth + 2) return;

    const clipLeft = clip.offsetLeft;
    const clipRight = clipLeft + clip.offsetWidth;
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    const margin = Math.min(80, Math.max(22, scroll.clientWidth * 0.12));
    const outOfView = clipLeft < left + margin || clipRight > right - margin;
    if (!center && !outOfView) return;

    const clipCenter = clipLeft + clip.offsetWidth / 2;
    const target = center
      ? clipCenter - scroll.clientWidth / 2
      : clipLeft < left + margin
        ? clipLeft - margin
        : clipRight - scroll.clientWidth + margin;
    scroll.scrollLeft = clampScrollLeft(scroll, target);
  }

  function panDuringScrub(dock, clientX) {
    const { scroll } = scrollParts(dock);
    if (!(scroll instanceof HTMLElement) || scroll.scrollWidth <= scroll.clientWidth) return;
    const rect = scroll.getBoundingClientRect();
    const edge = Math.min(56, Math.max(30, rect.width * 0.08));
    let delta = 0;
    if (clientX < rect.left + edge) delta = -Math.max(8, (rect.left + edge - clientX) * 0.45);
    else if (clientX > rect.right - edge) delta = Math.max(8, (clientX - (rect.right - edge)) * 0.45);
    if (delta) scroll.scrollLeft = clampScrollLeft(scroll, scroll.scrollLeft + delta);
  }

  function segmentTime(target) {
    const segment = target?.closest?.(".core-bottom-segment");
    if (!(segment instanceof HTMLElement)) return null;
    const value = Number(segment.dataset.start);
    return Number.isFinite(value) ? value : null;
  }

  function scrollTranscriptToSegment(target) {
    const segment = target?.closest?.(".core-bottom-segment");
    if (!(segment instanceof HTMLElement)) return;
    const index = Number(segment.dataset.segmentIndex);
    if (!Number.isInteger(index) || index < 0) return;
    const rows = document.querySelectorAll(".transcript-list .transcript-row");
    rows[index]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  function seekFromEvent(stage, event) {
    const page = editorPage();
    const video = activeVideo(page);
    if (!(video instanceof HTMLVideoElement)) return false;
    const segmentStart = segmentTime(event.target);
    const time = segmentStart == null ? pointerTime(stage, video, event.clientX) : segmentStart;
    if (time == null) return false;
    const changed = seek(video, time);
    if (segmentStart != null) scrollTranscriptToSegment(event.target);
    return changed;
  }

  function wireStage(dock, stage) {
    if (!(stage instanceof HTMLElement) || stage.dataset.commercialTimelineWired === "true") return;
    stage.dataset.commercialTimelineWired = "true";

    // Override legacy timeline click handlers in capture phase so every seek resolves
    // the CURRENT preview video instead of a video element captured before restore/import.
    stage.addEventListener("click", event => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!(event instanceof MouseEvent) || event.button !== 0) return;
      if (!seekFromEvent(stage, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const video = activeVideo();
      if (video) revealPlayhead(dock, video, { center: false, force: true });
    }, true);

    stage.addEventListener("pointerdown", event => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      // Subtitle clips keep click-to-select behavior. Drag scrubbing is available on
      // ruler, V1/A1 and empty lane space where it does not fight text selection.
      if (event.target instanceof Element && event.target.closest(".core-bottom-segment")) return;
      const video = activeVideo();
      if (!(video instanceof HTMLVideoElement) || !durationFor(video)) return;

      activeScrub = { dock, stage, pointerId: event.pointerId };
      dock.classList.add("is-scrubbing");
      try { stage.setPointerCapture(event.pointerId); } catch {}
      seekFromEvent(stage, event);
      panDuringScrub(dock, event.clientX);
      event.preventDefault();
      event.stopPropagation();
    });

    stage.addEventListener("pointermove", event => {
      if (!activeScrub || activeScrub.stage !== stage || activeScrub.pointerId !== event.pointerId) return;
      panDuringScrub(dock, event.clientX);
      seekFromEvent(stage, event);
      event.preventDefault();
    });

    const finish = event => {
      if (!activeScrub || activeScrub.stage !== stage || activeScrub.pointerId !== event.pointerId) return;
      seekFromEvent(stage, event);
      try { stage.releasePointerCapture(event.pointerId); } catch {}
      activeScrub = null;
      dock.classList.remove("is-scrubbing");
      suppressClickUntil = Date.now() + 320;
      const video = activeVideo();
      if (video) revealPlayhead(dock, video, { force: true });
    };

    stage.addEventListener("pointerup", finish);
    stage.addEventListener("pointercancel", event => {
      if (!activeScrub || activeScrub.stage !== stage || activeScrub.pointerId !== event.pointerId) return;
      try { stage.releasePointerCapture(event.pointerId); } catch {}
      activeScrub = null;
      dock.classList.remove("is-scrubbing");
      suppressClickUntil = Date.now() + 320;
    });
  }

  function wireZoom(dock) {
    const input = dock.querySelector("[data-bottom-zoom]");
    const { scroll, stage } = scrollParts(dock);
    if (!(input instanceof HTMLInputElement) || !(scroll instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;
    if (input.dataset.commercialZoomWired === "true") return;
    input.dataset.commercialZoomWired = "true";

    input.addEventListener("input", () => {
      const video = activeVideo();
      const duration = durationFor(video);
      const ratio = duration ? clamp(Number(video.currentTime || 0) / duration, 0, 1) : 0;
      const beforeX = ratio * stage.scrollWidth;
      const viewportOffset = beforeX - scroll.scrollLeft;
      stage.classList.add("is-zooming");
      requestAnimationFrame(() => {
        const afterX = ratio * stage.scrollWidth;
        scroll.scrollLeft = clampScrollLeft(scroll, afterX - viewportOffset);
        requestAnimationFrame(() => stage.classList.remove("is-zooming"));
      });
    }, true);

    input.addEventListener("change", () => {
      const video = activeVideo();
      if (video) revealPlayhead(dock, video, { force: true });
    });

    scroll.addEventListener("wheel", event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const step = Number(input.step || 0.25) || 0.25;
      const min = Number(input.min || 1) || 1;
      const max = Number(input.max || 4) || 4;
      const direction = event.deltaY > 0 ? -1 : 1;
      const next = clamp(Number(input.value || 1) + direction * step, min, max);
      if (next === Number(input.value)) return;
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { passive: false });
  }

  function wireScroll(dock) {
    const scroll = dock.querySelector("[data-timeline-scroll]");
    if (!(scroll instanceof HTMLElement) || scroll.dataset.commercialScrollWired === "true") return;
    scroll.dataset.commercialScrollWired = "true";
    const markManual = event => {
      if (event.isTrusted) lastManualScrollAt = Date.now();
    };
    scroll.addEventListener("scroll", markManual, { passive: true });
    scroll.addEventListener("pointerdown", markManual, { passive: true });
  }

  function wireVideo(video, dock) {
    if (!(video instanceof HTMLVideoElement) || wiredVideos.has(video)) return;
    wiredVideos.add(video);
    const update = event => {
      const currentDock = editorPage()?.querySelector?.(".core-editor-bottom-dock");
      if (!(currentDock instanceof HTMLElement)) return;
      if (event.type === "seeked" || event.type === "loadedmetadata") {
        revealPlayhead(currentDock, video, { center: event.type === "seeked", force: true });
      } else if (event.type === "timeupdate" && !video.paused) {
        revealPlayhead(currentDock, video);
      }
    };
    ["loadedmetadata", "timeupdate", "seeking", "seeked", "play"].forEach(name => video.addEventListener(name, update));
    revealPlayhead(dock, video, { force: true });
  }

  function editableTarget(target) {
    return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']"));
  }

  function wireKeyboard(page) {
    if (page.dataset.commercialKeyboardWired === "true") return;
    page.dataset.commercialKeyboardWired = "true";
    page.addEventListener("keydown", async event => {
      if (editableTarget(event.target)) return;
      const video = activeVideo(page);
      if (!(video instanceof HTMLVideoElement)) return;
      const duration = durationFor(video);

      if (event.key === " ") {
        event.preventDefault();
        if (video.paused) {
          try { await video.play(); } catch {}
        } else video.pause();
        return;
      }

      if (!duration) return;
      if (event.key === "Home") {
        event.preventDefault();
        seek(video, 0);
      } else if (event.key === "End") {
        event.preventDefault();
        seek(video, duration);
      } else {
        return;
      }
      const dock = page.querySelector(".core-editor-bottom-dock");
      if (dock instanceof HTMLElement) revealPlayhead(dock, video, { center: true, force: true });
    });
  }

  function wireDock(page, dock) {
    if (!(dock instanceof HTMLElement)) return;
    const stage = dock.querySelector("[data-timeline-stage]");
    if (stage instanceof HTMLElement) wireStage(dock, stage);
    wireZoom(dock);
    wireScroll(dock);
    wireKeyboard(page);
    wiredDocks.add(dock);

    const video = activeVideo(page);
    if (video instanceof HTMLVideoElement) wireVideo(video, dock);
  }

  function scan() {
    queued = false;
    const page = editorPage();
    const dock = page?.querySelector?.(".core-editor-bottom-dock");
    if (!(page instanceof HTMLElement) || !(dock instanceof HTMLElement)) return;
    wireDock(page, dock);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:transcript-edit", queue);
    window.addEventListener("viral-ai:editor-segment-selected", event => {
      const index = Number(event?.detail?.index);
      if (!Number.isInteger(index) || index < 0) return;
      requestAnimationFrame(() => {
        const dock = editorPage()?.querySelector?.(".core-editor-bottom-dock");
        if (!(dock instanceof HTMLElement)) return;
        revealSelectedClip(dock, index, { center: event?.detail?.source === "transcript" });
      });
    });
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
