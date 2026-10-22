(function attachSceneActions(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralSceneActionRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function sceneActions() {
  "use strict";
  function create({ model, persistence, status, submit, track, attachmentStatus = () => "pending", openProgress,
    preferences = () => ({}), id, changed = () => {} }) {
    let epoch = 0, searchContext = null;
    const pending = new Map(), states = new Map();
    const key = (projectId, sceneId) => JSON.stringify([projectId, sceneId]);
    const fail = code => Object.assign(Error(code), { code });
    function scene(projectId, sceneId) {
      const snapshot = persistence.snapshot();
      if (persistence.activeProjectId() !== projectId || snapshot?.projectId !== projectId) throw fail("SCENE_PROJECT_CHANGED");
      const found = snapshot.scenePlan.scenes.find(s => s.id === sceneId);
      if (!found) throw fail("SCENE_NOT_FOUND");
      return found;
    }
    function visible(context) {
      return context.generation === epoch && persistence.activeProjectId() === context.projectId &&
        persistence.snapshot()?.scenePlan?.scenes?.some(s => s.id === context.sceneId);
    }
    function publish(context, state, reason = null, jobId = null) {
      if (!visible(context)) return;
      states.set(key(context.projectId, context.sceneId), Object.freeze({ state, reason, jobId }));
      // Notification failure cannot reclassify an admitted request or resend it.
      try { changed(context); } catch {}
    }
    function beginSearch(projectId, sceneId, { query, kind } = {}) {
      const plan = model.buildSceneActionPlan(scene(projectId, sceneId));
      if (!plan.search.available || pending.has(key(projectId, sceneId))) throw fail("SCENE_SEARCH_UNAVAILABLE");
      query ??= plan.search.queries[0]; kind ??= plan.search.targetKinds[0];
      if (!plan.search.queries.includes(query) || !plan.search.targetKinds.includes(kind)) throw fail("SCENE_ACTION_INVALID");
      searchContext = Object.freeze({ projectId, sceneId, operationId: id(), generation: epoch, action: "search",
        query, kind, orientation: plan.search.orientation, queries: plan.search.queries, targetKinds: plan.search.targetKinds });
      return searchContext;
    }
    function acceptsSearch(context) { return context === searchContext && !!context && visible(context); }
    function generate(projectId, sceneId) {
      const scope = key(projectId, sceneId);
      if (pending.has(scope)) return pending.get(scope);
      let context;
      try {
        const plan = model.buildSceneActionPlan(scene(projectId, sceneId));
        if (!plan.generation.available) throw fail("SCENE_GENERATION_UNAVAILABLE");
        const operationId = id();
        context = Object.freeze({ projectId, sceneId, operationId, idempotencyKey: operationId,
          generation: epoch, action: "generation", prompt: plan.generation.prompt,
          preferences: Object.freeze({ ...preferences() }) });
      } catch (error) { return Promise.resolve({ ok: false, reason: error.code || error.message }); }
      // Reserve synchronously before any status/submit await or UI notification.
      // A later explicit click gets a new key; nothing automatically resends.
      const task = Promise.resolve().then(async () => {
        publish(context, "generating");
        let consumed = false, accepted = false, job = null;
        try {
          const ready = await status();
          if (!visible(context)) throw fail("SCENE_PROJECT_CHANGED");
          const request = model.buildGenerationRequest(context, ready?.ok ? ready.value : null, context.preferences);
          consumed = true;
          const response = await submit(request);
          if (!response?.ok) throw fail(response?.errorCode || response?.error?.code || "SCENE_SUBMIT_UNCERTAIN");
          job = response.value;
          if (!job?.id || job.projectId !== projectId || job.sceneId !== sceneId || job.kind !== "video" ||
              job.idempotencyKey !== context.idempotencyKey || job.request?.prompt !== context.prompt) throw fail("SCENE_JOB_MISMATCH");
          accepted = true;
          // This exact admitted job must be tracked even if editing selection or
          // Project changed. Existing handoff resolves ORIGINAL registry ownership.
          await track(job);
          if (attachmentStatus(job.id) === "error") throw fail("SCENE_ATTACHMENT_FAILED");
          publish(context, "submitted", null, job.id);
          const active = persistence.snapshot();
          if (visible(context) && active.scenePlan.selectedSceneId === sceneId) {
            try { await openProgress?.(job.id); } catch { publish(context, "submitted", "SCENE_PROGRESS_UNAVAILABLE", job.id); }
          }
          return { ok: true, jobId: job.id };
        } catch (error) {
          const code = error.code || error.message;
          // Generic IPC/network UNAVAILABLE cannot prove pre-admission failure.
          // Keep that consumed authority uncertain; never silently resubmit it.
          const known = ["DUPLICATE_JOB", "INVALID_REQUEST", "NO_GENERATION_ROUTE", "PROVIDER_UNAVAILABLE", "RESOURCE_UNAVAILABLE", "STORE_UNAVAILABLE", "SCENE_GENERATION_UNAVAILABLE", "SCENE_PROJECT_CHANGED"];
          const reason = accepted ? "SCENE_ATTACHMENT_FAILED" : consumed && !known.includes(code) ? "SCENE_SUBMIT_UNCERTAIN" : code;
          publish(context, "failed", reason, accepted ? job.id : null);
          return { ok: false, reason, jobId: accepted ? job.id : null };
        } finally {
          if (pending.get(scope) === task) pending.delete(scope);
          try { changed(context); } catch {}
        }
      });
      pending.set(scope, task);
      return task;
    }
    return { beginSearch, acceptsSearch, generate,
      busy: (projectId, sceneId) => pending.has(key(projectId, sceneId)),
      state: (projectId, sceneId) => states.get(key(projectId, sceneId)) || Object.freeze({ state: "idle", reason: null, jobId: null }),
      invalidate() { epoch++; searchContext = null; states.clear(); } };
  }
  return { create };
});
