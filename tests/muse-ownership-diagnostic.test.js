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
   assert.deepEqual(Object.keys(f.calls.at(-1).p).sort(),['diagnoseOwnership','operationId','sceneId','tabId']);
   assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
   assert.equal(f.service.jobs[0].status,status);
 }
 f.service.jobs[0].status='interrupted';assert.equal(JSON.stringify(f.service.jobs),memory);
 assert.equal(f.service.monitors.size,0);assert.equal(f.service.recovering.size,0);
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
 await assert.rejects(f.service.diagnoseMuseOwnership(f.job.id));assert.equal(f.calls.length,0);
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
});
for(const forbidden of ['text','url','html','token','nativeId'])test('ownership diagnosis rejects unbounded/private adapter data: '+forbidden,async t=>{
 const f=fixture(t);f.bridge.command=async(_,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipDiagnostic:{...diagnosis(),[forbidden]:'private'}});
 const before=fs.readFileSync(f.file);await assert.rejects(f.service.diagnoseMuseOwnership(f.job.id));assert.deepEqual(fs.readFileSync(f.file),before);
});
test('trusted ownership IPC validates IDs and preload exposes only a job-ID method',async t=>{
 const f=fixture(t),handlers={};require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{handle:(k,v)=>handlers[k]=v},getService:()=>f.service,trusted:e=>e.trusted});
 const action=handlers['generation:ownership-diagnosis'];
 assert.equal((await action({trusted:false},f.job.id)).errorCode,'UNAVAILABLE');
 for(const p of [{id:f.job.id},'../job',null])assert.equal((await action({trusted:true},p)).errorCode,'INVALID_REQUEST');
 assert.equal(f.calls.length,0);assert.equal((await action({trusted:true},f.job.id)).ok,true);
 let api;const calls=[];
 vm.runInNewContext(fs.readFileSync('preload.js','utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer:{invoke:(...v)=>calls.push(v)}};}});
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
 const before=fs.readFileSync(f.file);await assert.rejects(f.service.diagnoseMuseOwnership(f.job.id));assert.deepEqual(fs.readFileSync(f.file),before);
});
test('ownership bridge transport neither starts/prunes nor changes session/selection, including poll/result',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-ownership-http-'));
 const bridge=new MetaMuseExtensionBridge({userDataPath:root,developmentDiagnostics:true});await bridge.start();
 t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
 const origin='chrome-extension://'+'a'.repeat(32),token='a'.repeat(64),id='profile-one';
 bridge.sessions.set(id,{instanceId:id,origin,token,lastSeen:Date.now(),extensionState:'extension_connected',tabs:[{tabId:5,authState:'authenticated',executionContract:3}]});
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
 bridge.sessions.get(id).lastSeen=0;await assert.rejects(bridge.command('inspectGeneration',payload,{instanceId:id,tabId:5}));assert.equal(bridge.sessions.size,2);
});
