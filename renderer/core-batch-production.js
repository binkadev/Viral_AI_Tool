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
  const w = (key, vars) => window.I18N.t(state.locale === "en" ? "en" : "vi", "batchWorkspace." + key, vars);
  const primary = html => html.replace('class="button ghost"', 'class="button bp-primary"');
  const openDetails = key => [...(document.querySelectorAll?.('[data-bp-details]') || [])].some(n => n.dataset.bpDetails === key && n.open);
  const disclosure = (key, label, content) => '<details class="bp-details" data-bp-details="' + esc(key) + '"' + (openDetails(key) ? ' open' : '') + '><summary data-bp-summary="' + esc(key) + '">' + esc(label) + '<span aria-hidden="true">&#8964;</span></summary>' + content + '</details>';
  function readiness(p) {
    return !p ? "missing" : p.currentOutput && p.status === "ready" ? "existing" : p.status === "needs_attention" ? "attention" :
      p.status === "review" ? "review" : p.checkingOutput ? "checking" : p.status === "ready_to_render" ? "exportReady" :
      ["rendering", "preparing", "paused"].includes(p.status) ? "working" : "preparation";
  }
  function projectReason(p) {
    const keys = (p.reasons || []).map(code => ({noScenes:"noScenes", materialsAttention:"materialsAttention", renderFailed:"renderFailed", renderInterrupted:"renderInterrupted", outputMissing:"outputMissing",
      PROJECT_RENDER_VOICE_REQUIRED:"voiceRequired", PROJECT_RENDER_VOICE_STALE:"voiceRequired", PROJECT_RENDER_BGM_UNAVAILABLE:"bgmUnavailable", PROJECT_RENDER_MEDIA_MISSING:"mediaMissing",
      PROJECT_RENDER_PROFILE_UNRESOLVED:"profileMissing", PROJECT_RENDER_TIMING_INVALID:"timingInvalid", PROJECT_RENDER_INPUT_CHANGED:"inputChanged"})[code]).filter(Boolean);
    return keys.length ? [...new Set(keys)].map(key => w(key)).join(" ") : w("hint_" + readiness(p));
  }
  function projectCard(p, v) {
    const chosen = selected.includes(p.projectId), status = readiness(p), tone = ["attention", "review", "missing"].includes(status) ? "attention" : ["exportReady", "existing"].includes(status) ? "ready" : "quiet";
    return '<article class="bp-project-card' + (chosen ? ' is-selected' : '') + '" data-bp-project="' + esc(p.projectId) + '"><label class="bp-project-label"><input type="checkbox" data-batch-project="' + esc(p.projectId) + '"' + (chosen ? ' checked' : '') + (v.protected ? ' disabled' : '') + '><strong title="' + esc(p.name) + '">' + esc(p.name) + '</strong></label>' +
      '<p class="bp-project-meta">' + esc(w("sceneCount", {count:p.materials.total})) + (chosen ? '<span>' + esc(w("selectedPosition", {position:selected.indexOf(p.projectId) + 1})) + '</span>' : '') + '</p><p class="bp-state tone-' + tone + '">' + esc(w("state_" + status)) + '</p><p class="bp-project-explanation">' + esc(projectReason(p)) + '</p>' +
      disclosure("project:" + p.projectId, w("details"), '<p>' + esc(t("materialCounts", p.materials)) + '</p><p>' + esc(window.I18N.t(state.locale, 'productionManager.' + p.status)) + '</p>') + '</article>';
  }
  function selection(v, rows) {
    const ids = selected, directory = outputDir;
    const names = new Map(rows.map(p => [p.projectId, p.name]));
    const shown = visible(rows), states = ids.map(id => readiness(rows.find(p => p.projectId === id)));
    const ready = states.filter(s => ["exportReady", "existing"].includes(s)).length, attention = states.filter(s => ["attention", "review", "missing"].includes(s)).length;
    const disabled = v.batch ? v.protected || v.busy || !ids.length || !directory : v.protected || picking || !ids.length || !directory;
    const help = v.protected ? t("storageProtected") : v.batch && v.busy ? w("busyHint") : !ids.length ? w("noneHint") : !directory ? t("outputRequired") : picking && !v.batch ? w("pickingHint") : w(v.batch ? "startHint" : "prepareHint");
    const order = '<p class="bp-detail-note">' + esc(t("maxProjects")) + '</p><ol class="bp-order">' + ids.map((id, index) => '<li><strong title="' + esc(names.get(id) || t("projectMissing")) + '">' + esc(names.get(id) || t("projectMissing")) + '</strong><div class="bp-actions">' +
        button("up", "moveUp", v.protected || index === 0, 'data-batch-id="' + esc(id) + '" aria-label="' + esc(t("moveNamedUp", {name:names.get(id) || t("projectMissing")})) + '"') +
        button("down", "moveDown", v.protected || index === ids.length - 1, 'data-batch-id="' + esc(id) + '" aria-label="' + esc(t("moveNamedDown", {name:names.get(id) || t("projectMissing")})) + '"') + '</div></li>').join("") +
      '</ol>';
    const summary = '<section class="bp-summary" aria-labelledby="bp-summary-title"><div class="bp-summary-copy"><span class="bp-eyebrow">' + esc(w(v.batch ? "prepared" : "setup")) + '</span><h2 id="bp-summary-title">' + esc(ids.length ? t("selectedCount", {count:ids.length}) : w("noneTitle")) + '</h2>' +
      (ids.length ? '<p class="bp-readiness">' + esc(w("readinessCounts", {ready, attention, pending:ids.length - ready - attention})) + '</p>' : '') + '<p>' + esc(w("processHint")) + '</p></div><div class="bp-summary-action">' +
      primary(button(v.batch ? "start" : "prepare", v.batch ? "startBatch" : "prepareBatch", disabled, 'aria-describedby="bp-start-help"')) + '</div>' +
      '<div class="bp-destination"><div><span>' + esc(t("outputFolder")) + '</span><p class="bp-directory">' + esc(directory || w("noFolder")) + '</p></div>' + button("folder", "chooseFolder", v.protected || picking) + '</div>' +
      '<p id="bp-start-help" class="bp-start-help">' + esc(help) + '</p>' + (states.includes("missing") ? '<p class="bp-warning bp-run-warning" role="alert">' + esc(w("hint_missing")) + '</p>' : '') + (ids.length ? disclosure("order", w("order"), order) : '') + '</section>';
    const content = !rows.length && !ids.length ? '<section class="bp-empty"><span aria-hidden="true">&#9636;</span><div><h2>' + esc(w("emptyTitle")) + '</h2><p>' + esc(w("emptyHint")) + '</p><button type="button" class="button bp-primary" data-batch-action="create">' + esc(w("create")) + '</button></div></section>' :
      summary + '<section aria-labelledby="bp-projects-title"><div class="bp-projects-heading"><h2 id="bp-projects-title">' + esc(t("selectProjects")) + '</h2><div class="bp-actions">' + button("all", "selectAll", v.protected) + button("none", "clearSelection", v.protected || !ids.length) + '</div></div>' +
      (shown.length ? '<div class="bp-projects">' + shown.map(p => projectCard(p, v)).join('') + '</div>' : '<section class="bp-search-empty"><h3>' + esc(w("searchEmptyTitle")) + '</h3><p>' + esc(w("searchEmptyHint")) + '</p></section>') + '</section>';
    return '<div class="bp-toolbar"><label>' + esc(t("search")) + '<input type="search" data-batch-search value="' + esc(query) + '" placeholder="' + esc(w("searchPlaceholder")) + '"></label><label>' + esc(t("filter")) + '<select data-batch-filter>' +
      ["all", "needs_attention", "ready_to_render", "ready", "draft"].map(value => '<option value="' + value + '"' + (filter === value ? ' selected' : '') + '>' + esc(t("filter_" + value)) + '</option>').join("") + '</select></label><p role="status" aria-live="polite">' + esc(w("visibleCount", {count:shown.length, total:rows.length})) + '</p></div>' + content + disclosure("setup-activity", w("activity"), '<p>' + esc(w("setupActivityHint")) + '</p><div class="bp-actions">' + button("manager", "openProductionManager") + '</div>');
  }
  function itemRow(i, index, v, names) {
    const tone = i.status === "completed" || i.status === "skipped_ready" ? "ready" : model.ACTIVE.includes(i.status) ? "active" : ["needs_attention", "interrupted"].includes(i.status) ? "attention" : "quiet";
    return '<li class="bp-result-item" data-bp-result="' + esc(i.projectId) + '"><span class="bp-item-number" aria-hidden="true">' + esc(index + 1) + '</span><div><h3 title="' + esc(names.get(i.projectId) || t("projectMissing")) + '">' + esc(names.get(i.projectId) || t("projectMissing")) + '</h3><p class="bp-state tone-' + tone + '">' + esc(t(itemKey(i.status))) + '</p>' +
      (i.reason ? '<p class="bp-warning">' + esc(i.reason === "RENDER_FAILED" ? w("renderFailed") : t(reasonKey(i.reason))) + '</p>' : '') + '</div>' +
      (model.terminal(i) ? button("open", "openProject", v.busy || !model.finished(v.batch) || v.protected, 'data-batch-id="' + esc(i.projectId) + '"') : '') + '</li>';
  }
  function execution(v, rows) {
    const b = v.batch, c = v.progress, names = new Map(rows.map(p => [p.projectId, p.name])), current = b.items.find(i => model.ACTIVE.includes(i.status)), live = v.live;
    const pause = ["running", "stopping"].includes(b.status) ? button("pause", b.pauseRequested ? "pauseRequested" : "pauseBatch", v.protected || b.status !== "running" || b.pauseRequested) : '';
    const resume = model.resumable(b) ? button("resume", "resumeBatch", v.protected || v.busy) : '';
    const stop = !model.finished(b) ? button("stop", b.stopRequested ? "batchStopping" : "stopBatch", v.protected || b.stopRequested) : '';
    const main = resume || (model.finished(b) ? button("manager", "openProductionManager") : pause);
    const sceneIndex = live?.sceneId && current ? (persistence.projectAudioSnapshot(current.projectId)?.scenePlan.scenes || []).findIndex(s => s.id === live.sceneId) : -1;
    const activity = '<p class="bp-directory">' + esc(b.outputDir) + '</p><p>' + esc(w("activityHint")) + '</p><div class="bp-actions">' +
      (model.finished(b) ? button("new", "newBatch", v.protected || v.busy) : button("manager", "openProductionManager")) + '</div>';
    return '<section class="bp-summary bp-running" aria-labelledby="bp-summary-title"><div class="bp-summary-copy"><span class="bp-eyebrow">' + esc(w("execution")) + '</span><h2 id="bp-summary-title" role="status" aria-live="polite">' + esc(t(batchKey(b.status))) + '</h2><p>' + esc(t("projectProgress", {done:c.terminal, total:c.total})) + '</p></div><div class="bp-summary-action">' + (main ? primary(main) : '') + '</div>' +
      (b.status === "interrupted" ? '<p class="bp-run-warning">' + esc(t("resumeExplanation")) + '</p>' : '') + (b.reason ? '<p class="bp-warning bp-run-warning">' + esc(t(reasonKey(b.reason))) + '</p>' : '') +
      '<div class="bp-counts">' + [t("completedCount", {count:c.completed}), t("skippedCount", {count:c.skipped}), t("attentionCount", {count:c.attention + c.interrupted}), t("remainingCount", {count:c.pending + c.active}), t("stoppedCount", {count:c.stopped})].map(s => '<span>' + esc(s) + '</span>').join('') + '</div>' +
      '<div class="bp-progress" role="progressbar" aria-label="' + esc(t("batchProgress")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + c.percent + '" aria-valuetext="' + esc(t("projectProgress", {done:c.terminal, total:c.total})) + '"><span style="inline-size:' + c.percent + '%"></span></div><p class="bp-progress-hint">' + esc(w("progressHint")) + '</p>' +
      (current ? '<article class="bp-current" role="status" aria-live="polite"><span class="bp-eyebrow">' + esc(w("current")) + '</span><h3>' + esc(names.get(current.projectId) || t("projectMissing")) + '</h3><p>' + esc(t(itemKey(current.status))) + '</p>' +
        (live ? '<p>' + esc(t(livePhase(live))) + (Number.isFinite(live.percent) ? ' · ' + esc(live.percent) + '%' : '') + '</p>' +
          (sceneIndex >= 0 ? '<p>' + esc(t("currentScene", {index:sceneIndex + 1})) + '</p>' : '') +
          (Number.isInteger(live.sceneIndex) && live.sceneIndex > 0 && Number.isInteger(live.sceneCount) && live.sceneCount >= live.sceneIndex ? '<p>' + esc(t("renderScene", {index:live.sceneIndex, total:live.sceneCount})) + '</p>' : '') : '') + '</article>' : '') +
      (stop ? '<div class="bp-soft-controls">' + stop + '<p>' + esc(w("softStopHint")) + '</p></div>' : '') + '</section><section><div class="bp-projects-heading"><h2>' + esc(w("results")) + '</h2><span>' + esc(w("orderKept")) + '</span></div><ol class="bp-items">' + b.items.map((i,index) => itemRow(i,index,v,names)).join('') + '</ol></section>' + disclosure('activity:' + b.batchId, w("activity"), activity);
  }
  function page() {
    const heading = '<header class="bp-heading"><span class="bp-eyebrow">' + esc(w("eyebrow")) + '</span><h1>' + esc(t("title")) + '</h1><p>' + esc(w("description")) + '</p></header>';
    let v, rows; try {v = runtime.view(); rows = projects();} catch {return '<div class="batch-production" data-batch-production>' + heading + '<section class="bp-error" role="alert"><h2>' + esc(w("errorTitle")) + '</h2><p>' + esc(w("errorHint")) + '</p></section></div>';}
    const b = v.batch;
    if (b?.status === "draft" && draftId !== b.batchId) {draftId = b.batchId; selected = [...b.projectIds]; outputDir = b.outputDir;}
    let body = heading;
    const error = v.protected ? "storageProtected" : feedback || (v.error ? reasonKey(v.error) : null);
    if (error) body += '<p role="alert" class="bp-warning">' + esc(t(error)) + '</p>';
    if (!b || b.status === "draft") body += selection(v, rows);
    if (b && b.status !== "draft") body += execution(v, rows);
    return '<div class="batch-production" data-batch-production>' + body + '</div>';
  }
  function queue() {
    if (queued || state.page !== "batch-production") return;
    queued = true; requestAnimationFrame(() => {
      queued = false; if (state.page !== "batch-production") return;
      const host = document.getElementById("page"), focus = document.activeElement, position = focus?.selectionStart, scroll = window.scrollY;
      const token = focus?.dataset ? {...focus.dataset} : {}, html = page();
      if (host.innerHTML !== html) host.innerHTML = html;
      const target = [...host.querySelectorAll("input,select,button,summary")].find(n => Object.keys(token).length && JSON.stringify({...n.dataset}) === JSON.stringify(token));
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
      if (action === "create") {state.page = "ai-create"; render(); return;}
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
