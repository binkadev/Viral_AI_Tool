(function installCoreCapabilityGuard() {
  "use strict";

  // `ai-video` is the legacy internal route name for the real Core Editor
  // (Speech -> Translation -> Voice -> Render). Do not hide it as a prototype.
  // Standalone legacy editor/voice pages remain hidden to avoid duplicate or
  // decorative surfaces getting ahead of the production workflow.
  const DEFERRED_PAGES = new Set(["automation", "workflow", "workflow-builder", "monitor", "editor", "voice"]);
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

  function setAttrIfChanged(node, name, value) {
    if (!(node instanceof Element)) return;
    const next = String(value);
    if (node.getAttribute(name) !== next) node.setAttribute(name, next);
  }

  function setDatasetIfChanged(node, key, value) {
    if (!(node instanceof HTMLElement)) return;
    const next = String(value);
    if (node.dataset[key] !== next) node.dataset[key] = next;
  }

  function setDisabledIfChanged(button, value) {
    const next = Boolean(value);
    if (button.disabled !== next) button.disabled = next;
  }

  function mark(button, capability, reason = "") {
    if (!(button instanceof HTMLButtonElement)) return;
    setDatasetIfChanged(button, "coreCapability", capability);

    if (capability === "coming-soon") {
      const disabledReason = reason || copy().comingSoon;
      setDisabledIfChanged(button, true);
      setAttrIfChanged(button, "aria-disabled", "true");
      setDatasetIfChanged(button, "coreDisabledReason", disabledReason);
      if (button.title !== disabledReason) button.title = disabledReason;
      button.classList.add("core-coming-soon-control");
      return;
    }

    if (capability === "disabled") {
      const disabledReason = reason || button.title || copy().disabled;
      setAttrIfChanged(button, "aria-disabled", "true");
      setDatasetIfChanged(button, "coreDisabledReason", disabledReason);
      if (!button.title) button.title = disabledReason;
      return;
    }

    button.classList.remove("core-coming-soon-control");
  }

  function hideDeferredPages() {
    document.querySelectorAll("[data-page]").forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (!DEFERRED_PAGES.has(String(node.dataset.page || ""))) return;
      if (!node.hidden) node.hidden = true;
      setAttrIfChanged(node, "aria-hidden", "true");
      if (node instanceof HTMLButtonElement) mark(node, "coming-soon");
    });

    // Never show hard-coded prototype counters as if they were live data.
    document.querySelectorAll(".nav-badge").forEach(node => node.remove());
  }

  function hidePrototypeData() {
    // Dashboard KPI values are still static legacy demo numbers. Hide the block
    // until the values are backed by real persisted jobs/usage data.
    document.querySelectorAll(".dashboard-stats").forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (!node.hidden) node.hidden = true;
      setAttrIfChanged(node, "aria-hidden", "true");
      setDatasetIfChanged(node, "coreCapability", "coming-soon");
    });
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
    hidePrototypeData();
    guardKnownPlaceholders();
    classifyCoreButtons();
  }

  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  const observer = new MutationObserver(queueScan);
  const start = () => {
    const page = document.getElementById("page");
    const nav = document.getElementById("nav");

    // Observe structural rerenders only. Watching `disabled` / `aria-disabled`
    // while the guard itself writes those attributes can create a self-triggering
    // MutationObserver loop that starves the renderer event loop.
    if (page) observer.observe(page, { childList: true, subtree: true });
    if (nav) observer.observe(nav, { childList: true, subtree: true });

    window.addEventListener("viral-ai:core-state-changed", queueScan);
    scan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
