(function installCoreEditorSelectionBridge() {
  "use strict";

  let selectedIndex = -1;
  let queued = false;

  function rows() {
    return Array.from(document.querySelectorAll(".transcript-list .transcript-row"));
  }

  function clips() {
    return Array.from(document.querySelectorAll(".core-bottom-segment"));
  }

  function dispatchSelection(index, source) {
    window.dispatchEvent(new CustomEvent("viral-ai:editor-segment-selected", {
      detail: { index, source }
    }));
  }

  function applySelection(index, { scrollTranscript = false } = {}) {
    const transcriptRows = rows();
    const timelineClips = clips();
    const valid = Number.isInteger(index) && index >= 0 && index < transcriptRows.length;
    selectedIndex = valid ? index : -1;

    transcriptRows.forEach((row, rowIndex) => {
      const selected = rowIndex === selectedIndex;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", selected ? "true" : "false");
    });
    timelineClips.forEach(clip => {
      const clipIndex = Number(clip.dataset.segmentIndex || -1);
      const selected = clipIndex === selectedIndex;
      clip.classList.toggle("is-selected", selected);
      clip.setAttribute("aria-selected", selected ? "true" : "false");
    });

    if (scrollTranscript && selectedIndex >= 0) {
      transcriptRows[selectedIndex]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }

  function indexOfRow(row) {
    return rows().indexOf(row);
  }

  function selectFromTarget(target) {
    if (!(target instanceof Element)) return;
    const clip = target.closest(".core-bottom-segment");
    if (clip instanceof HTMLElement) {
      const index = Number(clip.dataset.segmentIndex || -1);
      applySelection(index, { scrollTranscript: true });
      dispatchSelection(index, "timeline");
      return;
    }

    const row = target.closest(".transcript-list .transcript-row");
    if (row instanceof HTMLElement) {
      const index = indexOfRow(row);
      applySelection(index);
      dispatchSelection(index, "transcript");
    }
  }

  function moveTranscriptSelection(row, delta) {
    const transcriptRows = rows();
    const current = transcriptRows.indexOf(row);
    if (current < 0 || !transcriptRows.length) return false;
    const next = Math.max(0, Math.min(transcriptRows.length - 1, current + delta));
    const target = transcriptRows[next];
    if (!(target instanceof HTMLElement)) return false;
    applySelection(next, { scrollTranscript: true });
    dispatchSelection(next, "transcript");
    target.focus({ preventScroll: true });
    return true;
  }

  function reapply() {
    queued = false;
    const count = rows().length;
    if (selectedIndex >= count) selectedIndex = -1;
    applySelection(selectedIndex);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(reapply);
  }

  const start = () => {
    document.addEventListener("click", event => selectFromTarget(event.target), true);
    document.addEventListener("keydown", event => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.matches(".transcript-list .transcript-row")) return;

      if (event.key === "Enter" || event.key === " ") {
        const index = indexOfRow(event.target);
        applySelection(index);
        dispatchSelection(index, "transcript");
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const delta = event.key === "ArrowUp" ? -1 : 1;
        if (moveTranscriptSelection(event.target, delta)) event.preventDefault();
      }
    }, true);

    window.addEventListener("viral-ai:editor-segment-selected", event => {
      const index = Number(event?.detail?.index);
      if (Number.isInteger(index)) applySelection(index, { scrollTranscript: event?.detail?.source === "timeline" });
    });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:transcript-edit", queue);
    window.addEventListener("viral-ai:bottom-dock-tab", queue);

    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
