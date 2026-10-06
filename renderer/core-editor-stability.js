(function installCoreEditorStability() {
  "use strict";

  const legacyRender = typeof window.render === "function" ? window.render : null;
  if (!legacyRender || legacyRender.__viralCorePersistentWrapped) return;

  function isCoreEditorPage() {
    try { return typeof state !== "undefined" && state?.page === "ai-video"; }
    catch { return false; }
  }

  function previewSnapshot() {
    const preview = document.querySelector("#page .preview.preview-real");
    const video = preview?.querySelector("video.preview-video, video.core-player-media");
    if (!(preview instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return null;

    return {
      preview,
      video,
      src: String(video.currentSrc || video.getAttribute("src") || video.src || ""),
      currentTime: Number(video.currentTime || 0),
      paused: video.paused,
      muted: video.muted,
      volume: Number(video.volume),
      playbackRate: Number(video.playbackRate || 1)
    };
  }

  function sameMedia(snapshot, replacement) {
    if (!snapshot || !(replacement instanceof HTMLElement)) return false;
    const nextVideo = replacement.querySelector("video.preview-video, video.core-player-media");
    if (!(nextVideo instanceof HTMLVideoElement)) return false;
    const nextSrc = String(nextVideo.currentSrc || nextVideo.getAttribute("src") || nextVideo.src || "");
    return Boolean(snapshot.src && nextSrc && snapshot.src === nextSrc);
  }

  function restorePlayback(snapshot) {
    const video = snapshot?.video;
    if (!(video instanceof HTMLVideoElement)) return;

    try {
      video.muted = Boolean(snapshot.muted);
      if (Number.isFinite(snapshot.volume)) video.volume = Math.max(0, Math.min(1, snapshot.volume));
      if (Number.isFinite(snapshot.playbackRate) && snapshot.playbackRate > 0) video.playbackRate = snapshot.playbackRate;
      if (Number.isFinite(snapshot.currentTime) && snapshot.currentTime > 0 && Number.isFinite(video.duration) && video.duration > 0) {
        const target = Math.min(snapshot.currentTime, video.duration);
        if (Math.abs(Number(video.currentTime || 0) - target) > 0.15) video.currentTime = target;
      }
      if (!snapshot.paused && video.paused) video.play().catch(() => {});
    } catch {}
  }

  function preserveEditorPreview(snapshot) {
    if (!snapshot || !isCoreEditorPage()) return false;
    const replacement = document.querySelector("#page .preview.preview-real");
    if (!sameMedia(snapshot, replacement)) return false;

    replacement.replaceWith(snapshot.preview);
    snapshot.preview.dataset.corePersistentPreview = "true";
    restorePlayback(snapshot);
    window.dispatchEvent(new CustomEvent("viral-ai:editor-preview-preserved", {
      detail: {
        src: snapshot.src,
        currentTime: Number(snapshot.video.currentTime || 0),
        paused: snapshot.video.paused
      }
    }));
    return true;
  }

  function stableRender(...args) {
    const snapshot = isCoreEditorPage() ? previewSnapshot() : null;
    const result = legacyRender.apply(this, args);
    preserveEditorPreview(snapshot);
    return result;
  }

  stableRender.__viralCorePersistentWrapped = true;
  stableRender.__viralCoreLegacyRender = legacyRender;
  window.render = stableRender;
  document.documentElement.dataset.corePersistentEditor = "enabled";
})();
