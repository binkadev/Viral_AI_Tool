(function installCoreTimelineSelection() {
  "use strict";

  const SELECTION_KEY = "viral-ai-core-timeline-selection";
  let observer = null;
  let queued = false;
  let selectedKey = "";
  let selectedSegmentIndex = -1;
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
    return "";
  }

  function itemForKey(root, key) {
    if (!(root instanceof HTMLElement) || !key) return null;
    if (key === "video") return root.querySelector(".core-video-clip");
    if (key === "audio") return root.querySelector(".core-audio-clip");
    return null;
  }

  function selectionLabel() {
    if (selectedKey) return selectedKey;
    return selectedSegmentIndex >= 0 ? "subtitle:" + selectedSegmentIndex : "none";
  }

  function loadStoredSelection() {
    const value = String(localStorage.getItem(SELECTION_KEY) || "none");
    if (value === "video" || value === "audio") {
      selectedKey = value;
      selectedSegmentIndex = -1;
      return;
    }
    const match = /^subtitle:(\d+)$/.exec(value);
    selectedKey = "";
    selectedSegmentIndex = match ? Number(match[1]) : -1;
  }

  function persistSelection() {
    localStorage.setItem(SELECTION_KEY, selectionLabel());
  }

  function applySourceSelection(root, selected) {
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll(".core-source-clip").forEach(node => {
      const active = node === selected;
      node.classList.toggle("is-selected", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
    root.dataset.timelineSelection = selectionLabel();
  }

  function clearTranscriptSelectionForSource() {
    window.dispatchEvent(new CustomEvent("viral-ai:editor-segment-selected", {
      detail: { index: -1, source: "timeline-source" }
    }));
  }

  function restoreSelection() {
    queued = false;
    const root = dock();
    if (!(root instanceof HTMLElement)) return;

    const nextSource = sourceKey();
    if (nextSource !== currentSource) {
      currentSource = nextSource;
      loadStoredSelection();
    }

    if (!selectedKey) {
      applySourceSelection(root, null);
      return;
    }

    const selected = itemForKey(root, selectedKey);
    if (selected instanceof HTMLElement) {
      applySourceSelection(root, selected);
      return;
    }

    selectedKey = "";
    persistSelection();
    applySourceSelection(root, null);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(restoreSelection);
  }

  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest(".core-source-clip");
    const root = dock();
    if (!(item instanceof HTMLElement) || !(root instanceof HTMLElement) || !root.contains(item)) return;
    const key = itemKey(item);
    if (!key) return;
    selectedKey = key;
    selectedSegmentIndex = -1;
    persistSelection();
    applySourceSelection(root, item);
    clearTranscriptSelectionForSource();
  }

  function onSegmentSelection(event) {
    const index = Number(event?.detail?.index);
    if (!Number.isInteger(index)) return;

    if (event?.detail?.source === "timeline-source" && index < 0) {
      selectedSegmentIndex = -1;
    } else if (index >= 0) {
      selectedKey = "";
      selectedSegmentIndex = index;
    } else {
      selectedKey = "";
      selectedSegmentIndex = -1;
    }

    persistSelection();
    const root = dock();
    if (root instanceof HTMLElement) applySourceSelection(root, itemForKey(root, selectedKey));
  }

  function start() {
    const root = page();
    if (!(root instanceof HTMLElement)) return;
    loadStoredSelection();
    // Capture before the existing source seek handlers stop propagation.
    root.addEventListener("click", onClick, true);
    observer = new MutationObserver(queue);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-segment-selected", onSegmentSelection);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
