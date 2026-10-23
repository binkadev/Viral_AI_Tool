(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralProductionManagerModel = api;
})(typeof window !== "undefined" ? window : globalThis, function managerModel() {
  "use strict";
  const STATUSES = ["rendering", "preparing", "paused", "needs_attention", "review", "ready_to_render", "ready", "draft"];
  const FILTERS = ["all", "active", "needs_attention", "review", "ready_to_render", "ready"];
  const stamp = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : 0; };
  const compareId = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  function history(outputs = []) {
    return outputs.map((o,index) => ({ ...o, index })).sort((a,b) =>
      (stamp(b.job.completedAt)||stamp(b.job.startedAt))-(stamp(a.job.completedAt)||stamp(a.job.startedAt)) || stamp(b.job.startedAt)-stamp(a.job.startedAt) || b.index-a.index);
  }
  function summarize({ snapshot, materialSummary, renderPlan, renderOutputs = [], productionView, renderView, activeProjectId, health = () => "unknown" }) {
    const id = snapshot.projectId, attempts = history(renderOutputs.filter(o => o.job.projectId === id));
    const candidates = attempts.filter(o => o.current && o.job.status === "completed" && o.job.fileState === "available" && o.job.outputPath);
    const current = candidates.find(o => health(o.job) === "available") || null;
    const latest = attempts[0]?.job;
    const liveProduction = id === activeProjectId && productionView?.run?.projectId === id ? productionView : null;
    const liveRender = renderView?.projectId === id && renderView.busy === true ? renderView : null;
    const expected = attempts.filter(o => o.job.status === "completed" && o.job.renderInputSignature === renderPlan.renderInputSignature && o.job.outputPath);
    const missing = !current && expected.length > 0 && expected.every(o => ["missing","trashed"].includes(o.job.fileState) || health(o.job) === "missing");
    const checking = !current && candidates.some(o => !["available","missing"].includes(health(o.job)));
    const failed = ["failed","interrupted"].includes(latest?.status);
    const renderError = renderView?.projectId === id && typeof renderView.error === "string" && !!renderView.error;
    // Unselected, sourceable scenes are drafts/review under Block 6. A downstream
    // missing-visual render gate must not invent a fatal material condition.
    const materialReady = materialSummary.total > 0 && materialSummary.ready === materialSummary.total;
    const reasons = [];
    if (!materialSummary.total) reasons.push("noScenes");
    if (materialSummary.attention) reasons.push("materialsAttention");
    if (failed) reasons.push(latest.status === "interrupted" ? "renderInterrupted" : "renderFailed");
    if (renderError) reasons.push("renderFailed");
    if (missing) reasons.push("outputMissing");
    if (materialReady && !renderPlan.ready) reasons.push(renderPlan.reason || "PROJECT_RENDER_INCOMPLETE");
    if (liveProduction?.state === "needs_attention") reasons.push("materialsAttention");
    const attention = reasons.length > 0;
    const status = liveRender ? "rendering" : liveProduction?.state === "running" ? "preparing" : liveProduction?.state === "paused" ? "paused" :
      current && !failed && !renderError ? "ready" : attention ? "needs_attention" : materialSummary.review > 0 ? "review" : materialReady && renderPlan.ready ? "ready_to_render" : "draft";
    return { projectId:id, name:snapshot.projectName, updatedAt:snapshot.updatedAt, active:id === activeProjectId, status,
      materials:{ total:materialSummary.total, ready:materialSummary.ready, review:materialSummary.review, attention:materialSummary.attention,
        scenes:materialSummary.scenes.map(s => ({ sceneId:s.sceneId, status:s.status, reason:s.reason })) },
      reasons:[...new Set(reasons)], renderReady:renderPlan.ready, profile:{...renderPlan.profile},
      currentOutput:current?.job || null, checkingOutput:checking, missingOutput:missing,
      previousCount:attempts.filter(o => o.job.status === "completed" && !o.current).length,
      history:attempts.map(o => ({job:o.job,current:o.current,health:health(o.job)})),
      render:liveRender ? {state:liveRender.state,percent:Number.isFinite(liveRender.percent) ? Math.max(0,Math.min(100,liveRender.percent)) : null,
        sceneIndex:liveRender.sceneIndex,sceneCount:liveRender.sceneCount,jobId:liveRender.jobId} : null,
      production:liveProduction ? {state:liveProduction.state,current:liveProduction.current,phase:liveProduction.phase} : null };
  }
  function sort(projects) {
    return [...projects].sort((a,b) => STATUSES.indexOf(a.status)-STATUSES.indexOf(b.status) || stamp(b.updatedAt)-stamp(a.updatedAt) || compareId(a.projectId,b.projectId));
  }
  function filter(projects, query = "", value = "all") {
    const text = String(query).trim().toLocaleLowerCase();
    return sort(projects).filter(p => String(p.name || "").toLocaleLowerCase().includes(text) &&
      (value === "all" || value === "active" && ["rendering","preparing","paused"].includes(p.status) || p.status === value));
  }
  function totals(projects) {
    return {totalProjects:projects.length,activeWork:projects.filter(p => ["rendering","preparing","paused"].includes(p.status)).length,
      needsAttention:projects.filter(p => p.status === "needs_attention").length,readyVideos:projects.filter(p => p.status === "ready").length};
  }
  function selection(projects, selected, active) {
    return projects.some(p => p.projectId === selected) ? selected : selected ? projects[0]?.projectId || null :
      projects.find(p => p.projectId === active)?.projectId || projects[0]?.projectId || null;
  }
  return {STATUSES,FILTERS,history,summarize,sort,filter,totals,selection};
});
