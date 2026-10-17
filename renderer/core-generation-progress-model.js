(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ViralGenerationProgressModel = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const states = ['queued','preparing','submitting','running','verifying','completed','failed','cancelling','cancelled','interrupted'];
  const active = ['queued','preparing','submitting','running','verifying','cancelling'];
  function verified(job) {
    return job?.status === 'completed' && typeof job.id === 'string' && job.asset?.fileName === job.id + '.mp4' && job.output?.fileName === job.asset.fileName;
  }
  function describe(job, ready = false, blocked = false) {
    const status = states.includes(job?.status) ? job.status : 'unknown';
    const complete = verified(job);
    return {
      status, complete,
      percent: typeof job?.progress === 'number' && Number.isFinite(job.progress) ? Math.max(0, Math.min(complete ? 100 : 99, job.progress)) : null,
      cancel: [...active.filter(s=>s !== 'cancelling'),'interrupted'].includes(status),
      retry: ['failed','cancelled'].includes(status) && ready && !blocked,
      recover: ['queued','running','interrupted'].includes(status),
      tone: complete ? 'success' : status === 'failed' ? 'danger' : status === 'interrupted' ? 'warning' : ['cancelling','cancelled'].includes(status) ? 'muted' : 'active'
    };
  }
  function scoped(jobs, projectId) {
    return (Array.isArray(jobs) ? jobs : []).filter(j=>j?.projectId === projectId).sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  function outputCandidate(job, current) {
    if (!verified(job)) return null;
    const name = job.output.fileName;
    const matches = path => typeof path === 'string' && path.split(/[\\/]/).pop() === name;
    // Never manufacture a local path from a provider's filename.
    const source = (current?.jobs || []).find(j=>j.sourcePath && !j.isRenderOutput);
    return source && source.fileState === 'available' && matches(source.sourcePath) ? source.sourcePath : null;
  }
  function stages(job, plan, current = {}) {
    const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
    const result = [job?.request?.prompt?.trim() ? 'done' : 'pending', plan?.sourceType === 'script' && scenes.some(s=>s.sourceText) ? 'done' : 'pending', scenes.length ? 'done' : 'pending', 'pending', 'pending', 'pending', 'pending'];
    if (job) result[3] = verified(job) ? 'done' : ['failed','interrupted','cancelled','cancelling'].includes(job.status) ? job.status : 'current';
    // Later stages require their own real completion evidence, never generation percentage.
    if (current.voice?.job?.status === 'completed' && current.voice?.result?.outputPath) result[4] = 'done';
    const exported = (current.jobs || []).some(j=>j.isRenderOutput && j.status === 'completed' && j.outputPath && j.fileState === 'available');
    if (exported) { result[5] = 'done'; result[6] = 'done'; }
    return result;
  }
  function scenes(plan, jobs) {
    return (Array.isArray(plan?.scenes) ? plan.scenes : []).map(scene => {
      const job = jobs.find(j=>j.sceneId === scene.id);
      return {scene, job:job || null, state:job ? describe(job).status : 'notStarted', media:verified(job) ? 'verified' : 'noMedia'};
    });
  }
  return {states, active, verified, describe, scoped, outputCandidate, stages, scenes};
});
