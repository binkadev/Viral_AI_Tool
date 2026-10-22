"use strict";
// Telemetry-only storage. Never consulted by receipt, intent or candidate authority.
(function(root) {
  const PREFIX = 'execution-audit-v2:', MAX_RECORDS = 32, MAX_STREAMS = 16, MAX_BYTES = 24576;
  const scoped = type => ['submit.committed', 'submit.invocation_observed'].includes(type);
  const id = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
  function valid(source, type, d) {
    if (source === 'worker') return type === 'submit.committed' && exact(d, []);
    if (type === 'submit.invocation_observed') return exact(d, ['outcome']) && ['returned','threw_unknown'].includes(d.outcome);
    if (type === 'manual.session_opened') return exact(d, ['sessionAlias']) && id(d.sessionAlias);
    if (type === 'manual.candidate_revealed') return exact(d, ['sessionAlias','candidateAlias']) && id(d.sessionAlias) && id(d.candidateAlias);
    return false;
  }
  function create({ storage, source, uuid = () => crypto.randomUUID(), canClose = () => true }) {
    if (!['worker', 'content'].includes(source)) throw Error('Invalid witness source');
    const epoch = uuid(), live = new Map(), aliases = new Map(), damaged = new Set(), binding = new Map(), pending = new Map(), finishing = new Set();
    let tail = Promise.resolve(), prebindLoss = false;
    const key = packet => PREFIX + source + ':' + packet.jobId + ':' + packet.sourceEpoch;
    const enqueue = fn => { const task = tail.then(fn); tail = task.catch(() => {}); return task.catch(() => false); };
    function persist(packet) {
      return enqueue(async () => { try { await storage.set({ [key(packet)]: clone(packet) }); return true; } catch { packet.gap = true; if(packet.submissionSeal)packet.submissionSeal.gap=true; return false; } });
    }
    async function bindOnce(binding) {
      try {
        if (!binding || Object.keys(binding).sort().join(',') !== 'auditId,jobId,version' || binding.version !== 2 || !id(binding.jobId) || !id(binding.auditId)) return false;
        if (live.has(binding.jobId)) return live.get(binding.jobId).auditId === binding.auditId;
        const all = await storage.get(null);
        if (live.size >= MAX_STREAMS || Object.keys(all).filter(k => k.startsWith(PREFIX + source + ':')).length >= MAX_STREAMS) return false;
        const p = { version: 2, jobId: binding.jobId, auditId: binding.auditId, source, sourceEpoch: epoch, watermark: 0, closed: false, gap: prebindLoss || damaged.has(binding.jobId), events: [], submissionSeal: null };
        live.set(p.jobId, p); return await persist(p);
      } catch { gap(binding?.jobId);return false; }
    }
    function bind(value) {
      if(!value || !id(value.jobId))return Promise.resolve(false);
      if(binding.has(value.jobId))return binding.get(value.jobId);
      if(binding.size>=MAX_STREAMS)return Promise.resolve(false);
      const task=bindOnce(value).then(ok=>{
        const events=pending.get(value.jobId);pending.delete(value.jobId);
        if(!ok){gap(value.jobId);return false;}
        // Flush telemetry only after the initial checkpoint is durable. Never send/retry a command.
        for(const e of events || [])record(live.get(value.jobId),e.type,e.detail);
        if(finishing.has(value.jobId))checkpoint(live.get(value.jobId));
        return true;
      }).finally(()=>binding.delete(value.jobId));binding.set(value.jobId,task);return task;
    }
    function observe(jobId, type, detail = {}) {
      try {
        if(!id(jobId))return;
        const p = live.get(jobId);
        if (scoped(type) && finishing.has(jobId) && !p?.submissionSeal) gap(jobId);
        if(!p || binding.has(jobId)) {
          if(!valid(source,type,detail)){gap(jobId);return;}
          if(!pending.has(jobId)) {
            if(pending.size>=MAX_STREAMS){prebindLoss=true;gap(jobId);return;}
            pending.set(jobId,[]);
          }
          const events=pending.get(jobId);
          if(events.length>=MAX_RECORDS){gap(jobId);return;}
          events.push({type,detail:clone(detail)});return;
        }
        return record(p,type,detail);
      } catch {gap(jobId);}
    }
    function record(p, type, detail) {
      try {
        if (!valid(source, type, detail)) { p.gap = true; return persist(p); }
        if (scoped(type) && p.submissionSeal) { p.submissionSeal.gap = true; p.gap = true; }
        if (p.closed) { p.gap = true; persist(p); return; }
        const e = { eventId: uuid(), source, sourceEpoch: epoch, sourceSequence: ++p.watermark, type, detail: clone(detail) };
        if (p.events.length >= MAX_RECORDS || JSON.stringify(p).length + JSON.stringify(e).length > MAX_BYTES - 1024) p.gap = true;
        else p.events.push(e);
        return persist(p);
      } catch {gap(p?.jobId);}
    }
    function checkpoint(p) {
      if (!p) return;
      // This runs after every queued pre-bind occurrence has been materialized.
      // Drain shares the persistence queue, so it cannot deliver a seal before
      // the checkpoint (including all earlier witnesses) is durable.
      if (!p.submissionSeal) p.submissionSeal = {scope:'submission',source,sourceEpoch:epoch,watermark:p.watermark,sealed:true,gap:p.gap || damaged.has(p.jobId)};
      return persist(p);
    }
    function sealSubmission(jobId) {
      try {
        if (!id(jobId)) return;
        if (!finishing.has(jobId) && finishing.size >= MAX_STREAMS) {prebindLoss=true;gap(jobId);return;}
        finishing.add(jobId);
        if (!binding.has(jobId)) return checkpoint(live.get(jobId));
      } catch {gap(jobId);}
    }
    function alias(jobId, privateIdentity) {
      // A random alias has no relationship to a candidate capability or node.
      const k = jobId + ':' + privateIdentity;
      if (!aliases.has(k)) { if (aliases.size >= 160) {gap(jobId);return uuid();} aliases.set(k, uuid()); }
      return aliases.get(k);
    }
    async function drain(deliver) {
      return enqueue(async () => {
        try {
          const all = await storage.get(null);
          for (const k of Object.keys(all).filter(k => k.startsWith(PREFIX + source + ':')).slice(0, MAX_STREAMS)) {
            const snapshot = clone(all[k]);
            const resident = live.get(snapshot.jobId);
            // A failed later checkpoint must not let an older clean disk image
            // hide a known loss (including a late submission occurrence).
            if(resident?.sourceEpoch === snapshot.sourceEpoch) {
              snapshot.gap ||= resident.gap;
              if(snapshot.submissionSeal && resident.submissionSeal?.gap)snapshot.submissionSeal.gap=true;
            }
            if (snapshot.sourceEpoch !== epoch && !snapshot.closed) { snapshot.closed = true; snapshot.gap = true; if(!snapshot.submissionSeal || snapshot.submissionSeal.gap)gap(snapshot.jobId); }
            const ack = await deliver(snapshot);
            if (!ack?.persisted) continue;
            const p = live.get(snapshot.jobId);
            const current = p?.sourceEpoch === snapshot.sourceEpoch ? p : clone(all[k]);
            // Retain newer occurrences created while this snapshot was in flight.
            const ids = new Set(snapshot.events.map(e => e.eventId));
            current.events = current.events.filter(e => !ids.has(e.eventId));
            if (ack.close && !current.closed && canClose(snapshot.jobId)) current.closed = true;
            if (snapshot.sourceEpoch !== epoch) { current.closed = true; current.gap = true; }
            if (snapshot.closed && !current.events.length && snapshot.gap===current.gap && snapshot.watermark===current.watermark) {
              await storage.remove(k);
              if (p === current) {
                live.delete(current.jobId);damaged.delete(current.jobId);finishing.delete(current.jobId);
                for(const aliasKey of aliases.keys())if(aliasKey.startsWith(current.jobId+':'))aliases.delete(aliasKey);
              }
            }
            else await storage.set({ [k]: clone(current) });
          }
          return true;
        } catch { return false; }
      });
    }
    function gap(jobId) { try { if(id(jobId)){if(damaged.size<MAX_STREAMS)damaged.add(jobId);else prebindLoss=true;}const p=live.get(jobId);if(p){p.gap=true;if(p.submissionSeal)p.submissionSeal.gap=true;return persist(p);} } catch {} }
    return { bind, observe, sealSubmission, alias, drain, gap, flush: () => tail, epoch };
  }
  async function settle(pending, onGap, timeout=250) {
    let timer;
    const gap=()=>{try{const p=onGap?.();p?.catch?.(()=>{});}catch{}};
    try { await Promise.race([Promise.resolve(pending),new Promise(resolve=>{timer=setTimeout(()=>{gap();resolve();},timeout);})]); }
    catch {gap();}finally{clearTimeout(timer);}
  }
  const api = { create, settle, PREFIX, MAX_RECORDS, MAX_STREAMS, MAX_BYTES };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MuseExecutionAudit = api;
})(globalThis);
