(function installCoreCapabilityGuard() {
  "use strict";

  const DEFERRED_PAGES = new Set(["ai-video", "automation", "workflow", "workflow-builder", "monitor"]);
  const FUNCTIONAL_IDS = new Set([
    "quickProject",
    "langMenuButton",
    "speechStart",
    "speechStop",
    "translationStart",
    "translationStop",
    "voiceStart",
    "voiceStop",
    "voiceStudioPreview",
    "render",
    "export",
    "openCloudSettings",
    "cloudAccountAction",
    "cloudLogoutAction",
    "manageLocalAiPanel"
  ]);

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
          comingSoon: "Coming soon — this action is not connected to a production capability yet.",
          disabled: "This action is not available yet because a required previous step is incomplete."
        }
      : {
          comingSoon: "Sắp có — thao tác này chưa được nối với capability production.",
          disabled: "Chưa thể dùng thao tác này vì bước bắt buộc trước đó chưa hoàn tất."
        };
  }

  function mark(button, capability, reason = "") {
    if (!(button instanceof HTMLButtonElement)) return;
    button.dataset.coreCapability = capability;

    if (capability === "coming-soon") {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.dataset.coreDisabledReason = reason || copy().comingSoon;
      button.title = button.dataset.coreDisabledReason;
      button.classList.add("core-coming-soon-control");
      return;
    }

    if (capability === "disabled") {
      button.setAttribute("aria-disabled", "true");
      button.dataset.coreDisabledReason = reason || button.title || copy().disabled;
      if (!button.title) button.title = button.dataset.coreDisabledReason;
      return;
    }

    button.classList.remove("core-coming-soon-control");
  }

  function hideDeferredPages() {
    document.querySelectorAll("[data-page]").forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (!DEFERRED_PAGES.has(String(node.dataset.page || ""))) return;
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      if (node instanceof HTMLButtonElement) mark(node, "coming-soon");
    });

    // Never show hard-coded prototype counters as if they were live data.
    document.querySelectorAll(".nav-badge").forEach(node => node.remove());
  }

  function guardKnownPlaceholders() {
    const urlAnalyze = document.getElementById("analyze");
    if (urlAnalyze instanceof HTMLButtonElement) mark(urlAnalyze, "coming-soon");

    const legacyTts = document.getElementById("tts");
    if (legacyTts instanceof HTMLButtonElement) mark(legacyTts, "coming-soon");

    const search = document.querySelector(".command-palette");
    if (search instanceof HTMLButtonElement) mark(search, "coming-soon");
  }

  function classifyCoreButtons() {
    document.querySelectorAll("button").forEach(button => {
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset.coreCapability) return;

      const page = String(button.dataset.page || "");
      if (page && DEFERRED_PAGES.has(page)) {
        mark(button, "coming-soon");
        return;
      }

      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        mark(button, "disabled", button.dataset.coreDisabledReason || button.title || "");
        return;
      }

      if (
        FUNCTIONAL_IDS.has(button.id) ||
        button.matches("[data-job-action], [data-job-menu], [data-core-play], [data-core-fullscreen], .popover-option, .core-panel-toggle") ||
        (page && !DEFERRED_PAGES.has(page))
      ) {
        mark(button, "functional");
      }
    });
  }

  function scan() {
    hideDeferredPages();
    guardKnownPlaceholders();
    classifyCoreButtons();
  }

  const observer = new MutationObserver(scan);
  const start = () => {
    const page = document.getElementById("page");
    const nav = document.getElementById("nav");
    if (page) observer.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
    if (nav) observer.observe(nav, { childList: true, subtree: true });
    scan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
