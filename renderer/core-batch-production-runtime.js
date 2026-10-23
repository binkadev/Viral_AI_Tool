(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralBatchProductionRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  // One promise owns the entire ordered batch. Stage writes are admission
  // barriers; Pause/Stop only take effect at the next terminal item boundary.
  function create({model, store, persistence, productionModel, actionModel, production, audioModel, audio, renderModel, render, player, managerModel, desktop,
    id, now = () => new Date().toISOString(), changed = () => {}}) {
    let record = store.read(), task = null, owner = null, activating = false, intervention = false, error = store.error(), haltReason = null;
    const notify = () => {try {changed();} catch {}};
    const fail = model.failure;
    const protectedState = () => store.protected() || !!persistence.storageError() || !!persistence.unsupportedSchemaVersion();
    function writable() {
      if (store.protected()) throw fail(store.error());
      if (persistence.storageError() || persistence.unsupportedSchemaVersion()) throw fail("PROJECT_STORAGE_PROTECTED");
    }
    function save(update) {
      writable(); const next = model.clone(record); update(next.current, next);
      if (next.current) next.current.updatedAt = now();
      record = store.write(next); notify();
    }
    function snapshot(projectId) {
      writable(); const p = persistence.projectAudioSnapshot(projectId);
      if (!p || p.projectId !== projectId) throw fail("PROJECT_NOT_FOUND");
      return p;
    }
    const materials = p => productionModel.summarize(p, actionModel);
    const materialReady = s => s.total > 0 && s.ready === s.total;
    function owned(projectId) {
      if (haltReason) throw fail(haltReason);
      snapshot(projectId);
      if (intervention || persistence.activeProjectId() !== projectId) throw fail("USER_INTERVENTION");
    }
    async function directory() {
      // The existing file:status contract returns stat metadata for directories
      // with exists:false (exists means isFile). Missing paths carry a reason.
      // Never recreate a vanished Batch folder via the render preflight.
      let status;
      try {status = await desktop.fileStatus(record.current.outputDir);} catch {throw fail("OUTPUT_UNAVAILABLE");}
      writable();
      if (status?.exists !== false || status.reason || !Number.isFinite(status.sizeBytes) || !Number.isFinite(status.modifiedAt)) throw fail("OUTPUT_UNAVAILABLE");
    }
    function busy() {
      const view = production.view();
      if (view.settling || ["running", "paused"].includes(view.state)) return true;
      return persistence.listProjects().some(({projectId}) => {
        const p = snapshot(projectId);
        return audio.view(projectId).busy || render.view(projectId).busy ||
          [p.workflow?.voice?.job, p.workflow?.voice?.staleJob].some(j => audioModel.ACTIVE.includes(j?.status)) ||
          (p.workflow?.jobs || []).some(j => renderModel.ACTIVE.includes(j.status));
      });
    }
    async function currentOutput(projectId) {
      const p = snapshot(projectId), plan = renderModel.build(p, player.buildProjectPlayback(p));
      const candidates = managerModel.history(renderModel.outputs(p, plan)).filter(o => o.current);
      for (const {job} of candidates) {
        let health; try {health = await desktop.fileStatus(job.outputPath);} catch {continue;}
        writable();
        // File checks can race edits/deletion; prove exact latest ownership,
        // signature and output identity again before accepting the result.
        const latest = snapshot(projectId), fresh = renderModel.build(latest, player.buildProjectPlayback(latest));
        if (fresh.renderInputSignature !== plan.renderInputSignature) return false;
        const exact = renderModel.outputs(latest, fresh).some(o => o.current && o.job.id === job.id && o.job.outputPath === job.outputPath);
        if (exact && health?.exists === true && health.sizeBytes > 0) return true;
      }
      return false;
    }
    function stage(index, status, reason = null) {
      save(b => {const item = b.items[index]; item.status = item.stage = status; item.reason = reason;
        if (!item.startedAt) item.startedAt = now();
        if (model.terminal(item)) {item.completedAt = now(); b.cursor = index + 1;}
      });
    }
    async function item(index) {
      const projectId = record.current.projectIds[index];
      stage(index, "activating");
      snapshot(projectId);
      if (await currentOutput(projectId)) {stage(index, "skipped_ready"); return;}
      if (busy()) throw fail("PROJECT_WORK_RUNNING");
      activating = true;
      try {if (persistence.activeProjectId() !== projectId) await persistence.openProject(projectId);}
      finally {activating = false;}
      owner = projectId; owned(projectId);
      let p = snapshot(projectId), summary = materials(p);
      if (!summary.total) throw fail("NO_SCENES");
      if (!materialReady(summary)) {
        stage(index, "materials"); owned(projectId);
        if (!production.start(projectId, "auto")) throw fail("MATERIALS_ATTENTION");
        await production.settled(); owned(projectId);
        p = snapshot(projectId); summary = materials(p);
        const live = production.view();
        if (live.run?.projectId === projectId && live.summary?.scenes?.some(s => ["RECOVERY_REQUIRED", "SCENE_SUBMIT_UNCERTAIN"].includes(s.reason))) throw fail("RECOVERY_REQUIRED");
        if (!materialReady(summary) || live.run?.projectId === projectId && live.state !== "completed") throw fail("MATERIALS_ATTENTION");
      }
      owned(projectId); p = snapshot(projectId);
      const settings = audioModel.normalizeSettings(p.workflow.renderOptions);
      if (settings.voiceEnabled) {
        const plan = audioModel.voicePlan(p, player.buildProjectPlayback(p));
        if (!plan.ready) throw fail("VOICE_REQUIRED");
        if (!audioModel.currentVoice(p, plan)) {
          if (busy()) throw fail("PROJECT_WORK_RUNNING");
          stage(index, "voice"); owned(projectId);
          const outcome = await audio.generate(projectId); owned(projectId);
          if (!outcome?.ok || outcome.cancelled) throw fail(outcome?.reason === "voiceUnavailable" ? "VOICE_UNAVAILABLE" : "VOICE_FAILED");
          p = snapshot(projectId);
          if (!audioModel.currentVoice(p, audioModel.voicePlan(p, player.buildProjectPlayback(p)))) throw fail("PROJECT_RENDER_VOICE_STALE");
        }
      }
      owned(projectId); p = snapshot(projectId);
      const plan = renderModel.build(p, player.buildProjectPlayback(p));
      if (!plan.ready) throw fail(model.reason(plan.reason, "PROJECT_RENDER_INCOMPLETE"));
      if (busy()) throw fail("PROJECT_WORK_RUNNING");
      if (render.view(projectId).busy || renderModel.outputs(p, plan).some(o => renderModel.ACTIVE.includes(o.job.status))) throw fail("PROJECT_RENDER_DUPLICATE");
      stage(index, "render"); owned(projectId);
      const outcome = await render.start(projectId, record.current.outputDir); owned(projectId);
      if (!outcome?.ok || outcome.cancelled) throw fail(model.reason(outcome?.reason, "RENDER_FAILED"));
      if (!await currentOutput(projectId)) throw fail("OUTPUT_MISSING");
      owned(projectId); stage(index, "completed");
    }
    const GLOBAL = ["BATCH_STORAGE_FAILED", "BATCH_STORAGE_PROTECTED", "PROJECT_STORAGE_PROTECTED", "PROJECT_SAVE_FAILED", "PROJECT_STATE_UNAVAILABLE", "BATCH_INVALID", "OUTPUT_REQUIRED", "OUTPUT_UNAVAILABLE", "LOW_DISK_SPACE", "PROJECT_WORK_RUNNING", "PROJECT_TRANSITION_PENDING"];
    function interrupt(code) {
      error = model.reason(code); haltReason = error;
      const update = b => {if (!b) return; b.status = "interrupted"; b.reason = error;
        for (const i of b.items) if (model.ACTIVE.includes(i.status)) {i.status = i.stage = "interrupted"; i.reason = error;}
      };
      try {save(update);} catch {update(record.current); notify();}
    }
    async function drive() {
      try {
        while (true) {
          writable();
          if (haltReason) throw fail(haltReason);
          const b = record.current;
          if (b.stopRequested) {
            save(batch => {for (const i of batch.items) if (!model.terminal(i)) {i.status = i.stage = "stopped"; i.completedAt = now();}
              batch.cursor = batch.items.length; batch.status = "completed_with_attention"; batch.completedAt = now();}); return;
          }
          const index = model.next(b);
          if (index < 0) {save(batch => {batch.status = model.aggregate(batch); batch.cursor = batch.items.length; batch.completedAt = now();}); return;}
          if (b.pauseRequested) {save(batch => {batch.status = "paused";}); return;}
          await directory();
          // A Pause/Stop that arrives during the asynchronous directory check
          // must win before this Project is admitted.
          if (record.current.pauseRequested || record.current.stopRequested) continue;
          if (haltReason) throw fail(haltReason);
          owner = null; intervention = false;
          save(batch => {batch.cursor = index; if (batch.items[index].status === "interrupted") batch.items[index].status = batch.items[index].stage = "pending";});
          try {await item(index);}
          catch (e) {
            const code = model.reason(e.code || e.message, "RENDER_FAILED");
            if (GLOBAL.includes(code)) throw fail(code);
            stage(index, "needs_attention", code);
            if (code === "USER_INTERVENTION") {save(batch => {batch.status = "paused"; batch.pauseRequested = true; batch.reason = code;}); return;}
          } finally {owner = null;}
        }
      } catch (e) {interrupt(e.code || e.message);}
    }
    function launch(resume) {
      if (task) return task;
      try {
        writable(); const b = record.current;
        if (!b || (resume ? !model.resumable(b) : b.status !== "draft")) return Promise.resolve(false);
        if (busy()) throw fail("PROJECT_WORK_RUNNING");
        save(batch => {batch.status = "running"; batch.pauseRequested = batch.stopRequested = false; batch.reason = null; batch.startedAt ||= now();});
      } catch (e) {error = model.reason(e.code || e.message); notify(); return Promise.resolve(false);}
      error = null; haltReason = null;
      const running = Promise.resolve().then(drive).finally(() => {if (task === running) task = null; notify();});
      task = running; return running;
    }
    function createBatch(projectIds, outputDir) {
      try {
        writable(); if (task || record.current && !model.finished(record.current)) throw fail("BATCH_EXISTS");
        const ids = model.membership(projectIds), dir = model.outputDirectory(outputDir), existing = new Set(persistence.listProjects().map(p => p.projectId));
        if (ids.some(i => !existing.has(i))) throw fail("PROJECT_NOT_FOUND");
        const stamp = now();
        save((_, next) => {next.current = {batchId:id(), status:"draft", projectIds:ids, outputDir:dir, cursor:0, createdAt:stamp, startedAt:null, updatedAt:stamp, completedAt:null,
          pauseRequested:false, stopRequested:false, reason:null, items:ids.map(projectId => ({projectId, status:"pending", stage:"pending", reason:null, startedAt:null, completedAt:null}))};});
        error = null; return true;
      } catch (e) {error = model.reason(e.code || e.message); notify(); return false;}
    }
    function request(kind) {
      try {
        writable(); const b = record.current;
        if (!b || model.finished(b) || b.status === "draft") return false;
        if (kind === "pause" && b.status !== "running") return false;
        save(batch => {if (kind === "pause") batch.pauseRequested = true; else {batch.stopRequested = true; batch.status = "stopping";}});
        if (!task && kind === "stop") {task = Promise.resolve().then(drive).finally(() => {task = null; notify();});}
        return true;
      } catch (e) {interrupt(e.code || e.message); return false;}
    }
    function observe() {
      if (owner && !activating && persistence.activeProjectId() !== owner) intervention = true;
      notify();
    }
    function view() {
      const batch = model.clone(record.current), current = batch?.items.find(i => model.ACTIVE.includes(i.status));
      const live = current?.status === "materials" ? production.view() : current?.status === "voice" ? audio.view(current.projectId) : current?.status === "render" ? render.view(current.projectId) : null;
      return {batch, protected:protectedState(), error:error || store.error(), busy:!!task, progress:model.progress(batch),
        live:live ? {state:live.state, phase:live.phase, sceneId:live.current, percent:Number.isFinite(live.percent) ? Math.max(0, Math.min(100, live.percent)) : null,
          sceneIndex:live.sceneIndex, sceneCount:live.sceneCount} : null};
    }
    function clear() {
      if (task || !model.finished(record.current)) return false;
      try {save((_, value) => {value.current = null;}); error = null; return true;} catch (e) {error = model.reason(e.code || e.message); notify(); return false;}
    }
    function configure(projectIds, outputDir) {
      if (task || record.current?.status !== "draft") return false;
      try {
        writable(); const ids = model.membership(projectIds), dir = model.outputDirectory(outputDir);
        const existing = new Set(persistence.listProjects().map(p => p.projectId));
        if (ids.some(i => !existing.has(i))) throw fail("PROJECT_NOT_FOUND");
        save(b => {b.projectIds = ids; b.outputDir = dir; b.items = ids.map(projectId => ({projectId, status:"pending", stage:"pending", reason:null, startedAt:null, completedAt:null}));});
        error = null; return true;
      } catch (e) {error = model.reason(e.code || e.message); notify(); return false;}
    }
    return {create:createBatch, configure, start:() => launch(false), resume:() => launch(true), pause:() => request("pause"), stop:() => request("stop"), clear, observe, view, settled:() => task || Promise.resolve()};
  }
  return {create};
});
