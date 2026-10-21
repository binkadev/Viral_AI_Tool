"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createFixture}=require('../dev/manual-recovery-fixture');
const {GenerationService}=require('../services/generation/generation-service');
const {GenerationStore}=require('../services/generation/generation-store');
const {registerGenerationIpc}=require('../services/generation/generation-ipc');
const C=require('../extensions/meta-muse-bridge/manual-recovery-contract');
const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]),media={duration:1,width:160,height:90};
async function fixture(t,options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-recovery-test-'));
  const f=createFixture({root,bytes,verifyVideo:async()=>media,...options});t.after(()=>{f.close();fs.rmSync(root,{recursive:true,force:true});});
  const job=await f.admit();return {...f,f,job,root};
}
test('prospective admission only; explicit discovery leaves automatic evidence and send count unchanged',async t=>{
  const {f,job}=await fixture(t);
  assert.deepEqual(job.manualRecovery,{version:1,eligible:true});assert.equal(job.status,'interrupted');assert.equal(f.fetches,0);
  assert.equal(f.calls.some(c=>c.type==='listRecoveryCandidates'),false);
  const operation=path.join(f.service.context(job).outputDirectory,'muse-operation.json'),before=fs.readFileSync(operation),calls=f.calls.length;
  const s=await f.service.listRecoveryCandidates(job.id);assert.equal(s.candidates.length,2);assert.equal(f.fetches,0);
  assert.equal(f.calls.length,calls+1);assert.equal(f.calls.at(-1).type,'listRecoveryCandidates');assert.deepEqual(fs.readFileSync(operation),before);
  assert(!JSON.stringify(s).includes('blob:'));assert(!JSON.stringify(s).includes('selector'));assert(!JSON.stringify(s).includes('fixture-instance'));
});
test('second revealed candidate completes through bounded native publication with truthful durable provenance and restart',async t=>{
  const {f,job,root}=await fixture(t),before=fs.readFileSync(path.join(f.service.context(job).outputDirectory,'muse-operation.json'));
  const s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);assert.deepEqual(f.focus,[['tab',5],['window',7],['highlight',2]]);assert.equal(f.fetches,0);
  const [a,b]=await Promise.all([f.service.confirmRecoveryCandidate(job.id,id),f.service.confirmRecoveryCandidate(job.id,id)]);
  assert.equal(a.status,'completed');assert.deepEqual(a,b);assert.equal(f.fetches,1);assert.deepEqual(a.attempts,job.attempts);
  const r=a.outputResolution;assert.equal(r.mode,'user-confirmed');assert.equal(r.automaticOwnershipVerified,false);assert.equal(r.automaticOutcome,'interrupted');assert.equal(r.phase,'published');
  assert.equal(r.verified.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(r.verified.media,media);
  assert.equal(f.service.output(job.id).verified,true);assert.equal(fs.readdirSync(f.service.context(job).outputDirectory).filter(n=>n.endsWith('.mp4')).length,1);
  assert.deepEqual(fs.readFileSync(path.join(f.service.context(job).outputDirectory,'muse-operation.json')),before);
  const again=await f.service.confirmRecoveryCandidate(job.id,id);assert.deepEqual(again,a);assert.equal(f.fetches,1);
  const restarted=new GenerationService({root,registry:f.registry});assert.deepEqual(restarted.get(job.id).outputResolution,r);assert.equal(restarted.output(job.id).verified,true);
  const stored=fs.readFileSync(path.join(root,'jobs.json'),'utf8');for(const forbidden of ['blob:','documentEpoch','observationToken','revision','fixture-instance'])assert(!stored.includes(forbidden));
});
test('cannot confirm before exact reveal acknowledgment; no acquisition',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,s.candidates[0].candidateId));assert.equal(f.fetches,0);assert.equal(f.service.get(job.id).status,'interrupted');
});
for(const mode of ['navigate','reload','restartWorker','replaceContent','accountUncertain','containerChange','transientRemove','remount','disappear','sourceChange','expire','activity'])test('whole session revokes on '+mode,async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);f[mode]();
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));assert.equal(f.fetches,0);assert.equal(f.service.get(job.id).status,'interrupted');
  assert.equal(f.service.get(job.id).outputResolution,undefined);
});
test('candidate-list revision change revokes even when original selected node remains',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[0].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);f.more();await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));assert.equal(f.fetches,0);
});
test('8 candidates allowed, 9 fail closed without truncation or selection',async t=>{
  const {f,job}=await fixture(t);f.more();f.nodes.pop();
  let s=await f.service.listRecoveryCandidates(job.id);assert.equal(s.candidates.length,8);assert.equal(f.fetches,0);
  await f.service.dismissRecovery(job.id);f.more();await assert.rejects(f.service.listRecoveryCandidates(job.id),{code:'RECOVERY_TOO_MANY'});assert.equal(f.fetches,0);
});
for(const field of ['job','project','scene','tab','epoch','candidate','revision','session'])test('exact bound identity rejects wrong '+field,async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),list=f.calls.find(c=>c.type==='listRecoveryCandidates').p;
  const privateSession=vm.runInContext('manualRecovery.controller.documentEpoch',f.context);
  const result=await f.bridge.command('listRecoveryCandidates',list,{instanceId:'fixture-instance',tabId:5});assert.equal(result.state,'unavailable');
  // A new explicit selection after dismissal provides the current complete token.
  await f.service.dismissRecovery(job.id);await f.service.listRecoveryCandidates(job.id);
  const workerSession=vm.runInContext('manualWorker',f.wc);assert(workerSession);
  // Capture actual token only at the private worker/content boundary.
  let captured;const original=f.wc.chrome.tabs.sendMessage;
  f.wc.chrome.tabs.sendMessage=async(id,m)=>{captured=m.payload;return original(id,m);};
  const live=f.service.manualSelectionJob;assert.equal(live,job.id);
  // Native service session has fresh IDs; obtain display-only candidate again after reset.
  await f.service.dismissRecovery(job.id);const fresh=await f.service.listRecoveryCandidates(job.id);await f.service.revealRecoveryCandidate(job.id,fresh.candidates[0].candidateId);
  const p={...captured};delete p.observationToken;
  const key={job:'operationId',project:'projectId',scene:'sceneId',tab:'tabId',epoch:'documentEpoch',candidate:'candidateId',revision:'revision',session:'selectionSessionId'}[field];p[key]=field==='tab'?99:field==='job'||field==='project'||field==='scene'?'wrong':crypto.randomUUID();
  const bad=await f.bridge.command('validateRecoveryCandidate',p,{instanceId:'fixture-instance',tabId:5});assert.equal(bad.state,'unavailable');assert.equal(f.fetches,0);assert(C.opaque(privateSession));assert(C.opaque(s.candidates[0].candidateId));
});
test('historical and E2E #15 identity cannot be enabled by load, discovery or renderer flags',async t=>{
  const {f,job,root}=await fixture(t);const old={...job,id:'81379514-7da7-4777-9a12-9b7e6108e20c'};delete old.manualRecovery;
  f.service.commit(old);const storeBefore=fs.readFileSync(path.join(root,'jobs.json'));
  const restarted=new GenerationService({root,registry:f.registry});assert.equal(restarted.get(old.id).manualRecovery,undefined);
  await assert.rejects(restarted.listRecoveryCandidates(old.id));assert.deepEqual(fs.readFileSync(path.join(root,'jobs.json')),storeBefore);
  await assert.rejects(f.service.listRecoveryCandidates('71e52ccf-a0ac-45af-a667-30146d3312c2'));
});
test('strict IPC rejects URL, path, selector, project/scene and ownership overrides at every action',async t=>{
  const {f,job}=await fixture(t),handlers={};registerGenerationIpc({ipcMain:{handle:(k,fn)=>handlers[k]=fn},getService:()=>f.service,trusted:e=>e.trusted});
  for(const action of ['recovery-reveal','recovery-confirm'])for(const override of [{url:'blob:https://muse.ai/private'},{path:'C:/private.mp4'},{selector:'video'},{projectId:'other'},{sceneId:'other'},{automaticOwnershipVerified:true},{extra:{}}]) {
    const r=await handlers['generation:'+action]({trusted:true},{jobId:job.id,candidateId:crypto.randomUUID(),...override});assert.equal(r.errorCode,'INVALID_REQUEST');
  }
  assert.equal((await handlers['generation:recovery-candidates']({},job.id)).errorCode,'UNAVAILABLE');
  assert.equal((await handlers['generation:recovery-candidates']({trusted:true},{jobId:job.id,eligible:true})).errorCode,'INVALID_REQUEST');assert.equal(f.fetches,0);
});
for(const mode of ['confirmation','verified-output','invalid-mp4','native-probe'])test('failure '+mode+' publishes no completion, output or new attempt',async t=>{
  const {f,job}=await fixture(t,{bytes:mode==='invalid-mp4'?Buffer.alloc(76):bytes,verifyVideo:async()=>{if(mode==='native-probe')throw Error('bad native video');return media;}});
  const s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;await f.service.revealRecoveryCandidate(job.id,id);
  f.failPersistence=mode==='confirmation';f.failOutputPersistence=mode==='verified-output';
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));assert.equal(f.service.get(job.id).status,'interrupted');assert.deepEqual(f.service.get(job.id).attempts,job.attempts);
  assert.throws(()=>f.service.output(job.id));assert(!fs.existsSync(path.join(f.service.context(job).outputDirectory,job.id+'.mp4')));
  assert.equal(f.fetches,mode==='confirmation'?0:1);
});
test('double click and second candidate race cannot authorize a second transfer',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);
  for(const candidate of s.candidates)await f.service.revealRecoveryCandidate(job.id,candidate.candidateId);
  const first=f.service.confirmRecoveryCandidate(job.id,s.candidates[1].candidateId);
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,s.candidates[0].candidateId));await first;assert.equal(f.fetches,1);
});
test('dismissal retains interrupted automatic evidence; restart restores no capability or automatic acquisition',async t=>{
  const {f,job,root}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);
  await f.service.dismissRecovery(job.id);assert.deepEqual(f.service.get(job.id),job);assert.equal(f.fetches,0);
  await assert.rejects(f.service.revealRecoveryCandidate(job.id,s.candidates[0].candidateId));
  const next=new GenerationService({root,registry:f.registry});await assert.rejects(next.confirmRecoveryCandidate(job.id,s.candidates[0].candidateId));assert.equal(f.fetches,0);
});
test('unknown provenance fields, capability persistence and malformed identity fail store validation',async t=>{
  const {f,job,root}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);await f.service.revealRecoveryCandidate(job.id,s.candidates[1].candidateId);await f.service.confirmRecoveryCandidate(job.id,s.candidates[1].candidateId);
  const completed=f.service.get(job.id),store=new GenerationStore(root);
  for(const patch of [{url:'blob:https://muse.ai/private'},{revision:crypto.randomUUID()},{version:2},{projectId:'wrong'},{automaticOwnershipVerified:true},{verified:{fileName:job.id+'.mp4',size:76,sha256:'a'.repeat(64),media:{...media,token:'secret'}}}]) {
    assert.throws(()=>store.save([{...completed,outputResolution:{...completed.outputResolution,...patch}}]),{code:'STORE_UNAVAILABLE'});
  }
});

test('durable confirmation precedes the sole fetch; receipt checks remain exclusive to automatic acquisition',async t=>{
  const {f,job,root}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);
  f.onFetch=()=>{
    const durable=new GenerationStore(root).load().find(j=>j.id===job.id);
    assert.equal(durable.outputResolution.mode,'user-confirmed');assert.equal(durable.outputResolution.phase,'acquiring');
    assert.equal(durable.outputResolution.automaticOwnershipVerified,false);assert.equal(durable.attempts.at(-1).status,'interrupted');
  };
  await f.service.confirmRecoveryCandidate(job.id,id);
  assert.equal(f.calls.filter(c=>c.type==='acquireGenerationResult').length,0);
  const automatic=require('../services/generation/bridge/execution-contract');
  const manual=f.calls.find(c=>c.type==='acquireRecoveryCandidate').p;
  assert.equal(automatic.validPayload('acquireGenerationResult',manual),false);assert.equal(C.request('acquireRecoveryCandidate',manual),true);
});
for(const stage of ['fetch','read'])test('source mutation during '+stage+' aborts without publishing MP4',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);f[stage==='fetch'?'onFetch':'onRead']=()=>f.sourceChange();
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));assert.equal(f.service.get(job.id).status,'interrupted');assert.equal(f.fetches,1);
  assert(!fs.existsSync(path.join(f.service.context(job).outputDirectory,job.id+'.mp4')));
});
for(const kind of ['hash','size','sequence','offset','transfer'])test('shared bounded transfer rejects corrupt '+kind,async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);
  const original=f.bridge.command;
  f.bridge.command=async(...args)=>{
    const r=await original(...args);if(args[0]==='acquireRecoveryCandidate' && r.state==='result') {
      if(kind==='hash')r.chunkHash='0'.repeat(64);
      if(kind==='size')r.total++;
      if(kind==='sequence')r.sequence++;
      if(kind==='offset')r.offset++;
      if(kind==='transfer')r.transferId=crypto.randomUUID();
    }return r;
  };
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));assert.equal(f.service.get(job.id).status,'interrupted');assert.throws(()=>f.service.output(job.id));
});
test('HTTPS-only and stream-backed videos never become eligible; selected blob retains exact node index',async t=>{
  const {f,job}=await fixture(t);f.nodes[0].currentSrc='https://muse.ai/private.mp4';
  const s=await f.service.listRecoveryCandidates(job.id);assert.equal(s.candidates.length,1);
  await f.service.revealRecoveryCandidate(job.id,s.candidates[0].candidateId);await f.service.confirmRecoveryCandidate(job.id,s.candidates[0].candidateId);assert.equal(f.fetches,1);
  const second=await fixture(t);for(const node of second.f.nodes){node.srcObject={};}
  const none=await second.f.service.listRecoveryCandidates(second.job.id);assert.equal(none.candidates.length,0);assert.equal(second.f.fetches,0);
});
test('one session only, opaque IDs refresh after dismissal, no implicit selection',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);
  assert(s.candidates.every(c=>C.opaque(c.candidateId)));assert(C.opaque(s.selectionSessionId));
  await assert.rejects(f.service.listRecoveryCandidates(job.id));assert.equal(f.fetches,0);
  await f.service.dismissRecovery(job.id);const fresh=await f.service.listRecoveryCandidates(job.id);
  assert.notEqual(fresh.selectionSessionId,s.selectionSessionId);assert(fresh.candidates.every(c=>!s.candidates.some(v=>v.candidateId===c.candidateId)));
  await assert.rejects(f.service.revealRecoveryCandidate(job.id,s.candidates[0].candidateId));assert.equal(f.fetches,0);
});
test('restart during acquisition never reacquires and keeps automatic attempt interrupted',async t=>{
  const {f,job,root}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);
  let restarted;
  f.onFetch=()=>{restarted=new GenerationService({root,registry:f.registry});assert.equal(restarted.get(job.id).status,'interrupted');};
  await f.service.confirmRecoveryCandidate(job.id,id);
  assert.equal(restarted.get(job.id).outputResolution.phase,'interrupted');assert.deepEqual(restarted.get(job.id).attempts,job.attempts);
  const count=f.fetches;await restarted.recover(job.id);assert.equal(f.fetches,count);
});
test('durable verified local publication can finalize after restart only with native and digest checks',async t=>{
  const {f,job,root}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);const completed=await f.service.confirmRecoveryCandidate(job.id,id),count=f.fetches;
  f.service.commit({...completed,status:'interrupted',output:null,asset:null,outputResolution:{...completed.outputResolution,phase:'interrupted',publication:'pending'}});
  const next=new GenerationService({root,registry:f.registry});assert.equal((await next.recover(job.id)).status,'completed');assert.equal(f.fetches,count);assert.deepEqual(next.get(job.id).attempts,job.attempts);
  const file=next.output(job.id).path;fs.appendFileSync(file,Buffer.from('tamper'));next.commit({...next.get(job.id),status:'interrupted'});
  assert.equal((await next.recover(job.id)).status,'interrupted');assert.equal(f.fetches,count);
});
test('an independent prompt revokes old selection and never resubmits the interrupted job',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id);
  await f.service.revealRecoveryCandidate(job.id,s.candidates[0].candidateId);await f.admit('other-project','other-scene');
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,s.candidates[0].candidateId));assert.equal(f.fetches,0);
  assert.equal(f.calls.filter(c=>c.type==='submitGeneration' && c.p.operationId===job.id).length,1);
});

test('cancellation during acquisition cleans partial data, preserves interruption and never claims remote cancellation',async t=>{
  const {f,job}=await fixture(t),s=await f.service.listRecoveryCandidates(job.id),id=s.candidates[1].candidateId;
  await f.service.revealRecoveryCandidate(job.id,id);
  let cancelling;
  f.onFetch=()=>{cancelling=f.service.cancel(job.id);};
  await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));await cancelling;
  const current=f.service.get(job.id);assert.equal(current.status,'interrupted');assert.equal(current.attempts.length,1);assert.equal(current.attempts[0].status,'interrupted');
  assert(!fs.existsSync(path.join(f.service.context(job).outputDirectory,job.id+'.mp4')));assert(!fs.existsSync(path.join(f.service.context(job).outputDirectory,job.id+'.partial.mp4')));
  assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
});
