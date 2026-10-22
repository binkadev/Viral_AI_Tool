"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../services/generation/execution-audit');
const W=require('../extensions/meta-muse-bridge/execution-audit');
const {memoryStorage,automaticFixture,projectFixture,contentFixture}=require('../dev/execution-audit-fixture');
const {GenerationService}=require('../services/generation/generation-service');
const {GenerationStore}=require('../services/generation/generation-store');
const {ProviderRegistry}=require('../services/generation/provider-registry');
const {createJob}=require('../services/generation/generation-job');
const {normalizeRequest}=require('../services/generation/generation-request');
const uuid=()=>crypto.randomUUID(),json=v=>JSON.parse(JSON.stringify(v));
function deferred(){let resolve,reject;const d={settled:false};d.promise=new Promise((yes,no)=>{resolve=yes;reject=no;});d.resolve=v=>{d.settled=true;resolve(v);};d.reject=e=>{d.settled=true;reject(e);};return d;}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const media={duration:1,width:160,height:90};
const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]);
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'execution-audit-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function job(){const request=normalizeRequest({projectId:uuid(),sceneId:uuid(),providerId:'muse',idempotencyKey:uuid(),prompt:'SECRET PRIVATE PROMPT'});
 return {...createJob(request,{model:{id:null,provider:'muse'},estimate:{}},null),executionAudit:{version:1,auditId:uuid()}};}
function fixture(t,options){const j=job(),audit=new A.ExecutionAudit(root(t),options);audit.admit(j);return {job:j,audit,file:audit.file(j)};}
function packet(j,source='content',events=[],options={}){return {version:1,jobId:j.id,auditId:j.executionAudit.auditId,source,sourceEpoch:uuid(),watermark:events.length,closed:false,gap:false,events,...options};}
function occurrence(source,sourceEpoch,sourceSequence,type,detail={}){return {eventId:uuid(),source,sourceEpoch,sourceSequence,type,detail};}
async function admissionService(t){const registry=new ProviderRegistry();registry.register({id:'muse',modelIds:[],executionMode:'single-scene-session',displayName:'DEV',validateConfig(){},preflight:async()=>({ready:true}),start:async()=>{},reconcile:async()=>{},cancel:async()=>{},capabilities:['text-to-video'],readiness:async()=>({id:'muse',ready:true,enabled:true,state:'ready'})});
 const service=new GenerationService({root:root(t),registry});service.execute=async()=>{};return service;}
const request=()=>({projectId:uuid(),sceneId:uuid(),providerId:'muse',idempotencyKey:uuid(),prompt:'PRIVATE'});
function count(audit,j,type){return audit.report(j).counters?.[type]?.recorded;}

test('exact v1 vocabulary contains only the 14 requested facts',()=>{assert.equal(A.TYPES.length,14);assert.equal(new Set(A.TYPES).size,14);assert(!A.TYPES.some(t=>/cancel|reconcil|progress|heartbeat|chunk/.test(t)));});
test('new admission gets a validated durable marker; event follows the job save',async t=>{
 const s=await admissionService(t),save=s.store.save.bind(s.store);let committed=false;
 s.store.save=jobs=>{assert(!fs.existsSync(path.join(s.root,'audit',jobs.at(-1).id+'.json')));save(jobs);committed=true;};
 const admit=s.executionJournal.admit.bind(s.executionJournal);s.executionJournal.admit=j=>{assert(committed);assert.equal(s.store.load().at(-1).executionAudit.auditId,j.executionAudit.auditId);admit(j);};
 const j=await s.submit(request());assert.equal(A.marker(j.executionAudit).version,1);assert.equal(s.executionAuditReport(j.id).counters['generation.admitted'].recorded,1);
 assert.equal(s.store.load()[0].executionAudit.auditId,j.executionAudit.auditId);
});
test('authoritative admission save failure emits no admission journal',async t=>{const s=await admissionService(t);s.store.save=()=>{throw Error('authoritative');};await assert.rejects(s.submit(request()));assert(!fs.existsSync(path.join(s.root,'audit')));});
test('audit callback exception cannot undo admission or terminal commit',async t=>{const s=await admissionService(t);s.executionJournal.admit=()=>{throw Error('observer');};s.executionJournal.record=()=>{throw Error('observer');};const j=await s.submit(request());assert.equal(j.status,'queued');assert.equal(s.commit({...j,status:'failed'}).status,'failed');});
test('historical jobs #1–#16 stay byte-identical without markers or journals',async t=>{
 const s=await admissionService(t),historical=Array.from({length:16},()=>{const j=job();delete j.executionAudit;return {...j,status:'completed'};});s.store.save(historical);
 const next=new GenerationService({root:s.root,registry:s.registry});next.execute=async()=>{};
 for(const old of historical){assert.equal(next.executionAuditReport(old.id).coverage.state,'not_recorded');assert.equal(next.executionAuditReport(old.id).counters,null);}
 const before=JSON.stringify(next.jobs);await next.submit(request());assert.equal(JSON.stringify(next.jobs.slice(0,16)),before);
 assert.equal(fs.readdirSync(path.join(s.root,'audit')).filter(f=>f.endsWith('.json')).length,1);
});
for(const value of [{version:2,auditId:uuid()},{version:1,auditId:'../file'},{version:1,auditId:uuid(),token:'secret'}])test('store quarantines malformed audit marker without blocking authoritative jobs '+JSON.stringify(Object.keys(value)),t=>{
 const dir=root(t),store=new GenerationStore(dir),j=job();j.executionAudit=value;store.save([j]);const loaded=store.load()[0];assert.deepEqual(loaded.executionAudit,{version:1,auditId:null});assert.equal(new A.ExecutionAudit(dir).report(loaded).coverage.state,'unavailable');assert(!fs.readFileSync(store.file,'utf8').includes('secret'));assert(!fs.existsSync(path.join(dir,'audit')));
});
test('missing prospective journal is unavailable, never reconstructed',t=>{const {audit,job:j,file}=fixture(t);fs.unlinkSync(file);assert.equal(audit.report(j).coverage.state,'unavailable');audit.record(j,'submit.requested');assert(!fs.existsSync(file));});
test('genuine second native submit occurrence remains a second event',t=>{const {audit,job:j}=fixture(t);audit.record(j,'submit.requested');audit.record(j,'submit.requested');assert.equal(count(audit,j,'submit.requested'),2);assert.equal(audit.report(j).counters['submit.requested'].total,null);});
test('same witness ID and payload redelivers idempotently, including reordered keys',t=>{const {audit,job:j}=fixture(t),p=packet(j),e=occurrence('content',p.sourceEpoch,1,'submit.invocation_observed',{outcome:'returned'});p.events=[e];p.watermark=1;
 assert(audit.ingest(j,p));assert(audit.ingest(j,p));const q=json(p);q.events[0]=Object.fromEntries(Object.entries(e).reverse());assert(audit.ingest(j,q));assert.equal(count(audit,j,'submit.invocation_observed'),1);
});
test('same occurrence ID with conflicting payload preserves original and marks partial',t=>{const {audit,job:j}=fixture(t),p=packet(j),e=occurrence('content',p.sourceEpoch,1,'submit.invocation_observed',{outcome:'returned'});p.events=[e];p.watermark=1;assert(audit.ingest(j,p));p.events[0].detail.outcome='threw_unknown';assert(!audit.ingest(j,p));assert(audit.report(j).coverage.reasons.includes('integrity'));assert.equal(audit.report(j).events.at(-1).detail.outcome,'returned');});
test('different occurrence IDs are never deduplicated by job or event kind',t=>{const {audit,job:j}=fixture(t),p=packet(j);p.events=[1,2].map(n=>occurrence('content',p.sourceEpoch,n,'submit.invocation_observed',{outcome:'returned'}));p.watermark=2;assert(audit.ingest(j,p));assert.equal(count(audit,j,'submit.invocation_observed'),2);});
test('unresolved source sequence gap makes totals unknown',t=>{const {audit,job:j}=fixture(t),p=packet(j);p.events=[occurrence('content',p.sourceEpoch,2,'manual.session_opened',{sessionAlias:uuid()})];p.watermark=2;p.closed=true;assert(audit.ingest(j,p));const r=audit.report(j);assert(r.coverage.reasons.includes('sequence_gap'));assert.equal(r.counters['manual.session_opened'].recorded,1);assert.equal(r.counters['manual.session_opened'].total,null);});
for(const source of ['worker','content'])test(source+' restart leaves an unclosed earlier epoch partial',t=>{const {audit,job:j}=fixture(t);assert(audit.ingest(j,packet(j,source)));assert(audit.ingest(j,packet(j,source,[],{closed:true})));assert(audit.report(j).coverage.reasons.includes('epoch_unclosed'));});
test('native restart reports an unresolved native epoch without writing or replaying',t=>{const {audit,job:j,file}=fixture(t),before=fs.readFileSync(file);const restarted=new A.ExecutionAudit(path.dirname(path.dirname(file)));assert(restarted.report(j).coverage.reasons.includes('epoch_unclosed'));assert.deepEqual(fs.readFileSync(file),before);});
for(const source of ['worker','content'])test(source+' witness survives suspension, lost ACK and redelivery without actions',async t=>{
 const {audit,job:j}=fixture(t),storage=memoryStorage(),first=W.create({storage,source}),type=source==='worker'?'submit.committed':'submit.invocation_observed';
 await first.bind({jobId:j.id,auditId:j.executionAudit.auditId});await first.observe(j.id,type,source==='worker'?{}:{outcome:'returned'});
 let delivered;await first.drain(async p=>{delivered=json(p);assert(audit.ingest(j,p));return {persisted:false};});assert(Object.keys(storage.data).length);
 const restarted=W.create({storage,source});await restarted.drain(async p=>({persisted:audit.ingest(j,p)}));assert.equal(count(audit,j,type),1);assert.equal(audit.report(j).coverage.state,'partial');assert.equal(Object.keys(storage.data).length,0);assert.equal(delivered.events[0].eventId,audit.report(j).events.at(-1).eventId);
});
test('witness ACK never deletes events created during in-flight delivery',async t=>{const {audit,job:j}=fixture(t),storage=memoryStorage(),w=W.create({storage,source:'content'});await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});await w.observe(j.id,'manual.session_opened',{sessionAlias:uuid()});
 await w.drain(async p=>{w.observe(j.id,'submit.invocation_observed',{outcome:'returned'});return {persisted:audit.ingest(j,p)};});await w.flush();assert.equal(Object.values(storage.data)[0].events.length,1);await w.drain(async p=>({persisted:audit.ingest(j,p)}));assert.equal(count(audit,j,'submit.invocation_observed'),1);
});
test('native ACK failure retains witness and retries only telemetry',async()=>{const storage=memoryStorage(),w=W.create({storage,source:'content'}),j=job();await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});await w.observe(j.id,'manual.session_opened',{sessionAlias:uuid()});const before=json(storage.data);await w.drain(async()=>{throw Error('offline');});assert.deepEqual(storage.data,before);});
test('witness capacity preserves old records and sends an explicit gap',async t=>{const {audit,job:j}=fixture(t),storage=memoryStorage(),w=W.create({storage,source:'content'});await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});for(let i=0;i<W.MAX_RECORDS+2;i++)w.observe(j.id,'manual.session_opened',{sessionAlias:uuid()});await w.flush();const p=Object.values(storage.data)[0];assert.equal(p.events.length,W.MAX_RECORDS);assert.equal(p.watermark,W.MAX_RECORDS+2);assert(p.gap);await w.drain(async p=>({persisted:audit.ingest(j,p)}));assert(audit.report(j).coverage.reasons.includes('sequence_gap'));});
test('witness persistence failures are swallowed; recovered packet stays gapped',async()=>{const storage=memoryStorage(),base=storage.set;let fail=false;storage.set=async v=>{if(fail)throw Error('quota');return base(v);};const w=W.create({storage,source:'worker'}),j=job();await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});fail=true;await w.observe(j.id,'submit.committed');fail=false;await w.gap(j.id);assert(Object.values(storage.data)[0].gap);});
test('witness refuses privacy-unsafe detail instead of persisting it',async()=>{const storage=memoryStorage(),w=W.create({storage,source:'content'}),j=job();await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});await w.observe(j.id,'manual.session_opened',{sessionAlias:uuid(),candidateToken:'SECRET',url:'blob:https://muse.ai/SECRET'});const s=JSON.stringify(storage.data);assert(!s.includes('SECRET'));assert(Object.values(storage.data)[0].gap);});
test('closure waits for quiescence and a second persisted checkpoint',async t=>{const {audit,job:j}=fixture(t),storage=memoryStorage();let busy=true;const w=W.create({storage,source:'content',canClose:()=>!busy});await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});await w.drain(async p=>({persisted:audit.ingest(j,p),close:true}));assert.equal(Object.values(storage.data)[0].closed,false);busy=false;await w.drain(async p=>({persisted:audit.ingest(j,p),close:true}));assert.equal(audit.report(j).streams.find(s=>s.source==='content').closed,false);await w.drain(async p=>({persisted:audit.ingest(j,p),close:true}));assert.equal(audit.report(j).streams.find(s=>s.source==='content').closed,true);});
for(const method of ['writeFileSync','fsyncSync','renameSync'])test(method+' telemetry failure leaves execution observers fail-open',t=>{
 const dir=root(t),j=job();let fail=false;const io={...fs,[method]:(...args)=>{if(fail)throw Error('DEV disk failure');return fs[method](...args);}},audit=new A.ExecutionAudit(dir,{io});audit.admit(j);fail=true;assert.equal(audit.record(j,'submit.requested'),false);fail=false;audit.record(j,'submit.requested');assert.equal(audit.report(j).coverage.state,'partial');assert(audit.report(j).coverage.reasons.includes('write_failed'));
});
test('safe observer swallows synchronous exceptions and rejected promises',async()=>{assert.doesNotThrow(()=>A.safeObserve({audit(){throw Error('bad');}},'submit.requested'));A.safeObserve({audit:()=>Promise.reject(Error('bad'))},'submit.requested');await new Promise(r=>setImmediate(r));});
test('event overflow preserves evidence, bounded file and partial totals',t=>{const {audit,job:j,file}=fixture(t);for(let i=0;i<A.MAX_EVENTS+5;i++)audit.record(j,'submit.requested');const r=audit.report(j);assert.equal(r.events.length,A.MAX_EVENTS);assert(r.coverage.reasons.includes('capacity'));assert(fs.statSync(file).size<=A.MAX_FILE_BYTES);assert.equal(r.counters['submit.requested'].total,null);});
for(const value of ['{broken',JSON.stringify({version:1}), 'x'.repeat(A.MAX_FILE_BYTES+1)])test('corrupt or oversized journal is unavailable and never replaced '+value.length,t=>{const {audit,job:j,file}=fixture(t);fs.writeFileSync(file,value);assert.equal(audit.report(j).coverage.state,'unavailable');assert(!audit.record(j,'submit.requested'));assert.equal(fs.readFileSync(file,'utf8'),value);});
test('strict native event schemas reject prompt, URLs, tokens and arbitrary paths',t=>{const {audit,job:j,file}=fixture(t);for(const detail of [{prompt:'SECRET'},{url:'https://muse.ai/SECRET'},{token:'SECRET'},{path:'C:/SECRET'}])assert(!audit.record(j,'submit.requested',detail));assert(!fs.readFileSync(file,'utf8').includes('SECRET'));assert.equal(count(audit,j,'submit.requested'),0);});
test('extension cannot forge native/renderer source or provider authority events',t=>{const {audit,job:j}=fixture(t),p=packet(j);p.source='native';assert(!audit.ingest(j,p));p.source='content';p.events=[occurrence('content',p.sourceEpoch,1,'ownership.completed',{evidenceKind:'receipt-v2',evidenceVersion:2,evidenceDigest:'a'.repeat(64)})];p.watermark=1;assert(!audit.ingest(j,p));assert.equal(count(audit,j,'ownership.completed'),0);});
test('terminal transition observed once after persistence, never for interrupted/rerender',async t=>{const s=await admissionService(t),j=await s.submit(request());s.commit({...j,status:'interrupted'});assert.equal(s.executionAuditReport(j.id).counters['job.terminal'].recorded,0);const done=s.commit({...j,status:'cancelled'});s.commit(done);s.emit('changed',{id:j.id,status:'cancelled'});assert.equal(s.executionAuditReport(j.id).counters['job.terminal'].recorded,1);});
test('read-only report cannot invoke any provider action or mutate files',async t=>{const s=await admissionService(t),j=await s.submit(request()),file=s.executionJournal.file(j),before=fs.readFileSync(file);await new Promise(r=>setImmediate(r));for(const name of ['execute','recover','submit','cancel'])s[name]=()=>assert.fail(name);s.executionAuditReport(j.id);assert.deepEqual(fs.readFileSync(file),before);});

async function auto(t,options={}){const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media,...options});t.after(()=>f.close());const j=await f.admit();return {...f,fixture:f,job:j};}
async function complete(f){let j=f.service.get(f.job.id);for(let i=0;i<6 && j.status!=='completed';i++)j=await f.service.recover(j.id);assert.equal(j.status,'completed');return j;}
test('automatic production boundaries yield complete audit and canonical attachment with all manual counts zero',async t=>{const f=await auto(t),j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);await f.drain();const r=f.service.executionAuditReport(j.id);
 assert.equal(r.coverage.state,'complete',JSON.stringify(r.coverage));
 for(const type of A.TYPES)assert.equal(r.counters[type].total,type.startsWith('manual.')?0:1,type);
 assert.equal(f.content.clicks,1);assert.equal(f.calls.filter(c=>c==='submitGeneration').length,1);assert.equal(f.fixture.fetches,1);
 const snapshot=p.persisted();assert.equal(snapshot.media.assets.length,1);assert.equal(snapshot.workflow.jobs.length,1);assert.equal(snapshot.workflow.generationOutputs[0].jobId,j.id);assert.equal(snapshot.source.path,f.service.output(j.id).path);
 const serialized=JSON.stringify(r);for(const privateValue of ['SECRET','PRIVATE PROMPT','blob:','https://','observationToken','candidateId','dev-result-owner'])assert(!serialized.includes(privateValue),privateValue);
 assert.equal(r.events.find(e=>e.type==='project.attachment_reported').source,'renderer');assert.equal(r.attachmentCorroboration,'persisted-registry-check-required');
});
test('click throws means unknown invocation, with no acceptance or ownership promotion',async t=>{const f=await auto(t,{clickThrows:true});assert.equal(f.job.status,'interrupted');await f.drain();const r=f.service.executionAuditReport(f.job.id);assert.equal(r.events.find(e=>e.type==='submit.invocation_observed').detail.outcome,'threw_unknown');assert.equal(r.counters['submit.acceptance_proven'].recorded,0);assert.equal(r.counters['ownership.completed'].recorded,0);assert.equal(f.content.clicks,1);});
test('lost native response still drains committed/click witnesses without resubmission',async t=>{const f=await auto(t,{lostSubmit:true});assert.equal(f.job.status,'interrupted');await f.drain();const r=f.service.executionAuditReport(f.job.id);assert.equal(r.counters['submit.committed'].recorded,1);assert.equal(r.counters['submit.invocation_observed'].recorded,1);assert.equal(r.counters['submit.acceptance_proven'].recorded,0);assert.equal(f.content.clicks,1);});
test('existing verified output check adds no transfer or publication occurrence',async t=>{const f=await auto(t),j=await complete(f),before=f.service.executionAuditReport(j.id);await f.provider.reconcile(f.service.context(j));const after=f.service.executionAuditReport(j.id);for(const type of ['acquisition.started','acquisition.completed','output.published'])assert.equal(after.counters[type].recorded,before.counters[type].recorded);assert.equal(f.fixture.fetches,1);});
test('invalid native video receives bytes but never emits verified publication',async t=>{const f=await auto(t,{verifyVideo:async()=>{throw Error('invalid');}});for(let i=0;i<6;i++){if((await f.service.recover(f.job.id)).status==='interrupted')break;}const r=f.service.executionAuditReport(f.job.id);assert.equal(r.counters['acquisition.started'].recorded,1);assert.equal(r.counters['acquisition.completed'].recorded,1);assert.equal(r.counters['output.published'].recorded,0);assert.equal(f.service.get(f.job.id).status,'interrupted');});
test('repeated registry observation adds no attachment report; replay is idempotent',async t=>{const f=await auto(t),j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);assert.equal(p.reports.length,1);f.service.reportGenerationAttachment(p.reports[0]);assert.equal(f.service.executionAuditReport(j.id).counters['project.attachment_reported'].recorded,1);});
test('actual registry write failure reports failure; later successful commit stays distinct',async t=>{const f=await auto(t),j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.fail=true;assert.throws(()=>p.api.attachGeneratedOutput(j,f.service.output(j.id),media));assert.equal(p.reports.length,1);assert.equal(p.reports[0].outcome,'failure');p.fail=false;p.api.attachGeneratedOutput(j,f.service.output(j.id),media);assert.equal(p.reports.length,2);assert.equal(f.service.executionAuditReport(j.id).counters['project.attachment_reported'].recorded,2);});
test('presentation error after registry commit cannot report attachment failure',async t=>{const f=await auto(t),j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.failPresentation=true;try{p.api.attachGeneratedOutput(j,f.service.output(j.id),media);}catch{}assert(p.persisted().media.assets.length===1);assert.equal(p.reports.length,1);assert.equal(p.reports[0].outcome,'success');});
test('renderer cannot override project, scene, source, asset or append arbitrary events',async t=>{const f=await auto(t),j=await complete(f),base={jobId:j.id,outcome:'success',reportId:uuid()};for(const [k,v] of [['projectId',uuid()],['sceneId',uuid()],['sourceId','evil'],['assetId','evil'],['type','ownership.completed'],['source','native']])assert.throws(()=>f.service.reportGenerationAttachment({...base,[k]:v}),{code:'INVALID_REQUEST'});assert.equal(f.service.executionAuditReport(j.id).counters['project.attachment_reported'].recorded,0);});
test('telemetry disk failures throughout real automatic execution do not fail generation or attachment',async t=>{const f=await auto(t);f.service.executionJournal.write=()=>{throw Error('disk');};const j=await complete(f),p=projectFixture(j,f.service);p.api.registerGenerationJob(j);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);assert.equal(p.persisted().media.assets.length,1);assert.equal(f.service.get(j.id).status,'completed');assert.equal(f.content.clicks,1);assert.equal(f.service.executionAuditReport(j.id).coverage.state,'partial');});

async function manual(t){const f=require('../dev/manual-recovery-fixture').createFixture({root:root(t),bytes,verifyVideo:async()=>media,executionAudit:true});t.after(()=>f.close());const j=await f.admit(uuid(),uuid());return {...f,fixture:f,job:j};}
test('manual recovery records its facts with partial coverage when binding races committed intent',async t=>{
 const f=await manual(t),s=await f.service.listRecoveryCandidates(f.job.id),candidate=s.candidates[1].candidateId;
 await f.service.revealRecoveryCandidate(f.job.id,candidate);const j=await f.service.confirmRecoveryCandidate(f.job.id,candidate),p=projectFixture(j,f.service);
 p.api.registerGenerationJob(j);p.api.attachGeneratedOutput(j,f.service.output(j.id),media);await f.drainAudit();const r=f.service.executionAuditReport(j.id);
 assert.equal(r.coverage.state,'partial',JSON.stringify(r.coverage));assert(r.coverage.reasons.includes('sequence_gap'));
 for(const type of ['generation.admitted','submit.requested','submit.committed','manual.session_opened','manual.candidate_revealed','manual.candidate_confirmed','acquisition.started','acquisition.completed','output.published','project.attachment_reported','job.terminal'])assert.equal(r.counters[type].recorded,1,type);
 for(const type of ['submit.invocation_observed','submit.acceptance_proven','ownership.completed'])assert.equal(r.counters[type].recorded,0,type);
 for(const type of A.TYPES)assert.equal(r.counters[type].total,null,type);
 assert.equal(r.events.find(e=>e.type==='acquisition.started').detail.mode,'user-confirmed');assert.equal(r.events.find(e=>e.type==='output.published').detail.mode,'user-confirmed');
 assert.equal(j.attempts[0].status,'interrupted');assert.equal(f.fixture.fetches,1);assert.equal(j.outputResolution.mode,'user-confirmed');
 assert(!JSON.stringify(r).includes(candidate));assert(!JSON.stringify(r).includes(s.selectionSessionId));assert(!JSON.stringify(r).includes('blob:'));
 const reveal=r.events.find(e=>e.type==='manual.candidate_revealed');assert.equal(reveal.source,'content');assert.equal(reveal.detail.sessionAlias,r.events.find(e=>e.type==='manual.session_opened').detail.sessionAlias);
});
test('failed durable manual confirmation produces no confirmation or acquisition observation',async t=>{const f=await manual(t),s=await f.service.listRecoveryCandidates(f.job.id),id=s.candidates[0].candidateId;await f.service.revealRecoveryCandidate(f.job.id,id);f.fixture.failPersistence=true;await assert.rejects(f.service.confirmRecoveryCandidate(f.job.id,id));await f.drainAudit();const r=f.service.executionAuditReport(f.job.id);assert.equal(r.counters['manual.candidate_confirmed'].recorded,0);assert.equal(r.counters['acquisition.started'].recorded,0);assert.equal(f.fixture.fetches,0);});
test('lost reveal response still retains exact content witness for later drain',async t=>{const f=await manual(t),s=await f.service.listRecoveryCandidates(f.job.id),original=f.wc.chrome.tabs.sendMessage;f.wc.chrome.tabs.sendMessage=async(id,m)=>{const r=await original(id,m);if(m.command==='revealRecoveryCandidate')throw Error('lost reveal reply');return r;};await assert.rejects(f.service.revealRecoveryCandidate(f.job.id,s.candidates[0].candidateId));await f.drainAudit();const r=f.service.executionAuditReport(f.job.id);assert.equal(r.counters['manual.candidate_revealed'].recorded,1);assert.equal(r.counters['manual.candidate_confirmed'].recorded,0);assert.equal(f.fixture.fetches,0);});
test('content session is recorded when capability is created even if candidate response is lost',async t=>{const f=await manual(t),original=f.wc.chrome.tabs.sendMessage;f.wc.chrome.tabs.sendMessage=async(id,m)=>{const r=await original(id,m);if(m.command==='listRecoveryCandidates')throw Error('lost list');return r;};await assert.rejects(f.service.listRecoveryCandidates(f.job.id));await f.drainAudit();assert.equal(f.service.executionAuditReport(f.job.id).counters['manual.session_opened'].recorded,1);assert.equal(f.fixture.fetches,0);});
test('telemetry observer throwing during session/reveal does not change candidate authority',async t=>{const f=await manual(t),vm=require('node:vm');vm.runInContext("contentAudit.observe=()=>{throw Error('observer')}",f.context);const s=await f.service.listRecoveryCandidates(f.job.id);await f.service.revealRecoveryCandidate(f.job.id,s.candidates[0].candidateId);assert.equal((await f.service.confirmRecoveryCandidate(f.job.id,s.candidates[0].candidateId)).status,'completed');assert.equal(f.fixture.fetches,1);});
test('crash after confirmation commit leaves confirmation fact and no fresh transfer',async t=>{const f=await manual(t),s=await f.service.listRecoveryCandidates(f.job.id),id=s.candidates[0].candidateId;await f.service.revealRecoveryCandidate(f.job.id,id);const save=f.service.store.save.bind(f.service.store);f.service.store.save=jobs=>{if(jobs.some(j=>j.status==='verifying'))throw Error('DEV crash before transfer');return save(jobs);};await assert.rejects(f.service.confirmRecoveryCandidate(f.job.id,id));const r=f.service.executionAuditReport(f.job.id);assert.equal(r.counters['manual.candidate_confirmed'].recorded,1);assert.equal(r.counters['acquisition.started'].recorded,0);assert.equal(f.fixture.fetches,0);});
test('output published before Project attachment is explicitly pending coverage',async t=>{const f=await auto(t),j=await complete(f);await f.drain();const r=f.service.executionAuditReport(j.id);assert.equal(r.counters['output.published'].recorded,1);assert.equal(r.counters['project.attachment_reported'].total,null);assert.equal(r.coverage.state,'partial');});
test('actual second bounded transfer gets a new transfer correlation and count',async t=>{const f=await auto(t,{verifyVideo:async()=>{throw Error('invalid');}});for(let i=0;i<6;i++)if((await f.service.recover(f.job.id)).status==='interrupted')break;await f.service.recover(f.job.id);const r=f.service.executionAuditReport(f.job.id),started=r.events.filter(e=>e.type==='acquisition.started');assert.equal(started.length,2);assert.notEqual(started[0].detail.transferId,started[1].detail.transferId);assert.equal(r.counters['output.published'].recorded,0);assert.equal(f.content.clicks,1);});
test('worker intent commit survives content delivery loss before any click',async t=>{const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());const send=f.wc.chrome.tabs.sendMessage;f.wc.chrome.tabs.sendMessage=async(id,m)=>{if(m.command==='submitGeneration')throw Error('DEV delivery lost');return send(id,m);};const j=await f.admit();await f.drain();const r=f.service.executionAuditReport(j.id);assert.equal(r.counters['submit.committed'].recorded,1);assert.equal(r.counters['submit.invocation_observed'].recorded,0);assert.equal(f.content.clicks,0);assert.equal(j.status,'interrupted');});
test('narrow IPC exposes read/report only, enforces trusted sender and cannot append arbitrary events',async t=>{const {registerGenerationIpc}=require('../services/generation/generation-ipc'),handlers={},s=await admissionService(t),j=await s.submit(request());registerGenerationIpc({ipcMain:{handle:(n,f)=>handlers[n]=f},getService:()=>s,trusted:e=>e.trusted===true});assert(!Object.keys(handlers).some(k=>/append|audit-write/.test(k)));assert.equal((await handlers['generation:execution-audit']({trusted:false},j.id)).ok,false);assert.equal((await handlers['generation:execution-audit']({trusted:true},j.id)).value.coverage.state,'partial');assert.equal((await handlers['generation:attachment-report']({trusted:true},{jobId:j.id,type:'submit.requested'})).errorCode,'INVALID_REQUEST');});
test('authenticated telemetry endpoint validates target binding and never dispatches generation',async t=>{
 const {MetaMuseExtensionBridge}=require('../services/generation/bridge/meta-muse-extension-bridge'),f=await auto(t),bridge=new MetaMuseExtensionBridge({userDataPath:root(t)});t.after(()=>bridge.close());bridge.executionAuditSink=(p,target)=>f.service.ingestExecutionWitness(p,target);await bridge.start();
 const origin='chrome-extension://'+'a'.repeat(32),url='http://127.0.0.1:'+bridge.port;let token='';
 async function send(route,body,auth=token){const r=await fetch(url+'/v1/'+route,{method:'POST',headers:{origin,'content-type':'application/json',...(auth?{'X-Viral-Muse-Token':auth}:{})},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
 token=(await send('register',{instanceId:'audit-fixture',profileLabel:'DEV',browserName:'Chrome',extensionVersion:'0.3.17',protocolVersion:1})).value.token;
 await send('heartbeat?instanceId=audit-fixture',{profileLabel:'DEV',browserName:'Chrome',tabs:[{tabId:5,url:'https://muse.ai/',composerReady:true}]});
 const p=packet(f.job),before=f.calls.length;
 assert.equal((await send('audit?instanceId=audit-fixture',{tabId:5,packet:p},'0'.repeat(64))).status,401);
 assert.equal((await send('audit?instanceId=audit-fixture',{tabId:6,packet:p})).status,400);
 assert.equal((await send('audit?instanceId=audit-fixture',{tabId:5,packet:{...p,auditId:uuid()}})).value.persisted,false);
 assert.equal((await send('audit?instanceId=audit-fixture',{tabId:5,packet:p})).value.persisted,true);assert.equal(f.calls.length,before);assert.equal(f.content.clicks,1);
});
test('audit capability and bundle retain execution/receipt/manual contracts and Chrome permissions',()=>{const manifest=require('../extensions/meta-muse-bridge/manifest.json');assert.equal(manifest.version,'0.3.17');assert.deepEqual(manifest.permissions,['storage','alarms']);assert.deepEqual(manifest.host_permissions,['https://muse.ai/*','http://127.0.0.1/*']);assert(manifest.content_scripts[0].js.includes('execution-audit.js'));for(const name of ['content-script.js','service-worker.js']){const s=fs.readFileSync('extensions/meta-muse-bridge/'+name,'utf8');assert(s.includes('contract3-receipt2-manual1-audit1'));}const c=contentFixture({storage:memoryStorage()});assert.equal(c.handshake().executionAuditVersion,1);assert.equal(c.handshake().contractVersion,3);assert.equal(c.handshake().manualRecoveryVersion,1);});
test('hung and rejected telemetry observers have a bounded wait and mark a gap',async()=>{let gaps=0;await W.settle(new Promise(()=>{}),()=>gaps++,5);await W.settle(Promise.reject(Error('storage')),()=>gaps++,5);assert.equal(gaps,2);});
test('pending worker witness leaves totals unknown while submit and click complete',async t=>{
 const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());
 const pending=deferred();t.after(()=>pending.resolve());
 // Disable the telemetry watchdog: an awaited observer could never escape via a timeout.
 f.wc.MuseExecutionAudit.settle=p=>Promise.resolve(p).catch(()=>{});
 f.workerAudit.observe=()=>pending.promise;
 const j=await f.admit();assert.equal(j.status,'running');assert.equal(f.content.clicks,1);assert.equal(pending.settled,false);
 await f.drain();const report=f.service.executionAuditReport(j.id);assert.equal(report.coverage.state,'partial');assert.equal(report.counters['submit.committed'].total,null);
 assert.equal(f.calls.filter(c=>c==='submitGeneration').length,1);
});
test('concurrent binding cannot reset a source sequence or lose an occurrence',async()=>{const storage=memoryStorage(),w=W.create({storage,source:'worker'}),j=job(),binding={jobId:j.id,auditId:j.executionAudit.auditId};await Promise.all([w.bind(binding),w.bind(binding)]);await w.observe(j.id,'submit.committed');await w.bind(binding);await w.observe(j.id,'submit.committed');const p=Object.values(storage.data)[0];assert.deepEqual(p.events.map(e=>e.sourceSequence),[1,2]);});
test('older identical witness delivery after a newer checkpoint is a harmless replay',t=>{const {audit,job:j}=fixture(t),p=packet(j);p.events=[occurrence('content',p.sourceEpoch,1,'submit.invocation_observed',{outcome:'returned'})];p.watermark=1;assert(audit.ingest(j,p));const old=json(p);p.events=[occurrence('content',p.sourceEpoch,2,'manual.session_opened',{sessionAlias:uuid()})];p.watermark=2;assert(audit.ingest(j,p));assert(audit.ingest(j,old));assert(!audit.report(j).coverage.reasons.includes('sequence_gap'));assert.equal(count(audit,j,'submit.invocation_observed'),1);});
test('DEV runner rejects production and is excluded from the packaged app',async()=>{const {run}=require('../dev/run-execution-audit'),previous=process.env.NODE_ENV;try{process.env.NODE_ENV='production';await assert.rejects(run(),/unavailable in production/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}const pkg=require('../package.json');assert(!pkg.build.files.some(f=>f.startsWith('dev/') || f.startsWith('tests/') || f==='**/*'));assert(!fs.readFileSync('main.js','utf8').includes('run-execution-audit'));});
test('bounded alias exhaustion explicitly degrades coverage rather than silently losing correlation',async()=>{const storage=memoryStorage(),w=W.create({storage,source:'content'}),j=job();await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});for(let i=0;i<161;i++)w.alias(j.id,'private-capability-'+i);await w.flush();const p=Object.values(storage.data)[0];assert(p.gap);assert(!JSON.stringify(p).includes('private-capability'));});
test('in-flight closure ACK cannot erase newer gap metadata',async t=>{const {audit,job:j}=fixture(t),storage=memoryStorage(),w=W.create({storage,source:'content'});await w.bind({jobId:j.id,auditId:j.executionAudit.auditId});await w.drain(async p=>({persisted:audit.ingest(j,p),close:true}));await w.drain(async p=>{w.gap(j.id);return {persisted:audit.ingest(j,p),close:true};});await w.flush();assert.equal(Object.keys(storage.data).length,1);assert(Object.values(storage.data)[0].gap);await w.drain(async p=>({persisted:audit.ingest(j,p),close:true}));assert(audit.report(j).coverage.reasons.includes('sequence_gap'));assert.equal(Object.keys(storage.data).length,0);});
test('audit setup occurs once per job and never waits again for acquisition chunks',async t=>{const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());let binds=0;const send=f.wc.chrome.tabs.sendMessage;f.wc.chrome.tabs.sendMessage=async(id,m)=>{if(m.type==='viral-ai:muse-audit-bind')binds++;return send(id,m);};const j=await f.admit();f.job=j;await complete(f);assert.equal(binds,1);assert.equal(f.content.clicks,1);});
test('native submit request event follows actual adapter dispatch invocation',async t=>{const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());const record=f.service.executionJournal.record.bind(f.service.executionJournal);let observed=false;f.service.executionJournal.record=(j,type,...rest)=>{if(type==='submit.requested'){assert(f.calls.includes('submitGeneration'));observed=true;}return record(j,type,...rest);};await f.admit();assert(observed);});
test('failed authoritative acceptance save emits no acceptance proof despite a real click',async t=>{const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());const rename=fs.renameSync;try{fs.renameSync=(from,to)=>{if(String(to).endsWith('muse-operation.json') && JSON.parse(fs.readFileSync(from)).receipt?.userStableIdHash)throw Error('DEV acceptance persistence');return rename(from,to);};const j=await f.admit(),r=f.service.executionAuditReport(j.id);assert.equal(j.status,'interrupted');assert.equal(f.content.clicks,1);assert.equal(r.counters['submit.acceptance_proven'].recorded,0);assert.equal(r.counters['ownership.completed'].recorded,0);}finally{fs.renameSync=rename;}});
test('failed authoritative ownership save emits no ownership completion or transfer',async t=>{const f=await auto(t),rename=fs.renameSync;try{fs.renameSync=(from,to)=>{if(String(to).endsWith('muse-operation.json') && JSON.parse(fs.readFileSync(from)).receipt?.result)throw Error('DEV ownership persistence');return rename(from,to);};let j=f.job;for(let i=0;i<6 && j.status!=='interrupted';i++)j=await f.service.recover(j.id);const r=f.service.executionAuditReport(j.id);assert.equal(j.status,'interrupted');assert.equal(r.counters['submit.acceptance_proven'].recorded,1);assert.equal(r.counters['ownership.completed'].recorded,0);assert.equal(r.counters['acquisition.started'].recorded,0);}finally{fs.renameSync=rename;}});
test('failed authoritative terminal save changes neither status nor terminal audit fact',async t=>{const s=await admissionService(t),j=await s.submit(request());s.store.save=()=>{throw Error('DEV job save');};assert.throws(()=>s.commit({...j,status:'failed'}));assert.equal(s.get(j.id).status,'queued');assert.equal(s.executionAuditReport(j.id).counters['job.terminal'].recorded,0);});

for(const stage of ['worker bind','route read','route write','content bind','drain'])test('poll executes and returns its result before deferred audit '+stage,async t=>{
 const vm=require('node:vm'),f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());
 const gate=deferred(),entered=deferred();t.after(()=>gate.resolve(false));
 const hold=()=>{entered.resolve();return gate.promise;};
 // No audit watchdog can release a regression that accidentally awaits setup.
 f.wc.MuseExecutionAudit.settle=p=>Promise.resolve(p).catch(()=>{});
 const command={id:uuid(),type:'openMuse',payload:{tabId:5},audit:{jobId:uuid(),auditId:uuid()}};
 f.wc.testCommand=command;f.wc.results=[];f.wc.started=[];
 if(stage==='worker bind')f.workerAudit.bind=hold;
 if(stage==='route read'){const get=f.storage.get;let reads=0;f.storage.get=k=>k===null && ++reads===2?hold():get(k);}
 if(stage==='route write'){const set=f.storage.set;f.storage.set=v=>Object.keys(v).some(k=>k.startsWith('execution-audit-v1:route:'))?hold():set(v);}
 if(stage==='content bind')f.wc.chrome.tabs.sendMessage=hold;
 // poll also initiates a separate drain; hold both without serializing execution.
 if(stage==='drain')f.workerAudit.drain=hold;
 else f.workerAudit.drain=async()=>true;
 vm.runInContext(`navigator.userAgent='Chrome/DEV';bridge={port:1,token:'local',serverId:'local'};
 connect=async()=>bridge;identity=async()=>({instanceId:'local'});museTabs=async()=>[];
 request=async(port,path,options)=>{if(path.startsWith('/v1/poll'))return {command:testCommand};if(path.startsWith('/v1/result'))results.push(options.body);return {};};
 execute=async c=>{started.push(c.id);return {state:'test-result'};};`,f.wc);
 const polling=vm.runInContext('poll()',f.wc);
 await entered.promise;await turn();
 assert.deepEqual(Array.from(f.wc.started),[command.id]);assert.equal(f.wc.results.length,1);assert.equal(f.wc.results[0].result.state,'test-result');
 assert.equal(await polling,true);assert.equal(gate.settled,false);
 f.wc.navigator.userAgent='Edg/DEV';
});

for(const source of ['worker','content'])test(source+' delayed binding flushes a queued occurrence only after its checkpoint succeeds',async t=>{
 const {audit,job:j}=fixture(t),storage=memoryStorage(),get=storage.get,gate=deferred();let reads=0;
 storage.get=async k=>{reads++;await gate.promise;return get(k);};
 const w=W.create({storage,source}),type=source==='worker'?'submit.committed':'submit.invocation_observed',detail=source==='worker'?{}:{outcome:'returned'};
 // Content may receive the invocation before even the bind message arrives.
 w.observe(j.id,type,detail);const binding=w.bind({jobId:j.id,auditId:j.executionAudit.auditId});
 w.observe(j.id,type,detail);
 assert.equal(reads,1);await turn();assert.deepEqual(storage.data,{});assert.equal(gate.settled,false);
 assert.equal(audit.report(j).counters[type].total,null);
 gate.resolve();assert.equal(await binding,true);await w.flush();
 const p=Object.values(storage.data)[0];assert.equal(p.events.length,2);assert.equal(p.events[0].type,type);assert.equal(p.gap,false);
 await w.drain(async p=>({persisted:audit.ingest(j,p)}));assert.equal(count(audit,j,type),2);
});

for(const source of ['worker','content'])test(source+' queued witness waits only inside telemetry for initial checkpoint storage',async()=>{
 const storage=memoryStorage(),set=storage.set,gate=deferred(),entered=deferred(),jobId=uuid();
 storage.set=async v=>{entered.resolve();await gate.promise;return set(v);};
 const w=W.create({storage,source}),binding=w.bind({jobId,auditId:uuid()});await entered.promise;
 w.observe(jobId,source==='worker'?'submit.committed':'submit.invocation_observed',source==='worker'?{}:{outcome:'returned'});
 await turn();assert.deepEqual(storage.data,{});gate.resolve();assert(await binding);await w.flush();assert.equal(Object.values(storage.data)[0].events.length,1);
});

for(const source of ['worker','content'])test(source+' pre-bind overflow preserves the bounded events and reports a gap',async()=>{
 const storage=memoryStorage(),w=W.create({storage,source}),jobId=uuid(),type=source==='worker'?'submit.committed':'submit.invocation_observed',detail=source==='worker'?{}:{outcome:'returned'};
 for(let i=0;i<W.MAX_RECORDS+1;i++)w.observe(jobId,type,detail);
 assert(await w.bind({jobId,auditId:uuid()}));await w.flush();const p=Object.values(storage.data)[0];assert.equal(p.events.length,W.MAX_RECORDS);assert(p.gap);
});

for(const source of ['worker','content'])test(source+' pre-bind overflow and failed bind retain truthful partial coverage',async t=>{
 const {audit,job:j}=fixture(t),storage=memoryStorage(),w=W.create({storage,source}),type=source==='worker'?'submit.committed':'submit.invocation_observed',detail=source==='worker'?{}:{outcome:'returned'};
 for(let i=0;i<W.MAX_RECORDS+1;i++)w.observe(j.id,type,detail);
 const get=storage.get;storage.get=async()=>{throw Error('offline');};assert.equal(await w.bind({jobId:j.id,auditId:j.executionAudit.auditId}),false);
 storage.get=get;assert.equal(await w.bind({jobId:j.id,auditId:j.executionAudit.auditId}),true);await w.flush();
 assert(Object.values(storage.data)[0].gap);assert.equal(Object.values(storage.data)[0].events.length,0,'failed bind discards telemetry, never replays execution');
 await w.drain(async p=>({persisted:audit.ingest(j,p)}));const r=audit.report(j);assert.equal(r.coverage.state,'partial');assert.equal(r.counters[type].total,null);assert(r.coverage.reasons.includes('sequence_gap'));
});

test('pre-bind capacity is bounded across jobs and overflow damages later coverage',async()=>{
 const storage=memoryStorage(),w=W.create({storage,source:'worker'}),ids=Array.from({length:W.MAX_STREAMS+1},uuid);
 for(const id of ids)w.observe(id,'submit.committed');
 const last=ids.at(-1);assert(await w.bind({jobId:last,auditId:uuid()}));await w.flush();
 assert(Object.values(storage.data)[0].gap);assert.equal(Object.values(storage.data)[0].events.length,0);
});

test('lost pre-bind memory on restart remains missing coverage with unknown totals',async t=>{
 const {audit,job:j}=fixture(t),storage=memoryStorage(),old=W.create({storage,source:'worker'});old.observe(j.id,'submit.committed');
 await W.create({storage,source:'worker'}).drain(async p=>({persisted:audit.ingest(j,p)}));audit.record(j,'job.terminal',{status:'failed'},{close:true});
 const r=audit.report(j);assert.equal(r.coverage.state,'partial');assert.equal(r.counters['submit.committed'].recorded,0);assert.equal(r.counters['submit.committed'].total,null);
});

test('real worker and content witnesses survive binding delayed until after submit result',async t=>{
 const f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());
 const gate=deferred(),contentBound=deferred(),get=f.storage.get,send=f.wc.chrome.tabs.sendMessage;t.after(()=>gate.resolve());
 f.wc.MuseExecutionAudit.settle=p=>Promise.resolve(p).catch(()=>{});
 f.storage.get=async k=>{if(k===null)await gate.promise;return get(k);};
 f.wc.chrome.tabs.sendMessage=async(id,m)=>{const result=await send(id,m);if(m.type==='viral-ai:muse-audit-bind')contentBound.resolve();return result;};
 const j=await f.admit();assert.equal(j.status,'running');assert.equal(f.content.clicks,1);assert.equal(gate.settled,false);
 const before=f.service.executionAuditReport(j.id);assert.equal(before.counters['submit.committed'].total,null);assert.equal(before.counters['submit.invocation_observed'].total,null);
 gate.resolve();await contentBound.promise;await f.drain();const after=f.service.executionAuditReport(j.id);
 assert.equal(after.counters['submit.committed'].recorded,1);assert.equal(after.counters['submit.invocation_observed'].recorded,1);assert.equal(after.events.find(e=>e.type==='submit.invocation_observed').detail.outcome,'returned');
 assert.equal(after.coverage.state,'partial','late binding cannot certify continuity across a possible document/process loss');
 assert.equal(f.content.clicks,1);assert.equal(f.calls.filter(c=>c==='submitGeneration').length,1);
});

test('restart followed by empty rebinding cannot turn lost pre-bind witnesses into known zero',async t=>{
 const vm=require('node:vm'),f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());
 const gate=deferred(),get=f.storage.get;t.after(()=>gate.resolve());
 f.wc.MuseExecutionAudit.settle=p=>Promise.resolve(p).catch(()=>{});
 f.storage.get=async k=>{if(k===null)await gate.promise;return get(k);};
 const j=await f.admit();assert.equal(j.status,'running');assert.equal(f.content.clicks,1);
 // A fresh worker/document keeps only authoritative storage; neither memory queue survived.
 const next=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>next.close());
 const intentKey='generation-intent:'+j.id;next.storage.data[intentKey]=json(f.storage.data[intentKey]);
 next.wc.command={id:uuid(),type:'inspectGeneration',payload:{tabId:5,operationId:j.id},audit:{jobId:j.id,auditId:j.executionAudit.auditId}};
 await vm.runInContext('prepareExecutionAudit(command)',next.wc);await next.workerAudit.flush();
 const p=Object.values(next.storage.data).find(v=>v.source==='worker');assert(p.gap);assert.equal(p.events.length,0);
 assert(f.service.ingestExecutionWitness(json(p),{instanceId:'audit-fixture',tabId:5}).persisted);
 const report=f.service.executionAuditReport(j.id);assert.equal(report.coverage.state,'partial');assert.equal(report.counters['submit.committed'].total,null);
 assert.equal(next.content.clicks,0);assert.equal(next.calls.length,0);
});

for(const mode of ['pending storage','audit storage rejection','bind rejection','content bind rejection','witness rejection','drain rejection'])test(mode+' cannot change submit, authoritative invoked intent, or replay safety',async t=>{
 const vm=require('node:vm'),f=await automaticFixture({root:root(t),bytes,verifyVideo:async()=>media});t.after(()=>f.close());
 const gate=deferred(),committed=deferred();t.after(()=>gate.resolve());let delivered=false,payload;
 f.wc.MuseExecutionAudit.settle=(p,onGap)=>Promise.resolve(p).catch(()=>onGap?.());
 const set=f.storage.set;
 f.storage.set=async values=>{
   if(mode==='pending storage' && Object.entries(values).some(([k,p])=>k.startsWith(W.PREFIX+'worker:') && p.watermark>0))await gate.promise;
   if(mode==='audit storage rejection' && Object.entries(values).some(([k,p])=>k.startsWith(W.PREFIX+'worker:') && p.watermark>0))throw Error('audit quota');
   const result=await set(values);
   if(Object.entries(values).some(([k,p])=>k.startsWith('generation-intent:') && p.invoked))committed.resolve();
   return result;
 };
 if(mode==='bind rejection')f.workerAudit.bind=()=>Promise.reject(Error('bind failure'));
 if(mode==='witness rejection')f.workerAudit.observe=()=>Promise.reject(Error('witness failure'));
 if(mode==='drain rejection')f.workerAudit.drain=()=>Promise.reject(Error('drain failure'));
 const send=f.wc.chrome.tabs.sendMessage;
 f.wc.chrome.tabs.sendMessage=async(id,m)=>{
   if(mode==='content bind rejection' && m.type==='viral-ai:muse-audit-bind')throw Error('content bind failure');
   if(m.type==='viral-ai:muse-execution' && m.command==='submitGeneration'){
     delivered=true;payload=m.payload;assert.equal(f.storage.data['generation-intent:'+payload.operationId].invoked,true);
   }
   return send(id,m);
 };
 const admitting=f.admit();await committed.promise;await turn();
 assert.equal(delivered,true,'content delivery occurs on the next event loop turn with telemetry still unresolved');assert.equal(gate.settled,false);
 const j=await admitting;assert.equal(j.status,'running');assert.equal(f.content.clicks,1);assert.equal(gate.settled,false);
 const {observationToken,...originalPayload}=payload;
 f.wc.replay={id:uuid(),type:'submitGeneration',payload:originalPayload};assert.equal((await vm.runInContext('execute(replay)',f.wc)).state,'interrupted');assert.equal(f.content.clicks,1);
 gate.resolve();await f.workerAudit.flush();
 // Drain failures are telemetry-only; use the same source's normal drain for reporting.
 if(mode==='drain rejection')f.workerAudit.drain=async()=>false;
 await f.drain();assert.equal(f.service.get(j.id).status,'running');
 if(mode.includes('rejection'))assert.equal(f.service.executionAuditReport(j.id).coverage.state,'partial');
});

test('content click and returned/threw_unknown witnesses survive unresolved content audit storage',async()=>{
 for(const clickThrows of [false,true]){
   const storage=memoryStorage(),gate=deferred(),get=storage.get;
   storage.get=async k=>{await gate.promise;return get(k);};
   const f=contentFixture({storage,clickThrows}),jobId=uuid(),binding=f.audit.bind({jobId,auditId:uuid()});
   const result=await f.send('submitGeneration',{operationId:jobId,sceneId:'scene',prompt:'Synthetic prompt'});
   assert.equal(gate.settled,false);assert.equal(f.clicks,1);assert.equal(result.state,clickThrows?'interrupted':'running');assert.deepEqual(storage.data,{});
   gate.resolve();assert(await binding);await f.audit.flush();
   const p=Object.values(storage.data)[0];assert.equal(p.events[0].detail.outcome,clickThrows?'threw_unknown':'returned');
 }
});

test('final fresh validation to click contains no await; executeV2 and poll never await telemetry',()=>{
 const content=fs.readFileSync('extensions/meta-muse-bridge/content-script.js','utf8'),worker=fs.readFileSync('extensions/meta-muse-bridge/service-worker.js','utf8');
 const guard=content.indexOf('const current=composer();',content.indexOf("invocation.reason='composer-changed'")),click=content.indexOf('button.click();',guard);
 assert(guard>=0 && click>guard);assert(!/\bawait\b/.test(content.slice(guard,click)));
 const submit=worker.slice(worker.indexOf('async function executeV2'));
 assert(!/\bawait\s+[^;\n]*(?:[Aa]udit|ExecutionAudit)/.test(submit));
 assert(!/prepareExecutionAuditSafely\(c\)\s*\.then/.test(worker));assert(worker.includes('const execution=execute(c).finally'));
});
