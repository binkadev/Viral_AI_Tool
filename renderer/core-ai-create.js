(function installAiCreateWorkspace() {
  "use strict";

  const GOAL_KEY = "viral-ai-generation-goal";
  const BRIEF_KEY = "viral-ai-generation-brief";
  const VALID_GOALS = new Set(["economy", "balanced", "quality"]);
  let installed = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function copy() {
    return window.I18N.messages[locale()].aiCreate;
  }

  let generationReady = false;
  let generationState = "checking";
  let readinessPending = null;
  let submitting = false;
  let submissionKey = null;
  let feedback = "";

  function projectIdentity() {
    try {
      const snapshot = window.ViralCoreProjectPersistence?.snapshot?.();
      const projectId = typeof snapshot?.projectId === "string" ? snapshot.projectId : null;
      const selectedSceneId = typeof snapshot?.scenePlan?.selectedSceneId === "string"
        ? snapshot.scenePlan.selectedSceneId
        : null;
      return { projectId, sceneId: selectedSceneId };
    } catch {
      return { projectId: null, sceneId: null };
    }
  }

  function currentBrief() {
    return String(localStorage.getItem(BRIEF_KEY) || "");
  }

  function canGenerate() {
    return generationReady && !submitting && Boolean(projectIdentity().projectId) && Boolean(currentBrief().trim());
  }

  function updateGenerationControls() {
    const button = document.querySelector("[data-ai-generate]");
    if (button) {
      button.disabled = !canGenerate();
      button.setAttribute("aria-disabled", String(button.disabled));
    }
    const status = document.querySelector("[data-ai-generation-feedback]");
    if (status) status.textContent = feedback;
  }

  function refreshReadiness() {
    if (readinessPending) return readinessPending;
    generationReady = false;
    generationState = "checking";
    updateGenerationControls();
    readinessPending = Promise.resolve()
      .then(() => window.desktopAPI?.getGenerationStatus?.())
      .then(result => {
        if (result?.ok !== true) {
          generationState = "unavailable";
          generationReady = false;
          return;
        }
        generationState = ["ready", "not_configured", "unavailable", "error"].includes(result.value?.state)
          ? result.value.state
          : (result.value?.ready === true ? "ready" : "not_configured");
        generationReady = result.value?.ready === true && generationState === "ready";
      })
      .catch(() => {
        generationReady = false;
        generationState = "error";
      })
      .finally(() => {
        readinessPending = null;
        updateGenerationControls();
        if (appState()?.page === "ai-create" && typeof render === "function") render();
      });
    return readinessPending;
  }

  async function generate() {
    const identity = projectIdentity();
    if (submitting || !generationReady || !identity.projectId || !currentBrief().trim()) return;
    submitting = true;
    updateGenerationControls();
    submissionKey ||= window.crypto?.randomUUID?.();
    if (!submissionKey) {
      feedback = copy().generationError;
      submitting = false;
      updateGenerationControls();
      return;
    }
    try {
      const result = await window.desktopAPI.submitGeneration({
        projectId: identity.projectId,
        sceneId: identity.sceneId,
        idempotencyKey: submissionKey,
        kind: "video",
        mode: "text-to-video",
        prompt: currentBrief(),
        goal: selectedGoal(),
        aspectRatio: "9:16"
      });
      feedback = result?.ok ? copy().submitted : copy().generationError;
    } catch {
      feedback = copy().generationError;
    } finally {
      submitting = false;
      updateGenerationControls();
    }
  }

  function format(template, values = {}) {
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  }

  function selectedGoal() {
    const saved = String(localStorage.getItem(GOAL_KEY) || "balanced");
    return VALID_GOALS.has(saved) ? saved : "balanced";
  }

  function projectContext() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    const source = jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
    const transcript = current?.translation?.result?.segments || current?.speech?.result?.segments || [];
    const scenes = Array.isArray(current?.scenePlan?.scenes) ? current.scenePlan.scenes : [];
    return {
      source,
      transcriptCount: Array.isArray(transcript) ? transcript.length : 0,
      sceneCount: scenes.length
    };
  }

  function readiness() {
    const current = appState();
    const localReady = current?.speech?.providerStatus?.ready === true || current?.speech?.modelStatus?.state === "installed";
    const cloudReady = Boolean(current?.cloud?.auth || current?.cloud?.account);
    const mediaReady = typeof window.desktopAPI?.searchMedia === "function" || typeof window.desktopAPI?.searchMediaAssets === "function";
    const sceneReady = Boolean(window.ViralCoreScenePlanModel);
    return { localReady, cloudReady, mediaReady, sceneReady };
  }

  function statusPill(label, tone) {
    return '<span class="core-ai-status ' + tone + '">' + esc(label) + '</span>';
  }

  function strategyCard(goal, title, body, active) {
    return '<button type="button" class="core-ai-strategy ' + (active ? "is-active" : "") + '" data-ai-goal="' + goal + '" aria-pressed="' + (active ? "true" : "false") + '">' +
      '<span class="core-ai-strategy-dot" aria-hidden="true"></span>' +
      '<strong>' + esc(title) + '</strong>' +
      '<span>' + esc(body) + '</span>' +
    '</button>';
  }

  function setupCard(icon, title, body, status, tone, action, actionLabel) {
    return '<article class="core-ai-setup-card">' +
      '<div class="core-ai-setup-icon" aria-hidden="true">' + icon + '</div>' +
      '<div class="core-ai-setup-copy"><div class="core-ai-setup-head"><strong>' + esc(title) + '</strong>' + statusPill(status, tone) + '</div><p>' + esc(body) + '</p></div>' +
      (action ? '<button type="button" class="button ghost" data-ai-action="' + action + '">' + esc(actionLabel) + '</button>' : '') +
    '</article>';
  }

  function providerStatus(c) {
    if (generationState === "ready") return { label: c.ready, tone: "ready" };
    if (generationState === "checking") return { label: c.foundationOnly, tone: "foundation" };
    return { label: c.needsProvider, tone: "blocked" };
  }

  function page() {
    const c = copy();
    const goal = selectedGoal();
    const project = projectContext();
    const ready = readiness();
    const provider = providerStatus(c);
    const transcriptLabel = project.transcriptCount > 0 ? format(c.countSegments, { count: project.transcriptCount }) : c.noTranscript;
    const sceneLabel = project.sceneCount > 0 ? format(c.countScenes, { count: project.sceneCount }) : c.noTranscript;

    const workflowTones = [
      "foundation",
      ready.sceneReady ? "ready" : "foundation",
      ready.mediaReady ? "ready" : "foundation",
      generationReady ? "ready" : "blocked",
      "ready",
      "ready",
      "foundation"
    ];
    const workflowStatuses = [
      c.foundationOnly,
      ready.sceneReady ? c.ready : c.foundationOnly,
      ready.mediaReady ? c.ready : c.foundationOnly,
      generationReady ? c.ready : c.needsProvider,
      c.existing,
      c.existing,
      c.foundationOnly
    ];

    return '<div class="core-ai-create-workspace" data-generation-execution="runtime" data-generation-status="' + esc(generationState) + '">' +
      '<section class="core-ai-create-hero">' +
        '<div class="core-ai-create-hero-copy"><span class="core-ai-kicker">' + esc(c.eyebrow) + '</span><h2>' + esc(c.title) + '</h2><p>' + esc(c.body) + '</p>' +
          '<div class="core-ai-hero-status">' + statusPill(c.foundation, "ready") + statusPill(c.sceneReady, ready.sceneReady ? "ready" : "foundation") + statusPill(c.mediaReady, ready.mediaReady ? "ready" : "foundation") + '</div>' +
        '</div>' +
        '<div class="core-ai-create-hero-actions"><button type="button" class="button ghost" data-ai-route="download">' + esc(c.importVideo) + '</button><button type="button" class="button primary" data-ai-route="ai-video">' + esc(c.openStudio) + '</button></div>' +
      '</section>' +

      '<section class="core-ai-create-grid">' +
        '<article class="core-ai-create-card core-ai-brief-card"><div class="core-ai-card-head"><div><span class="eyebrow">01 · BRIEF</span><h3>' + esc(c.briefLabel) + '</h3></div></div>' +
          '<textarea class="core-ai-brief" data-ai-brief maxlength="8000" aria-label="' + esc(c.briefLabel) + '" rows="6" placeholder="' + esc(c.briefPlaceholder) + '">' + esc(currentBrief()) + '</textarea><p class="core-ai-help">' + esc(c.briefHint) + '</p>' +
        '</article>' +
        '<article class="core-ai-create-card core-ai-project-card"><div class="core-ai-card-head"><div><span class="eyebrow">' + esc(c.projectEyebrow) + '</span><h3>' + esc(c.sourceTitle) + '</h3></div></div>' +
          '<div class="core-ai-project-source"><span class="core-ai-project-icon">▶</span><div><strong>' + esc(project.source?.name || c.sourceNone) + '</strong><span>' + esc(project.source ? c.sourceReady : c.sourceNone) + '</span></div></div>' +
          '<div class="core-ai-project-metrics"><div><span>' + esc(c.transcript) + '</span><strong>' + esc(transcriptLabel) + '</strong></div><div><span>' + esc(c.scenes) + '</span><strong>' + esc(sceneLabel) + '</strong></div></div>' +
        '</article>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.strategy) + '</h3><p>' + esc(c.strategyDesc) + '</p></div></div>' +
        '<div class="core-ai-strategy-grid">' +
          strategyCard("economy", c.economy, c.economyBody, goal === "economy") +
          strategyCard("balanced", c.balanced, c.balancedBody, goal === "balanced") +
          strategyCard("quality", c.quality, c.qualityBody, goal === "quality") +
        '</div>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.workflow) + '</h3><p>' + esc(c.workflowDesc) + '</p></div></div>' +
        '<div class="core-ai-pipeline">' + c.steps.map((step, index) => '<div class="core-ai-pipeline-step"><span class="core-ai-step-index">' + String(index + 1).padStart(2, "0") + '</span><div><strong>' + esc(step) + '</strong>' + statusPill(workflowStatuses[index], workflowTones[index]) + '</div></div>').join("") + '</div>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.setup) + '</h3><p>' + esc(c.setupDesc) + '</p></div></div>' +
        '<div class="core-ai-setup-grid">' +
          setupCard("◈", c.localAi, ready.localReady ? c.localAiReady : c.localAiNeeds, ready.localReady ? c.ready : c.foundationOnly, ready.localReady ? "ready" : "foundation", "local-ai", c.manageLocal) +
          setupCard("☁", c.cloudAi, ready.cloudReady ? c.cloudReady : c.cloudNeeds, ready.cloudReady ? c.ready : c.foundationOnly, ready.cloudReady ? "ready" : "foundation", "settings", c.openSettings) +
          setupCard("▦", c.mediaEngine, ready.mediaReady ? c.mediaEngineReady : c.mediaEngineNeeds, ready.mediaReady ? c.ready : c.foundationOnly, ready.mediaReady ? "ready" : "foundation", null, "") +
          setupCard("✦", c.videoProvider, c.providerBody, provider.label, provider.tone, "settings", c.openSettings) +
        '</div>' +
        '<div class="core-ai-model-note"><div><span class="eyebrow">' + esc(c.strategy) + '</span><strong>' + esc(c.restoredModels) + '</strong><p>' + esc(c.restoredModelsBody) + '</p></div></div>' +
      '</section>' +

      '<section class="core-ai-generation-lock"><div><span class="core-ai-lock-icon">✦</span><div><strong>' + esc(c.generationLocked) + '</strong><p>' + esc(c.generationLockedBody) + '</p></div></div><button type="button" class="button primary" data-ai-generate ' + (!canGenerate() ? 'disabled aria-disabled="true"' : 'aria-disabled="false"') + '>' + esc(c.generate) + '</button></section>' +
      '<p role="status" aria-live="polite" data-ai-generation-feedback>' + esc(feedback) + '</p>' +
      '<section class="core-ai-next-block"><span>' + esc(c.nextBlock) + '</span><p>' + esc(c.nextBlockBody) + '</p></section>' +
    '</div>';
  }

  function route(pageId) {
    const current = appState();
    if (!current) return;
    current.page = pageId;
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-ai-generate]")) {
      generate();
      return;
    }

    const goalButton = target.closest("[data-ai-goal]");
    if (goalButton instanceof HTMLButtonElement) {
      const goal = String(goalButton.dataset.aiGoal || "");
      if (!VALID_GOALS.has(goal)) return;
      submissionKey = null;
      localStorage.setItem(GOAL_KEY, goal);
      if (appState()?.page === "ai-create" && typeof render === "function") render();
      return;
    }

    const routeButton = target.closest("[data-ai-route]");
    if (routeButton instanceof HTMLButtonElement) {
      route(String(routeButton.dataset.aiRoute || "download"));
      return;
    }

    const action = target.closest("[data-ai-action]");
    if (!(action instanceof HTMLButtonElement)) return;
    const type = String(action.dataset.aiAction || "");
    if (type === "local-ai" && typeof openLocalModelSetup === "function") {
      openLocalModelSetup().catch?.(() => {});
      return;
    }
    if (type === "settings") route("settings");
  }

  function onInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.aiBrief === undefined) return;
    submissionKey = null;
    localStorage.setItem(BRIEF_KEY, target.value.slice(0, 8000));
    updateGenerationControls();
  }

  function install() {
    if (installed) return;
    try {
      if (typeof pages === "undefined" || !pages) return;
      installed = true;
      pages["ai-create"] = page;
      if (typeof pageMeta !== "undefined" && pageMeta) pageMeta["ai-create"] = ["nav.aiVideo", "aiVideo.breadcrumb"];
      refreshReadiness();
      window.addEventListener("focus", refreshReadiness);
      document.addEventListener("click", onClick);
      document.addEventListener("input", onInput);
      window.addEventListener("viral-ai:core-state-changed", () => {
        refreshReadiness();
        if (appState()?.page === "ai-create" && typeof render === "function") render();
      });
      window.addEventListener("viral-ai:project-snapshot-saved", updateGenerationControls);
      window.addEventListener("viral-ai:project-snapshot-restored", updateGenerationControls);
      document.documentElement.dataset.aiCreateWorkspace = "enabled";
      if (appState()?.page === "ai-create" && typeof render === "function") render();
    } catch {
      console.warn("[AiCreate] Could not install workspace");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
