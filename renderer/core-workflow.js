(function installCoreWorkflow() {
  "use strict";

  const model = window.ViralCoreWorkflowModel;
  if (!model) return;

  const CORE_PAGES = new Set(["download", "speech", "translation", "voice", "editor", "ai-video"]);
  let refreshQueued = false;

  function savedState() {
    try { return JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}"); }
    catch { return {}; }
  }

  function locale() {
    return savedState().locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          current: "Core workflow",
          comingSoon: "Coming soon",
          importVideo: "Import video",
          states: {
            completed: "Done",
            processing: "Working",
            failed: "Needs attention",
            cancelled: "Cancelled",
            blocked: "Locked",
            active: "Ready",
            idle: "Waiting"
          }
        }
      : {
          current: "Quy trình chính",
          comingSoon: "Sắp có",
          importVideo: "Nhập video",
          states: {
            completed: "Đã xong",
            processing: "Đang xử lý",
            failed: "Cần xử lý",
            cancelled: "Đã hủy",
            blocked: "Chưa mở",
            active: "Sẵn sàng",
            idle: "Đang chờ"
          }
        };
  }

  function coreSurface(saved) {
    if (CORE_PAGES.has(String(saved?.page || ""))) return true;
    return Boolean(document.querySelector(".preview-video, .transcript-list, #speechStart, #translationStart, #voiceStart, #render, #export"));
  }

  function statusIcon(status) {
    if (status === "completed") return "✓";
    if (status === "processing") return "…";
    if (status === "failed") return "!";
    if (status === "cancelled") return "×";
    if (status === "active") return "•";
    return "○";
  }

  function ensureWorkflowRail(derived, saved) {
    const page = document.getElementById("page");
    if (!page) return;

    let rail = page.querySelector(":scope > .core-workflow-shell");
    if (!coreSurface(saved)) {
      rail?.remove();
      return;
    }

    if (!rail) {
      rail = document.createElement("section");
      rail.className = "core-workflow-shell";
      rail.setAttribute("aria-label", copy().current);
      page.prepend(rail);
    }

    const c = copy();
    rail.innerHTML =
      '<div class="core-workflow-title">' + c.current + '</div>' +
      '<div class="core-workflow-rail">' +
        derived.stages.map((stage, index) =>
          '<div class="core-workflow-stage is-' + stage.status + '" data-core-stage="' + stage.id + '" title="' + escapeAttr(stage.reason) + '">' +
            '<span class="core-stage-index">' + statusIcon(stage.status) + '</span>' +
            '<span class="core-stage-copy"><b>' + stage.label + '</b><small>' + (c.states[stage.status] || stage.status) + '</small></span>' +
          '</div>' +
          (index < derived.stages.length - 1 ? '<span class="core-stage-link" aria-hidden="true"></span>' : '')
        ).join("") +
      '</div>';
  }

  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function applyGate(selector, policy) {
    const button = document.querySelector(selector);
    if (!(button instanceof HTMLButtonElement) || !policy) return;

    const shouldDisable = policy.enabled !== true;
    button.disabled = shouldDisable;
    button.setAttribute("aria-disabled", shouldDisable ? "true" : "false");
    button.classList.toggle("core-gated", shouldDisable);
    button.dataset.coreCapability = policy.enabled ? "functional" : "disabled";

    if (shouldDisable && policy.reason) {
      button.title = policy.reason;
      button.dataset.coreDisabledReason = policy.reason;
    } else {
      if (button.dataset.coreDisabledReason && button.title === button.dataset.coreDisabledReason) button.removeAttribute("title");
      delete button.dataset.coreDisabledReason;
    }
  }

  function applyControlPolicy(derived) {
    applyGate("#speechStart", derived.controls.speech);
    applyGate("#translationStart", derived.controls.translate);
    applyGate("#voiceStart", derived.controls.voice);
    applyGate("#render", derived.controls.render);
    applyGate("#export", derived.controls.export);
  }

  function markComingSoon() {
    const search = document.querySelector(".command-palette");
    if (search instanceof HTMLButtonElement) {
      search.disabled = true;
      search.setAttribute("aria-disabled", "true");
      search.dataset.coreCapability = "coming-soon";
      search.title = copy().comingSoon;
      if (!search.querySelector(".core-coming-soon")) {
        const badge = document.createElement("span");
        badge.className = "core-coming-soon";
        badge.textContent = copy().comingSoon;
        search.appendChild(badge);
      }
    }
  }

  function wireQuickProject() {
    const button = document.getElementById("quickProject");
    if (!(button instanceof HTMLButtonElement)) return;
    button.dataset.coreCapability = "functional";
    const label = document.getElementById("newProjectLabel");
    if (label) label.textContent = copy().importVideo;
    if (button.dataset.coreImportWired === "true") return;
    button.dataset.coreImportWired = "true";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = Array.from(document.querySelectorAll('[data-page="download"]'))
        .find(node => node !== button && node instanceof HTMLElement && node.offsetParent !== null)
        || document.querySelector('[data-page="download"]')
        || document.querySelector('[data-page="speech"]');
      if (target instanceof HTMLElement) target.click();
    }, true);
  }

  function annotateJobs(derived) {
    const map = [
      ["#speechStart", derived.jobs.speech],
      ["#translationStart", derived.jobs.translation],
      ["#voiceStart", derived.jobs.voice]
    ];
    for (const [selector, status] of map) {
      const button = document.querySelector(selector);
      if (button) button.dataset.coreJobState = status;
    }
  }

  function refresh() {
    refreshQueued = false;
    const saved = savedState();
    const derived = model.derive(saved);
    ensureWorkflowRail(derived, saved);
    applyControlPolicy(derived);
    annotateJobs(derived);
    markComingSoon();
    wireQuickProject();
    document.documentElement.dataset.coreWorkflow = "enabled";
    document.documentElement.dataset.coreSourceMissing = derived.missingSource ? "true" : "false";
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  const observer = new MutationObserver(queueRefresh);
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true, attributes: false });
    queueRefresh();
    window.setInterval(queueRefresh, 900);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
