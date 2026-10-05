(function installCoreLayout() {
  "use strict";

  const LEFT_KEY = "viral-ai-core-left-collapsed";
  const RIGHT_KEY = "viral-ai-core-right-collapsed";
  const wiredGrids = new WeakSet();
  let queued = false;

  function boolPref(key) {
    return localStorage.getItem(key) === "true";
  }

  function setPref(key, value) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  function ensureLeftToggle() {
    const topbar = document.querySelector(".topbar-heading");
    if (!topbar) return;
    let button = document.getElementById("coreLeftPanelToggle");
    if (!button) {
      button = document.createElement("button");
      button.id = "coreLeftPanelToggle";
      button.type = "button";
      button.className = "core-panel-toggle core-left-toggle";
      button.setAttribute("aria-label", "Toggle project panel");
      button.title = "Thu gọn / mở bảng dự án";
      button.textContent = "☰";
      topbar.prepend(button);
      button.addEventListener("click", () => {
        const collapsed = !document.documentElement.classList.contains("core-left-collapsed");
        document.documentElement.classList.toggle("core-left-collapsed", collapsed);
        setPref(LEFT_KEY, collapsed);
        button.setAttribute("aria-pressed", collapsed ? "true" : "false");
      });
    }
    const collapsed = boolPref(LEFT_KEY);
    document.documentElement.classList.toggle("core-left-collapsed", collapsed);
    button.setAttribute("aria-pressed", collapsed ? "true" : "false");
  }

  function dockTranscript(grid) {
    const result = grid.querySelector(".speech-result");
    if (!result) return;
    if (result.parentElement !== grid) grid.appendChild(result);
    result.classList.add("core-transcript-dock");
  }

  function ensureRightToggle(grid) {
    const preview = grid.querySelector(":scope > .preview") || grid.querySelector(".preview");
    const right = grid.querySelector(":scope > .stack");
    if (!preview || !right) return;

    grid.classList.add("core-editor-layout");
    right.classList.add("core-properties-panel");

    let button = preview.querySelector(".core-right-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "core-panel-toggle core-right-toggle";
      button.setAttribute("aria-label", "Toggle properties panel");
      button.title = "Thu gọn / mở bảng thuộc tính";
      button.textContent = "⇥";
      preview.appendChild(button);
    }

    const apply = collapsed => {
      grid.classList.toggle("core-right-collapsed", collapsed);
      button.setAttribute("aria-pressed", collapsed ? "true" : "false");
      button.textContent = collapsed ? "⇤" : "⇥";
      button.title = collapsed ? "Mở bảng thuộc tính" : "Thu gọn bảng thuộc tính";
    };

    apply(boolPref(RIGHT_KEY));

    if (!wiredGrids.has(grid)) {
      wiredGrids.add(grid);
      button.addEventListener("click", () => {
        const collapsed = !grid.classList.contains("core-right-collapsed");
        apply(collapsed);
        setPref(RIGHT_KEY, collapsed);
      });
    }
  }

  function enhance() {
    queued = false;
    ensureLeftToggle();
    document.querySelectorAll(".editor-grid").forEach(grid => {
      if (!(grid instanceof HTMLElement)) return;
      if (!grid.querySelector(".preview-video") && !grid.querySelector(".speech-result")) return;
      ensureRightToggle(grid);
      dockTranscript(grid);
    });
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  const observer = new MutationObserver(queue);
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
