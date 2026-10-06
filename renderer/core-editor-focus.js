(function installCoreEditorFocus() {
  "use strict";

  let queued = false;

  function parseClock(value) {
    const text = String(value || "");
    const matches = text.match(/(?:^|[·\s])(\d{1,2}:)?\d{2}:\d{2}(?=$|[·\s])/g) || [];
    const token = matches.map(item => item.trim()).find(Boolean);
    if (!token) return 0;
    const parts = token.split(":").map(Number);
    if (parts.some(part => !Number.isFinite(part))) return 0;
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return 0;
  }

  function durationHint(head) {
    const copy = head?.querySelector("p")?.textContent || "";
    return parseClock(copy);
  }

  function ensureFocusLayout() {
    queued = false;
    const page = document.getElementById("page");
    const grid = page?.querySelector(".editor-grid");
    if (!(page instanceof HTMLElement) || !(grid instanceof HTMLElement)) return;
    if (!grid.querySelector(".preview-video, .core-player-media")) return;

    const head = grid.previousElementSibling instanceof HTMLElement && grid.previousElementSibling.classList.contains("section-head")
      ? grid.previousElementSibling
      : null;
    const rail = page.querySelector(":scope > .core-workflow-shell");

    let section = page.querySelector(":scope > .core-editor-focus-section");
    if (!(section instanceof HTMLElement)) {
      section = document.createElement("section");
      section.className = "core-editor-focus-section";
      section.setAttribute("aria-label", "Project preview editor");
      if (rail instanceof HTMLElement) rail.insertAdjacentElement("afterend", section);
      else page.prepend(section);
    }

    if (head && head.parentElement !== section) section.appendChild(head);
    if (grid.parentElement !== section) section.appendChild(grid);

    page.classList.add("core-editor-focused-page");
    grid.classList.add("core-editor-primary-grid");

    const voice = page.querySelector(".voice-workflow-card");
    if (voice instanceof HTMLElement) voice.classList.add("core-editor-secondary-panel");

    const video = grid.querySelector("video.preview-video, video.core-player-media");
    if (video instanceof HTMLVideoElement) {
      const hint = durationHint(head);
      if (hint > 0) video.dataset.coreDurationHint = String(hint);
    }
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensureFocusLayout);
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    }
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
