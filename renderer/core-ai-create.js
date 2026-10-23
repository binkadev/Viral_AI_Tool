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

  function defaultProjectName() {
    const now = new Date(), pad = n => String(n).padStart(2, "0");
    return copy().defaultProjectNameBase + " · " + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
      " " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  const rename = window.ViralProjectIdentity?.create({ owner:"ai", persistence:window.ViralCoreProjectPersistence,
    locale, currentId:() => appState()?.page === "ai-create" ? projectIdentity().projectId : null,
    changed:() => { renderWorkspace(); rename.restoreFocus(document); }, document, i18n:window.I18N });

  let generationReady = false;
  let museSession=false;
  let generationState = "checking";
  let readinessPending = null;
  let submitting = false;
  let projectActionPending = false;
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

  function beginNewRequest(event) {
    if(submitting || !event.detail?.projectId || event.detail.projectId!==projectIdentity().projectId)return;
    // An explicit new-request action rotates admission identity, never a rerender
    // or a check of an uncertain operation. Submission still requires Generate.
    submissionKey=null;
    feedback="";
  }

  function canGenerate() {
    return generationReady && !submitting && !projectActionPending && typeof window.ViralCoreProjectPersistence?.ensureProject === "function" && Boolean(currentBrief().trim());
  }

  function updateGenerationControls() {
    const button = document.querySelector("[data-ai-generate]");
    if (button) {
      button.disabled = !canGenerate();
      button.setAttribute("aria-disabled", String(button.disabled));
    }
    document.querySelectorAll?.("[data-ai-new-project], [data-ai-open-project]").forEach(control => {
      control.disabled = submitting || projectActionPending;
    });
    const status = document.querySelector("[data-ai-generation-feedback]");
    if (status) status.textContent = feedback;
  }

  function renderWorkspace() {
    if (appState()?.page !== "ai-create" || typeof render !== "function") return;
    try { render(); }
    catch { console.warn("[AiCreate] Workspace presentation could not refresh"); }
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
        museSession=generationReady && result.value?.providers?.some(p=>p.id==='muse' && p.ready) && !result.value?.modelIds?.length;
      })
      .catch(() => {
        generationReady = false;
        generationState = "error";
      })
      .finally(() => {
        readinessPending = null;
        updateGenerationControls();
        renderWorkspace();
      });
    return readinessPending;
  }

  async function generate() {
    if (!canGenerate()) return;
    const prompt = currentBrief();
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
      let snapshot;
      try {
        snapshot = await window.ViralCoreProjectPersistence.ensureProject({ projectName: defaultProjectName() });
        if (!snapshot?.projectId || !snapshot?.scenePlan?.selectedSceneId) throw Error("PROJECT_NOT_PERSISTED");
      } catch {
        feedback = copy().projectSaveError;
        return;
      }
      const identity = { projectId: snapshot.projectId, sceneId: snapshot.scenePlan.selectedSceneId };
      const result = await window.desktopAPI.submitGeneration({
        projectId: identity.projectId,
        sceneId: identity.sceneId,
        idempotencyKey: submissionKey,
        kind: "video",
        mode: "text-to-video",
        prompt,
        goal: selectedGoal(),
        ...(museSession?{providerId:'muse'}:{
          aspectRatio: selectedOption("aspect", ["9:16", "16:9", "1:1"], "9:16"),
          durationSeconds: Number(selectedOption("duration", ["5", "10"], "5"))})
      });
      feedback = result?.ok ? copy().submitted : copy().generationError;
      if (result?.ok && result.value?.id && result.value.projectId === identity.projectId) {
        // Enroll only this admitted request, never previously completed jobs.
        await window.ViralCoreGeneratedMedia?.track(result.value);
        if (projectIdentity().projectId === identity.projectId) await window.ViralGenerationProgress?.open(result.value.id);
      }
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

  function selectedOption(name, values, fallback) {
    const value = localStorage.getItem('viral-ai-generation-' + name);
    return values.includes(value) ? value : fallback;
  }

  function setting(name, label, options, value) {
    if(museSession && ['aspect','duration','goal'].includes(name))return '';
    return '<label class="core-ai-setting"><span>' + esc(label) + '</span><select data-ai-setting="' + name + '">' + options.map(([id, title]) => '<option value="' + id + '"' + (id === value ? ' selected' : '') + '>' + esc(title) + '</option>').join('') + '</select></label>';
  }

  function page() {
    const c = copy();
    const provider = providerStatus(c);
    const project = projectContext();
    const samples = c.examples;
    const persistence = window.ViralCoreProjectPersistence;
    const projects = persistence?.listProjects?.() || [];
    const activeId = persistence?.activeProjectId?.();
    const activeProject = projects.find(item => item.projectId === activeId);
    const projectType = item => item.projectKind === "ai" || (!item.projectKind && !item.hasSource) ? c.aiProject : c.importedProject;
    return '<div class="core-ai-create-workspace" data-generation-execution="runtime" data-generation-status="' + esc(generationState) + '">' +
      '<header class="core-ai-create-hero"><div><span class="core-ai-kicker">' + esc(c.composerEyebrow) + '</span><h2>' + esc(c.composerTitle) + '</h2><p>' + esc(c.composerBody) + '</p></div><div class="core-ai-project-actions"><button class="button ghost" type="button" data-ai-new-project' + (projectActionPending || submitting ? ' disabled' : '') + '>' + esc(c.newAiProject) + '</button><button class="button ghost" type="button" data-ai-route="ai-video">' + esc(c.openStudio) + ' <span aria-hidden="true">↗</span></button></div></header>' +
      (activeProject ? '<div class="core-ai-active-project" data-ai-active-project="' + esc(activeId) + '">' + (rename?.markup(activeId, activeProject.projectName) || '<strong title="' + esc(activeProject.projectName) + '">' + esc(activeProject.projectName) + '</strong>') + '<span>' + esc(projectType(activeProject)) + '</span></div>' : '') +
      (activeProject ? window.ViralCoreProjectScenes?.surface?.() || '' : '') +
      '<section class="core-ai-composer" aria-labelledby="ai-brief-label"><label id="ai-brief-label" for="ai-brief" class="core-ai-prompt-label"><span aria-hidden="true">✦</span> ' + esc(c.briefLabel) + '</label>' +
      '<textarea id="ai-brief" class="core-ai-brief" data-ai-brief maxlength="8000" rows="4" placeholder="' + esc(c.composerPlaceholder) + '">' + esc(currentBrief()) + '</textarea>' +
      '<div class="core-ai-controls core-ai-strategy-grid">' +
      (museSession?'<p>'+esc(c.museSessionSettings)+'</p>':'') +
      setting('aspect', c.aspectLabel, [['9:16', c.portrait], ['16:9', c.landscape], ['1:1', c.square]], selectedOption('aspect', ['9:16','16:9','1:1'], '9:16')) +
      setting('duration', c.durationLabel, [['5', c.fiveSeconds], ['10', c.tenSeconds]], selectedOption('duration', ['5','10'], '5')) +
      setting('goal', c.qualityLabel, [['economy', c.economy], ['balanced', c.balanced], ['quality', c.quality]], selectedGoal()) +
      '<div class="core-ai-provider"><span>' + esc(c.providerLabel) + '</span><button class="core-ai-provider-button" type="button" data-ai-action="settings">' + esc(c.automaticProvider) + '<span aria-hidden="true">↗</span></button></div></div>' +
      '<div class="core-ai-composer-footer core-ai-generation-lock"><div class="core-ai-provider-note">' + statusPill(provider.label, provider.tone) + '<span>' + esc(generationReady ? c.briefHint : c.connectionHint) + '</span></div><button type="button" class="button primary" data-ai-generate ' + (!canGenerate() ? 'disabled aria-disabled="true"' : 'aria-disabled="false"') + '><span aria-hidden="true">✦</span> ' + esc(c.generate) + '</button></div>' +
      '<p class="core-ai-feedback" role="status" aria-live="polite" data-ai-generation-feedback>' + esc(feedback) + '</p></section>' +
      '<section class="core-ai-examples" aria-labelledby="ai-examples-title"><div class="core-ai-section-heading"><h3 id="ai-examples-title">' + esc(c.examplesTitle) + '</h3><span>' + esc(c.examplesHint) + '</span></div><div class="core-ai-example-row">' + samples.map((sample, i) => '<button type="button" class="core-ai-example" data-ai-example="' + i + '"><span class="core-ai-example-art art-' + i + '" aria-hidden="true"><i></i><b></b><em></em></span><span class="core-ai-example-copy"><strong>' + esc(sample.title) + '</strong><span>' + esc(sample.detail) + '</span></span><span class="core-ai-example-arrow" aria-hidden="true">↗</span></button>').join('') + '</div></section>' +
      '<section class="core-ai-recent"><div class="core-ai-section-heading"><h3>' + esc(c.recentTitle) + '</h3><button type="button" class="button ghost" data-ai-route="download">' + esc(c.importVideo) + ' <span aria-hidden="true">↗</span></button></div>' +
      (projects.length ? projects.map(item => '<div class="core-ai-recent-project"><span class="core-ai-recent-icon" aria-hidden="true">↗</span><div><strong title="' + esc(item.projectName) + '">' + esc(item.projectName) + '</strong><span>' + esc(item.projectId === activeId ? format(c.currentProject, { projectType: projectType(item) }) : projectType(item)) + '</span></div>' +
        (item.projectId === activeId ? '' : '<button class="button ghost" type="button" data-ai-open-project="' + esc(item.projectId) + '"' + (projectActionPending || submitting ? ' disabled' : '') + '>' + esc(c.openProject) + '</button>') + '</div>').join('') : '<div class="core-ai-recent-empty"><span aria-hidden="true">↗</span><div><strong>' + esc(c.noProjects) + '</strong><p>' + esc(c.noProjectsHint) + '</p></div></div>') + '</section></div>';
  }

  function route(pageId) {
    const current = appState();
    if (!current) return;
    current.page = pageId;
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  async function projectAction(projectId = null) {
    if (submitting || projectActionPending) return;
    projectActionPending = true;
    updateGenerationControls();
    try {
      const persistence = window.ViralCoreProjectPersistence;
      if (projectId) await persistence.openProject(projectId);
      else await persistence.createProject({ kind: "ai", projectName: defaultProjectName() });
      submissionKey = null;
      feedback = "";
    } catch (error) {
      feedback = error?.message === "PROJECT_WORK_RUNNING" ? copy().projectWorkRunning : copy().projectSwitchError;
    } finally {
      projectActionPending = false;
      renderWorkspace();
      updateGenerationControls();
    }
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const newProject = target.closest("[data-ai-new-project]");
    const openProject = target.closest("[data-ai-open-project]");
    if (newProject || openProject) {
      if (event.detail > 1) return;
      projectAction(openProject?.dataset.aiOpenProject || null);
      return;
    }

    if (target.closest("[data-ai-generate]")) {
      generate();
      return;
    }

    const example = target.closest('[data-ai-example]');
    if (example) {
      const sample = copy().examples[Number(example.dataset.aiExample)];
      const input = document.querySelector('[data-ai-brief]');
      if (sample && input) {
        input.value = sample.prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
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
      window.addEventListener("viral-ai:generation-new-request", beginNewRequest);
      document.addEventListener("click", onClick);
      document.addEventListener("input", onInput);
      document.addEventListener('change', event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.dataset.aiSetting) return;
        const name = target.dataset.aiSetting;
        const choices = { aspect: ['9:16', '16:9', '1:1'], duration: ['5', '10'], goal: [...VALID_GOALS] };
        if (!choices[name]?.includes(target.value)) return;
        localStorage.setItem('viral-ai-generation-' + name, target.value);
        submissionKey = null;
        updateGenerationControls();
      });
      window.addEventListener("viral-ai:core-state-changed", event => {
        if (event?.detail?.reason === "project-rename") { renderWorkspace(); return; }
        if (event?.detail?.reason === "project-scene") { updateGenerationControls(); return; }
        refreshReadiness();
        renderWorkspace();
      });
      window.addEventListener("viral-ai:project-snapshot-saved", updateGenerationControls);
      window.addEventListener("viral-ai:project-snapshot-restored", () => {
        submissionKey = null;
        feedback = "";
        updateGenerationControls();
      });
      document.documentElement.dataset.aiCreateWorkspace = "enabled";
      if (appState()?.page === "ai-create" && typeof render === "function") render();
    } catch {
      console.warn("[AiCreate] Could not install workspace");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
