(function () {
  "use strict";

  const Jobs = globalThis.CoreJobStatus;
  if (!Jobs) return;

  const HIDDEN_MAIN_PAGES = new Set(["voice", "editor", "automation"]);

  function localeCopy() {
    return state.locale === "vi" ? {
      editor: "Trình biên tập",
      breadcrumb: "IMPORT → ANALYZE → TRANSCRIPT → EDIT → LOCALIZE → RENDER",
      comingSoon: "Sắp ra mắt — chưa có capability end-to-end ổn định.",
      openEditor: "Mở trình biên tập"
    } : {
      editor: "Editor",
      breadcrumb: "IMPORT → ANALYZE → TRANSCRIPT → EDIT → LOCALIZE → RENDER",
      comingSoon: "Coming soon — end-to-end capability is not stable yet.",
      openEditor: "Open editor"
    };
  }

  function hideUnreadyMainRoutes() {
    document.querySelectorAll("[data-page]").forEach(node => {
      const page = String(node.dataset.page || "");
      if (!HIDDEN_MAIN_PAGES.has(page)) return;
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      node.tabIndex = -1;
    });
  }

  function relabelEditorEntry() {
    const c = localeCopy();
    const navButton = document.querySelector('#nav [data-page="ai-video"]');
    if (navButton) {
      const spans = navButton.querySelectorAll("span");
      const label = spans.length > 1 ? spans[1] : null;
      if (label) label.textContent = c.editor;
      navButton.title = c.openEditor;
    }

    if (state.page === "ai-video") {
      const title = document.getElementById("pageTitle");
      const breadcrumb = document.getElementById("breadcrumb");
      if (title) title.textContent = c.editor;
      if (breadcrumb) breadcrumb.textContent = c.breadcrumb;
    }

    document.querySelectorAll('#page button[data-page="ai-video"], #page .tool-card[data-page="ai-video"], #page .suggestion-row[data-page="ai-video"]').forEach(node => {
      node.title = c.openEditor;
    });
  }

  function markComingSoonChrome() {
    const search = document.querySelector(".command-palette");
    if (search) {
      search.disabled = true;
      search.dataset.capabilityState = "coming-soon";
      search.title = localeCopy().comingSoon;
      search.setAttribute("aria-disabled", "true");
    }
  }

  function capabilityAudit() {
    document.querySelectorAll(".core-action").forEach(button => {
      button.dataset.capabilityState = Jobs.capabilityState(!button.disabled, true);
      if (button.disabled && !button.title) {
        button.title = state.locale === "vi" ? "Chưa đủ điều kiện để sử dụng." : "Prerequisites are not ready yet.";
      }
    });

    document.querySelectorAll(".core-collapse-button, .core-panel-restore, [data-core-play], [data-core-fullscreen], [data-core-seek]").forEach(control => {
      control.dataset.capabilityState = control.disabled ? "disabled" : "functional";
    });
  }

  function serviceState(actionId, job, hasResult) {
    const button = document.querySelector('.core-editor-shell [data-core-action="' + actionId + '"]');
    if (!button) return;
    const stateCode = Jobs.fromJob(job, hasResult);
    const stateNode = button.querySelector(".core-action-state");
    if (stateNode && Jobs.isBusy(stateCode)) {
      stateNode.textContent = Jobs.label(stateCode, state.locale);
    }
    if (stateCode === "failed") {
      button.classList.remove("active", "ready", "complete");
      button.classList.add("failed");
      if (stateNode) stateNode.textContent = Jobs.label(stateCode, state.locale);
    }
    if (stateCode === "cancelled" || stateCode === "interrupted") {
      if (stateNode) stateNode.textContent = Jobs.label(stateCode, state.locale);
    }
  }

  function syncGenericJobStates() {
    const source = (() => {
      try { return latestSourceJob?.() || null; } catch { return null; }
    })();
    if (!source) return;

    let speechJob = null;
    let speechResult = null;
    let translationJob = null;
    let translationResult = null;
    let voiceJob = null;
    let voiceResult = null;

    try {
      speechJob = speechJobForSource(source);
      speechResult = speechResultForSource(source);
      translationJob = translationJobForSource(source);
      translationResult = translationResultForSource(source);
      voiceJob = voiceJobForSource(source);
      voiceResult = voiceResultForSource(source);
    } catch {}

    serviceState("transcribe", speechJob, Boolean(speechResult));
    serviceState("translate", translationJob, Boolean(translationResult));
    serviceState("voice", voiceJob, Boolean(voiceResult));
  }

  function normalizeCoreProductSurface() {
    if (HIDDEN_MAIN_PAGES.has(String(state.page || ""))) {
      state.page = "ai-video";
      save();
      render();
      return;
    }

    hideUnreadyMainRoutes();
    relabelEditorEntry();
    markComingSoonChrome();
    capabilityAudit();
    syncGenericJobStates();
  }

  // render() rebuilds navigation/page content. Normalize capability exposure after
  // every render without replacing any backend or workflow implementation.
  const observer = new MutationObserver(() => normalizeCoreProductSurface());
  observer.observe(document.body, { childList: true, subtree: true });

  normalizeCoreProductSurface();
  setInterval(() => {
    capabilityAudit();
    syncGenericJobStates();
  }, 400);
})();
