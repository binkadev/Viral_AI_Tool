(function installCoreTimelineSelection() {
  "use strict";

  let observer = null;
  let queued = false;
  let selectedKey = "";
  let currentSource = "";

  function page() {
    return document.getElementById("page");
  }

  function dock() {
    return page()?.querySelector?.(".core-editor-bottom-dock") || null;
  }

  function sourceKey() {
    const video = page()?.querySelector?.(".core-editor-focus-section video.preview-video, .core-editor-focus-section video.core-player-media");
    if (!(video instanceof HTMLVideoElement)) return "none";
    return String(video.currentSrc || video.src || "none");
  }

  function itemKey(node) {
    if (!(node instanceof HTMLElement)) return "";
    if (node.classList.contains("core-video-clip")) return "video";
    if (node.classList.contains("core-audio-clip")) return "audio";
    if (node.classList.contains("core-bottom-segment")) return "subtitle:" + String(node.dataset.segmentIndex || "");
    return "";
  }

  function itemForKey(root, key) {
    if (!(root instanceof HTMLElement) || !key) return null;
    if (key === "video") return root.querySelector(".core-video-clip");
    if (key === "audio") return root.querySelector(".core-audio-clip");
    if (key.startsWith("subtitle:")) {
      const index = key.slice("subtitle:".length);
      return Array.from(root.querySelectorAll(".core-bottom-segment")).find(node => String(node.dataset.segmentIndex || "") === index) || null;
    }
    return null;
  }

  function applySelection(root, selected) {
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll(".core-source-clip, .core-bottom-segment").forEach(node => {
      const active = node === selected;
      node.classList.toggle("is-selected", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
    root.dataset.timelineSelection = selected ? itemKey(selected) : "none";
  }

  function restoreSelection() {
    queued = false;
    const root = dock();
    if (!(root instanceof HTMLElement)) return;

    const nextSource = sourceKey();
    if (nextSource !== currentSource) {
      currentSource = nextSource;
      selectedKey = "";
    }

    if (!selectedKey) {
      applySelection(root, null);
      return;
    }

    const selected = itemForKey(root, selectedKey);
    if (selected instanceof HTMLElement) {
      applySelection(root, selected);
      return;
    }

    selectedKey = "";
    applySelection(root, null);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(restoreSelection);
  }

  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest(".core-source-clip, .core-bottom-segment");
    const root = dock();
    if (!(item instanceof HTMLElement) || !(root instanceof HTMLElement) || !root.contains(item)) return;
    const key = itemKey(item);
    if (!key) return;
    selectedKey = key;
    applySelection(root, item);
  }

  function start() {
    const root = page();
    if (!(root instanceof HTMLElement)) return;
    // Capture before the existing timeline/clip seek handlers stop propagation.
    root.addEventListener("click", onClick, true);
    observer = new MutationObserver(queue);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
