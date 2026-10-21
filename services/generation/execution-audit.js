"use strict";
// Local forensic observations only. No execution authority is exported here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VERSION = 1, MAX_EVENTS = 256, MAX_FILE_BYTES = 128 * 1024;
const TYPES = Object.freeze([
  'generation.admitted', 'submit.requested', 'submit.committed', 'submit.invocation_observed',
  'submit.acceptance_proven', 'ownership.completed', 'acquisition.started', 'acquisition.completed',
  'manual.session_opened', 'manual.candidate_revealed', 'manual.candidate_confirmed',
  'output.published', 'project.attachment_reported', 'job.terminal'
]);
const SOURCES = ['native', 'worker', 'content', 'renderer'];
const REASONS = ['write_failed', 'capacity', 'sequence_gap', 'epoch_unclosed', 'integrity', 'unsupported_observers'];
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = v => Number.isSafeInteger(v) && v >= 0;
const mode = v => ['automatic', 'user-confirmed'].includes(v);
const utc = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value && typeof value === 'object' ?
  Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function marker(value) {
  if (!exact(value, ['version', 'auditId']) || value.version !== VERSION || !uuid(value.auditId)) throw Error('Invalid audit marker');
  return { version: VERSION, auditId: value.auditId };
}
function persistedMarker(value) {
  // Invalid optional telemetry must not reject an otherwise valid job store.
  // Keep presence distinct from historical absence without retaining unsafe data.
  try { return marker(value); } catch { return { version: VERSION, auditId: null }; }
}
function newMarker() {
  try { return { version: VERSION, auditId: crypto.randomUUID() }; }
  catch { return { version: VERSION, auditId: null }; }
}
function validDetail(type, d, jobId) {
  switch (type) {
    case 'generation.admitted': case 'submit.requested': case 'submit.committed': return exact(d, []);
    case 'submit.invocation_observed': return exact(d, ['outcome']) && ['returned', 'threw_unknown'].includes(d.outcome);
    case 'submit.acceptance_proven': case 'ownership.completed':
      return exact(d, ['evidenceKind', 'evidenceVersion', 'evidenceDigest']) && d.evidenceKind === 'receipt-v2' && d.evidenceVersion === 2 && sha(d.evidenceDigest);
    case 'acquisition.started': case 'acquisition.completed':
      return exact(d, ['mode', 'transferId']) && mode(d.mode) && uuid(d.transferId);
    case 'manual.session_opened': return exact(d, ['sessionAlias']) && uuid(d.sessionAlias);
    case 'manual.candidate_revealed': return exact(d, ['sessionAlias', 'candidateAlias']) && uuid(d.sessionAlias) && uuid(d.candidateAlias);
    case 'manual.candidate_confirmed': return exact(d, ['resolutionId']) && uuid(d.resolutionId);
    case 'output.published':
      return exact(d, ['mode', 'fileName', 'size', 'sha256', 'duration', 'width', 'height']) && mode(d.mode) &&
        d.fileName === jobId + '.mp4' && uuid(jobId) && integer(d.size) && d.size >= 12 && sha(d.sha256) &&
        Number.isFinite(d.duration) && d.duration > 0 && d.duration <= 86400 &&
        [d.width, d.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 32768);
    case 'project.attachment_reported':
      return exact(d, ['outcome', 'provenance', 'assetId', 'sourceId']) && ['success', 'failure'].includes(d.outcome) &&
        d.provenance === 'renderer-reported' && d.assetId === 'generation:' + jobId && d.sourceId === 'generation-source:' + jobId;
    case 'job.terminal': return exact(d, ['status']) && ['completed', 'failed', 'cancelled'].includes(d.status);
    default: return false;
  }
}
const sourceTypes = {
  native: TYPES.filter(t => !['submit.committed', 'submit.invocation_observed', 'manual.session_opened', 'manual.candidate_revealed', 'project.attachment_reported'].includes(t)),
  worker: ['submit.committed'], content: ['submit.invocation_observed', 'manual.session_opened', 'manual.candidate_revealed'],
  renderer: ['project.attachment_reported']
};
function validOccurrence(e, jobId) {
  return exact(e, ['eventId', 'source', 'sourceEpoch', 'sourceSequence', 'type', 'detail']) && uuid(e.eventId) &&
    SOURCES.includes(e.source) && uuid(e.sourceEpoch) && integer(e.sourceSequence) && e.sourceSequence > 0 &&
    sourceTypes[e.source].includes(e.type) && validDetail(e.type, e.detail, jobId);
}
function validate(j, job) {
  if (!exact(j, ['version', 'auditId', 'jobId', 'operationId', 'projectId', 'sceneId', 'provider', 'coverage', 'streams', 'events']) ||
      j.version !== VERSION || j.auditId !== marker(job.executionAudit).auditId || j.jobId !== job.id || j.operationId !== job.id ||
      j.projectId !== job.projectId || j.sceneId !== (job.sceneId || null) || j.provider !== job.provider ||
      !exact(j.coverage, ['state', 'reasons']) || !['complete', 'partial', 'unavailable'].includes(j.coverage.state) ||
      !Array.isArray(j.coverage.reasons) || j.coverage.reasons.length > REASONS.length || j.coverage.reasons.some(r => !REASONS.includes(r)) ||
      !Array.isArray(j.streams) || j.streams.length > 16 || !Array.isArray(j.events) || j.events.length > MAX_EVENTS) throw Error('Invalid audit journal');
  const streams = new Set(), events = new Set();
  for (const s of j.streams) {
    if (!exact(s, ['source', 'sourceEpoch', 'lastSequence', 'watermark', 'closed', 'gap']) || !SOURCES.includes(s.source) || !uuid(s.sourceEpoch) ||
        !integer(s.lastSequence) || !integer(s.watermark) || s.watermark < s.lastSequence || typeof s.closed !== 'boolean' || typeof s.gap !== 'boolean' ||
        streams.has(s.source + s.sourceEpoch)) throw Error('Invalid audit stream');
    streams.add(s.source + s.sourceEpoch);
  }
  const seen = new Map();
  for (const [index, e] of j.events.entries()) {
    const { sequence, recordedAt, ...occurrence } = e;
    if (!exact(e, ['sequence', 'recordedAt', 'eventId', 'source', 'sourceEpoch', 'sourceSequence', 'type', 'detail']) || sequence !== index + 1 ||
        !utc(recordedAt) || !validOccurrence(occurrence, job.id) || events.has(e.eventId) || !streams.has(e.source + e.sourceEpoch)) throw Error('Invalid audit event');
    const key = e.source + e.sourceEpoch, previous = seen.get(key) || 0;
    if (e.sourceSequence <= previous) throw Error('Invalid audit order');
    seen.set(key, e.sourceSequence); events.add(e.eventId);
  }
  for (const s of j.streams) if (s.lastSequence !== (seen.get(s.source + s.sourceEpoch) || 0)) throw Error('Invalid audit cursor');
  return j;
}
function safeObserve(c, type, detail = {}, options) {
  try { const result = c?.audit?.(type, detail, options); if (result?.catch) result.catch(() => {try{c?.auditGap?.();}catch{}}); }
  catch {try{c?.auditGap?.();}catch{}}
}
function observerContext(audit, job) {
  try {
    if (!job.executionAudit) return {};
    return { executionAudit: marker(job.executionAudit), audit: (type, detail, options) => {
      try { return audit.record(job, type, detail, options); } catch { try{audit.damage(job,'write_failed');}catch{} return false; }
    }, auditGap: () => {try{audit.damage(job,'write_failed');}catch{}} };
  } catch { return {}; }
}
class ExecutionAudit {
  constructor(root, { io = fs } = {}) {
    this.root = path.join(root, 'audit'); this.io = io;
    try {this.epoch = crypto.randomUUID();} catch {this.epoch = null;}
    this.damaged = new Set();
  }
  file(job) { if (!uuid(job.id)) throw Error('Invalid audit job'); return path.join(this.root, job.id + '.json'); }
  read(job) {
    const file = this.file(job), stat = this.io.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw Error('Invalid audit file');
    return validate(JSON.parse(this.io.readFileSync(file, 'utf8')), job);
  }
  write(job, j) {
    validate(j, job);
    const bytes = Buffer.from(JSON.stringify(j)); if (bytes.length > MAX_FILE_BYTES) throw Error('Audit capacity');
    const dir = this.root;
    this.io.mkdirSync(dir, { recursive: true });
    // Refuse junction/symlink ancestors and occupied unsafe targets.
    let ancestor = dir;
    while (true) { const s = this.io.lstatSync(ancestor); if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsafe audit directory'); const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent; }
    const file = this.file(job);
    if (this.io.existsSync(file)) { const s = this.io.lstatSync(file); if (!s.isFile() || s.isSymbolicLink()) throw Error('Unsafe audit target'); }
    const temp = file + '.' + crypto.randomUUID() + '.tmp'; let fd;
    try {
      fd = this.io.openSync(temp, 'wx', 0o600); this.io.writeFileSync(fd, bytes); this.io.fsyncSync(fd); this.io.closeSync(fd); fd = undefined;
      this.io.renameSync(temp, file);
    } finally { if (fd !== undefined) try { this.io.closeSync(fd); } catch {} try { this.io.unlinkSync(temp); } catch {} }
  }
  damage(job, reason) {
    this.damaged.add(job.id);
    try { const j = this.read(job); this.gap(j, reason); this.write(job, j); } catch {}
  }
  gap(j, reason) { if (!j.coverage.reasons.includes(reason)) j.coverage.reasons.push(reason); j.coverage.state = 'partial'; }
  coverage(j) {
    const required = ['native', ...(j.provider === 'muse' ? ['worker', 'content'] : [])];
    const completed = j.events.some(e => e.type === 'job.terminal' && e.detail.status === 'completed');
    if (completed) required.push('renderer');
    const closed = required.every(source => j.streams.some(s => s.source === source) && j.streams.filter(s => s.source === source).every(s => s.closed && !s.gap && s.watermark === s.lastSequence));
    j.coverage.state = !j.coverage.reasons.length && closed && j.events.some(e => e.type === 'job.terminal') ? 'complete' : 'partial';
  }
  admit(job) {
    if (!job.executionAudit) return;
    try {
      marker(job.executionAudit);
      if (this.io.existsSync(this.file(job))) throw Error('Audit admission collision');
      const j = { version: VERSION, auditId: job.executionAudit.auditId, jobId: job.id, operationId: job.id, projectId: job.projectId,
        sceneId: job.sceneId || null, provider: job.provider, coverage: { state: 'partial', reasons: job.provider === 'muse' ? [] : ['unsupported_observers'] }, streams: [], events: [] };
      this.write(job, j); this.record(job, 'generation.admitted');
    } catch { this.damage(job, 'write_failed'); }
  }
  stream(j, source, epoch) {
    let s = j.streams.find(s => s.source === source && s.sourceEpoch === epoch);
    if (!s) {
      if (j.streams.length >= 16) { this.gap(j, 'capacity'); return null; }
      if (j.streams.some(s => s.source === source && !s.closed)) this.gap(j, 'epoch_unclosed');
      s = { source, sourceEpoch: epoch, lastSequence: 0, watermark: 0, closed: false, gap: false }; j.streams.push(s);
    }
    return s;
  }
  append(j, occurrence) {
    if (!validOccurrence(occurrence, j.jobId)) { this.gap(j, 'integrity'); return false; }
    const old = j.events.find(e => e.eventId === occurrence.eventId);
    if (old) {
      const { sequence, recordedAt, ...original } = old;
      if (canonical(original) !== canonical(occurrence)) { this.gap(j, 'integrity'); return false; }
      return true;
    }
    const s = this.stream(j, occurrence.source, occurrence.sourceEpoch); if (!s) return false;
    if (s.closed || occurrence.sourceSequence <= s.lastSequence) { this.gap(j, 'integrity'); return false; }
    if (occurrence.sourceSequence !== s.lastSequence + 1) { s.gap = true; this.gap(j, 'sequence_gap'); }
    if (j.events.length >= MAX_EVENTS || Buffer.byteLength(JSON.stringify(j)) + Buffer.byteLength(JSON.stringify(occurrence)) + 512 > MAX_FILE_BYTES - 2048) {
      s.gap = true; this.gap(j, 'capacity'); return false;
    }
    s.lastSequence = occurrence.sourceSequence; s.watermark = Math.max(s.watermark, s.lastSequence);
    j.events.push({ sequence: j.events.length + 1, recordedAt: new Date().toISOString(), ...clone(occurrence) }); return true;
  }
  record(job, type, detail = {}, { eventId = crypto.randomUUID(), source = 'native', close = false } = {}) {
    if (!job.executionAudit) return false;
    try {
      const j = this.read(job);
      if (this.damaged.has(job.id)) this.gap(j, 'write_failed');
      // Event redelivery uses its original source cursor, not a fresh sequence.
      const existing = j.events.find(e => e.eventId === eventId);
      const s = this.stream(j, source, this.epoch); if (!s) { this.write(job, j); return false; }
      const ok = this.append(j, { eventId, source, sourceEpoch: existing?.sourceEpoch || this.epoch,
        sourceSequence: existing?.sourceSequence || s.lastSequence + 1, type, detail });
      if (close && ok) s.closed = true;
      this.coverage(j); this.write(job, j); return ok;
    } catch { this.damage(job, 'write_failed'); return false; }
  }
  ingest(job, packet) {
    if (!job.executionAudit) return false;
    try {
      if (!exact(packet, ['version', 'jobId', 'auditId', 'source', 'sourceEpoch', 'watermark', 'closed', 'gap', 'events']) || packet.version !== VERSION ||
          packet.jobId !== job.id || packet.auditId !== job.executionAudit.auditId || !['worker', 'content'].includes(packet.source) || !uuid(packet.sourceEpoch) ||
          !integer(packet.watermark) || typeof packet.closed !== 'boolean' || typeof packet.gap !== 'boolean' || !Array.isArray(packet.events) || packet.events.length > 32 ||
          Buffer.byteLength(JSON.stringify(packet)) > 24576 || packet.events.some(e => !validOccurrence(e, job.id) || e.source !== packet.source || e.sourceEpoch !== packet.sourceEpoch || e.sourceSequence > packet.watermark)) {
        this.damage(job, 'integrity'); return false;
      }
      const j = this.read(job), s = this.stream(j, packet.source, packet.sourceEpoch); if (!s) { this.write(job, j); return false; }
      let ok = true;
      for (const e of packet.events) if (!this.append(j, e)) ok = false;
      if (packet.closed && packet.watermark !== s.lastSequence || packet.gap) { s.gap = true; this.gap(j, 'sequence_gap'); }
      s.watermark = Math.max(s.watermark, packet.watermark); s.closed ||= packet.closed;
      if (this.damaged.has(job.id)) this.gap(j, 'write_failed');
      this.coverage(j); this.write(job, j); return ok;
    } catch { this.damage(job, 'write_failed'); return false; }
  }
  report(job) {
    if (!job.executionAudit) return { version: VERSION, coverage: { state: 'not_recorded' }, counters: null, events: [] };
    try {
      const j = this.read(job);
      if (this.damaged.has(job.id)) this.gap(j, 'write_failed');
      if (j.streams.some(s => ['native', 'renderer'].includes(s.source) && s.sourceEpoch !== this.epoch && !s.closed)) this.gap(j, 'epoch_unclosed');
      this.coverage(j);
      const counts = Object.fromEntries(TYPES.map(t => [t, 0]));
      for (const e of j.events) counts[e.type]++;
      const counters = Object.fromEntries(Object.entries(counts).map(([type, recorded]) => [type, { recorded, total: j.coverage.state === 'complete' ? recorded : null }]));
      const dimensions = Object.fromEntries([
        ...['returned','threw_unknown'].map(v=>'submit.invocation_observed.'+v),
        ...['acquisition.started','acquisition.completed','output.published'].flatMap(t=>['automatic','user-confirmed'].map(v=>t+'.'+v)),
        ...['success','failure'].map(v=>'project.attachment_reported.'+v),
        ...['completed','failed','cancelled'].map(v=>'job.terminal.'+v)
      ].map(k=>[k,0]));
      for (const e of j.events) {
        const suffix = e.detail.outcome || e.detail.mode || e.detail.status;
        if (suffix) { const key = e.type + '.' + suffix; dimensions[key] = (dimensions[key] || 0) + 1; }
      }
      const dimensionCounts=Object.fromEntries(Object.entries(dimensions).map(([k,recorded])=>[k,{recorded,total:j.coverage.state==='complete'?recorded:null}]));
      return { version: VERSION, auditId: j.auditId, coverage: clone(j.coverage), counters, dimensions: dimensionCounts,
        dimensionTotalsKnown: j.coverage.state === 'complete', streams: clone(j.streams), events: clone(j.events), attachmentCorroboration: 'persisted-registry-check-required' };
    } catch { return { version: VERSION, coverage: { state: 'unavailable' }, counters: null, events: [] }; }
  }
}
module.exports = { ExecutionAudit, VERSION, MAX_EVENTS, MAX_FILE_BYTES, TYPES, marker, persistedMarker, newMarker, validOccurrence, validDetail, safeObserve, observerContext, digest, uuid };
