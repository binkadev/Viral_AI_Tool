"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../services/generation/execution-audit'),W=require('../extensions/meta-muse-bridge/execution-audit');
const {memoryStorage,automaticFixture,projectFixture}=require('../dev/execution-audit-fixture');
const uuid=()=>crypto.randomUUID(),copy=v=>JSON.parse(JSON.stringify(v)),turn=()=>new Promise(r=>setImmediate(r));
const media={duration:1,width:160,height:90},bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]);
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-v2-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t){const audit=new A.ExecutionAudit(root(t)),job={id:uuid(),projectId:uuid(),sceneId:uuid(),provider:'muse',executionAudit:A.newMarker()};audit.admit(job);return {audit,job,epochs:{worker:uuid(),content:uuid()}};}
const evidence=()=>({evidenceKind:'receipt-v2',evidenceVersion:2,evidenceDigest:'a'.repeat(64)});
function packet(f,source,type,detail={},options={}){
 const sourceEpoch=f.epochs[source];return {version:2,jobId:f.job.id,auditId:f.job.executionAudit.auditId,source,sourceEpoch,watermark:type?1:0,closed:false,gap:false,
 events:type?[{eventId:uuid(),source,sourceEpoch,sourceSequence:1,type,detail}]:[],submissionSeal:null,...options};
}
function seal(p,extra={}){return {...p,submissionSeal:{scope:'submission',source:p.source,sourceEpoch:p.sourceEpoch,watermark:p.watermark,sealed:true,gap:p.gap,...extra}};}
function native(f,acceptance=true){f.audit.record(f.job,'submit.requested');if(acceptance)f.audit.record(f.job,'submit.acceptance_proven',evidence());assert(f.audit.sealSubmission(f.job));}
function ready(f,{acceptance=true,outcome='returned'}={}){
 native(f,acceptance);const worker=seal(packet(f,'worker','submit.committed')),content=seal(packet(f,'content','submit.invocation_observed',{outcome}));
 assert(f.audit.ingest(f.job,worker));assert(f.audit.ingest(f.job,content));return {worker,content};
}
const scope=f=>f.audit.report(f.job).scopes.submission;
function unknown(f){assert.notEqual(scope(f).state,'complete');for(const c of Object.values(scope(f).counters))assert.equal(c.total,null);}
test('prospective journal and marker are explicitly v2 with one bounded submission scope',t=>{const f=fixture(t),j=f.audit.read(f.job);assert.equal(j.version,2);assert.deepEqual(j.submission,{reasons:[],seals:[]});assert.equal(A.MAX_FILE_BYTES,128*1024);});
test('the exact 14-event vocabulary is unchanged',()=>assert.deepEqual(A.TYPES,['generation.admitted','submit.requested','submit.committed','submit.invocation_observed','submit.acceptance_proven','ownership.completed','acquisition.started','acquisition.completed','manual.session_opened','manual.candidate_revealed','manual.candidate_confirmed','output.published','project.attachment_reported','job.terminal']));

for(const label of ['17 interrupted','18 completed'])test('historical v1 '+label+' stays readable, unsealed and byte-identical',t=>{
 const f=fixture(t),packets=ready(f);if(label.startsWith('18')) {
   f.audit.record(f.job,'job.terminal',{status:'completed'},{close:true});
   f.audit.record(f.job,'project.attachment_reported',{outcome:'success',provenance:'renderer-reported',assetId:'generation:'+f.job.id,sourceId:'generation-source:'+f.job.id},{source:'renderer',close:true});
   for(const p of Object.values(packets))f.audit.ingest(f.job,{...p,closed:true});
 }
 const j=f.audit.read(f.job);j.version=1;delete j.submission;f.job.executionAudit.version=1;fs.writeFileSync(f.audit.file(f.job),JSON.stringify(j));const before=fs.readFileSync(f.audit.file(f.job));
 assert.equal(f.audit.report(f.job).version,1);assert.equal(f.audit.report(f.job).coverage.state,label.startsWith('18')?'complete':'partial');assert.equal(scope(f).state,'not_recorded');unknown(f);
 assert.equal(f.audit.record(f.job,'submit.requested'),false);assert.equal(f.audit.sealSubmission(f.job),false);assert.equal(f.audit.ingest(f.job,packet(f,'worker')),false);f.audit.damage(f.job,'integrity');f.audit.admit(f.job);
 assert.deepEqual(fs.readFileSync(f.audit.file(f.job)),before);f.job.executionAudit.version=2;assert.equal(f.audit.report(f.job).coverage.state,'unavailable');assert.deepEqual(fs.readFileSync(f.audit.file(f.job)),before);
});
test('v1 metadata cannot carry inferred or explicit v2 seals',t=>{const f=fixture(t),j=f.audit.read(f.job);j.version=1;f.job.executionAudit.version=1;fs.writeFileSync(f.audit.file(f.job),JSON.stringify(j));assert.equal(f.audit.report(f.job).coverage.state,'unavailable');assert.equal(scope(f).state,'not_recorded');});
test('native matching epoch/cursor checkpoint is accepted',t=>{const f=fixture(t);native(f);const s=scope(f).seals[0];assert.equal(s.source,'native');assert.equal(s.sourceEpoch,f.audit.epoch);assert.equal(s.watermark,3);unknown(f);});
for(const source of ['worker','content'])test(source+' matching checkpoint is accepted',t=>{const f=fixture(t),p=seal(packet(f,source));assert(f.audit.ingest(f.job,p));assert.equal(scope(f).seals[0].source,source);unknown(f);});
test('renderer cannot seal submission',t=>{const f=fixture(t),p=seal(packet(f,'worker'));p.source='renderer';p.submissionSeal.source='renderer';assert.equal(f.audit.ingest(f.job,p),false);unknown(f);});
test('scope stays incomplete until all three producers seal, even with all four facts',t=>{const f=fixture(t);native(f);assert(f.audit.ingest(f.job,packet(f,'worker','submit.committed')));assert(f.audit.ingest(f.job,packet(f,'content','submit.invocation_observed',{outcome:'returned'})));unknown(f);});
test('interrupted lifecycle stays globally partial while sealed submission is complete',t=>{const f=fixture(t);ready(f);const r=f.audit.report(f.job);assert.equal(r.coverage.state,'partial');assert.equal(scope(f).state,'complete');for(const c of Object.values(scope(f).counters))assert.deepEqual(c,{recorded:1,total:1});assert.equal(r.counters['ownership.completed'].total,null);assert(!r.events.some(e=>e.type==='job.terminal'));assert(r.streams.every(s=>!s.closed));});
test('complete describes exact counts and accepts acceptance_proven zero',t=>{const f=fixture(t);ready(f,{acceptance:false});assert.equal(scope(f).state,'complete');assert.deepEqual(scope(f).counters['submit.acceptance_proven'],{recorded:0,total:0});});
test('unavailable journals report null scoped totals',t=>{const f=fixture(t);fs.writeFileSync(f.audit.file(f.job),'{bad');assert.equal(scope(f).state,'unavailable');unknown(f);});
test('missing journal and timeout cannot prove a scope',t=>{const f=fixture(t);fs.unlinkSync(f.audit.file(f.job));unknown(f);});
test('missing worker producer remains partial',t=>{const f=fixture(t);native(f);f.audit.ingest(f.job,seal(packet(f,'content')));unknown(f);});
test('sequence loss through declared checkpoint prevents completeness',t=>{const f=fixture(t);native(f);const p=packet(f,'content','submit.invocation_observed',{outcome:'returned'});p.events[0].sourceSequence=2;p.watermark=2;assert(f.audit.ingest(f.job,seal(p)));f.audit.ingest(f.job,seal(packet(f,'worker')));unknown(f);});
test('seal ahead of durable reported events cannot prove completeness',t=>{const f=fixture(t);native(f);const p=seal(packet(f,'content'));p.watermark=1;p.submissionSeal.watermark=1;assert.equal(f.audit.ingest(f.job,p),false);unknown(f);});
test('unclosed prior source epoch invalidates scoped coverage',t=>{const f=fixture(t);f.audit.ingest(f.job,packet(f,'content'));f.epochs.content=uuid();ready(f);unknown(f);});
test('native restart without its producer seal cannot invent a seal',t=>{const f=fixture(t);f.audit=new A.ExecutionAudit(path.dirname(f.audit.root));assert.equal(f.audit.sealSubmission(f.job),false);unknown(f);});
test('sealed submission survives native restart without invented facts',t=>{const f=fixture(t);ready(f);const before=scope(f);f.audit=new A.ExecutionAudit(path.dirname(f.audit.root));assert.equal(scope(f).state,'complete');assert.deepEqual(scope(f).counters,before.counters);assert.equal(f.audit.report(f.job).coverage.state,'partial');});
test('identical seal redelivery is idempotent',t=>{const f=fixture(t),p=ready(f).content,before=scope(f);assert(f.audit.ingest(f.job,p));assert.deepEqual(scope(f),before);});
test('conflicting seal damages scope and exact totals become unknown',t=>{const f=fixture(t),p=ready(f).content;p.submissionSeal.gap=true;assert.equal(f.audit.ingest(f.job,p),false);unknown(f);assert(scope(f).reasons.includes('seal_conflict'));});
for(const field of ['auditId','jobId','sourceEpoch','scope','extra','watermark'])test('strict wire rejects invalid seal '+field,t=>{
 const f=fixture(t),p=seal(packet(f,'content','submit.invocation_observed',{outcome:'returned'}));
 if(field==='auditId'||field==='jobId')p[field]=uuid();else if(field==='sourceEpoch')p.submissionSeal.sourceEpoch=uuid();else if(field==='scope')p.submissionSeal.scope='ownership';else if(field==='extra')p.submissionSeal.secret='forbidden';else p.submissionSeal.watermark=0;
 assert.equal(f.audit.ingest(f.job,p),false);unknown(f);
});
test('v1 packet cannot forge a v2 scoped seal',t=>{const f=fixture(t),p=seal(packet(f,'worker'));p.version=1;assert.equal(f.audit.ingest(f.job,p),false);unknown(f);});
for(const type of A.SUBMISSION)test('late '+type+' damages coverage without provider authority',t=>{
 const f=fixture(t),p=ready(f);if(type==='submit.requested'||type==='submit.acceptance_proven')f.audit.record(f.job,type,type==='submit.requested'?{}:evidence());
 else {const q=copy(type==='submit.committed'?p.worker:p.content);q.events=[{...q.events[0],eventId:uuid(),sourceSequence:2}];q.watermark=2;f.audit.ingest(f.job,q);}
 unknown(f);assert(scope(f).reasons.includes('late_occurrence'));assert.equal(typeof f.audit.submit,'undefined');
});
test('duplicate occurrence ID remains idempotent after sealing',t=>{const f=fixture(t),p=ready(f).content;assert(f.audit.ingest(f.job,p));assert.equal(scope(f).state,'complete');assert.equal(scope(f).counters['submit.invocation_observed'].total,1);});
test('conflicting occurrence ID keeps original and damages scoped coverage',t=>{const f=fixture(t),p=ready(f).content;p.events[0].detail.outcome='threw_unknown';assert.equal(f.audit.ingest(f.job,p),false);unknown(f);assert.equal(scope(f).counters['submit.invocation_observed'].recorded,1);});
for(const outcome of ['returned','threw_unknown'])test('invocation outcome '+outcome+' has exact scoped dimension totals',t=>{const f=fixture(t);ready(f,{outcome});assert.equal(scope(f).dimensions['submit.invocation_observed.'+outcome].total,1);assert.equal(scope(f).dimensions['submit.invocation_observed.'+(outcome==='returned'?'threw_unknown':'returned')].total,0);});

test('manual session, reveal and confirmation continue on same job without reopening submission',t=>{
 const f=fixture(t),p=ready(f),before=scope(f).counters;
 for(const [type,detail] of [['manual.session_opened',{sessionAlias:uuid()}],['manual.candidate_revealed',{sessionAlias:uuid(),candidateAlias:uuid()}]]) {
   const last=p.content.events.at(-1),e={...last,eventId:uuid(),sourceSequence:last.sourceSequence+1,type,detail};p.content.events.push(e);p.content.watermark=e.sourceSequence;assert(f.audit.ingest(f.job,p.content));assert.equal(scope(f).state,'complete');assert.deepEqual(scope(f).counters,before);
 }
 f.audit.record(f.job,'manual.candidate_confirmed',{resolutionId:uuid()});assert.equal(scope(f).state,'complete');assert.deepEqual(scope(f).counters,before);
 assert.equal(f.audit.report(f.job).counters['manual.candidate_confirmed'].recorded,1);
});
for(const type of ['ownership.completed','acquisition.started','acquisition.completed','output.published','project.attachment_reported','job.terminal'])test(type+' cannot extend scoped submission counts',t=>{
 const f=fixture(t);ready(f);const before=scope(f).counters;
 const detail=type==='ownership.completed'?evidence():type.startsWith('acquisition.')?{mode:'automatic',transferId:uuid()}:type==='output.published'?{mode:'automatic',fileName:f.job.id+'.mp4',size:12,sha256:'a'.repeat(64),duration:1,width:160,height:90}:type==='job.terminal'?{status:'completed'}:{outcome:'success',provenance:'renderer-reported',assetId:'generation:'+f.job.id,sourceId:'generation-source:'+f.job.id};
 assert(f.audit.record(f.job,type,detail,{source:type==='project.attachment_reported'?'renderer':'native'}));assert.equal(scope(f).state,'complete');assert.deepEqual(scope(f).counters,before);
});
test('whole-job closure may become complete with identical submission counts',t=>{
 const f=fixture(t),p=ready(f),before=scope(f).counters;f.audit.record(f.job,'job.terminal',{status:'completed'},{close:true});
 f.audit.record(f.job,'project.attachment_reported',{outcome:'success',provenance:'renderer-reported',assetId:'generation:'+f.job.id,sourceId:'generation-source:'+f.job.id},{source:'renderer',close:true});
 for(const q of Object.values(p))assert(f.audit.ingest(f.job,{...q,closed:true}));assert.equal(f.audit.report(f.job).coverage.state,'complete');assert.deepEqual(scope(f).counters,before);
});

for(const source of ['worker','content'])for(const fault of ['pre-bind overflow','storage failure','pending persistence','restart loss','timeout'])test(source+' '+fault+' cannot certify submission',async t=>{
 const f=fixture(t);native(f);const storage=memoryStorage(),w=W.create({storage,source}),type=source==='worker'?'submit.committed':'submit.invocation_observed',detail=source==='worker'?{}:{outcome:'returned'},binding={version:2,jobId:f.job.id,auditId:f.job.executionAudit.auditId};
 let release;const hold=new Promise(r=>release=r);t.after(()=>release());
 if(fault==='pre-bind overflow')for(let i=0;i<W.MAX_RECORDS+1;i++)w.observe(f.job.id,type,detail);
 if(fault==='storage failure')storage.set=async()=>{throw Error('quota');};
 if(fault==='pending persistence') {const set=storage.set;storage.set=async p=>{if(Object.values(p).some(v=>v.submissionSeal))await hold;return set(p);};}
 if(fault==='restart loss') {w.observe(f.job.id,type,detail);await W.create({storage,source}).drain(p=>({persisted:f.audit.ingest(f.job,p)}));unknown(f);return;}
 await w.bind(binding);if(fault!=='pre-bind overflow')w.observe(f.job.id,type,detail);
 if(fault==='timeout'){await W.settle(new Promise(()=>{}),()=>w.gap(f.job.id),1);}w.sealSubmission(f.job.id);
 if(fault!=='pending persistence')await w.drain(p=>({persisted:f.audit.ingest(f.job,p)}));else await turn();
 const other=source==='worker'?'content':'worker';f.audit.ingest(f.job,seal(packet(f,other)));unknown(f);
 release();await w.flush();
});
test('native checkpoint storage failure cannot certify coverage',t=>{const f=fixture(t),write=f.audit.write;f.audit.write=()=>{throw Error('disk');};assert.equal(f.audit.sealSubmission(f.job),false);f.audit.write=write;unknown(f);});
test('failed persistence of a late native occurrence cannot preserve a stale exact total',t=>{const f=fixture(t);ready(f);f.audit.write=()=>{throw Error('disk');};assert.equal(f.audit.record(f.job,'submit.requested'),false);unknown(f);assert(scope(f).reasons.includes('write_failed'));});
test('seal requested before delayed bind checkpoints all queued witnesses',async t=>{
 const f=fixture(t);native(f);const storage=memoryStorage(),w=W.create({storage,source:'content'});w.observe(f.job.id,'submit.invocation_observed',{outcome:'returned'});w.sealSubmission(f.job.id);
 await w.bind({version:2,jobId:f.job.id,auditId:f.job.executionAudit.auditId});await w.flush();await w.drain(p=>({persisted:f.audit.ingest(f.job,p)}));f.audit.ingest(f.job,seal(packet(f,'worker','submit.committed')));assert.equal(scope(f).state,'complete');assert.equal(scope(f).counters['submit.invocation_observed'].total,1);
});
test('late pre-bind occurrence after producer finish damages scoped proof',async t=>{const f=fixture(t);native(f);const w=W.create({storage:memoryStorage(),source:'content'});w.sealSubmission(f.job.id);w.observe(f.job.id,'submit.invocation_observed',{outcome:'returned'});await w.bind({version:2,jobId:f.job.id,auditId:f.job.executionAudit.auditId});await w.drain(p=>({persisted:f.audit.ingest(f.job,p)}));f.audit.ingest(f.job,seal(packet(f,'worker')));unknown(f);});
test('late producer event cannot be hidden by a failed checkpoint over a clean disk image',async t=>{
 const f=fixture(t);native(f);const storage=memoryStorage(),w=W.create({storage,source:'content'});await w.bind({version:2,jobId:f.job.id,auditId:f.job.executionAudit.auditId});w.observe(f.job.id,'submit.invocation_observed',{outcome:'returned'});await w.sealSubmission(f.job.id);f.audit.ingest(f.job,seal(packet(f,'worker')));await w.drain(p=>({persisted:f.audit.ingest(f.job,p)}));assert.equal(scope(f).state,'complete');
 storage.set=async()=>{throw Error('quota');};await w.observe(f.job.id,'submit.invocation_observed',{outcome:'returned'});await w.drain(p=>({persisted:f.audit.ingest(f.job,p)}));unknown(f);
});

async function auto(t,options={}){const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media,...options});t.after(()=>f.close());return f;}
async function complete(f){let j=await f.admit();for(let i=0;i<6&&j.status!=='completed';i++)j=await f.service.recover(j.id);assert.equal(j.status,'completed');await turn();await f.drain();return j;}
for(const source of ['native','worker','content'])for(const failure of ['unresolved','rejected'])test(source+' seal '+failure+' never gates intent, click, ownership, acquisition or job state',async t=>{
 const f=await auto(t),audit=source==='native'?f.service.executionJournal:source==='worker'?f.workerAudit:f.content.audit;let release,called=false;const hold=new Promise(r=>release=r);t.after(()=>release());
 audit.sealSubmission=()=>{called=true;return failure==='unresolved'?hold:Promise.reject(Error('seal storage'));};
 const j=await complete(f);assert(called);assert.equal(f.content.clicks,1);assert.equal(f.calls.filter(c=>c==='submitGeneration').length,1);assert.equal(f.storage.data['generation-intent:'+j.id].invoked,true);assert.equal(f.fetches,1);assert.equal(f.service.get(j.id).status,'completed');
 const record=JSON.parse(fs.readFileSync(path.join(f.service.root,'outputs',j.id,'muse-operation.json')));assert(require('../extensions/meta-muse-bridge/receipt-v2').valid(record.receipt,j.id));assert(record.receipt.result);assert(record.verifiedOutput);assert.notEqual(f.service.executionAuditReport(j.id).scopes.submission.state,'complete');
});
for(const source of ['worker','content'])test(source+' actual seal storage pending cannot delay execution delivery',async t=>{
 const f=await auto(t),set=f.storage.set;let release,entered=false;const hold=new Promise(r=>release=r);t.after(()=>release());
 f.storage.set=async values=>{if(Object.values(values).some(p=>p.source===source&&p.submissionSeal)){entered=true;await hold;}return set(values);};
 let j=await f.admit();for(let i=0;i<6&&j.status!=='completed';i++)j=await f.service.recover(j.id);assert.equal(j.status,'completed');await turn();assert(entered);assert.equal(f.content.clicks,1);assert.equal(f.fetches,1);release();await f.drain();
});
test('real prospective automatic job has complete global/scope coverage and canonical Project attachment',async t=>{const f=await auto(t),j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);await f.drain();const r=f.service.executionAuditReport(j.id);assert.equal(r.coverage.state,'complete');assert.equal(r.scopes.submission.state,'complete');for(const c of Object.values(r.scopes.submission.counters))assert.equal(c.total,1);assert.equal(p.persisted().media.assets.length,1);for(const type of A.TYPES.filter(t=>t.startsWith('manual.')))assert.equal(r.counters[type].total,0);});
test('real Gate-D interaction interruption after Gate C keeps submission exact and acquisition absent',async t=>{const f=await auto(t),j=await f.admit();f.content.foreign('click');const stopped=await f.service.recover(j.id);assert.equal(stopped.status,'interrupted');await turn();await f.drain();const r=f.service.executionAuditReport(j.id);assert.equal(r.coverage.state,'partial');assert.equal(r.scopes.submission.state,'complete');for(const c of Object.values(r.scopes.submission.counters))assert.equal(c.total,1);assert.equal(r.counters['ownership.completed'].total,null);assert.equal(r.counters['acquisition.started'].recorded,0);assert.equal(f.fetches,0);assert.equal(stopped.manualRecovery.eligible,true);});
for(const fault of ['lostSubmit','clickThrows'])test('real '+fault+' seals exact submission with acceptance zero and no authority promotion',async t=>{
 const f=await auto(t,{[fault]:true}),j=await f.admit();assert.equal(j.status,'interrupted');await turn();await f.drain();const r=f.service.executionAuditReport(j.id),s=r.scopes.submission;
 assert.equal(s.state,'complete');assert.equal(s.counters['submit.requested'].total,1);assert.equal(s.counters['submit.committed'].total,1);assert.equal(s.counters['submit.invocation_observed'].total,1);assert.equal(s.counters['submit.acceptance_proven'].total,0);assert.equal(s.dimensions['submit.invocation_observed.'+(fault==='clickThrows'?'threw_unknown':'returned')].total,1);assert.equal(f.content.clicks,1);assert.equal(f.fetches,0);assert.equal(r.counters['ownership.completed'].recorded,0);
});
test('final fresh validation to click still has zero awaits and zero seal calls',()=>{const s=fs.readFileSync('extensions/meta-muse-bridge/content-script.js','utf8'),start=s.indexOf('const current=composer();',s.indexOf("invocation.reason='composer-changed'")),end=s.indexOf('button.click()',start);assert(start>=0&&end>start);assert(!/\bawait\b|sealSubmission/.test(s.slice(start,end)));});
