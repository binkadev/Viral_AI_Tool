(function installProjectScenes() {
  "use strict";
  let feedback = null, deleting = false;
  const api = () => window.ViralCoreProjectPersistence;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const locale = () => { try { return state.locale === "en" ? "en" : "vi"; } catch { return "vi"; } };
  const t = (key, vars) => window.I18N.t(locale(), "projectScenes." + key, vars);
  const clock = seconds => {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  };
  function markup() {
    const snapshot = api()?.snapshot?.(), projectId = snapshot?.projectId;
    if (!projectId) return "";
    const scenes = snapshot.scenePlan.scenes;
    const selectedIndex = scenes.findIndex(scene => scene.id === snapshot.scenePlan.selectedSceneId);
    const selectedScene = scenes[selectedIndex];
    const attrs = id => ' data-project-id="' + esc(projectId) + '" data-scene-id="' + esc(id) + '"';
    const button = (action, id, label, disabled = false, extra = "") => '<button type="button" data-project-scene-action="' + action + '"' + attrs(id) + extra +
      (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
    const busy = window.ViralCoreScenePlanModel.ACTIVE_PLANNER_STATES.has(snapshot.scenePlan.plannerJob.status);
    const toolbar = selectedScene ? '<div class="core-project-scene-actions" role="group" aria-label="' + esc(t("selectedActions")) + '">' +
      button("up", selectedScene.id, "↑", busy || selectedIndex === 0, ' aria-label="' + esc(t("up")) + '" title="' + esc(t("up")) + '"') +
      button("down", selectedScene.id, "↓", busy || selectedIndex === scenes.length - 1, ' aria-label="' + esc(t("down")) + '" title="' + esc(t("down")) + '"') +
      button("delete", selectedScene.id, t("delete"), busy || scenes.length === 1, ' title="' + esc(scenes.length === 1 ? t("lastScene") : t("delete")) + '"') + '</div>' : '';
    return '<div class="core-project-scenes-head"><h3>' + esc(t("title")) + '</h3>' +
      button("add", "", t("add"), busy || scenes.length >= window.ViralCoreScenePlanModel.MAX_SCENES) + '</div>' +
      toolbar + '<ol class="core-project-scene-list">' + scenes.map((scene, index) => {
        const slot = snapshot.mediaAssembly.slots.find(item => item.sceneId === scene.id);
        const selected = scene.id === snapshot.scenePlan.selectedSceneId;
        const label = scene.title || t("scene", { number: index + 1 });
        return '<li data-project-scene-row="' + esc(scene.id) + '" class="' + (selected ? 'is-selected' : '') + '">' +
          '<button type="button" class="core-project-scene-select" data-project-scene-action="select"' + attrs(scene.id) + ' aria-pressed="' + selected + '"' + (busy ? ' disabled' : '') + '>' +
          '<span class="core-project-scene-number">' + String(index + 1).padStart(2, "0") + '</span><span><b>' + esc(label) + (selected ? ' <span aria-hidden="true">✓</span>' : '') + '</b><small>' +
          (scene.end > scene.start ? clock(scene.start) + '–' + clock(scene.end) : esc(t("manual"))) + '</small><small>' + esc(t(slot?.candidateAssetIds.length === 1 ? "materialOne" : "materials", { count: slot?.candidateAssetIds.length || 0 })) +
          (slot?.selectedAssetId ? ' · ' + esc(t("inUse")) : '') + '</small></span></button></li>';
      }).join("") + '</ol>' +
      (scenes.length === 1 ? '<p>' + esc(t("lastScene")) + '</p>' : '') +
      '<p role="status" aria-live="polite">' + (feedback?.projectId === projectId ? esc(t(feedback.key)) : '') + '</p>';
  }
  function surface() {
    return '<section class="core-project-scenes" data-project-scenes tabindex="-1" aria-label="' + esc(t("title")) + '">' + markup() + '</section>';
  }
  function refresh() {
    document.querySelectorAll("[data-project-scenes]").forEach(section => {
      const next = markup();
      if (section.__sceneMarkup === next) return;
      const focused = document.activeElement;
      const focus = section.contains(focused) ? { ...focused.dataset } : null;
      section.innerHTML = next; section.__sceneMarkup = next;
      if (focus) {
        const buttons = [...section.querySelectorAll("button")];
        const target = buttons.find(b => !b.disabled && b.dataset.sceneId === focus.sceneId && b.dataset.projectSceneAction === focus.projectSceneAction) ||
          buttons.find(b => b.dataset.projectSceneAction === "select" && b.getAttribute("aria-pressed") === "true");
        (target || section).focus();
      }
    });
  }
  function meaningful(snapshot, scene) {
    const slot = snapshot.mediaAssembly.slots.find(item => item.sceneId === scene.id);
    return !!(scene.sourceText || scene.sourceSegmentIds.length || slot?.candidateAssetIds.length || slot?.selectedAssetId ||
      scene.title || scene.visualIntent || scene.generationPrompt || scene.searchQueries.length || scene.shotType || scene.motion || scene.mood ||
      scene.sceneState === "edited" || scene.lockedFields.length || scene.orientation !== "any" || scene.targetKinds.join() !== "video");
  }
  async function confirmDelete() {
    if (typeof confirmAction !== "function") return false;
    const previous = document.activeElement;
    const pending = confirmAction({ title: t("confirmTitle"), body: t("confirmBody"), confirmLabel: t("delete"),
      cancelLabel: window.I18N.t(locale(), "common.cancel"), danger: true });
    const dialog = document.querySelector("#modal .modal");
    if (!dialog) return false;
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", t("confirmTitle"));
    const cancel = dialog.querySelector("#confirmCancel"), ok = dialog.querySelector("#confirmOk");
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancel.click(); }
      if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); ok.focus(); }
        else if (!event.shiftKey && document.activeElement === ok) { event.preventDefault(); cancel.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true); cancel.focus();
    try { return await pending; }
    finally { document.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); }
  }
  async function action(event) {
    const button = event.target.closest?.("[data-project-scene-action]");
    if (!button || button.disabled || deleting) return;
    const { projectId, sceneId, projectSceneAction: operation } = button.dataset;
    try {
      if (api()?.activeProjectId() !== projectId) return;
      const snapshot = api().snapshot(), scenes = snapshot.scenePlan.scenes;
      const index = scenes.findIndex(scene => scene.id === sceneId), options = { projectId };
      if (operation === "add") api().addProjectScene({}, options);
      else if (index < 0) return;
      else if (operation === "select") api().selectProjectScene(sceneId, options);
      else if (operation === "up" || operation === "down") api().moveProjectScene(sceneId, index + (operation === "up" ? -1 : 1), options);
      else if (operation === "delete") {
        if (scenes.length <= 1) { feedback = { projectId, key: "lastScene" }; refresh(); return; }
        deleting = true;
        try { if (meaningful(snapshot, scenes[index]) && !await confirmDelete()) return; }
        finally { deleting = false; }
        // Confirmation may outlive a Project switch. Persistence checks the
        // captured identity again; never retarget the newly active Project.
        api().removeProjectScene(sceneId, options);
      } else return;
      feedback = null;
    } catch (error) {
      feedback = { projectId, key: error.message === "PROJECT_FINAL_SCENE" ? "lastScene" :
        error.message === "PROJECT_SCENE_LIMIT" ? "limit" : error.message === "PROJECT_SCENE_BUSY" ? "busy" : "saveFailed" };
    }
    refresh();
  }
  window.ViralCoreProjectScenes = { surface, refresh };
  document.addEventListener("click", action);
  window.addEventListener("viral-ai:core-state-changed", refresh);
  window.addEventListener("viral-ai:project-snapshot-restored", refresh);
  window.addEventListener("viral-ai:scene-plan-changed", refresh);
})();
