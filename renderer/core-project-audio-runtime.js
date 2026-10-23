(function attachProjectAudioRuntime(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectAudioRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function projectAudioRuntime() {
  "use strict";
  // idle -> validating -> durably admitted -> service-owned processing -> terminal.
  // Switching Project only changes presentation, never a captured request owner.
  function create({ model, persistence, desktop, playback, id, changed = () => {} }) {
    const pending = new Map(), failures = new Map();
    const notify = () => { try { changed(); } catch {} };
    const clone = v => JSON.parse(JSON.stringify(v));
    function plan(projectId) {
      const project = persistence.projectAudioSnapshot(projectId);
      if (!project) throw Error("PROJECT_NOT_FOUND");
      return model.voicePlan(project, playback(project));
    }
    function reconcile(projectId) {
      const project = persistence.projectAudioSnapshot(projectId);
      if (!project?.workflow.voice.result?.projectId) return;
      const current = plan(projectId);
      if (project.workflow.voice.result.inputSignature !== current.inputSignature) persistence.updateProjectVoice(projectId, { action: "stale", inputSignature: current.inputSignature });
    }
    function generate(projectId) {
      if (pending.has(projectId)) return pending.get(projectId).promise;
      let context;
      try {
        if (projectId !== persistence.activeProjectId()) throw Error("PROJECT_CHANGED");
        const input = plan(projectId);
        if (!input.ready) throw Error(input.reason);
        const voice = persistence.projectAudioSnapshot(projectId).workflow.voice;
        if ([voice.job, voice.staleJob].some(j => model.ACTIVE.includes(j?.status))) throw Error("alreadyRunning");
        context = Object.freeze({ projectId, jobId: id(), inputSignature: input.inputSignature, textSource: input.requestedSource, language: input.language,
          assignments: Object.freeze({ defaultVoiceId: input.assignments.defaultVoiceId, bySpeaker: Object.freeze({ ...input.assignments.bySpeaker }) }),
          segments: Object.freeze(input.segments.map(s => Object.freeze({ ...s }))) });
      } catch (error) { failures.set(projectId, error.message); notify(); return Promise.resolve({ ok: false, reason: error.message }); }
      const task = { context, state: "validating", percent: null, admitted: false, terminalAttempted: false, cancelConfirmed: false };
      pending.set(projectId, task); failures.delete(projectId);
      task.promise = Promise.resolve().then(async () => {
        try {
          const ready = await desktop.getVoiceStatus();
          const catalog = await desktop.getVoiceCatalog();
          if (persistence.activeProjectId() !== projectId || plan(projectId).inputSignature !== context.inputSignature) throw Error("PROJECT_INPUT_CHANGED");
          if (!ready?.ready || !catalog?.ok || catalog.data?.ready !== true) throw Error("voiceUnavailable");
          const ids = new Set((catalog.data.voices || []).map(v => v.id));
          if (!ids.has(context.assignments.defaultVoiceId) || Object.values(context.assignments.bySpeaker).some(v => !ids.has(v))) throw Error("chooseVoice");
          if (task.cancelBeforeAdmission) { task.state = "cancelled"; return { ok: true, cancelled: true }; }
          persistence.updateProjectVoice(projectId, { action: "admit", job: { id: context.jobId, projectId, inputSignature: context.inputSignature, textSource: context.textSource, language: context.language } });
          task.admitted = true; task.state = "generating"; notify();
          const response = await desktop.startVoice({ jobId: context.jobId, language: context.language,
            assignments: clone(context.assignments), segments: clone(context.segments) });
          if (task.cancelPromise) await task.cancelPromise;
          if (!response?.ok) throw Error("voiceFailed");
          const cancelled = response.data?.cancelled === true || task.cancelConfirmed;
          const result = cancelled ? null : model.validateResult(response.data?.result, context);
          task.terminalAttempted = true;
          persistence.updateProjectVoice(projectId, { action: "terminal", jobId: context.jobId, status: cancelled ? "cancelled" : "completed", ...(result ? { result } : {}) });
          task.state = cancelled ? "cancelled" : "completed";
          if (!cancelled) reconcile(projectId);
          return { ok: true, cancelled };
        } catch (error) {
          failures.set(projectId, error.message);
          if (task.admitted && !task.terminalAttempted) {
            task.terminalAttempted = true;
            try { persistence.updateProjectVoice(projectId, { action: "terminal", jobId: context.jobId, status: "failed" }); }
            catch { failures.set(projectId, "saveFailed"); }
          }
          return { ok: false, reason: failures.get(projectId) };
        } finally { if (pending.get(projectId) === task) pending.delete(projectId); notify(); }
      });
      notify(); return task.promise;
    }
    function cancel(projectId) {
      const task = pending.get(projectId);
      if (!task) return Promise.resolve(false);
      if (task.cancelPromise) return task.cancelPromise;
      if (!task.admitted) { task.cancelBeforeAdmission = true; task.state = "cancelling"; notify(); return Promise.resolve(true); }
      task.state = "cancelling"; notify();
      task.cancelPromise = Promise.resolve().then(() => desktop.cancelVoice(task.context.jobId)).then(response => {
        task.cancelConfirmed = response?.ok === true && response.cancelled === true;
        if (!task.cancelConfirmed) { task.state = "generating"; failures.set(projectId, "cancelFailed"); }
        return task.cancelConfirmed;
      }).catch(() => { task.state = "generating"; failures.set(projectId, "cancelFailed"); return false; }).finally(notify);
      return task.cancelPromise;
    }
    function progress(event) {
      const task = [...pending.values()].find(t => t.context.jobId === event?.jobId);
      if (!task || !task.admitted || task.state === "cancelling" || !["validating", "queued", "generating", "downloading"].includes(event.state)) return;
      task.state = event.state; task.percent = event.indeterminate !== true && Number.isFinite(event.percent) ? Math.max(0, Math.min(99, event.percent)) : null;
      notify(); // No registry write for percentages.
    }
    return { generate, cancel, progress, reconcile, plan,
      view(projectId) { const task = pending.get(projectId); return { busy: !!task, state: task?.state, percent: task?.percent, jobId: task?.context.jobId, error: failures.get(projectId) || null }; } };
  }
  return { create };
});
