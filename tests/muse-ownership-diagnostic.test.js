"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {GenerationService}=require('../services/generation/generation-service');
const {GenerationStore}=require('../services/generation/generation-store');
const {ProviderRegistry}=require('../services/generation/provider-registry');
const {createJob}=require('../services/generation/generation-job');
const {normalizeRequest}=require('../services/generation/generation-request');
const {createMuseProvider}=require('../services/generation/providers/muse-provider');
const {MetaMuseExtensionBridge}=require('../services/generation/bridge/meta-muse-extension-bridge');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const diagnosis=()=>({receiptAvailable:true,ownedUserMatches:1,rows:[{id:'c'.repeat(64),role:'user',ownedUser:true,parentIndex:0,nextSiblingIndex:-1,ancestors:[],candidates:[],linkage:[],videoCount:0,sourceTypes:[]}]});
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-ownership-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Seed synthetic durable evidence. These tests never submit even a fake job.
 const request=normalizeRequest({projectId:'project',sceneId:'scene',providerId:'muse',idempotencyKey:'key',prompt:'Fixture only'});
 const job={...createJob(request,{model:{id:null,provider:'muse'},estimate:{known:false}}),status:'interrupted'};
 const store=new GenerationStore(root);store.save([job]);
 const directory=path.join(root,'outputs',job.id);fs.mkdirSync(directory,{recursive:true});
 const file=path.join(directory,'muse-operation.json');
 const record={operationId:job.id,sceneId:job.sceneId,digest:hash(job.sceneId+'\0'+request.prompt),createdAt:Date.now(),target:{instanceId:'profile-one',tabId:5},receipt:{version:2,operationId:job.id,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)],userStableIdHash:'c'.repeat(64),acceptance:{baselineIntact:true,uniqueUserTurn:true,composerCleared:true,sendControlTransition:true,generationControlObserved:true}}};
 fs.writeFileSync(file,JSON.stringify(record));
 const calls=[],bridge={developmentDiagnostics:true,command:async(type,p,target)=>{
   calls.push({type,p,target});assert.equal(type,'inspectGeneration');assert.equal(p.diagnoseOwnership,true);
   return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipDiagnostic:diagnosis()};
 }};
 const registry=new ProviderRegistry();registry.register(createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:bridge,verifyVideo:async()=>{throw Error('NO ACQUISITION');}}));
 const service=new GenerationService({root,registry});
 for(const method of ['submit','execute','recover','cancel','retry','commit'])service[method]=()=>{throw Error('MUTATION FORBIDDEN: '+method);};
 return {root,job,file,record,service,bridge,calls};
}
test('durable V2 user-only dev diagnosis observes one existing job without any mutation or reconciliation',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file),memory=JSON.stringify(f.service.jobs);
 for(const status of ['interrupted','running']){
   f.service.jobs[0].status=status;
   const result=await f.service.diagnoseMuseOwnership(f.job.id);
   assert.equal(result.userStableIdHash,f.record.receipt.userStableIdHash);assert.equal(result.diagnostic.ownedUserMatches,1);
   assert.equal(result.ok,true);assert.equal(result.nativeUserAnchor,true);assert.equal(result.workerUserAnchor,true);
   assert.equal(result.historicalAssistantOwnershipFailure,null,'Old records have no fabricated history');
   assert.deepEqual(Object.keys(f.calls.at(-1).p).sort(),['diagnoseOwnership','operationId','ownedUserHash','sceneId','tabId']);
   assert.equal(f.calls.at(-1).p.ownedUserHash,f.record.receipt.userStableIdHash);
   assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
   assert.equal(f.service.jobs[0].status,status);
 }
 f.service.jobs[0].status='interrupted';assert.equal(JSON.stringify(f.service.jobs),memory);
 assert.equal(f.service.monitors.size,0);assert.equal(f.service.recovering.size,0);
});

test('historical Gate-D evidence and current DOM census are separate, immutable, and support-only',async t=>{
 const f=fixture(t),{failure}=require('./fixtures/muse-assistant-failure');
 f.record.assistantOwnershipFailure=failure();fs.writeFileSync(f.file,JSON.stringify(f.record));
 const bytes=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file);
 const report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(report.historicalAssistantOwnershipFailure.terminalReason,'BLOCK_PARENT_MISMATCH');
 assert.equal(report.historicalAssistantOwnershipFailure.frameCount,1);assert.equal(report.diagnostic.ownedUserMatches,1);
 assert.equal(report.diagnostic.rows[0].ownedUser,true);assert.equal(report.nativeAssistantAnchor,false);assert.equal(report.workerAssistantAnchor,false);
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].p.diagnoseOwnership,true);
 assert(!Object.keys(f.calls[0].p).includes('assistantOwnershipFailure'));
 f.bridge.command=async()=>{throw Error('private transport error');};
 const unavailable=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(unavailable.ok,false);assert.deepEqual(unavailable.historicalAssistantOwnershipFailure,report.historicalAssistantOwnershipFailure);
 assert.deepEqual(fs.readFileSync(f.file),bytes);
 const {sanitize}=require('../services/generation/bridge/ownership-diagnosis');
 for(const patch of [{url:'private'},{terminalReason:'private'},{frameCount:17},{lastFrame:{...report.historicalAssistantOwnershipFailure.lastFrame,token:'private'}}]){
   const bad=sanitize({...report,historicalAssistantOwnershipFailure:{...report.historicalAssistantOwnershipFailure,...patch}},f.job.id);
   assert.equal(bad.reason,'DIAGNOSTIC_RESULT_INVALID');assert(!JSON.stringify(bad).includes('private'));
 }
});

for(const [version,suffix] of [['0-3-8','assistdiag1'],['0-3-9','assistdiag2'],['0-3-10','assistsettle1'],['0-3-11','userchurn1']])test('historical '+version+' Gate-D summary remains readable without diagnostic migration',async t=>{
 const f=fixture(t),{failure}=require('./fixtures/muse-assistant-failure');
 const d=failure('BLOCK_NONCONTIGUOUS');d.build=`muse-content-v${version}-contract3-receipt2-${suffix}`;
 if(version!=='0-3-8')Object.assign(d.frames[0],require('../extensions/meta-muse-bridge/receipt-v2').emptyAssistantSequence());
 Object.assign(d.frames[0],{generationActive:null,blockRowCount:0,mediaCandidateCount:null,sameSequenceParent:true,blockContiguous:false});
 f.record.assistantOwnershipFailure=d;fs.writeFileSync(f.file,JSON.stringify(f.record));const before=fs.readFileSync(f.file);
 const report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(report.historicalAssistantOwnershipFailure.build,d.build);assert.deepEqual(report.historicalAssistantOwnershipFailure.lastFrame,d.frames[0]);
 assert.equal(Object.hasOwn(report.historicalAssistantOwnershipFailure.lastFrame,'firstMismatchCategory'),version!=='0-3-8');
 assert.equal(report.historicalUserAnchorChurn,null);
 assert.equal(report.historicalBaselineDrift,null);
 assert.equal(report.diagnostic.ownedUserMatches,1);assert.deepEqual(fs.readFileSync(f.file),before);
});

test('historical user churn is independent of current census and survives bounded transport failures without writes',async t=>{
 const f=fixture(t),schema=require('../extensions/meta-muse-bridge/receipt-v2');
 const d={version:1,build:'muse-content-v0-3-11-contract3-receipt2-userchurn1',kind:'SAME_NODE_ID_CHANGED',elapsedBucket:'under_1s',mutationCount:'one_to_four',
   ...Object.fromEntries(schema.userChurnBools.map(k=>[k,null])),...Object.fromEntries(schema.userChurnCounts.map(k=>[k,null]))};
 assert(schema.validUserAnchorChurn(d));f.record.userAnchorChurn=d;fs.writeFileSync(f.file,JSON.stringify(f.record));
 const before=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file),report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.deepEqual(report.historicalUserAnchorChurn,d);assert.equal(report.historicalAssistantOwnershipFailure,null);assert.equal(report.diagnostic.ownedUserMatches,1);
 assert.equal(report.historicalBaselineDrift,null,'No retrospective baseline evidence in a 0.3.11 record');
 const {sanitize}=require('../services/generation/bridge/ownership-diagnosis');
 for(const patch of [{rawNativeId:'private'},{prompt:'private'},{url:'private'},{cookie:'private'},{kind:'private'},{mutationCount:999},{freshLogicalUserCount:129}]){
   const safe=sanitize({...report,historicalUserAnchorChurn:{...d,...patch}},f.job.id);assert.equal(safe.reason,'DIAGNOSTIC_RESULT_INVALID');assert(!JSON.stringify(safe).includes('private'));
 }
 f.bridge.command=async()=>{throw Error('private transport error');};
 const failed=await f.service.diagnoseMuseOwnership(f.job.id);assert.equal(failed.ok,false);assert.deepEqual(failed.historicalUserAnchorChurn,d);
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
 assert(!f.calls.some(c=>c.p.userAnchorChurn!==undefined || c.p.historicalUserAnchorChurn!==undefined));
});

test('historical baseline drift is separately sanitized and never reconstructed or persisted by support diagnosis',async t=>{
 const f=fixture(t),schema=require('../extensions/meta-muse-bridge/receipt-v2');
 const d={version:1,build:require('../services/generation/bridge/extension-distribution.json').expectedContentBuild,kind:'BASELINE_ROW_REMOVED',elapsedBucket:'10_to_60s',mutationCountBucket:'one_to_four',firstMismatchKind:'BASELINE_ROW_REMOVED',firstMismatchIndexBucket:'one_to_four',
   ...Object.fromEntries(schema.baselineDriftCounts.map(k=>[k,null])),...Object.fromEntries(schema.baselineDriftBools.map(k=>[k,null]))};
 assert(schema.validBaselineDrift(d));f.record.baselineDrift=d;fs.writeFileSync(f.file,JSON.stringify(f.record));
 const before=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file),report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.deepEqual(report.historicalBaselineDrift,d);assert.equal(report.historicalAssistantOwnershipFailure,null);assert.equal(report.historicalUserAnchorChurn,null);assert.equal(report.diagnostic.ownedUserMatches,1);
 const {sanitize}=require('../services/generation/bridge/ownership-diagnosis');
 for(const patch of [{rawId:'private'},{prompt:'private'},{url:'private'},{account:'private'},{kind:'private'},{baselineLength:258},{firstMismatchIndexBucket:4}]){
   const safe=sanitize({...report,historicalBaselineDrift:{...d,...patch}},f.job.id);assert.equal(safe.reason,'DIAGNOSTIC_RESULT_INVALID');assert(!JSON.stringify(safe).includes('private'));
 }
 f.bridge.command=async()=>{throw Error('private transport error');};const failed=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(failed.ok,false);assert.deepEqual(failed.historicalBaselineDrift,d);assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
 assert(!f.calls.some(c=>c.p.baselineDrift!==undefined || c.p.historicalBaselineDrift!==undefined));
});
for(const scenario of ['no user','assistant anchored','production','completed','wrong scene','wrong operation','legacy'])test('ownership diagnosis fails closed without mutation: '+scenario,async t=>{
 const f=fixture(t);
 if(scenario==='no user'){delete f.record.receipt.userStableIdHash;delete f.record.receipt.acceptance;}
 if(scenario==='assistant anchored')f.record.receipt.assistantStableIdHash='d'.repeat(64);
 if(scenario==='production')f.bridge.developmentDiagnostics=false;
 if(scenario==='completed')f.service.jobs[0].status='completed';
 if(scenario==='wrong scene')f.record.sceneId='other';
 if(scenario==='wrong operation')f.record.operationId='other';
 if(scenario==='legacy')f.record.receipt.version=1;
 fs.writeFileSync(f.file,JSON.stringify(f.record));const before=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file);
 const reasons={'no user':'USER_ANCHOR_MISSING','assistant anchored':'ASSISTANT_ALREADY_ANCHORED',completed:'JOB_STATE_UNSUPPORTED','wrong scene':'OPERATION_RECORD_UNAVAILABLE','wrong operation':'OPERATION_RECORD_UNAVAILABLE',legacy:'RECEIPT_UNAVAILABLE'};
 if(scenario==='production')await assert.rejects(f.service.diagnoseMuseOwnership(f.job.id),{code:'UNAVAILABLE'});
 else {const report=await f.service.diagnoseMuseOwnership(f.job.id);assert.equal(report.ok,false);assert.equal(report.reason,reasons[scenario]);}
 assert.equal(f.calls.length,0);
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
});
for(const forbidden of ['text','url','html','token','nativeId'])test('ownership diagnosis rejects unbounded/private adapter data: '+forbidden,async t=>{
 const f=fixture(t);f.bridge.command=async(_,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipDiagnostic:{...diagnosis(),[forbidden]:'private'}});
 const before=fs.readFileSync(f.file),report=await f.service.diagnoseMuseOwnership(f.job.id);assert.equal(report.reason,'DIAGNOSTIC_RESULT_INVALID');assert(!JSON.stringify(report).includes('private'));assert.deepEqual(fs.readFileSync(f.file),before);
});
test('trusted ownership IPC validates IDs and preload exposes only a job-ID method',async t=>{
 const f=fixture(t),handlers={};require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{handle:(k,v)=>handlers[k]=v},getService:()=>f.service,trusted:e=>e.trusted,developmentDiagnostics:true});
 const action=handlers['generation:ownership-diagnosis'];
 assert.equal((await action({trusted:false},f.job.id)).errorCode,'UNAVAILABLE');
 for(const p of [{id:f.job.id},'../job',null])assert.equal((await action({trusted:true},p)).errorCode,'INVALID_REQUEST');
 assert.equal(f.calls.length,0);assert.equal((await action({trusted:true},f.job.id)).ok,true);
 let api;const calls=[];
 vm.runInNewContext(fs.readFileSync('preload.js','utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer:{sendSync:()=>true,invoke:(...v)=>calls.push(v)}};}});
 api.diagnoseMuseOwnership(f.job.id);assert.deepEqual(calls,[['generation:ownership-diagnosis',f.job.id]]);
});
for(const scenario of ['different worker user','incorrect match count','receipt unavailable'])test('diagnosis cannot report ownership inconsistent with the native durable anchor: '+scenario,async t=>{
 const f=fixture(t);f.bridge.command=async(_,p)=>{
   const d=diagnosis();
   if(scenario==='different worker user')d.rows[0].id='d'.repeat(64);
   if(scenario==='incorrect match count')d.ownedUserMatches=2;
   if(scenario==='receipt unavailable')d.receiptAvailable=false;
   return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipDiagnostic:d};
 };
 const before=fs.readFileSync(f.file);assert.equal((await f.service.diagnoseMuseOwnership(f.job.id)).reason,'DIAGNOSTIC_RESULT_INVALID');assert.deepEqual(fs.readFileSync(f.file),before);
});
test('ownership bridge transport neither starts/prunes nor changes session/selection, including poll/result',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-ownership-http-'));
 const bridge=new MetaMuseExtensionBridge({userDataPath:root,developmentDiagnostics:true});await bridge.start();
 t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
 const origin='chrome-extension://'+'a'.repeat(32),token='a'.repeat(64),id='profile-one';
 bridge.sessions.set(id,{instanceId:id,origin,token,lastSeen:Date.now(),extensionState:'extension_connected',tabs:[{tabId:5,authState:'authenticated',executionContract:3,contentFresh:true,runtimeBuild:{diagnosticsEnabled:true,workerBuild:bridge.distribution.expectedWorkerBuild,contentBuild:bridge.distribution.expectedContentBuild}}]});
 bridge.sessions.set('stale',{lastSeen:0});
 bridge.selectedInstanceId=id;bridge.selectedTabId=5;
 const before=JSON.stringify([...bridge.sessions]),selection=[bridge.selectedInstanceId,bridge.selectedTabId];
 bridge.start=bridge.prune=()=>{throw Error('SESSION MUTATION FORBIDDEN');};
 const payload={tabId:5,operationId:'op',sceneId:'scene',diagnoseOwnership:true};
 const task=bridge.command('inspectGeneration',payload,{instanceId:id,tabId:5});
 const send=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+bridge.port+'/v1/'+route+'?instanceId='+id,{method:body?'POST':'GET',headers:{Origin:origin,'X-Viral-Muse-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
 const command=(await send('poll')).command;assert.equal(command.type,'inspectGeneration');
 await send('result',{commandId:command.id,ok:true,result:{operationId:'op',sceneId:'scene',state:'interrupted',ownershipDiagnostic:diagnosis()}});
 assert.equal((await task).ownershipDiagnostic.ownedUserMatches,1);assert.equal(JSON.stringify([...bridge.sessions]),before);assert.deepEqual([bridge.selectedInstanceId,bridge.selectedTabId],selection);
 assert.equal(bridge.pending.size,0);assert(!fs.existsSync(bridge.selectionFile));
 const invalid=bridge.command('inspectGeneration',payload,{instanceId:id,tabId:5});
 const rejected=assert.rejects(invalid,e=>e.ownershipDiagnosis.reason==='DIAGNOSTIC_RESULT_INVALID');
 const second=(await send('poll')).command;
 await send('result',{commandId:second.id,ok:true,result:{operationId:'op',sceneId:'scene',state:'interrupted',ownershipDiagnostic:{...diagnosis(),text:'private'}}});
 await rejected;assert.equal(JSON.stringify([...bridge.sessions]),before);assert.equal(bridge.pending.size,0);
 bridge.sessions.get(id).lastSeen=0;await assert.rejects(bridge.command('inspectGeneration',payload,{instanceId:id,tabId:5}),e=>e.ownershipDiagnosis.reason==='TARGET_INSTANCE_UNAVAILABLE');assert.equal(bridge.sessions.size,2);
});
test('native validation returns the first bounded gate and never queries the bridge',async t=>{
 const f=fixture(t);
 assert.equal((await f.service.diagnoseMuseOwnership('missing-job')).reason,'JOB_NOT_FOUND');
 fs.writeFileSync(f.file,'invalid JSON');
 const report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(report.reason,'OPERATION_RECORD_UNAVAILABLE');assert.equal(report.layer,'native_validation');
 assert.equal(report.instanceMatch,null);assert.equal(f.calls.length,0);
});
for(const scenario of ['instance','tab','old runtime','content','diagnostics'])test('exact recorded target gate is bounded and never retargets: '+scenario,async t=>{
 const f=fixture(t),bridge=new MetaMuseExtensionBridge({userDataPath:f.root,developmentDiagnostics:true});
 // No listening socket is needed: every case rejects before allocating transport.
 bridge.server={};bridge.start=bridge.prune=()=>{throw Error('FORBIDDEN');};
 const tab={tabId:5,authState:'authenticated',executionContract:3,contentFresh:true,runtimeBuild:{diagnosticsEnabled:true,workerBuild:bridge.distribution.expectedWorkerBuild,contentBuild:bridge.distribution.expectedContentBuild}};
 bridge.sessions.set('profile-one',{lastSeen:Date.now(),extensionState:'extension_connected',tabs:[tab]});
 bridge.sessions.set('unrelated',{lastSeen:Date.now(),extensionState:'extension_connected',tabs:[tab]});
 bridge.selectedInstanceId='unrelated';bridge.selectedTabId=5;
 if(scenario==='instance')bridge.sessions.delete('profile-one');
 if(scenario==='tab')bridge.sessions.get('profile-one').tabs=[];
 if(scenario==='old runtime')tab.runtimeBuild.workerBuild='muse-worker-v0-3-3-contract3-receipt2-acceptance3';
 if(scenario==='content')tab.contentFresh=false;
 if(scenario==='diagnostics')tab.runtimeBuild.diagnosticsEnabled=false;
 const before=JSON.stringify([...bridge.sessions]);
 f.bridge.command=(...args)=>bridge.command(...args);
 const report=await f.service.diagnoseMuseOwnership(f.job.id);
 assert.equal(report.reason,{instance:'TARGET_INSTANCE_UNAVAILABLE',tab:'TARGET_TAB_UNAVAILABLE','old runtime':'RUNTIME_BUILD_MISMATCH',content:'CONTENT_RECEIVER_UNAVAILABLE',diagnostics:'EXTENSION_DIAGNOSTICS_DISABLED'}[scenario]);
 assert.equal(report.instanceMatch,scenario!=='instance');assert.equal(report.tabMatch,!['instance','tab'].includes(scenario));
 assert.equal(bridge.pending.size,0);assert.equal(JSON.stringify([...bridge.sessions]),before);assert.equal(bridge.selectedInstanceId,'unrelated');
});
for(const reason of ['WORKER_INTENT_UNAVAILABLE','WORKER_RECEIPT_MISMATCH','CONTENT_RECEIVER_UNAVAILABLE','CONTENT_DIAGNOSIS_REJECTED'])test('worker bounded failure reaches support JSON without receipt/job writes: '+reason,async t=>{
 const f=fixture(t),before=fs.readFileSync(f.file),jobs=fs.readFileSync(f.service.store.file);
 f.bridge.command=async(_,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipFailure:{reason,tabMatch:true,workerIntentPresent:reason!=='WORKER_INTENT_UNAVAILABLE',workerUserAnchor:reason==='WORKER_RECEIPT_MISMATCH'?false:null,workerAssistantAnchor:false}});
 const report=await f.service.diagnoseMuseOwnership(f.job.id);assert.equal(report.reason,reason);assert.equal(report.nativeUserAnchor,true);assert.equal(report.instanceMatch,true);assert.equal(report.tabMatch,true);
 if(reason==='WORKER_RECEIPT_MISMATCH')assert.equal(report.workerUserAnchor,false);
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
});
test('failure reports are bounded, sanitized and cannot carry raw error text or an unknown enum',async t=>{
 const f=fixture(t);f.bridge.command=async()=>{throw Error('secret URL token account');};
 const report=await f.service.diagnoseMuseOwnership(f.job.id);assert.equal(report.reason,'UNKNOWN');assert(!JSON.stringify(report).includes('secret'));
 const schema=require('../extensions/meta-muse-bridge/receipt-v2');
 const value={reason:'WORKER_RECEIPT_MISMATCH',tabMatch:true,workerIntentPresent:true,workerUserAnchor:false,workerAssistantAnchor:false};
 assert(schema.validOwnershipFailure(value));assert(!schema.validOwnershipFailure({...value,reason:'private error'}));
 for(const key of ['text','url','html','token','nativeId'])assert(!schema.validOwnershipFailure({...value,[key]:'private'}));
});
