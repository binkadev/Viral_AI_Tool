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
  let planFeedback = "";
  const sceneDrafts = new Map();
  const contentPlanner = window.ViralContentPlan?.create({
    persistence: window.ViralCoreProjectPersistence, sceneModel: window.ViralCoreScenePlanModel,
    // No synthetic production fallback. An appropriate text adapter must be
    // explicitly supplied by the composition root before this workspace loads.
    adapter: window.ViralTextAuthoringAdapter || null,
    changed: () => updateGenerationControls()
  });
  const planning = () => contentPlanner?.busy() === true;
  let planClosePending = false;

  function guardPlanClose(event) {
    if (!planning()) return;
    event.preventDefault();
    event.returnValue = false;
    if (planClosePending || typeof confirmAction !== "function") return;
    planClosePending = true;
    const c = copy();
    Promise.resolve(confirmAction({ title: c.planCloseTitle, body: c.planCloseBody,
      confirmLabel: c.planStopAndClose, cancelLabel: c.planKeepOpen }))
      .then(confirmed => {
        if (!confirmed) return;
        contentPlanner.cancel();
        window.desktopAPI?.close?.();
      }).catch(() => {}).finally(() => { planClosePending = false; });
    document.getElementById("confirmCancel")?.focus();
  }

  async function generateContentPlan() {
    if (!contentPlanner || planning() || submitting || projectActionPending) return;
    planFeedback = "";
    const result = await contentPlanner.generate(currentBrief(), {
      language: locale(), duration: Number(selectedOption("duration", ["5", "10"], "5")),
      orientation: { "9:16": "portrait", "16:9": "landscape", "1:1": "square" }[selectedOption("aspect", ["9:16", "16:9", "1:1"], "9:16")]
    });
    const key = result.ok ? "planCompleted" : ({ PLAN_UNAVAILABLE: "planUnavailable", PLAN_CANCELLED: "planCancelled",
      PLAN_EXISTING_CONTENT: "planExisting", PLAN_PROJECT_CHANGED: "planChanged", PLAN_INVALID_IDEA: "planInvalidIdea" })[result.code] || "planFailed";
    planFeedback = key;
    renderWorkspace();
    updateGenerationControls();
  }

  function planControls() {
    const c = copy(), busy = planning();
    return '<div class="core-ai-content-planning"><button type="button" class="button ghost" data-ai-plan' +
      (!contentPlanner?.ready() || busy || submitting || projectActionPending || !currentBrief().trim() || !window.ViralContentPlan?.canAuthor(window.ViralCoreProjectPersistence?.snapshot?.()) ? ' disabled' : '') +
      ' aria-describedby="ai-plan-status">' + esc(c.planGenerate) + '</button>' +
      '<button type="button" class="button ghost" data-ai-plan-cancel' + (!busy ? ' hidden' : '') + '>' + esc(c.planCancel) + '</button>' +
      '<p id="ai-plan-status" role="status" aria-live="polite" data-ai-plan-status>' + esc(c[planFeedback || (busy ? "planWorking" : !contentPlanner?.ready() ? "planUnavailable" : "planHint")]) + '</p></div>';
  }

  function scriptReview() {
    const snapshot = window.ViralCoreProjectPersistence?.snapshot?.();
    const script = snapshot?.scenePlan?.authoring?.script;
    if (!script) return "";
    const c = copy(), scene = snapshot.scenePlan.scenes.find(scene => scene.id === snapshot.scenePlan.selectedSceneId);
    const draft = sceneDrafts.get(JSON.stringify([snapshot.projectId, scene?.id])) || scene;
    return '<details data-ai-script-review><summary>' + esc(c.planScript) + '</summary>' +
      ["hook", "body", "cta"].map(key => '<h4>' + esc(c["plan" + key[0].toUpperCase() + key.slice(1)]) + '</h4><p class="core-ai-script-text">' + esc(script[key]) + '</p>').join("") + '</details>' +
      (scene ? '<details data-ai-scene-editor><summary>' + esc(c.planEditScene) + '</summary><form data-ai-scene-edit data-project-id="' + esc(snapshot.projectId) + '" data-scene-id="' + esc(scene.id) + '">' +
        '<label class="core-ai-scene-field">' + esc(c.planSceneTitle) + '<input name="title" data-ai-scene-field="title" maxlength="240" value="' + esc(draft.title || "") + '"></label>' +
        '<label class="core-ai-scene-field">' + esc(c.planSceneText) + '<textarea name="sourceText" data-ai-scene-field="sourceText" maxlength="12000" rows="4">' + esc(draft.sourceText) + '</textarea></label>' +
        '<button class="button ghost" type="submit" data-ai-scene-save>' + esc(c.planSaveScene) + '</button></form></details>' : '');
  }

  function saveSceneEdit(event) {
    const form = event.target;
    if (!form?.matches?.("[data-ai-scene-edit]")) return;
    event.preventDefault();
    if (planning() || submitting) return;
    try {
      window.ViralCoreProjectPersistence.updateProjectScene(form.dataset.sceneId, {
        title: form.elements.title.value, sourceText: form.elements.sourceText.value
      }, { projectId: form.dataset.projectId });
      sceneDrafts.delete(JSON.stringify([form.dataset.projectId, form.dataset.sceneId]));
      planFeedback = "planSceneSaved";
    } catch { planFeedback = "planSceneSaveFailed"; }
    renderWorkspace();
    updateGenerationControls();
  }

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
    return generationReady && !submitting && !planning() && !projectActionPending && typeof window.ViralCoreProjectPersistence?.ensureProject === "function" && Boolean(currentBrief().trim());
  }

  function updateGenerationControls() {
    const button = document.querySelector("[data-ai-generate]");
    if (button) {
      button.disabled = !canGenerate();
      button.setAttribute("aria-disabled", String(button.disabled));
      button.setAttribute("aria-busy", String(submitting));
      const label = button.querySelector?.("[data-ai-generate-label]");
      if (label) label.textContent = submitting ? copy().submitting : copy().generate;
    }
    document.querySelectorAll?.("[data-ai-new-project], [data-ai-open-project]").forEach(control => {
      control.disabled = submitting || planning() || projectActionPending;
    });
    const planButton = document.querySelector("[data-ai-plan]");
    if (planButton) planButton.disabled = !contentPlanner?.ready() || planning() || submitting || projectActionPending || !currentBrief().trim() || !window.ViralContentPlan?.canAuthor(window.ViralCoreProjectPersistence?.snapshot?.());
    const cancelPlan = document.querySelector("[data-ai-plan-cancel]");
    if (cancelPlan) cancelPlan.hidden = !planning();
    const planStatus = document.querySelector("[data-ai-plan-status]");
    if (planStatus) planStatus.textContent = copy()[planning() ? "planWorking" : planFeedback || (!contentPlanner?.ready() ? "planUnavailable" : "planHint")];
    const status = document.querySelector("[data-ai-generation-feedback]");
    if (status) status.textContent = feedback;
    updateSceneContext();
    const readiness = document.querySelector("[data-ai-readiness]");
    if (readiness) {
      const provider = providerStatus(copy());
      readiness.textContent = provider.label;
      readiness.className = "core-ai-status " + provider.tone;
      const hint = document.querySelector("[data-ai-readiness-hint]");
      if (hint) hint.textContent = provider.hint || "";
    }
  }

  function renderWorkspace() {
    if (appState()?.page !== "ai-create" || typeof render !== "function") return;
    // Keep presentation-only disclosure/focus across readiness and identity paints.
    const host = document.querySelector(".core-ai-create-workspace");
    const focused = document.activeElement;
    const hooks = ["data-ai-plan", "data-ai-plan-cancel", "data-ai-scene-field", "data-ai-scene-save", "data-ai-brief", "data-ai-setting", "data-ai-customize-trigger", "data-ai-recent-trigger", "data-ai-generate", "data-project-name", "data-project-name-rename", "data-production-mode", "data-production-details-trigger", "data-production-action", "data-project-scene-action"];
    const hook = host?.contains(focused) ? hooks.find(key => focused.hasAttribute(key)) : null;
    const value = hook ? focused.getAttribute(hook) : null;
    const sceneId = hook ? focused.dataset.sceneId : undefined;
    const projectId = hook ? projectIdentity().projectId : null;
    const selection = ["data-ai-brief", "data-ai-scene-field"].includes(hook) ? [focused.selectionStart, focused.selectionEnd] : null;
    const open = ["data-ai-customize", "data-ai-recent", "data-production-details", "data-ai-script-review", "data-ai-scene-editor"].map(key => [key, document.querySelector("details[" + key + "]")?.open]);
    try {
      render();
      for (const [key, expanded] of open) {
        const disclosure = document.querySelector("details[" + key + "]");
        if (disclosure && expanded !== undefined) disclosure.open = expanded;
      }
      if (hook) {
        const restore = () => {
          if (appState()?.page !== "ai-create" || projectIdentity().projectId !== projectId) return;
          const target = [...document.querySelectorAll("[" + hook + "]")].find(node => node.getAttribute(hook) === value && node.dataset.sceneId === sceneId && !node.disabled);
          target?.focus({ preventScroll: true });
          if (selection) target?.setSelectionRange(...selection);
        };
        restore();
        // Existing owners inject planning controls after a page paint. Restore
        // only lost focus, after their insertion; never steal a newer focus.
        if (hook.startsWith("data-production-")) requestAnimationFrame(() => requestAnimationFrame(() => {
          if (appState()?.page === "ai-create" && projectIdentity().projectId === projectId && open.find(([key]) => key === "data-production-details")?.[1]) {
            const details = document.querySelector("[data-production-details]");
            if (details) details.open = true;
          }
          if (document.activeElement === document.body) restore();
        }));
      }
      rename?.restoreFocus(document);
    }
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

  function providerStatus(c) {
    if (generationReady) return { label: c.aiReady, tone: "ready" };
    if (generationState === "checking") return { label: c.aiChecking, tone: "checking" };
    if (generationState === "error") return { label: c.aiStatusError, tone: "blocked", hint: c.statusErrorHint };
    return { label: c.aiNotReady, tone: "blocked", hint: c.connectionHint };
  }

  function sceneContext() {
    const snapshot = window.ViralCoreProjectPersistence?.snapshot?.();
    if (!snapshot?.projectId) return copy().firstScene;
    const scenes = snapshot.scenePlan?.scenes || [];
    const index = scenes.findIndex(scene => scene.id === snapshot.scenePlan.selectedSceneId);
    if (index < 0) return copy().sceneUnavailable;
    const number = String(index + 1).padStart(2, "0");
    return format(scenes[index].title ? copy().namedScene : copy().sceneNumber, { number, title: scenes[index].title });
  }

  function updateSceneContext() {
    const context = document.querySelector("[data-ai-scene-context]");
    if (context) context.textContent = context.title = sceneContext();
    const count = document.querySelector("[data-ai-plan-count]");
    if (count) count.textContent = planSceneCount();
  }

  function planSceneCount() {
    const count = window.ViralCoreProjectPersistence?.snapshot?.()?.scenePlan?.scenes?.length || 0;
    return format(count === 1 ? copy().oneScene : copy().sceneCount, { count });
  }

  function settingsSummary() {
    const c = copy();
    const values = museSession ? [c.museSessionSettings] : [
      selectedOption("aspect", ["9:16", "16:9", "1:1"], "9:16"),
      selectedOption("duration", ["5", "10"], "5") === "10" ? c.tenSeconds : c.fiveSeconds,
      c[selectedGoal()], c.automaticProvider
    ];
    return values.map(value => '<span class="core-ai-setting-chip">' + esc(value) + '</span>').join("");
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
    const persistence = window.ViralCoreProjectPersistence;
    const projects = persistence?.listProjects?.() || [];
    const activeId = persistence?.activeProjectId?.();
    const activeProject = projects.find(item => item.projectId === activeId);
    const projectType = item => item.projectKind === "ai" || (!item.projectKind && !item.hasSource) ? c.aiProject : c.importedProject;
    return '<div class="core-ai-create-workspace" data-generation-execution="runtime" data-generation-status="' + esc(generationState) + '">' +
      '<header class="core-ai-create-hero">' +
      '<div class="core-ai-project-context">' +
      (activeProject ? '<div class="core-ai-active-project" data-ai-active-project="' + esc(activeId) + '">' + (rename?.markup(activeId, activeProject.projectName) || '<strong title="' + esc(activeProject.projectName) + '">' + esc(activeProject.projectName) + '</strong>') + '</div>' : '<p class="core-ai-project-empty">' + esc(c.implicitProject) + '</p>') +
      '<div class="core-ai-project-actions">' +
      (activeProject ? '<button class="button ghost" type="button" data-ai-route="ai-video">' + esc(c.openStudio) + ' <span aria-hidden="true">&#8599;</span></button>' : '') +
      '<button class="button ghost" type="button" data-ai-new-project' + (projectActionPending || submitting ? ' disabled' : '') + '>' + esc(c.newProjectAction) + '</button></div></div></header>' +
      '<section class="core-ai-composer" aria-labelledby="ai-creation-title">' +
      '<div class="core-ai-creation-heading"><span class="core-ai-kicker">' + esc(c.composerEyebrow) + '</span><h3 id="ai-creation-title">' + esc(c.creationQuestion) + '</h3><p>' + esc(c.composerBody) + '</p></div>' +
      '<div class="core-ai-input-canvas"><div class="core-ai-scene-context"><span data-ai-scene-context role="status" aria-live="polite" aria-atomic="true" title="' + esc(sceneContext()) + '">' + esc(sceneContext()) + '</span>' +
      (activeProject ? '<button type="button" class="button ghost" data-ai-action="change-scene">' + esc(c.changeScene) + ' <span aria-hidden="true">&#8595;</span></button>' : '') + '</div>' +
      '<label id="ai-brief-label" for="ai-brief" class="core-ai-prompt-label">' + esc(c.briefLabel) + '</label>' +
      '<textarea id="ai-brief" class="core-ai-brief" data-ai-brief maxlength="8000" rows="4" spellcheck="false" aria-describedby="ai-brief-hint" placeholder="' + esc(c.composerPlaceholder) + '">' + esc(currentBrief()) + '</textarea>' +
      '<div class="core-ai-canvas-foot"><p id="ai-brief-hint" class="core-ai-brief-hint">' + esc(c.briefHint) + '</p><span class="core-ai-canvas-mark" aria-hidden="true">&#10022;</span></div></div>' +
      '<div class="core-ai-examples" role="group" aria-label="' + esc(c.examplesHint) + '"><div class="core-ai-example-row">' + c.examples.map((sample, i) => '<button type="button" class="core-ai-example" data-ai-example="' + i + '" title="' + esc(sample.detail) + '"><strong>' + esc(sample.title) + '</strong></button>').join('') + '</div></div>' +
      '<div class="core-ai-creation-controls" role="group" aria-label="' + esc(c.creationControls) + '"><details class="core-ai-customize" data-ai-customize><summary data-ai-customize-trigger><span class="core-ai-settings-summary" data-ai-settings-summary>' + settingsSummary() + '</span><span class="core-ai-customize-label">' + esc(c.customize) + ' <span class="core-ai-chevron" aria-hidden="true">&#8964;</span></span></summary>' +
      '<div class="core-ai-controls">' +
      (museSession ? '<p class="core-ai-session-note">' + esc(c.museSessionSettings) + '</p>' : '') +
      setting('aspect', c.aspectLabel, [['9:16', c.portrait], ['16:9', c.landscape], ['1:1', c.square]], selectedOption('aspect', ['9:16','16:9','1:1'], '9:16')) +
      setting('duration', c.durationLabel, [['5', c.fiveSeconds], ['10', c.tenSeconds]], selectedOption('duration', ['5','10'], '5')) +
      setting('goal', c.qualityLabel, [['economy', c.economy], ['balanced', c.balanced], ['quality', c.quality]], selectedGoal()) +
      '<div class="core-ai-provider"><span>' + esc(c.providerLabel) + '</span><button class="core-ai-provider-button" type="button" data-ai-action="settings">' + esc(c.viewSettings) + '<span aria-hidden="true">&#8599;</span></button></div></div>' + planControls() + '</details>' +
      '<div class="core-ai-composer-footer core-ai-generation-lock"><div class="core-ai-provider-note"><div class="core-ai-readiness-copy"><span class="core-ai-status ' + provider.tone + '" data-ai-readiness role="status" aria-live="polite">' + esc(provider.label) + '</span><p data-ai-readiness-hint>' + esc(provider.hint || '') + '</p></div>' +
      '<button class="button ghost" type="button" data-ai-action="settings">' + esc(c.openSettings) + '</button></div><button type="button" class="button primary" data-ai-generate aria-busy="' + submitting + '" ' + (!canGenerate() ? 'disabled aria-disabled="true"' : 'aria-disabled="false"') + '><span class="core-ai-submit-icon" aria-hidden="true">&#10022;</span> <span data-ai-generate-label>' + esc(submitting ? c.submitting : c.generate) + '</span></button></div>' +
      '<p class="core-ai-feedback" role="status" aria-live="polite" data-ai-generation-feedback>' + esc(feedback) + '</p></div></section>' +
      (activeProject ? '<section class="core-ai-project-plan" aria-labelledby="ai-plan-title"><div class="core-ai-section-heading"><h3 id="ai-plan-title">' + esc(c.projectPlan) + '</h3><span data-ai-plan-count>' + esc(planSceneCount()) + '</span></div>' + scriptReview() + (window.ViralCoreProjectScenes?.surface?.() || '') + '</section>' : '') +
      '<details class="core-ai-recent" data-ai-recent><summary data-ai-recent-trigger>' + esc(c.recentTitle) + '<span class="core-ai-chevron" aria-hidden="true">&#8964;</span></summary><div class="core-ai-recent-content"><div class="core-ai-section-heading"><button type="button" class="button ghost" data-ai-route="download">' + esc(c.importVideo) + ' <span aria-hidden="true">&#8599;</span></button></div>' +
      (projects.length ? projects.map(item => '<div class="core-ai-recent-project"><div><strong title="' + esc(item.projectName) + '">' + esc(item.projectName) + '</strong><span>' + esc(item.projectId === activeId ? format(c.currentProject, { projectType: projectType(item) }) : projectType(item)) + '</span></div>' +
        (item.projectId === activeId ? '' : '<button class="button ghost" type="button" data-ai-open-project="' + esc(item.projectId) + '"' + (projectActionPending || submitting ? ' disabled' : '') + '>' + esc(c.openProject) + '</button>') + '</div>').join('') : '<div class="core-ai-recent-empty"><strong>' + esc(c.noProjects) + '</strong><p>' + esc(c.noProjectsHint) + '</p></div>') + '</div></details></div>';
  }

  function route(pageId) {
    const current = appState();
    if (!current) return;
    current.page = pageId;
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  async function projectAction(projectId = null) {
    if (submitting || planning() || projectActionPending) return;
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
    if (target.closest("[data-ai-plan]")) { if (event.detail <= 1) generateContentPlan(); return; }
    if (target.closest("[data-ai-plan-cancel]")) { contentPlanner?.cancel(); return; }

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
    if (type === "change-scene") {
      const surface = document.querySelector("[data-project-scenes]");
      surface?.focus({ preventScroll: true });
      surface?.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    if (type === "settings") route("settings");
  }

  function onInput(event) {
    const target = event.target;
    const form = target.closest?.("[data-ai-scene-edit]");
    if (form && target.dataset.aiSceneField) {
      sceneDrafts.set(JSON.stringify([form.dataset.projectId, form.dataset.sceneId]), {
        title: form.elements.title.value, sourceText: form.elements.sourceText.value
      });
      return;
    }
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
      window.addEventListener("pagehide", () => contentPlanner?.cancel());
      window.addEventListener("beforeunload", guardPlanClose);
      window.addEventListener("viral-ai:generation-new-request", beginNewRequest);
      document.addEventListener("click", onClick);
      document.addEventListener("input", onInput);
      document.addEventListener("submit", saveSceneEdit);
      document.addEventListener('change', event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.dataset.aiSetting) return;
        const name = target.dataset.aiSetting;
        const choices = { aspect: ['9:16', '16:9', '1:1'], duration: ['5', '10'], goal: [...VALID_GOALS] };
        if (!choices[name]?.includes(target.value)) return;
        localStorage.setItem('viral-ai-generation-' + name, target.value);
        submissionKey = null;
        updateGenerationControls();
        const summary = document.querySelector("[data-ai-settings-summary]");
        if (summary) summary.innerHTML = settingsSummary();
      });
      window.addEventListener("viral-ai:scene-plan-changed", updateSceneContext);
      window.addEventListener("viral-ai:core-state-changed", event => {
        if (event?.detail?.reason === "project-rename") { renderWorkspace(); return; }
        if (event?.detail?.reason === "project-scene") { renderWorkspace(); updateGenerationControls(); return; }
        refreshReadiness();
        renderWorkspace();
      });
      window.addEventListener("viral-ai:project-snapshot-saved", updateGenerationControls);
      window.addEventListener("viral-ai:project-snapshot-restored", () => {
        submissionKey = null;
        feedback = "";
        planFeedback = "";
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
