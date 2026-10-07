(function installCoreEditorShortcuts() {
  "use strict";

  let queued = false;

  function page() {
    const node = document.getElementById("page");
    return node?.classList?.contains("core-editor-docked-page") ? node : null;
  }

  function video(root = page()) {
    return root?.querySelector?.(".core-editor-focus-section video.preview-video, .core-editor-focus-section video.core-player-media") || null;
  }

  function editing(target) {
    return target instanceof HTMLElement && Boolean(target.closest(
      "input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']"
    ));
  }

  function playerOwnsEvent(target) {
    return target instanceof HTMLElement && Boolean(target.closest(
      ".preview.core-player-host, .preview.preview-real"
    ));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function durationFor(media) {
    const nativeDuration = Number(media?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(media?.dataset?.coreDurationHint || 0);
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  function seekBy(media, delta) {
    if (!(media instanceof HTMLVideoElement)) return false;
    const duration = durationFor(media);
    if (!duration) return false;
    media.currentTime = clamp(Number(media.currentTime || 0) + Number(delta || 0), 0, duration);
    return true;
  }

  function reveal(media) {
    media.dispatchEvent(new Event("seeking"));
    media.dispatchEvent(new Event("seeked"));
    window.dispatchEvent(new CustomEvent("viral-ai:editor-shortcut-seek", {
      detail: { currentTime: Number(media.currentTime || 0) }
    }));
  }

  function wire(root) {
    if (!(root instanceof HTMLElement) || root.dataset.coreShortcutWired === "true") return;
    root.dataset.coreShortcutWired = "true";

    root.addEventListener("keydown", event => {
      if (editing(event.target) || playerOwnsEvent(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const media = video(root);
      if (!(media instanceof HTMLVideoElement)) return;
      const amount = event.shiftKey ? 10 : 5;
      const delta = event.key === "ArrowLeft" ? -amount : amount;
      if (!seekBy(media, delta)) return;

      event.preventDefault();
      reveal(media);
    });

    const media = video(root);
    const host = media?.closest?.(".preview.core-player-host, .preview.preview-real");
    if (host instanceof HTMLElement) host.setAttribute("aria-keyshortcuts", "Space K ArrowLeft ArrowRight");
  }

  function scan() {
    queued = false;
    const root = page();
    if (root) wire(root);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function start() {
    const root = document.getElementById("page");
    if (root) new MutationObserver(queue).observe(root, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
