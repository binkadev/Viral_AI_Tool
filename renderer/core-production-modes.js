(function installProductionModes() {
  "use strict";
  const persistence = window.ViralCoreProjectPersistence, model = window.ViralProductionModel;
  if (!persistence || !model || !window.ViralSceneOrchestration) return;
  const KEY = "viral-ai-production-mode";
  let mode = "assisted", queued = false, reviewTarget = null;
  try { mode = model.mode(localStorage.getItem(KEY)); } catch {}
  const locale = () => { try { return state.locale === "en" ? "en" : "vi"; } catch { return "vi"; } };
  const t = (key, vars) => window.I18N.t(locale(), "productionModes." + key, vars);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const runtime = window.ViralProductionRuntime.create({ model, actionModel: window.ViralSceneActionModel, persistence,
    projectMedia: window.ViralCoreProjectMedia, desktop: window.desktopAPI, orchestration: window.ViralSceneOrchestration.runtime,
    attachmentStatus: id => window.ViralCoreGeneratedMedia.status(id), id: () => window.crypto.randomUUID(), changed: queue });
  window.ViralProductionModes = { runtime };
  function refresh() {
    queued = false;
    if (reviewTarget && persistence.activeProjectId() === reviewTarget.projectId &&
        persistence.snapshot()?.scenePlan?.selectedSceneId === reviewTarget.sceneId) {
      const materials = document.querySelector("[data-scene-materials]");
      if (materials) { materials.focus(); materials.scrollIntoView({ block: "nearest" }); reviewTarget = null; }
    }
    let inWorkspace = false;
    try { inWorkspace = state.page === "ai-create"; } catch {}
    if (!inWorkspace) return;
    const list = document.querySelector("[data-project-scenes]");
    if (!list) return;
    let section = list.previousElementSibling;
    if (!section?.matches("[data-production-modes]")) {
      section = document.createElement("section"); section.dataset.productionModes = "true";
      section.className = "core-production-modes"; section.tabIndex = -1; list.before(section);
    }
    const view = runtime.view(), snapshot = persistence.snapshot(), projectId = snapshot?.projectId;
    if (!projectId) { section.hidden = true; return; }
    section.hidden = false; section.setAttribute("aria-label", t("title"));
    const active = ["running", "paused"].includes(view.state), selectedMode = active ? view.run.mode : mode;
    const key = JSON.stringify([view, projectId, selectedMode, locale(), t("title"), t("start")]);
    if (section.__productionKey === key) return;
    const focus = section.contains(document.activeElement) ? { action: document.activeElement.dataset.productionAction,
      scene: document.activeElement.dataset.sceneId, mode: document.activeElement.matches("select") } : null;
    section.__productionKey = key; section.dataset.projectId = projectId;
    const button = (action, disabled) => '<button type="button" data-production-action="' + action + '"' +
      (disabled ? ' disabled' : '') + '>' + esc(t(action)) + '</button>';
    const sceneName = id => { const scenes = model.ordered(snapshot), index = scenes.findIndex(s => s.id === id);
      return scenes[index]?.title || t("scene", { number: index + 1 }); };
    section.innerHTML = '<h3>' + esc(t("title")) + '</h3><label><span>' + esc(t("mode")) + '</span>' +
      '<select data-production-mode' + (active || view.settling ? ' disabled' : '') + '>' + ["assisted", "auto"].map(value =>
        '<option value="' + value + '"' + (selectedMode === value ? ' selected' : '') + '>' + esc(t(value)) + '</option>').join("") + '</select></label>' +
      '<p>' + esc(t(selectedMode + "Description")) + '</p><div class="core-production-controls">' +
      button("start", active || view.settling) + button("pause", view.state !== "running") +
      button("resume", view.state !== "paused") + button("stop", !active) + '</div>' +
      '<p role="status" aria-live="polite" aria-atomic="true">' + esc(t(view.state === "completed" ?
        view.summary.ready === view.summary.total ? "materialsReady" : "reviewReady" : view.state)) + ' ' +
        esc(t("counts", view.summary)) + (view.current ? ' ' + esc(t(view.phase || "checking", { scene: sceneName(view.current) })) : '') + '</p>' +
      '<p class="core-production-note">' + esc(t("stopNote")) + '</p>' +
      (view.summary.scenes.some(s => ["review", "attention"].includes(s.status)) ? '<ul>' + view.summary.scenes.filter(s => ["review", "attention"].includes(s.status)).map(s =>
        '<li><span>' + esc(t(s.status + "Scene", { scene: sceneName(s.sceneId) })) + '</span> ' +
        (s.status === "attention" ? '<small>' + esc(t(reasonKey(s.reason))) + '</small> ' : '') +
        '<button type="button" data-production-action="review" data-scene-id="' + esc(s.sceneId) + '">' + esc(t("review")) + '</button></li>').join("") + '</ul>' : '');
    if (focus) {
      const target = [...section.querySelectorAll("button,select")].find(n => !n.disabled && (focus.mode ? n.matches("select") :
        n.dataset.productionAction === focus.action && n.dataset.sceneId === focus.scene));
      (target || section).focus();
    }
  }
  function reasonKey(reason) {
    if (reason === "no-source") return "noSource";
    if (reason === "broken-selection") return "brokenSelection";
    if (reason === "RECOVERY_REQUIRED") return "recovery";
    if (reason === "SCENE_SUBMIT_UNCERTAIN") return "uncertain";
    if (["GENERATION_FAILED", "GENERATION_CANCELLED", "SCENE_GENERATION_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "DUPLICATE_JOB"].includes(reason)) return "generationFailed";
    return "operationFailed";
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  document.addEventListener("change", event => {
    if (!event.target.matches?.("[data-production-mode]")) return;
    const view = runtime.view();
    if (["running", "paused"].includes(view.state) || view.settling) return;
    mode = model.mode(event.target.value);
    try { localStorage.setItem(KEY, mode); } catch {}
    queue(); // Preference only; no execution authority.
  });
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-production-action]");
    if (!button || button.disabled || event.detail > 1) return;
    const projectId = button.closest("[data-production-modes]")?.dataset.projectId;
    if (!projectId || projectId !== persistence.activeProjectId()) { queue(); return; }
    const action = button.dataset.productionAction;
    if (action === "start") runtime.start(projectId, mode);
    else if (action === "review") {
      try {
        persistence.selectProjectScene(button.dataset.sceneId, { projectId });
        reviewTarget = { projectId, sceneId: button.dataset.sceneId };
        state.page = "ai-video";
        if (typeof save === "function") save();
        if (typeof render === "function") render();
        queue();
      } catch { queue(); }
    } else if (["pause", "resume", "stop"].includes(action)) runtime[action]();
  });
  window.desktopAPI?.onGenerationChanged?.(() => runtime.notify());
  for (const name of ["viral-ai:generation-attachment-changed", "viral-ai:core-state-changed", "viral-ai:scene-plan-changed"]) window.addEventListener(name, () => runtime.notify());
  window.addEventListener("viral-ai:project-snapshot-restored", () => { runtime.invalidate(); reviewTarget = null; queue(); });
  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
        (node.matches?.("[data-project-scenes]") || node.querySelector?.("[data-project-scenes]"))))) queue();
    }).observe(page, { childList: true, subtree: true });
    queue();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
