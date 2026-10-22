(function installSceneMaterialActions() {
  "use strict";
  const persistence = window.ViralCoreProjectPersistence, model = window.ViralSceneActionModel;
  if (!persistence || !model || !window.ViralSceneActionRuntime) return;
  const locale = () => { try { return state.locale === "en" ? "en" : "vi"; } catch { return "vi"; } };
  const t = (key, vars) => window.I18N.t(locale(), "sceneActions." + key, vars);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let queued = false, focusReturn = null;
  const runtime = window.ViralSceneActionRuntime.create({ model, persistence,
    status: () => window.desktopAPI.getGenerationStatus(), submit: request => window.desktopAPI.submitGeneration(request),
    track: job => window.ViralCoreGeneratedMedia.track(job), attachmentStatus: id => window.ViralCoreGeneratedMedia.status(id),
    openProgress: id => window.ViralGenerationProgress?.open(id), id: () => window.crypto.randomUUID(),
    preferences: () => ({ goal: localStorage.getItem("viral-ai-generation-goal"), aspect: localStorage.getItem("viral-ai-generation-aspect"), duration: localStorage.getItem("viral-ai-generation-duration") }),
    changed: () => queue() });
  window.ViralSceneOrchestration = { runtime };
  function statusKey(status) {
    if (status.state !== "failed") return status.reason === "SCENE_PROGRESS_UNAVAILABLE" ? "progressUnavailable" : status.state;
    if (status.reason === "SCENE_ATTACHMENT_FAILED") return "attachmentFailed";
    if (status.reason === "SCENE_SUBMIT_UNCERTAIN") return "uncertain";
    if (status.reason === "DUPLICATE_JOB") return "busy";
    return "unavailable";
  }
  function refresh() {
    queued = false;
    const snapshot = persistence.snapshot(), scene = snapshot?.scenePlan?.scenes?.find(s => s.id === snapshot.scenePlan.selectedSceneId);
    for (const list of document.querySelectorAll("[data-project-scenes]")) {
      let section = list.nextElementSibling;
      if (!section?.matches("[data-scene-orchestration]")) {
        section = document.createElement("section"); section.dataset.sceneOrchestration = "true"; section.className = "core-scene-actions"; section.tabIndex = -1;
        list.after(section);
      }
      if (!scene) { section.hidden = true; continue; }
      section.hidden = false; section.setAttribute("aria-label", t("title"));
      const plan = model.buildSceneActionPlan(scene), projectId = snapshot.projectId, busy = runtime.busy(projectId, scene.id);
      const status = runtime.state(projectId, scene.id), apiReady = typeof window.desktopAPI?.submitGeneration === "function" && typeof window.desktopAPI?.getGenerationStatus === "function" && !!window.ViralCoreGeneratedMedia;
      const key = JSON.stringify([projectId, plan, busy, status, apiReady, locale()]);
      if (section.__actionKey === key) continue;
      const focused = document.activeElement === section ? section.__returnFocus : section.contains(document.activeElement) ?
        { action: document.activeElement.dataset.sceneAction, field: document.activeElement.dataset.sceneActionField } : null;
      const detailsOpen = section.querySelector("details")?.open;
      const sameScene = section.dataset.sceneId === scene.id && section.dataset.projectId === projectId;
      const query = sameScene ? section.querySelector('[data-scene-action-field="query"]')?.value : null;
      const kind = sameScene ? section.querySelector('[data-scene-action-field="kind"]')?.value : null;
      section.dataset.sceneId = scene.id; section.dataset.projectId = projectId; section.__actionKey = key;
      const options = (items, selected, translate) => items.map(v => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(translate ? t(v) : v) + '</option>').join("");
      const reasonSearch = !plan.search.queries.length ? "noQuery" : "noKind";
      const reasonGenerate = !plan.search.targetKinds.includes("video") ? "videoOnly" : !plan.generation.prompt ? "noPrompt" : "unavailable";
      section.innerHTML = '<h3>' + esc(t("title")) + '</h3>' +
        (plan.search.available ? '<label><span>' + esc(t("query")) + '</span><select data-scene-action-field="query" aria-label="' + esc(t("query")) + '">' + options(plan.search.queries, query || plan.search.queries[0]) + '</select></label>' +
          '<label><span>' + esc(t("kind")) + '</span><select data-scene-action-field="kind" aria-label="' + esc(t("kind")) + '">' + options(plan.search.targetKinds, kind || plan.search.targetKinds[0], true) + '</select></label>' : '<p>' + esc(t(reasonSearch)) + '</p>') +
        '<button type="button" data-scene-action="find"' + (!plan.search.available || busy ? ' disabled' : '') + '>' + esc(t("find")) + '</button>' +
        (plan.generation.prompt ? '<details' + (detailsOpen ? ' open' : '') + '><summary>' + esc(t("prompt")) + '</summary><p class="core-scene-prompt">' + esc(plan.generation.prompt) + '</p></details>' : '') +
        '<button type="button" data-scene-action="generate"' + (!plan.generation.available || !apiReady || busy ? ' disabled' : '') + ' aria-busy="' + busy + '">' + esc(t(busy ? "generating" : status.jobId ? "another" : "generate")) + '</button>' +
        (!plan.generation.available || !apiReady ? '<p>' + esc(t(reasonGenerate)) + '</p>' : '') +
        '<p data-scene-action-status role="status" aria-live="polite">' + esc(status.state === "idle" ? "" : t(statusKey(status))) + '</p>';
      if (focused) {
        const candidates = [...section.querySelectorAll("button,select")];
        const target = candidates.find(n => !n.disabled && (focused.action && n.dataset.sceneAction === focused.action || focused.field && n.dataset.sceneActionField === focused.field));
        // Disabled controls cannot receive focus. Keep it on this named region
        // until the same action is enabled again, without changing Scene context.
        section.__returnFocus = focused;
        (target || section).focus();
      }
    }
    // AI Create can finish an asynchronous readiness repaint after the drawer
    // closes. Restore only lost focus, never overwrite a user's new focus.
    if (focusReturn && snapshot?.projectId === focusReturn.projectId && scene?.id === focusReturn.sceneId &&
        document.activeElement === document.body) document.querySelector('[data-scene-action="find"]')?.focus();
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-scene-action]");
    if (!button || button.disabled || event.detail > 1) return;
    const section = button.closest("[data-scene-orchestration]"), { projectId, sceneId } = section.dataset;
    const snapshot = persistence.snapshot();
    if (snapshot?.projectId !== projectId || snapshot.scenePlan.selectedSceneId !== sceneId) { queue(); return; }
    if (button.dataset.sceneAction === "find") {
      try {
        const context = runtime.beginSearch(projectId, sceneId, { query: section.querySelector('[data-scene-action-field="query"]')?.value, kind: section.querySelector('[data-scene-action-field="kind"]')?.value });
        window.dispatchEvent(new CustomEvent("viral-ai:media-discovery-open", { detail: { authority: "scene-orchestration", context, projectId, sceneId } }));
      } catch { queue(); }
    } else runtime.generate(projectId, sceneId).finally(queue);
  });
  window.addEventListener("viral-ai:project-snapshot-restored", () => { runtime.invalidate(); focusReturn = null; queue(); });
  window.addEventListener("viral-ai:scene-search-closed", event => { focusReturn = event.detail; queue(); });
  document.addEventListener("pointerdown", () => { focusReturn = null; }, true);
  document.addEventListener("keydown", () => { focusReturn = null; }, true);
  for (const name of ["viral-ai:core-state-changed", "viral-ai:scene-plan-changed", "viral-ai:editor-preview-preserved"]) window.addEventListener(name, queue);
  const start = () => {
    const page = document.getElementById("page");
    // Playback clocks/progress text do not invalidate the action projection.
    // Durable Scene changes already notify us; observe only replacement of a
    // Scene-list surface (page navigation or an existing workspace repaint).
    if (page) new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
        (node.matches?.("[data-project-scenes]") || node.querySelector?.("[data-project-scenes]"))))) queue();
    }).observe(page, { childList: true, subtree: true });
    queue();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
