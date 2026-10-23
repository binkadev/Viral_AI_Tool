(function installBatchProduction() {
  "use strict";
  const model = window.ViralBatchProductionModel, persistence = window.ViralCoreProjectPersistence;
  if (!model || !persistence) return;
  const t = (key, vars) => window.I18N.t(state.locale === "en" ? "en" : "vi", "batchProduction." + key, vars);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  let selected = [], outputDir = "", draftId = null, query = "", filter = "all", feedback = null, picking = false, queued = false;
  const store = window.ViralBatchProductionStore.create({storage:localStorage});
  // openProject remains the sole activation authority. Its normal presentation
  // routes to the editor; restore the user's current page after that synchronous
  // transition so an application-scoped Batch does not pull them away.
  const batchPersistence = {...persistence, openProject(projectId) {
    const page = state.page, result = persistence.openProject(projectId);
    state.page = page; render(); return result;
  }};
  const runtime = window.ViralBatchProductionRuntime.create({model, store, persistence:batchPersistence, productionModel:window.ViralProductionModel, actionModel:window.ViralSceneActionModel,
    production:window.ViralProductionModes.runtime, audioModel:window.ViralCoreProjectAudioModel, audio:window.ViralCoreProjectAudio.runtime,
    renderModel:window.ViralCoreProjectRenderModel, render:window.ViralCoreProjectRender.runtime, player:window.ViralCorePlayerModel, managerModel:window.ViralProductionManagerModel,
    desktop:window.desktopAPI, id:() => "batch-" + crypto.randomUUID(), changed:changed});
  const reasonKey = code => ({BATCH_EMPTY:"noSelection", BATCH_DUPLICATE:"duplicateProject", BATCH_TOO_MANY:"tooManyProjects", BATCH_EXISTS:"batchExists", OUTPUT_REQUIRED:"outputRequired",
    OUTPUT_UNAVAILABLE:"outputUnavailable", LOW_DISK_SPACE:"outputUnavailable", PROJECT_NOT_FOUND:"projectMissing", USER_INTERVENTION:"userIntervention", PROJECT_CHANGED:"userIntervention",
    VOICE_REQUIRED:"voiceRequired", VOICE_UNAVAILABLE:"voiceUnavailable", VOICE_FAILED:"voiceUnavailable", PROJECT_RENDER_VOICE_REQUIRED:"voiceRequired", PROJECT_RENDER_VOICE_STALE:"voiceRequired",
    RECOVERY_REQUIRED:"generationRecoveryRequired", BATCH_STORAGE_FAILED:"storageProtected", BATCH_STORAGE_PROTECTED:"storageProtected", PROJECT_STORAGE_PROTECTED:"storageProtected", PROJECT_SAVE_FAILED:"storageProtected", PROJECT_STATE_UNAVAILABLE:"storageProtected",
    PROJECT_WORK_RUNNING:"workRunning", PROJECT_TRANSITION_PENDING:"workRunning", MATERIALS_ATTENTION:"materialsAttention", NO_SCENES:"materialsAttention"}[code] || "renderBlocked");
  const itemKey = status => "project" + ({skipped_ready:"Skipped", needs_attention:"Attention"}[status] || status[0].toUpperCase() + status.slice(1));
  const batchKey = status => "batch" + ({completed_with_attention:"CompletedAttention"}[status] || status[0].toUpperCase() + status.slice(1));
  const livePhase = live => {
    const value = live?.phase || live?.state;
    return "phase_" + (["checking", "sourcing", "waiting", "validating", "queued", "generating", "downloading", "preparing", "scenes", "voice", "audio", "composing", "finalizing", "verifying", "cancelling", "completed"].includes(value) ? value : "processing");
  };
  const button = (action, key, disabled = false, attrs = "") => '<button type="button" class="button ghost" data-batch-action="' + action + '" ' + attrs + (disabled ? ' disabled' : '') + '>' + esc(t(key)) + '</button>';
  function projects() {return window.ViralProductionManager.runtime.collect().summaries;}
  function visible(rows) {
    return rows.filter(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (filter === "all" || filter === "draft" && ["draft", "review", "preparing", "paused"].includes(p.status) || p.status === filter));
  }
  function selection(v, rows) {
    const ids = selected, directory = outputDir;
    const names = new Map(rows.map(p => [p.projectId, p.name]));
    return '<div class="bp-selection"><section><h2>' + esc(t("selectProjects")) + '</h2><div class="bp-toolbar"><label>' + esc(t("search")) +
      '<input type="search" data-batch-search value="' + esc(query) + '"></label><label>' + esc(t("filter")) + '<select data-batch-filter>' +
      ["all", "needs_attention", "ready_to_render", "ready", "draft"].map(value => '<option value="' + value + '"' + (filter === value ? ' selected' : '') + '>' + esc(t("filter_" + value)) + '</option>').join("") + '</select></label></div><div class="bp-actions">' +
      button("all", "selectAll", v.protected) + button("none", "clearSelection", v.protected || !ids.length) + '</div><div class="bp-projects">' +
      (visible(rows).map(p => '<label class="bp-project"><input type="checkbox" data-batch-project="' + esc(p.projectId) + '"' + (ids.includes(p.projectId) ? ' checked' : '') + (v.protected ? ' disabled' : '') +
        '><span><strong>' + esc(p.name) + '</strong><span>' + esc(window.I18N.t(state.locale, "productionManager." + p.status)) + '</span><small>' + esc(t("materialCounts", p.materials)) + '</small><small>' + esc(t(p.currentOutput ? "videoReady" : p.checkingOutput ? "videoNotVerified" : "noCurrentOutput")) + '</small></span></label>').join("") || '<p>' + esc(t("noProjects")) + '</p>') +
      '</div></section><aside><h2>' + esc(t("selectedCount", {count:ids.length})) + '</h2><p>' + esc(t("maxProjects")) + '</p><ol class="bp-order">' + ids.map((id, index) => '<li><strong>' + esc(names.get(id) || t("projectMissing")) + '</strong><div class="bp-actions">' +
        button("up", "moveUp", v.protected || index === 0, 'data-batch-id="' + esc(id) + '" aria-label="' + esc(t("moveNamedUp", {name:names.get(id) || t("projectMissing")})) + '"') +
        button("down", "moveDown", v.protected || index === ids.length - 1, 'data-batch-id="' + esc(id) + '" aria-label="' + esc(t("moveNamedDown", {name:names.get(id) || t("projectMissing")})) + '"') + '</div></li>').join("") +
      '</ol><h3>' + esc(t("outputFolder")) + '</h3><p class="bp-directory">' + esc(directory || t("outputRequired")) + '</p><div class="bp-actions">' + button("folder", "chooseFolder", v.protected || picking) +
      (v.batch ? button("start", "startBatch", v.protected || v.busy || !ids.length || !directory) : button("prepare", "prepareBatch", v.protected || picking || !ids.length || !directory)) + '</div></aside></div>';
  }
  function page() {
    const v = runtime.view(), b = v.batch, rows = projects(), names = new Map(rows.map(p => [p.projectId, p.name]));
    if (b?.status === "draft" && draftId !== b.batchId) {draftId = b.batchId; selected = [...b.projectIds]; outputDir = b.outputDir;}
    let body = '<header><h1>' + esc(t("title")) + '</h1><p>' + esc(t("subtitle")) + '</p></header>';
    const error = v.protected ? "storageProtected" : feedback || (v.error ? reasonKey(v.error) : null);
    if (error) body += '<p role="alert" class="bp-warning">' + esc(t(error)) + '</p>';
    if (!b || b.status === "draft") body += selection(v, rows);
    if (b) {
      const c = v.progress, current = b.items.find(i => model.ACTIVE.includes(i.status)), live = v.live;
      body += '<section class="bp-run"><div class="bp-run-heading"><h2 role="status" aria-live="polite">' + esc(t(batchKey(b.status))) + '</h2><div class="bp-actions">' +
        (["running", "stopping"].includes(b.status) ? button("pause", b.pauseRequested ? "pauseRequested" : "pauseBatch", v.protected || b.status !== "running" || b.pauseRequested) : "") +
        (model.resumable(b) ? button("resume", "resumeBatch", v.protected || v.busy) : "") +
        (!model.finished(b) && b.status !== "draft" ? button("stop", b.stopRequested ? "batchStopping" : "stopBatch", v.protected || b.stopRequested) : "") +
        (model.finished(b) ? button("new", "newBatch", v.protected || v.busy) : "") + button("manager", "openProductionManager") + '</div></div>' +
        (b.status === "interrupted" ? '<p>' + esc(t("resumeExplanation")) + '</p>' : "") + (b.reason ? '<p class="bp-warning">' + esc(t(reasonKey(b.reason))) + '</p>' : "") +
        '<div class="bp-counts">' + [t("completedCount", {count:c.completed}), t("skippedCount", {count:c.skipped}), t("attentionCount", {count:c.attention + c.interrupted}), t("remainingCount", {count:c.pending + c.active}), t("stoppedCount", {count:c.stopped})].map(s => '<span>' + esc(s) + '</span>').join("") + '</div>' +
        '<div class="bp-progress" role="progressbar" aria-label="' + esc(t("batchProgress")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + c.percent + '" aria-valuetext="' + esc(t("projectProgress", {done:c.terminal, total:c.total})) + '"><span style="width:' + c.percent + '%"></span></div><p>' + esc(t("projectProgress", {done:c.terminal, total:c.total})) + '</p>';
      if (current) body += '<article class="bp-current" role="status" aria-live="polite"><h3>' + esc(t("currentProject", {name:names.get(current.projectId) || t("projectMissing")})) + '</h3><p>' + esc(t(itemKey(current.status))) + '</p>' +
        (live ? '<p>' + esc(t("live_" + current.status)) + (live.percent !== null ? ' · ' + live.percent + '%' : "") + '</p><p>' + esc(t(livePhase(live))) + '</p>' + (live.sceneId ? '<p>' + esc(t("currentScene", {index:(persistence.projectAudioSnapshot(current.projectId)?.scenePlan.scenes || []).findIndex(s => s.id === live.sceneId) + 1})) + '</p>' : "") +
          (live.sceneIndex !== undefined ? '<p>' + esc(t("renderScene", {index:live.sceneIndex, total:live.sceneCount})) + '</p>' : "") : "") + '</article>';
      body += '<ol class="bp-items">' + b.items.map(i => '<li><div><strong>' + esc(names.get(i.projectId) || t("projectMissing")) + '</strong><span>' + esc(t(itemKey(i.status))) + '</span>' +
        (i.reason ? '<p class="bp-warning">' + esc(t(reasonKey(i.reason))) + '</p>' : "") + '</div>' +
        (model.terminal(i) ? button("open", "openProject", v.busy || !model.finished(b) || v.protected, 'data-batch-id="' + esc(i.projectId) + '"') : "") + '</li>').join("") + '</ol></section>';
    }
    return '<div class="batch-production" data-batch-production>' + body + '</div>';
  }
  function queue() {
    if (queued || state.page !== "batch-production") return;
    queued = true; requestAnimationFrame(() => {
      queued = false; if (state.page !== "batch-production") return;
      const host = document.getElementById("page"), focus = document.activeElement, position = focus?.selectionStart, scroll = window.scrollY;
      const token = focus?.dataset ? {...focus.dataset} : {}, html = page();
      if (host.innerHTML !== html) host.innerHTML = html;
      const target = [...host.querySelectorAll("input,select,button")].find(n => Object.keys(token).length && JSON.stringify({...n.dataset}) === JSON.stringify(token));
      if (target) {target.focus({preventScroll:true}); if (token.batchSearch !== undefined && position !== null) try {target.setSelectionRange(position, position);} catch {}}
      if (window.scrollY !== scroll) window.scrollTo(0, scroll);
    });
  }
  function changed() {
    const v = runtime.view(), b = v.batch, current = b?.items.find(i => model.ACTIVE.includes(i.status));
    window.dispatchEvent(new CustomEvent("viral-ai:batch-production-changed", {detail:{batchId:b?.batchId || null, status:b?.status || null, currentProjectId:current?.projectId || null, terminalCounts:v.progress}}));
    queue();
  }
  function updateSelection(ids, directory) {
    try {
      if (ids.length) model.membership(ids);
      if (ids.length > model.MAX_PROJECTS) throw model.failure("BATCH_TOO_MANY");
      selected = ids; if (directory !== undefined) outputDir = directory;
      feedback = null;
    } catch (e) {feedback = reasonKey(e.code || e.message);}
    queue();
  }
  function install() {
    pages["batch-production"] = page; pageMeta["batch-production"] = ["batchProduction.title", "batchProduction.breadcrumb"];
    window.ViralPrivateBetaModel?.primary.add("batch-production");
    document.addEventListener("input", e => {if (state.page === "batch-production" && e.target.matches?.("[data-batch-search]")) {query = e.target.value.slice(0, 512); queue();}});
    document.addEventListener("change", e => {
      if (state.page !== "batch-production") return;
      if (e.target.matches?.("[data-batch-filter]")) {filter = e.target.value; queue();}
      if (e.target.matches?.("[data-batch-project]")) {
        const b = runtime.view().batch; if (b && b.status !== "draft") return;
        const ids = selected, id = e.target.dataset.batchProject;
        updateSelection(e.target.checked ? [...ids, id] : ids.filter(s => s !== id));
        // checked is a DOM property, not an HTML attribute. Restore it even if
        // the same validation message leaves the rendered markup unchanged.
        e.target.checked = selected.includes(id);
      }
    });
    document.addEventListener("click", async e => {
      if (state.page !== "batch-production") return;
      const target = e.target.closest?.("[data-batch-action]"); if (!target || target.disabled) return;
      const v = runtime.view(), b = v.batch, ids = selected, action = target.dataset.batchAction;
      feedback = null;
      if (action === "manager") {state.page = "productions"; render(); return;}
      if (action === "open") {if (!v.busy && model.finished(b)) await window.ViralProductionManager.runtime.open(target.dataset.batchId); return;}
      if (["all", "none", "up", "down", "folder", "prepare"].includes(action) && b && b.status !== "draft") return;
      if (action === "all") updateSelection([...new Set([...ids, ...visible(projects()).map(p => p.projectId)])]);
      if (action === "none") updateSelection([]);
      if (["up", "down"].includes(action)) {
        const next = [...ids], from = next.indexOf(target.dataset.batchId), to = from + (action === "up" ? -1 : 1);
        if (from >= 0 && to >= 0 && to < next.length) {[next[from], next[to]] = [next[to], next[from]]; updateSelection(next);}
      }
      if (action === "folder" && !picking) {
        picking = true; queue();
        try {const dir = await window.desktopAPI.selectOutputFolder(); if (dir) {model.outputDirectory(dir); updateSelection(ids, dir);}}
        catch {feedback = "outputUnavailable";} finally {picking = false; queue();}
      }
      if (action === "prepare") runtime.create(selected, outputDir);
      if (action === "start" && runtime.configure(selected, outputDir)) runtime.start();
      if (action === "pause") runtime.pause();
      if (action === "resume") runtime.resume();
      if (action === "stop") runtime.stop();
      if (action === "new" && runtime.clear()) {selected = []; outputDir = ""; draftId = null;}
      queue();
    });
    for (const event of ["viral-ai:project-snapshot-saved", "viral-ai:project-snapshot-restored", "viral-ai:core-state-changed", "viral-ai:generation-output-attached", "viral-ai:production-view-changed", "viral-ai:project-render-view-changed"]) window.addEventListener(event, runtime.observe);
    window.desktopAPI?.onVoiceProgress?.(queue); window.desktopAPI?.onRenderProgress?.(queue);
    if (state.page === "batch-production") render();
  }
  window.ViralBatchProduction = {runtime, store};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, {once:true}); else install();
})();
