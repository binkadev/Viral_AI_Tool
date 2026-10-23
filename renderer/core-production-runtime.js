(function attachProductionRuntime(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralProductionRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function productionRuntime() {
  "use strict";
  const ACTIVE = new Set(["queued", "preparing", "submitting", "running", "verifying", "cancelling"]);
  // Explicit Start: idle/completed/needs_attention/cancelled -> running.
  // running <-> paused; either -> cancelled; running -> completed/needs_attention.
  // These states never enter Project storage or confer provider ownership.
  function create({ model, actionModel, persistence, projectMedia, desktop, orchestration, attachmentStatus, id, changed = () => {} }) {
    let epoch = 0, run = null, state = "idle", current = null, phase = null, task = null, stock = null;
    const records = new Map(), attempted = new Set(), wakeups = new Set(), uncertain = new Set();
    const scope = (context, sceneId) => JSON.stringify([context.projectId, sceneId]);
    const failure = (code, fatal = true) => Object.assign(Error(code), { code, fatal });
    function publish() { try { changed(); } catch {} }
    function valid(context) { return context === run && context.epoch === epoch && persistence.activeProjectId() === context.projectId; }
    function snapshot(context) {
      if (!valid(context)) throw failure("PROJECT_CHANGED");
      const value = persistence.snapshot();
      if (value?.projectId !== context.projectId) throw failure("PROJECT_CHANGED");
      return value;
    }
    function material(context, sceneId) {
      const value = snapshot(context), scene = value.scenePlan.scenes.find(s => s.id === sceneId);
      if (!scene) throw failure("SCENE_DELETED");
      return model.classify(value, scene, actionModel);
    }
    function notify() { for (const wake of [...wakeups]) wake(); publish(); }
    function select(context, sceneId, assetId) {
      const latest = material(context, sceneId);
      if (latest.selected) return; // All valid selections, including manual, win.
      if (latest.slot?.selectedAssetId) throw failure("broken-selection", false);
      if (!latest.candidates.some(a => a.id === assetId)) throw failure("MATERIAL_CHANGED");
      persistence.selectSceneMaterial(sceneId, assetId, { projectId: context.projectId, selectionSource: "auto" });
      if (material(context, sceneId).selected?.id !== assetId) throw failure("SELECTION_FAILED");
    }
    function entries(context, sceneId) {
      snapshot(context);
      return persistence.generationOutputJobs().filter(e => e.projectId === context.projectId && (!sceneId || e.sceneId === sceneId));
    }
    async function job(context, entry) {
      const response = await desktop.getGenerationJob(entry.jobId);
      snapshot(context);
      const value = response?.value;
      if (!response?.ok || value?.id !== entry.jobId || value.projectId !== context.projectId ||
          value.sceneId !== entry.sceneId || value.kind !== "video") throw failure("GENERATION_IDENTITY");
      return value;
    }
    function terminal(value) {
      if (value.status === "interrupted" || value.errorCode === "RECOVERY_REQUIRED" || value.error?.code === "RECOVERY_REQUIRED") throw failure("RECOVERY_REQUIRED");
      if (["failed", "cancelled"].includes(value.status)) throw failure("GENERATION_" + value.status.toUpperCase(), false);
      if (value.status !== "completed" && !ACTIVE.has(value.status)) throw failure("GENERATION_STATUS");
    }
    // Register the wakeup BEFORE the first read. Events during an in-flight read
    // are coalesced, never lost; no timer/polling or second provider queue exists.
    function waitForAttachment(context, entry) {
      return new Promise((resolve, reject) => {
        let reading = false, dirty = false, done = false;
        const finish = (error, value) => { if (done) return; done = true; wakeups.delete(wake); error ? reject(error) : resolve(value); };
        const wake = async () => {
          if (done) return;
          if (!valid(context)) { finish(failure("PROJECT_CHANGED")); return; }
          if (reading) { dirty = true; return; }
          reading = true;
          try {
            do {
              dirty = false;
              const value = await job(context, entry);
              material(context, entry.sceneId);
              terminal(value);
              if (attachmentStatus(entry.jobId) === "error") throw failure("ATTACHMENT_FAILED");
              const enrolled = entries(context, entry.sceneId).find(e => e.jobId === entry.jobId);
              const latest = material(context, entry.sceneId);
              if (value.status === "completed" && attachmentStatus(entry.jobId) === "attached" && enrolled?.assetId &&
                  latest.candidates.some(a => a.id === enrolled.assetId)) { finish(null, enrolled.assetId); break; }
              if (enrolled?.assetId && value.status === "completed") throw failure("ATTACHMENT_INVALID");
            } while (dirty && !done);
          } catch (error) { finish(error); }
          finally { reading = false; }
        };
        wakeups.add(wake); wake();
      });
    }
    async function generate(context, sceneId) {
      phase = "waiting"; publish();
      const scenes = model.ordered(snapshot(context));
      if ([...uncertain].some(key => JSON.parse(key)[0] === context.projectId) ||
          scenes.some(s => orchestration.state?.(context.projectId, s.id)?.reason === "SCENE_SUBMIT_UNCERTAIN")) throw failure("SCENE_SUBMIT_UNCERTAIN");
      if (scenes.some(s => orchestration.busy?.(context.projectId, s.id))) throw failure("GENERATION_PENDING_ADMISSION");
      // Inspect only explicitly enrolled records, including another Scene's
      // pending operation. No historical job discovery or ownership recovery.
      let exact = null, exactAsset = null;
      for (const entry of entries(context)) {
        const value = await job(context, entry);
        if (value.status === "interrupted" || value.errorCode === "RECOVERY_REQUIRED" || value.error?.code === "RECOVERY_REQUIRED") throw failure("RECOVERY_REQUIRED");
        if (ACTIVE.has(value.status)) {
          const assetId = await waitForAttachment(context, entry);
          if (entry.sceneId === sceneId) { exact = entry; exactAsset = assetId; }
        } else if (entry.sceneId === sceneId) {
          terminal(value); // A failed exact job needs an explicit manual decision.
          exact = entry;
          exactAsset = await waitForAttachment(context, entry);
        }
      }
      const latest = material(context, sceneId);
      if (latest.selected || latest.candidates.length) return exactAsset || latest.selected?.id || latest.candidates[0]?.id;
      const prior = orchestration.state?.(context.projectId, sceneId);
      if (uncertain.has(scope(context, sceneId)) || prior?.reason === "SCENE_SUBMIT_UNCERTAIN") throw failure("SCENE_SUBMIT_UNCERTAIN");
      if (exact) throw failure("ATTACHMENT_INVALID");
      if (state === "paused") return null; // No new admission after Pause.
      const response = await orchestration.generate(context.projectId, sceneId);
      // Retain uncertain authority even across Stop / Project switch / new Start.
      if (response?.reason === "SCENE_SUBMIT_UNCERTAIN") uncertain.add(scope(context, sceneId));
      snapshot(context);
      if (!response?.ok) throw failure(response?.reason || "GENERATION_FAILED",
        !["SCENE_GENERATION_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "NO_GENERATION_ROUTE", "RESOURCE_UNAVAILABLE", "DUPLICATE_JOB"].includes(response?.reason));
      const entry = entries(context, sceneId).find(e => e.jobId === response.jobId);
      if (!entry) throw failure("GENERATION_NOT_ENROLLED");
      return waitForAttachment(context, entry);
    }
    async function source(context, sceneId, plan) {
      for (const query of plan.search.available ? plan.search.queries : []) for (const kind of plan.search.targetKinds) {
        if (state === "paused") return null;
        material(context, sceneId);
        const operation = Object.freeze({ ...context, sceneId, operationId: id(), query, kind, orientation: plan.search.orientation, plan });
        stock = { requestId: operation.operationId };
        phase = "sourcing"; publish();
        const response = await desktop.searchMedia({ requestId: operation.operationId, query, kind,
          orientation: operation.orientation, page: 1, perPage: 18, provider: "auto" });
        snapshot(context);
        stock = null;
        if (!response?.ok || !Array.isArray(response.data?.results)) throw failure("STOCK_SEARCH_FAILED", false);
        const result = response.data.results.find(r => model.eligible(r, kind));
        if (!result) continue;
        // A selection made during search wins without an unnecessary download.
        const latest = material(context, sceneId);
        if (latest.selected || latest.candidates.length) return latest.selected?.id || latest.candidates[0].id;
        if (latest.slot?.selectedAssetId) throw failure("broken-selection", false);
        if (state === "paused") return null;
        const acquisition = Object.freeze({ ...operation, operationId: id(), provider: result.provider, providerAssetId: String(result.providerAssetId) });
        const owner = projectMedia.begin({ projectId: context.projectId, sceneId, intent: "candidate", expected: result });
        stock = { jobId: acquisition.operationId };
        try {
          const payload = await desktop.acquireMedia({ jobId: acquisition.operationId, projectId: context.projectId, ticket: result.acquisition.ticket });
          snapshot(context);
          // The existing native contract returns {asset, duplicate}; the IPC
          // promise itself is bound to this exact immutable job/Project request.
          // Validate any echoed identity as well, never infer from current focus.
          if (!payload?.ok || payload.data?.jobId != null && payload.data.jobId !== acquisition.operationId ||
              payload.data?.projectId != null && payload.data.projectId !== context.projectId) throw failure("STOCK_ACQUISITION_FAILED");
          // ProjectMedia verifies exact provider/asset/kind and persists first.
          const outcome = projectMedia.admit(owner, [payload.data.asset]);
          if (outcome.errors?.length || !outcome.enrolled?.length) throw failure("STOCK_ADMISSION_FAILED");
          return outcome.enrolled[0];
        } finally { stock = null; projectMedia.finish(owner); }
      }
      material(context, sceneId);
      if (state === "paused") return null;
      if (!plan.generation.available) throw failure("no-source", false);
      return generate(context, sceneId);
    }
    async function drive(context) {
      try {
        while (valid(context) && state === "running") {
          const value = snapshot(context);
          const scene = model.ordered(value).find(s => !attempted.has(s.id));
          if (!scene) {
            let summary = model.summarize(value, actionModel, records);
            for (const unresolved of summary.scenes.filter(s => s.status === "pending")) records.set(unresolved.sceneId, { status: "attention", reason: "MATERIAL_CHANGED" });
            summary = model.summarize(value, actionModel, records);
            state = summary.attention || (context.mode === "auto" && summary.ready !== summary.total) ? "needs_attention" : "completed";
            break;
          }
          current = scene.id; phase = "checking"; publish();
          let settled = false;
          try {
            const initial = material(context, scene.id);
            if (initial.classification === "attention-required") throw failure(initial.reason, false);
            if (initial.selected) { records.set(scene.id, { status: "ready" }); settled = true; }
            else {
              const assetId = initial.candidates[0]?.id || await source(context, scene.id, initial.plan);
              snapshot(context);
              if (!assetId) break;
              if (context.mode === "auto") select(context, scene.id, assetId);
              records.set(scene.id, { status: context.mode === "auto" ? "ready" : "review" });
              settled = true;
            }
          } catch (error) {
            if (!valid(context)) break;
            records.set(scene.id, { status: "attention", reason: error.code || "PRODUCTION_FAILED" });
            settled = true;
            if (error.fatal !== false) { state = "needs_attention"; break; }
          } finally {
            if (valid(context) && settled) attempted.add(scene.id);
          }
          publish();
        }
      } catch (error) {
        if (valid(context)) {
          state = "needs_attention";
          if (current) records.set(current, { status: "attention", reason: error.code || "PRODUCTION_FAILED" });
        }
      } finally {
        if (valid(context)) { current = null; phase = null; }
        publish();
      }
    }
    function launch(context) {
      const pending = drive(context);
      task = pending;
      pending.finally(() => { if (task === pending) { task = null; publish(); } });
    }
    function start(projectId, selectedMode) {
      if (task || state === "running" || state === "paused" || projectId !== persistence.activeProjectId() || !persistence.snapshot()?.scenePlan?.scenes?.length) return false;
      run = Object.freeze({ runId: id(), projectId, mode: model.mode(selectedMode), epoch: ++epoch });
      records.clear(); attempted.clear(); state = "running"; current = null; phase = null;
      launch(run); publish(); return true;
    }
    function pause() { if (state !== "running") return false; state = "paused"; publish(); return true; }
    function resume() {
      if (state !== "paused" || !valid(run)) return false;
      // If the admitted operation is still settling, its existing drive loop
      // continues. Otherwise start one loop after a fresh canonical rescan.
      state = "running"; if (!task) launch(run); publish(); return true;
    }
    function stop() {
      if (!["running", "paused"].includes(state)) return false;
      epoch++; state = "cancelled"; current = null; phase = null;
      try {
        if (stock?.requestId) Promise.resolve(desktop.cancelMediaSearch?.(stock.requestId)).catch(() => {});
        if (stock?.jobId) Promise.resolve(desktop.cancelMediaAcquisition?.(stock.jobId)).catch(() => {});
      } catch {} // Cancellation transport cannot revive coordinator authority.
      notify(); return true;
    }
    function invalidate() { stop(); epoch++; notify(); }
    function view() {
      const value = persistence.snapshot(), visible = run?.projectId === value?.projectId;
      return { state: visible ? state : "idle", run: visible ? run : null, current: visible ? current : null, phase: visible ? phase : null,
        settling: !!task, summary: model.summarize(value, actionModel, visible ? records : new Map()) };
    }
    return { start, pause, resume, stop, invalidate, notify, view, settled: () => task || Promise.resolve() };
  }
  return { create };
});
