"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {GenerationService}=require('../services/generation/generation-service');
const {ProviderRegistry}=require('../services/generation/provider-registry');
const {createMuseProvider}=require('../services/generation/providers/muse-provider');
const {normalizeRequest}=require('../services/generation/generation-request');
const {validPayload,validResult,validReceipt,COMMANDS}=require('../services/generation/bridge/execution-contract');
const {MetaMuseExtensionBridge}=require('../services/generation/bridge/meta-muse-extension-bridge');
const request=extra=>({projectId:'project',sceneId:'scene',providerId:'muse',idempotencyKey:'single',prompt:'  A red ball rolls slowly.  ',...extra});
// Synthetic receipts for native-service tests only; DOM acceptance is tested separately.
const receiptFor=p=>({version:1,operationId:p.operationId,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)],submittedUserMessageId:'c'.repeat(64),acceptance:{composerCleared:true,sendControlTransition:true,generationControlObserved:false}});
function withReceipt(result,p) {return ['running','result'].includes(result?.state)?{receipt:receiptFor(p),...(result.state==='result' && result.receipt?.version!==2?{assistantMessageId:'d'.repeat(64)}:{}),...result}:result;}
async function until(service,id,status) {
 for(let i=0;i<100;i++){const job=service.get(id);if(job.status===status)return job;await new Promise(r=>setTimeout(r,10));}
 assert.equal(service.get(id).status,status);
}
function fixture(t,{verifyVideo=async()=>{},command}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-execution-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[];let ready=true;
 const bridge={executionReady:async()=>ready,executionTarget:async()=>{if(!ready)throw Error('offline');return {instanceId:'profile-one',tabId:5};},
 command:async(type,payload)=>{calls.push({type,payload});if(!ready)throw Error('offline');return withReceipt(command?await command(type,payload):{operationId:payload.operationId,sceneId:payload.sceneId,state:type==='cancelGeneration'?'unsupported':'running',...(type==='cancelGeneration'?{confirmed:false}:{})},payload);}};
 const registry=new ProviderRegistry(),provider=createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:bridge,verifyVideo});registry.register(provider);
 const service=new GenerationService({root,registry});t.after(()=>{for(const timer of service.monitors.values())clearTimeout(timer);});
 return {root,registry,provider,service,calls,bridge,setReady:v=>ready=v};
}
test('authenticated connection alone cannot enable execution; contract and verifier required',async t=>{
 const f=fixture(t);assert.equal((await f.service.readiness()).ready,true);assert.deepEqual(f.provider.modelIds,[]);
 f.setReady(false);assert.equal((await f.service.readiness()).ready,false);
 const p=createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:{check:async()=>({state:'authenticated'})},verifyVideo:async()=>{}});
 assert.equal((await p.readiness()).ready,false);
 const noVerifier=createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:f.bridge});assert.equal((await noVerifier.readiness()).ready,false);
});
test('single scene exact prompt, idempotency, concurrent duplicate and no invented model',async t=>{
 const f=fixture(t);const [a,b]=await Promise.all([f.service.submit(request()),f.service.submit(request())]);assert.equal(a.id,b.id);
 const job=await until(f.service,a.id,'running');assert.equal(job.progress,null);assert.equal(job.modelId,null);
 await f.provider.start(f.service.context(job));assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
 assert.equal(f.calls[0].payload.prompt,request().prompt);
 await assert.rejects(f.service.submit(request({idempotencyKey:'second',sceneId:'another'})),{code:'DUPLICATE_JOB'});
 for(const change of [{sceneId:null},{sceneId:['a','b']},{modelId:'invented'},{durationSeconds:5},{referenceAssetIds:['a']}])assert.throws(()=>normalizeRequest(request(change)),{code:'INVALID_REQUEST'});
});
test('offline extension rejects before a job is created',async t=>{
 const f=fixture(t);f.setReady(false);await assert.rejects(f.service.submit(request()),{code:'PROVIDER_UNAVAILABLE'});assert.equal(f.service.jobs.length,0);assert.equal(f.calls.length,0);
});

for(const status of ['interrupted','failed','completed','cancelled']) {
 test('terminal Muse '+status+' history admits an independent key without altering history',async t=>{
   const f=fixture(t);f.service.execute=async()=>{};
   const queued=await f.service.submit(request());
   const old=f.service.commit({...queued,status});
   const before=JSON.stringify(old),storeBefore=fs.readFileSync(f.service.store.file);
   assert.equal((await f.service.museAdmission()).admissible,true);
   assert.deepEqual(fs.readFileSync(f.service.store.file),storeBefore);
   const next=await f.service.submit(request({idempotencyKey:'independent'}));
   assert.notEqual(next.id,old.id);assert.equal(next.status,'queued');
   assert.equal(JSON.stringify(f.service.get(old.id)),before);assert.equal(f.calls.length,0);
 });
}
for(const status of ['queued','preparing','submitting','running','verifying','cancelling']) {
 test('active Muse '+status+' blocks an independent operation',async t=>{
   const f=fixture(t);f.service.execute=async()=>{};
   const queued=await f.service.submit(request());f.service.commit({...queued,status});
   assert.equal((await f.service.museAdmission()).admissible,false);
   await assert.rejects(f.service.submit(request({idempotencyKey:'independent',sceneId:'other'})),{code:'DUPLICATE_JOB'});
   assert.equal(f.service.jobs.length,1);assert.equal(f.calls.length,0);
 });
}
test('interrupted same-key replay and explicit retry never resubmit; independent concurrent requests are single-flight',async t=>{
 const f=fixture(t,{command:()=>{throw Error('uncertain');}});
 const first=await f.service.submit(request());await until(f.service,first.id,'interrupted');
 const record=path.join(f.service.context(first).outputDirectory,'muse-operation.json'),before=fs.readFileSync(record);
 assert.equal((await f.service.submit(request())).id,first.id);
 await assert.rejects(f.service.retry(first.id,'retry-key'),{code:'RETRY_UNSAFE'});
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert.deepEqual(fs.readFileSync(record),before);
 f.service.execute=async()=>{};
 const results=await Promise.allSettled([f.service.submit(request({idempotencyKey:'new-a'})),f.service.submit(request({idempotencyKey:'new-b'}))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'DUPLICATE_JOB');
 assert.deepEqual(fs.readFileSync(record),before);
});
test('restart with interrupted history permits new admission without changing historical record',async t=>{
 const f=fixture(t,{command:()=>{throw Error('uncertain');}});
 const first=await f.service.submit(request());await until(f.service,first.id,'interrupted');
 const bytes=fs.readFileSync(f.service.store.file);
 const next=new GenerationService({root:f.root,registry:f.registry});next.execute=async()=>{};
 assert.deepEqual(fs.readFileSync(f.service.store.file),bytes);
 assert.equal((await next.museAdmission()).admissible,true);
 assert.deepEqual(fs.readFileSync(f.service.store.file),bytes);
 const previous=JSON.stringify(next.get(first.id));
 await next.submit(request({idempotencyKey:'after-restart'}));
 assert.equal(JSON.stringify(next.get(first.id)),previous);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
});
test('late reconciliation cannot revive interrupted Muse history after new slot admission',async t=>{
 let resolve;
 const f=fixture(t,{command:async(type,p)=>type==='submitGeneration'?{operationId:p.operationId,sceneId:p.sceneId,state:'interrupted'}:new Promise(r=>{resolve=()=>r({operationId:p.operationId,sceneId:p.sceneId,state:'running'});})});
 const old=await f.service.submit(request());await until(f.service,old.id,'interrupted');
 const pending=f.service.recover(old.id);while(!resolve)await new Promise(r=>setImmediate(r));
 f.service.execute=async()=>{};const next=await f.service.submit(request({idempotencyKey:'new-operation'}));
 resolve();await pending;
 assert.equal(f.service.get(old.id).status,'interrupted');assert.equal(f.service.get(next.id).status,'queued');
});
test('uncertain submission and authentication loss interrupt without resubmission',async t=>{
 const f=fixture(t,{command:()=>{throw Error('private provider error');}});const job=await f.service.submit(request());
 await until(f.service,job.id,'interrupted');await f.service.recover(job.id);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(!JSON.stringify(f.service.get(job.id)).includes('private'));
 const g=fixture(t);const running=await g.service.submit(request());await until(g.service,running.id,'running');g.setReady(false);
 await g.service.recover(running.id);assert.equal(g.service.get(running.id).status,'interrupted');
});
test('restart never submits persisted intent and keeps interrupted evidence private',async t=>{
 const f=fixture(t);const job=await f.service.submit(request());await until(f.service,job.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const next=new GenerationService({root:f.root,registry:f.registry});assert.equal(next.get(job.id).status,'interrupted');
 await next.recover(job.id);assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
 clearTimeout(next.monitors.get(job.id));
 assert(!JSON.stringify(next.get(job.id)).includes('profile-one'));
 assert.equal(next.get(job.id).request.prompt,request().prompt);
});
test('cancellation reports unsupported and late reconciliation cannot revive the job',async t=>{
 let resolve;
 const f=fixture(t,{command:async(type,p)=>{
   const base={operationId:p.operationId,sceneId:p.sceneId};
   if(type==='inspectGeneration')return new Promise(r=>resolve=()=>r({...base,state:'running'}));
   return {...base,state:type==='cancelGeneration'?'unsupported':'running',...(type==='cancelGeneration'?{confirmed:false}:{})};
 }});
 const job=await f.service.submit(request());await until(f.service,job.id,'running');
 const pending=f.service.recover(job.id);while(!resolve)await new Promise(r=>setImmediate(r));
 assert.equal((await f.service.cancel(job.id)).status,'interrupted');resolve();await pending;
 assert.equal(f.service.get(job.id).status,'interrupted');assert(f.calls.some(c=>c.type==='cancelGeneration'));
});
test('only typed commands and bounded operation-bound results cross bridge',()=>{
 const p={tabId:5,operationId:'op',sceneId:'scene'};
 assert.deepEqual([...COMMANDS],['submitGeneration','inspectGeneration','acquireGenerationResult','cancelGeneration','prepareGeneration']);
 for(const type of ['evaluate','executeScript','DOM','browserCommand'])assert.equal(validPayload(type,p),false);
 assert.equal(validPayload('submitGeneration',{...p,prompt:'test',selector:'body'}),false);
 for(const result of [{state:'completed'},{operationId:'other',sceneId:'scene',state:'result'},{...p,state:'result',url:'https://private'}, {operationId:'op',sceneId:'scene',state:'result',data:'AAAA'}])assert.equal(validResult('inspectGeneration',result,p),false);
});
test('live loopback contract gates selected authenticated tab and sanitizes results',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-contract-'));
 const bridge=new MetaMuseExtensionBridge({userDataPath:root});await bridge.start();t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
 let token='';const origin='chrome-extension://'+'a'.repeat(32);
 const send=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+bridge.port+'/v1/'+route+(route==='register'?'':'?instanceId=profile-one'),{method:body?'POST':'GET',headers:{Origin:origin,...(token?{'X-Viral-Muse-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,value:await r.json()};};
 token=(await send('register',{instanceId:'profile-one',profileLabel:'',browserName:'Chrome',extensionVersion:'0.3.11',protocolVersion:1})).value.token;
 const beat=contract=>send('heartbeat',{profileLabel:'',browserName:'Chrome',tabs:[{tabId:5,url:'https://muse.ai/',composerReady:true,inspectionComplete:true,...(contract?{executionContract:contract,canSubmit:true}:{})}]});
 await beat(false);assert.equal(await bridge.executionReady(),false);
 await beat(2);assert.equal(await bridge.executionReady(),false);
 await beat(3);assert.equal(await bridge.executionReady(),true);
 const target=await bridge.executionTarget(),p={tabId:5,operationId:'operation',sceneId:'scene',prompt:'exact'};
 const pending=bridge.command('submitGeneration',p,target);await new Promise(r=>setImmediate(r));
 const polled=(await send('poll')).value.command;assert.equal(polled.type,'submitGeneration');assert.equal(polled.payload.prompt,'exact');
 assert.equal((await send('poll')).value.command,null);
 assert.equal((await send('result',{commandId:polled.id,ok:true,result:{operationId:'unrelated',sceneId:'scene',state:'result'}})).status,400);
 await send('result',{commandId:polled.id,ok:true,result:withReceipt({operationId:'operation',sceneId:'scene',state:'running'},p)});assert.equal((await pending).state,'running');
 const snapshot=JSON.stringify(bridge.snapshot());for(const secret of [token,'https://','prompt','executionContract'])assert(!snapshot.includes(secret));
 await assert.rejects(bridge.command('executeScript',p,target));
});
test('worker durable intent deduplicates submit across worker restart',async()=>{
 const stored={},commands=[];
 const make=()=>{
  const chrome={runtime:{id:'ext',getManifest:()=>({version:'0.3.0',version_name:'development-diagnostics'}),onConnect:{addListener(){}},onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)}},tabs:{query:async()=>[{id:5}],sendMessage:async(id,m)=>{commands.push(m.command);return withReceipt({operationId:m.payload.operationId,sceneId:m.payload.sceneId,state:'running'},m.payload);}},alarms:{create(){},onAlarm:{addListener(){}}}};
  const c={chrome,navigator:{userAgent:'Edg/1'},crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync('extensions/meta-muse-bridge/acceptance-replay.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/receipt-v2.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/service-worker.js','utf8'),c);return c;
 };
 const c=make();c.command={id:'command',type:'submitGeneration',payload:{operationId:'op',sceneId:'s',tabId:5,prompt:'exact'}};
 await Promise.all([vm.runInContext('execute(command)',c),vm.runInContext('execute(command)',c)]);
 const next=make();next.command=c.command;await vm.runInContext('execute(command)',next);
 assert.equal(commands.filter(v=>v==='submitGeneration').length,1);assert(commands.includes('inspectGeneration'));
 assert(!JSON.stringify(stored).includes('exact'));
});
test('legacy receipt cannot acquire or publish even a candidate media fixture',async t=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(32)]);
 const f=fixture(t,{verifyVideo:async()=>{throw Error('LEGACY_VERIFIER_MUST_NOT_RUN');},command:async(type,p)=>{
   const base={operationId:p.operationId,sceneId:p.sceneId};
   if(type==='submitGeneration')return {...base,state:'running'};
   if(type==='inspectGeneration')return {...base,state:'result'};
   if(type==='acquireGenerationResult')return {...base,state:'result',offset:p.offset,total:bytes.length,data:bytes.subarray(p.offset).toString('base64')};
 }});
 const job=await f.service.submit(request());await until(f.service,job.id,'running');const completed=await f.service.recover(job.id);
 assert.equal(completed.status,'interrupted');assert.equal(completed.output,null);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
 const next=new GenerationService({root:f.root,registry:f.registry});assert.equal(next.get(job.id).status,'interrupted');assert.throws(()=>next.output(job.id));
});
test('invalid, missing or unrelated acquisition never publishes an asset',async t=>{
 for(const kind of ['missing','invalid','unrelated']) {
   const f=fixture(t,{verifyVideo:async()=>{throw Error('INVALID_MEDIA');},command:async(type,p)=>{
    const base={operationId:kind==='unrelated' && type!=='submitGeneration'?'foreign':p.operationId,sceneId:p.sceneId};
    if(type==='submitGeneration')return {...base,state:'running'};
    if(type==='inspectGeneration')return {...base,state:'result'};
    return {...base,state:'result',offset:0,total:16,data:kind==='missing'?'':Buffer.alloc(16).toString('base64')};
   }});
   const job=await f.service.submit(request());await until(f.service,job.id,'running');await f.service.recover(job.id);
   assert.equal(f.service.get(job.id).status,'interrupted');assert.equal(f.service.get(job.id).asset,null);
   assert(!fs.existsSync(path.join(f.root,'outputs',job.id,job.id+'.mp4')));
 }
});

function contentFixture(options={}) {
 const listeners=[];let rows=[],length=options.draftLength||0,clicks=0,online=true,stop=false,disconnected=0; const observerCallbacks=new Set(),observerCallback=()=>{for(const fn of [...observerCallbacks])fn();};
 const messageParent={tagName:'DIV',getAttribute:()=>null,parentElement:null,querySelectorAll:()=>rows,contains:node=>{for(let n=node,i=0;n && i<8;n=n.parentNode,i++)if(n===messageParent)return true;return false;}};
 const base=()=>({isConnected:true,disabled:false,hidden:false,getAttribute:()=>null,matches(){return this.disabled;},closest(selector){return this.hidden || selector==='[aria-disabled="true"]' && this.getAttribute('aria-disabled')==='true'?{}:null;},getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[]});
 function forbidText(n) {for(const k of ['textContent','innerText','innerHTML','nodeValue','value'])Object.defineProperty(n,k,{get(){throw Error('TEXT_READ_FORBIDDEN');},configurable:true});return n;}
 const node=(role,id,video=null)=>{const n=forbidText({...base(),id,role,parentNode:messageParent,parentElement:messageParent,getAttribute(k){return k==='data-message-role'?this.role:k==='data-message-id'?this.id:null;},querySelectorAll:s=>s==='video' && video?[video]:[]});if(video)video.closest=()=>n;return n;};
 const editor=forbidText({...base(),tagName:'TEXTAREA',readOnly:false,get textLength(){return length;},focus(){},dispatchEvent(){}});
 function Textarea(){}Object.defineProperty(Textarea.prototype,'value',{set:v=>{length=v.length;if(options.ownTrustedInput)events.input?.({isTrusted:true,type:'input',target:editor});}});
 const stopNode=base();
 const button={...base(),click(){
   clicks++;if(options.clickThrows)throw Error('click failure');
   if(options.clickOnly)return;
   if(!options.noNewUser)rows.push(node('user',options.userId||'new-user'));
   if(!options.noAssistant)rows.push(node('assistant',options.assistantId||'new-assistant',options.video));
   if(!options.noClear)length=0;
   if(options.active)stop=true;
   options.afterClick?.(api);
 }};
 if(options.disabled)button.disabled=true;
 if(options.hidden)button.hidden=true;
 if(options.ariaDisabled)button.getAttribute=k=>k==='aria-disabled'?'true':null;
 let activeButton=button;
 const slot={...base(),querySelectorAll:()=>activeButton && (length || options.keepButton) ? options.twoButtons?[activeButton,{...base()}]:[activeButton]:[],contains:b=>(length>0 || options.keepButton) && b===activeButton};
 const events={};
 let currentEditor=editor;
 const root={...base(),querySelectorAll:s=>s==='[data-hatch-composer-action-slot]'?[slot]:[currentEditor],addEventListener:(t,fn)=>events[t]=fn,removeEventListener:t=>delete events[t]};
 let currentRoot=root,postSendTicks=0;
 const documentEvents=new Map();
 if(!options.empty)rows=[node('user','history-user'),node('assistant','history-assistant')];
 const document={documentElement:{},readyState:'complete',querySelectorAll:s=>s==='video'?(options.historicalVideos||[]):s==='[data-hatch-composer-root]'?(online?[currentRoot]:[]):s==='[data-testid="hatch-composer-stop-button"]'?(stop?[stopNode]:[]):rows,
   addEventListener:(type,fn)=>{if(!documentEvents.has(type))documentEvents.set(type,new Set());documentEvents.get(type).add(fn);},
   removeEventListener:(type,fn)=>documentEvents.get(type)?.delete(fn),
   createTreeWalker:()=>({nextNode:()=>null})};
 const window={};window.top=window;
 const c={document,window,URL,fetch:options.fetch,AbortController,btoa,location:{origin:'https://muse.ai'},HTMLTextAreaElement:Textarea,Event:class{},NodeFilter:{SHOW_TEXT:4},crypto:options.crypto||require('node:crypto').webcrypto,TextEncoder,Date:options.clock?{now:options.clock}:Date,performance:options.monotonicClock?{now:options.monotonicClock}:undefined,
   setTimeout:(fn,ms)=>ms>=15000?setTimeout(fn,options.transferTimeout && ms===15000?20:ms).unref():setTimeout(()=>{if(options.disturb && events.input)events.input({isTrusted:true});if(options.mutating){rows=[node('user','changing-'+Math.random())];observerCallback?.();}if(clicks)options.onPostSendTick?.(api,++postSendTicks);fn();},ms===5000?100:1),clearTimeout,
   MutationObserver:class {constructor(fn){this.fn=records=>fn(records,this);}observe(){observerCallbacks.add(this.fn);}disconnect(){observerCallbacks.delete(this.fn);disconnected++;}},
   getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),chrome:{runtime:{id:'ext',getManifest:()=>options.manifest||({version:'0.3.0',...(options.production?{}:{version_name:'development-diagnostics'})}),onMessage:{addListener:f=>listeners.push(f)},connect:()=>({onDisconnect:{addListener(){}}})}}};
 vm.runInNewContext(fs.readFileSync('extensions/meta-muse-bridge/acceptance-replay.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/receipt-v2.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/content-script.js','utf8'),c);
 const send=(command,payload)=>new Promise(resolve=>listeners[0]({type:'viral-ai:muse-execution',command,payload},{id:'ext'},resolve));
 const status=()=>{let result;listeners[0]({type:'viral-ai:muse-status'},{id:'ext'},r=>result=r);return result;};
 const api={
   messageParent,
   transaction:(next,records=[],placement)=>{
     for(const old of rows)if(!next.includes(old)){old.isConnected=false;old.parentNode=null;old.previousSibling=null;old.nextSibling=null;}
     rows=next;
     rows.forEach((n,i)=>{n.isConnected=true;n.parentNode=api.messageParent;n.previousSibling=rows[i-1]||null;n.nextSibling=rows[i+1]||null;});
     placement?.();
     api.mutate(records);
   },
   get lineage(){return JSON.parse(vm.runInNewContext('JSON.stringify((()=>{const op=[...operations.values()][0];return op?{identityCount:op.newUsers?.size,logicalCount:op.logicalFreshUserTurnCount,maxConcurrent:op.maxConcurrentFreshUserRows,replacementCount:op.replacementCandidateCount,replacementObserved:!!op.identityReplacementObserved}:null;})())',c));},
   get structuralTrace(){return JSON.parse(vm.runInNewContext('JSON.stringify([...operations.values()][0]?.acceptanceTrace||null)',c));},
   get assistantTrace(){return JSON.parse(vm.runInNewContext('JSON.stringify([...operations.values()][0]?.assistantFrames||null)',c));},
   get assistantFailureCount(){return vm.runInNewContext('assistantFailures.size',c);},
   sequenceEvidence:(rows,sequence,index,contiguous)=>JSON.parse(JSON.stringify(vm.runInNewContext('gateDSequenceEvidence',c)(rows,sequence,index,contiguous))),
   replaceComposer:()=>{currentRoot.isConnected=false;currentRoot={...root,isConnected:true};},
   replaceEditor:()=>{currentEditor=Object.defineProperties({},Object.getOwnPropertyDescriptors(editor));},
   replaceSend:()=>{activeButton={...base()};},removeSend:()=>{activeButton=null;},
   foreign:type=>{for(const fn of documentEvents.get(type)||[])fn({isTrusted:true,type,target:currentEditor});},
   get documentListenerCount(){return ['input','click','keydown','pointerdown'].reduce((n,type)=>n+(documentEvents.get(type)?.size||0),0);},
   get rows(){return rows;},captureTransferClose:()=>vm.runInNewContext('(()=>{const t=[...transfers.values()][0];return ()=>closeTransfer(t);})()',c),
   get tombstones(){return Array.from(vm.runInNewContext('[...closedTransfers]',c));},get operationCount(){return vm.runInNewContext('operations.size',c);},get transferCount(){return vm.runInNewContext('transfers.size',c);},
   handshake:()=>{let result;listeners[0]({type:'viral-ai:muse-handshake'},{id:'ext'},r=>result=r);return result;},
   send,status,rejects:(command,payload)=>listeners[0]({type:"viral-ai:muse-execution",command,payload},{id:"ext"},()=>{throw Error("UNEXPECTED_REPLY");})===false,
   mutate:records=>{for(const fn of [...observerCallbacks])fn(records);},get clicks(){return clicks;},get disconnected(){return disconnected;},
   inject:n=>{rows.push(n);observerCallback?.();},node,offline:()=>online=false,replace:next=>{rows=next;observerCallback?.();},stop:()=>stop=true,finish:()=>{stop=false;}
 };
 return api;
}
const operation={operationId:'op',sceneId:'scene',prompt:'Exact prompt',tabId:5};
const inspectPayload={operationId:'op',sceneId:'scene',tabId:5};
const media=()=>({getAttribute:()=>null,querySelectorAll:()=>[],currentSrc:'https://muse.ai/files/result.mp4',duration:2,videoWidth:64,videoHeight:64,readyState:4});

const receiptV2=require('../extensions/meta-muse-bridge/receipt-v2');
test('production rejects investigative diagnostics at native, worker and content boundaries',async t=>{
 const f=contentFixture({production:true}),worker=workerV2Harness({},f,true);
 for(const flag of ['diagnoseOwnership','diagnoseAcquisition']) {
   const p={...inspectPayload,[flag]:true};
   assert(f.rejects('inspectGeneration',p));
   if(flag==='diagnoseOwnership')assert.equal((await worker.run('inspectGeneration',p)).ownershipFailure.reason,'EXTENSION_DIAGNOSTICS_DISABLED');
   else await assert.rejects(worker.run('inspectGeneration',p),/DIAGNOSTICS_DISABLED/);
   const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-private-diagnostic-'));
   t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
   const bridge=new MetaMuseExtensionBridge({userDataPath:root});
   t.after(()=>bridge.close());
   await assert.rejects(bridge.command('inspectGeneration',p,{}),{code:'INVALID_REQUEST'});
   assert.equal(bridge.server,null);
 }
 assert(f.rejects('submitGeneration',operation));
 await assert.rejects(worker.run('submitGeneration',operation),/RECEIPT_REQUIRED/);
 assert.equal(worker.calls.length,0);assert.equal(f.clicks,0);
});
test('executing build markers identify the packaged version and ownership contract',()=>{
 const version=require('../extensions/meta-muse-bridge/manifest.json').version.replaceAll('.','-');
 for(const [file,role] of [['service-worker.js','worker'],['content-script.js','content']]) {
   const source=fs.readFileSync('extensions/meta-muse-bridge/'+file,'utf8');
   assert(source.includes(`muse-${role}-v${version}-contract3-receipt2`));
   assert(!/muse-(worker|content)-20\d{6}/.test(source));
 }
});
test('read-only acquisition census crosses worker without ownership, fetch, playback or storage writes',async()=>{
 const v={...media(),currentSrc:'blob:https://muse.ai/private',hasAttribute:k=>k==='src',srcObject:null,networkState:1,paused:true,
   play(){throw Error('PLAY_FORBIDDEN');},load(){throw Error('LOAD_FORBIDDEN');}};
 const f=contentFixture({historicalVideos:[v],fetch:()=>{throw Error('FETCH_FORBIDDEN');}});
 f.replace([f.node('assistant','historical-private-id',v)]);
 const stored={},worker=workerV2Harness(stored,f),p={...inspectPayload,operationId:'capability-only',diagnoseAcquisition:true};
 const result=JSON.parse(JSON.stringify(await worker.run('inspectGeneration',p)));
 assert(validPayload('inspectGeneration',p));assert(validResult('inspectGeneration',result,p));
 assert.equal(result.acquisitionDiagnostic.videos[0].sourceKind,'blob');
 assert.equal(result.acquisitionDiagnostic.videos[0].containingAssistantStableHashPresent,true);
 assert.equal(result.acquisitionDiagnostic.videos[0].paused,true);
 assert.deepEqual(stored,{});assert.deepEqual(worker.calls,['inspectGeneration']);assert.equal(f.clicks,0);
 assert(!JSON.stringify(result).includes('private'));assert(!JSON.stringify(result).includes('blob:'));
 for(const patch of [{receipt:anchoredReceipt('capability-only')},{offset:0},{prompt:'forbidden'},{selector:'video'},{diagnoseOwnership:true}])assert(!validPayload('inspectGeneration',{...p,...patch}));
 assert(!validPayload('acquireGenerationResult',p));assert(!validPayload('submitGeneration',p));
 const bad=structuredClone(result);bad.acquisitionDiagnostic.videos[0].src='private';assert(!validResult('inspectGeneration',bad,p));
});
test('read-only capability census distinguishes source categories without claiming assistant ownership',async()=>{
 for(const currentSrc of ['', 'https://muse.ai/private','data:private']) {
   const v={...media(),currentSrc,closest:()=>null,hasAttribute:()=>false,srcObject:null,networkState:0,paused:true};
   const f=contentFixture({historicalVideos:[v]});
   const result=await f.send('inspectGeneration',{...inspectPayload,diagnoseAcquisition:true});
   const row=result.acquisitionDiagnostic.videos[0];assert.equal(row.containingAssistantPresent,false);assert.equal(row.containingAssistantStableHashPresent,false);
   assert.equal(row.sourceKind,!currentSrc?'none':currentSrc.startsWith('https:')?'https':'other');
 }
 const f=contentFixture({historicalVideos:Array(17).fill({})});
 assert.equal((await f.send('inspectGeneration',{...inspectPayload,diagnoseAcquisition:true})).acquisitionDiagnostic,undefined);
});
const shaBytes=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const anchoredReceipt=id=>({version:2,operationId:id,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)],userStableIdHash:'c'.repeat(64),assistantStableIdHash:'d'.repeat(64),acceptance:{composerCleared:true,sendControlTransition:true,generationControlObserved:false},result:{kind:'video',ownerAssistantStableIdHash:'d'.repeat(64)}});
function transferReply(p,bytes,extra={}) {
 const chunk=bytes.subarray(p.offset,p.offset+196608),done=p.offset+chunk.length===bytes.length;
 return {operationId:p.operationId,sceneId:p.sceneId,state:'result',receipt:p.receipt,transferId:p.transferId,sequence:p.sequence,offset:p.offset,done,total:done?bytes.length:null,data:chunk.toString('base64'),chunkHash:shaBytes(chunk),...extra};
}
async function acquisitionFixture(t,options={}) {
 const bytes=options.bytes||Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(300000)]);
 const f=fixture(t,{verifyVideo:options.verifyVideo,command:async(type,p)=>{
   if(type==='submitGeneration' || type==='prepareGeneration')throw Error('SUBMISSION_FORBIDDEN');
   if(type==='cancelGeneration')return {operationId:p.operationId,sceneId:p.sceneId,state:'unsupported',confirmed:false};
   if(p.abort)return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted'};
   if(type==='inspectGeneration')return {operationId:p.operationId,sceneId:p.sceneId,state:'result',receipt:p.receipt};
   return options.transfer?options.transfer(p,bytes):transferReply(p,bytes);
 }});
 f.service.execute=async()=>{};
 const job=await f.service.submit(request());f.service.commit({...job,status:'running'});
 const context=f.service.context(job);fs.mkdirSync(context.outputDirectory,{recursive:true});
 const intent={operationId:job.id,sceneId:job.sceneId,digest:shaBytes(job.sceneId+'\0'+job.request.prompt),createdAt:Date.now(),target:{instanceId:'profile-one',tabId:5},receipt:anchoredReceipt(job.id)};
 fs.writeFileSync(path.join(context.outputDirectory,'muse-operation.json'),JSON.stringify(intent));
 return {...f,job,context,bytes,intent};
}
test('v2 fixture bytes require injected verification before publication and offline reuse',async t=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(210000,7)]);
 let probes=0;const f=await acquisitionFixture(t,{bytes,verifyVideo:async file=>{
   assert.deepEqual(fs.readFileSync(file),bytes);if(probes===0)assert.equal(f.service.get(f.job.id).asset,null);probes++;
 }});
 const completed=await f.service.recover(f.job.id);assert.equal(completed.status,'completed');assert.deepEqual(completed.asset,{fileName:f.job.id+'.mp4'});
 assert.deepEqual(fs.readFileSync(f.service.output(f.job.id).path),f.bytes);
 const saved=JSON.parse(fs.readFileSync(path.join(f.context.outputDirectory,'muse-operation.json')));assert.equal(saved.verifiedOutput.sha256,shaBytes(f.bytes));
 const before=f.calls.length;f.setReady(false);assert.equal((await f.provider.reconcile(f.context)).status,'completed');assert.equal(f.calls.length,before);assert(probes>=2);
 assert(!f.calls.some(c=>['prepareGeneration','submitGeneration'].includes(c.type)));
});
for(const kind of ['wrong-sequence','wrong-offset','wrong-transfer','bad-checksum','oversized','missing-chunk','timeout','verify-failed']) {
 test('v2 transfer fails closed and removes partial: '+kind,async t=>{
   const f=await acquisitionFixture(t,{verifyVideo:async()=>{if(kind==='verify-failed')throw Error('bad media');},transfer:async(p,bytes)=>{
     if(kind==='timeout')throw Object.assign(Error('timeout'),{code:'PROVIDER_TIMEOUT'});
     const r=transferReply(p,bytes);
     if(kind==='wrong-sequence')r.sequence++;
     if(kind==='wrong-offset')r.offset++;
     if(kind==='wrong-transfer')r.transferId='foreign';
     if(kind==='bad-checksum')r.chunkHash='0'.repeat(64);
     if(kind==='oversized')r.total=268435457;
     if(kind==='missing-chunk' && p.offset)r.data='';
     return r;
   }});
   await f.service.recover(f.job.id);const job=f.service.get(f.job.id);assert.equal(job.status,'interrupted');assert.equal(job.asset,null);assert.equal(job.output,null);
   assert(!fs.existsSync(path.join(f.context.outputDirectory,f.job.id+'.mp4')));assert(!fs.existsSync(path.join(f.context.outputDirectory,f.job.id+'.partial.mp4')));
   assert(!f.calls.some(c=>c.type==='submitGeneration'));
 });
}
test('v2 restart clears own partial, recovers only owned result; unrecorded and changed output rejected',async t=>{
 const f=await acquisitionFixture(t);fs.writeFileSync(path.join(f.context.outputDirectory,f.job.id+'.partial.mp4'),'incomplete');
 const next=new GenerationService({root:f.root,registry:f.registry});assert.equal((await next.recover(f.job.id)).status,'completed');
 const output=path.join(f.context.outputDirectory,f.job.id+'.mp4');fs.appendFileSync(output,'changed');
 await assert.rejects(f.provider.reconcile(f.context));
 const g=await acquisitionFixture(t);fs.writeFileSync(path.join(g.context.outputDirectory,g.job.id+'.mp4'),g.bytes);await assert.rejects(g.provider.reconcile(g.context));
 assert.equal(g.calls.length,0);assert(!f.calls.some(c=>c.type==='submitGeneration'));
});
test('v2 acquisition cancellation ignores late bytes and publishes no asset',async t=>{
 let release;const f=await acquisitionFixture(t,{transfer:p=>new Promise(resolve=>{release=()=>resolve(transferReply(p,Buffer.alloc(20)));})});
 const pending=f.service.recover(f.job.id);while(!release)await new Promise(r=>setImmediate(r));
 assert.equal(f.service.get(f.job.id).status,'verifying');await f.service.cancel(f.job.id);release();await pending;
 assert.notEqual(f.service.get(f.job.id).status,'completed');assert.equal(f.service.get(f.job.id).asset,null);
 assert(!fs.existsSync(path.join(f.context.outputDirectory,f.job.id+'.partial.mp4')));
});
test('v2 native chunk deadline cleans the partial even when transport never settles',async t=>{
 let started=false;const f=await acquisitionFixture(t,{transfer:()=>{started=true;return new Promise(()=>{});}});
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.provider.reconcile(f.context);while(!started)await new Promise(r=>setImmediate(r));
 const rejected=assert.rejects(pending,{code:'PROVIDER_TIMEOUT'});t.mock.timers.tick(20000);await rejected;
 assert(!fs.existsSync(path.join(f.context.outputDirectory,f.job.id+'.partial.mp4')));
 assert(!fs.existsSync(path.join(f.context.outputDirectory,f.job.id+'.mp4')));
 assert(f.calls.some(c=>c.payload.abort===true));
});
test('v2 largest allowed chunk and receipt fit actual loopback body limit; renderer snapshot stays private',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-chunk-http-')),bridge=new MetaMuseExtensionBridge({userDataPath:root});
 await bridge.start();t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
 let token='';const origin='chrome-extension://'+'a'.repeat(32);
 const send=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+bridge.port+'/v1/'+route+(route==='register'?'':'?instanceId=profile-one'),{method:body?'POST':'GET',headers:{Origin:origin,...(token?{'X-Viral-Muse-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};};
 token=(await send('register',{instanceId:'profile-one',profileLabel:'',browserName:'Chrome',extensionVersion:'0.3.11',protocolVersion:1})).value.token;
 await send('heartbeat',{profileLabel:'',browserName:'Chrome',tabs:[{tabId:5,url:'https://muse.ai/',composerReady:true,inspectionComplete:true,executionContract:3,canSubmit:true,ownershipReceiptVersion:2}]});
 const receipt=anchoredReceipt('op');receipt.baselineUserMessageIds=Array.from({length:128},(_,i)=>shaBytes('user'+i));receipt.baselineAssistantMessageIds=Array.from({length:128},(_,i)=>shaBytes('assistant'+i));
 const p={tabId:5,operationId:'op',sceneId:'scene',receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'},target={instanceId:'profile-one',tabId:5};
 const pending=bridge.command('acquireGenerationResult',p,target);await new Promise(r=>setImmediate(r));
 const polled=(await send('poll')).value.command;
 const bytes=Buffer.alloc(196608,3),result=transferReply(p,bytes),body={commandId:polled.id,ok:true,result,error:null};
 assert(Buffer.byteLength(JSON.stringify(body))<300000);assert.equal((await send('result',body)).status,200);assert.equal((await pending).chunkHash,shaBytes(bytes));
 const snapshot=JSON.stringify(bridge.snapshot());for(const secret of [token,result.data,receipt.assistantStableIdHash,'transferId','https://'])assert(!snapshot.includes(secret));
});
test('v2 transfer payload rejects missing anchors, legacy receipt, URL, selector and wrong kind',()=>{
 const p={tabId:5,operationId:'op',sceneId:'scene',receipt:anchoredReceipt('op'),transferId:'transfer',sequence:0,offset:0,mediaKind:'video'};
 assert(validPayload('acquireGenerationResult',p));
 for(const patch of [{receipt:{...p.receipt,assistantStableIdHash:undefined}},{receipt:receiptFor(p)},{url:'https://muse.ai/private'},{selector:'video'},{mediaKind:'audio'},{transferId:undefined}])assert(!validPayload('acquireGenerationResult',{...p,...patch}));
});
const v2Payload={...inspectPayload,observationToken:'worker-bridge-epoch'};
for(const phase of ['prepared','accepted','anchored']) {
 test('v2 local cancel releases reservation and preserves durable evidence: '+phase,async()=>{
   const content=contentFixture({noAssistant:phase==='accepted'}),stored={},worker=workerV2Harness(stored,content);
   const prepared=await worker.run('prepareGeneration',inspectPayload);
   let receipt=prepared.receipt;
   if(phase!=='prepared')receipt=(await worker.run('submitGeneration',{...operation,receipt})).receipt;
   if(phase==='anchored')receipt=(await worker.run('inspectGeneration',{...inspectPayload,receipt})).receipt;
   const before=JSON.stringify(stored),disconnects=content.disconnected,clicks=content.clicks;
   const result=await worker.run('cancelGeneration',inspectPayload);
   assert.equal(result.state,'unsupported');assert.equal(result.confirmed,false);
   assert(phase==='anchored' || content.disconnected>disconnects);assert.equal(content.operationCount,0);
   const expected=JSON.parse(before);expected['generation-intent:op'].localCancelled=true;
   assert.equal(JSON.stringify(stored),JSON.stringify(expected));
   assert.equal((await worker.run('submitGeneration',{...operation,receipt:prepared.receipt})).state,'interrupted');
   assert.equal((await worker.run('prepareGeneration',inspectPayload)).state,'interrupted');
   assert.equal(content.clicks,clicks);
   assert.equal((await worker.run('prepareGeneration',{...inspectPayload,operationId:'independent'})).state,'prepared');
   assert.equal(JSON.stringify(stored['generation-intent:op']),JSON.stringify(expected['generation-intent:op']));
   const restarted=workerV2Harness(stored,contentFixture());
   assert.equal((await restarted.run('submitGeneration',{...operation,receipt:prepared.receipt})).state,'interrupted');
   assert.equal(restarted.calls.length,0);
   await worker.run('cancelGeneration',{...inspectPayload,operationId:'independent'});
 });
}
test('v2 cancel aborts active browser transfer without deleting anchored receipt or submitting',async()=>{
 let started,aborted=false;
 const content=contentFixture({fetch:(url,{signal})=>{started=true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}));}});
 const receipt=await bindV2(content);content.replace([content.node('assistant','new-assistant',media())]);
 const candidate=await content.send('inspectGeneration',{...v2Payload,receipt});
 const stored={'generation-intent:op':{tabId:5,sceneId:'scene',receipt:candidate.receipt}},worker=workerV2Harness(stored,content),before=JSON.stringify(stored);
 const pending=worker.run('acquireGenerationResult',{...inspectPayload,receipt:candidate.receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'});
 while(!started)await new Promise(r=>setImmediate(r));
 const result=await worker.run('cancelGeneration',inspectPayload);
 assert.equal(result.confirmed,false);assert(aborted);assert.equal((await pending).state,'interrupted');
 const expected=JSON.parse(before);expected['generation-intent:op'].localCancelled=true;
 assert.equal(JSON.stringify(stored),JSON.stringify(expected));assert(!worker.calls.includes('submitGeneration'));
});
async function acceptV2(f) {
 const prepared=await f.send('prepareGeneration',v2Payload);
 assert.equal(prepared.state,'prepared');assert(receiptV2.valid(JSON.parse(JSON.stringify(prepared.receipt)),'op'));
 assert.equal(f.clicks,0);
 const accepted=await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:prepared.receipt});
 assert.equal(accepted.state,'running');assert.equal(accepted.receipt.version,2);assert(accepted.receipt.userStableIdHash);
 assert.equal(accepted.receipt.assistantStableIdHash,undefined);return accepted.receipt;
}

// All post-anchor cases use the isolated DOM/worker fixtures; no live bridge.
test('user churn: unchanged accepted node and assistant-only updates record no event',async()=>{
 const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),user=f.rows.at(-1);
 for(let i=0;i<3;i++)assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).userAnchorChurn,undefined);
 const assistant=f.node('assistant','new-media',media());f.transaction([...f.rows,assistant],[userMutation(f,[assistant],[],user)]);
 const first=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(first.state,'running');assert.equal(first.userAnchorChurn,undefined);
 const anchored=await f.send('inspectGeneration',{...v2Payload,receipt});assert(anchored.receipt.assistantStableIdHash);assert.equal(anchored.userAnchorChurn,undefined);
 assert.equal(f.assistantFailureCount,0);assert.equal(f.clicks,1);
});

for(const kind of receiptV2.userChurnKinds)test('user churn: bounded first event '+kind,async()=>{
 const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),original=f.rows.slice(),user=original.at(-1),baseline=original.slice(0,-1),tail=baseline.at(-1);
 const replacement=f.node('user','private-replacement-id'),attribute=name=>({type:'attributes',target:user,attributeName:name,oldValue:name==='data-message-id'?'new-user':'user'});
 if(kind==='SAME_NODE_ID_CHANGED'){user.id='private-changed-id';f.mutate([attribute('data-message-id')]);}
 if(kind==='OWNED_NODE_REMOVED')f.transaction(baseline,[userMutation(f,[],[user],tail)]);
 if(kind==='REPLACED_SAME_POSITION')f.transaction([...baseline,replacement],[userMutation(f,[replacement],[user],tail)]);
 if(kind==='REPLACED_DIFFERENT_POSITION'){
   const status=f.node('assistant','new-status');f.transaction([...baseline,status,replacement],[userMutation(f,[status,replacement],[user],tail)]);
 }
 if(kind==='ROLE_CHANGED'){user.role='assistant';f.mutate([attribute('data-message-role')]);}
 if(kind==='PARENT_CHANGED'){
   const foreign={};f.transaction(original,[userMutation(f,[],[user],tail),userMutation(f,[user],[],null,null,foreign)],()=>{user.parentNode=foreign;});
 }
 if(kind==='MULTIPLE_USER_CANDIDATES')f.transaction([...baseline,replacement,f.node('user','another-user')],[userMutation(f,[replacement,f.node('user','transient-user')],[user],tail)]);
 if(kind==='NEXT_USER_OBSERVED')f.transaction([...original,replacement],[userMutation(f,[replacement],[],user)]);
 if(kind==='BASELINE_CHANGED'){
   const old=baseline[0].id;baseline[0].id='private-baseline-change';f.mutate([{type:'attributes',target:baseline[0],attributeName:'data-message-id',oldValue:old}]);
 }
 if(kind==='IDENTITY_UNAVAILABLE'){user.id='';f.mutate([attribute('data-message-id')]);}
 if(kind==='UNKNOWN_BOUNDED')f.mutate(Array.from({length:257},()=>({type:'childList',target:f.messageParent,addedNodes:[],removedNodes:[]})));
 const result=await f.send('inspectGeneration',{...v2Payload,receipt}),d=JSON.parse(JSON.stringify(result.userAnchorChurn));
 assert.equal(result.state,'interrupted');assert.equal(d.kind,kind);assert(receiptV2.validUserAnchorChurn(d));assert.equal(result.receipt,undefined);
 assert(validResult('inspectGeneration',JSON.parse(JSON.stringify(result)),{...inspectPayload,receipt}));
 assert.equal(receipt.userStableIdHash,shaBytes('op\0user\0new-user'));assert.equal(receipt.assistantStableIdHash,undefined);
 if(kind==='REPLACED_SAME_POSITION'){
   assert.equal(d.anchoredNodeStillConnected,false);assert.equal(d.anchoredNodeRemoved,true);assert.equal(d.replacementNodeAdded,true);
   assert.equal(d.replacementSameSequencePosition,true);assert.equal(d.replacementSameParent,true);assert.equal(d.replacementImmediatelyAfterBaseline,true);assert.equal(d.replacementHasValidNativeId,true);
 }
 if(kind==='REPLACED_DIFFERENT_POSITION')assert.equal(d.replacementSameSequencePosition,false);
 if(kind==='NEXT_USER_OBSERVED')assert.equal(d.anchoredNodeStillConnected,true);
 if(kind==='MULTIPLE_USER_CANDIDATES')assert.equal(d.replacementSameParent,null);
 // A later final document must not replace either first failure.
 const first=JSON.stringify(d),firstAssistant=JSON.stringify(result.assistantOwnershipFailure);
 f.transaction([...baseline,replacement,f.node('assistant','final-video',media())]);
 const again=await f.send('inspectGeneration',{...v2Payload,receipt});
 assert.equal(JSON.stringify(again.userAnchorChurn),first);assert.equal(JSON.stringify(again.assistantOwnershipFailure),firstAssistant);
 assert.equal(again.receipt,undefined);assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
 assert.equal(Object.keys(d).length,5+receiptV2.userChurnBools.length+receiptV2.userChurnCounts.length);
 for(const secret of ['private-','new-user','history-','Exact prompt','https:','blob:','timestamp'])assert(!JSON.stringify(d).includes(secret));
});

test('user churn: final adjacency without mutation evidence cannot claim replacement or ownership',async()=>{
 const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),baseline=f.rows.slice(0,-1),candidate=f.node('user','different-id');
 f.transaction([...baseline,candidate,f.node('assistant','has-video',media())]);
 const result=await f.send('inspectGeneration',{...v2Payload,receipt});
 assert.equal(result.userAnchorChurn.kind,'OWNED_NODE_REMOVED');assert.equal(result.userAnchorChurn.anchoredNodeRemoved,false);
 assert.equal(result.userAnchorChurn.replacementNodeAdded,false);assert.equal(result.userAnchorChurn.replacementSameSequencePosition,true);
 assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(receipt.assistantStableIdHash,undefined);
 assert.equal(f.clicks,1);
});

test('user churn: change and restore in one attribute batch preserves the first observed identity mutation',async()=>{
 const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),user=f.rows.at(-1);
 f.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'},
   {type:'attributes',target:user,attributeName:'data-message-id',oldValue:'transient-private-id'}]);
 const r=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(r.userAnchorChurn.kind,'SAME_NODE_ID_CHANGED');
 assert.equal(r.userAnchorChurn.anchoredNativeIdStillSame,true);assert.equal(r.userAnchorChurn.anchoredIdAttributeChanged,true);assert.equal(r.userAnchorChurn.mutationObservedOnAnchoredNode,true);
 assert.equal(r.state,'interrupted');assert.equal(f.clicks,1);
});

test('user churn: strict schemas reject private fields, invalid counts and execution inputs',async()=>{
 const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),user=f.rows.at(-1);user.id='other-id';f.mutate([]);
 const result=JSON.parse(JSON.stringify(await f.send('inspectGeneration',{...v2Payload,receipt}))),d=result.userAnchorChurn;
 for(const patch of [{rawId:'secret'},{url:'secret'},{prompt:'secret'},{timestamp:123},{kind:'secret'},{freshLogicalUserCount:129},{replacementUserCandidateCount:-1},{anchoredNodeRemoved:'true'},{elapsedBucket:'2026-10-21'}]){
   const bad={...d,...patch};assert(!receiptV2.validUserAnchorChurn(bad));assert(!validResult('inspectGeneration',{...result,userAnchorChurn:bad},{...inspectPayload,receipt}));
 }
 assert(!receiptV2.valid(d,'op'));assert(!validPayload('inspectGeneration',{...inspectPayload,receipt,userAnchorChurn:d}));
 for(const type of ['prepareGeneration','submitGeneration','acquireGenerationResult','cancelGeneration'])assert(!validResult(type,result,{...inspectPayload,receipt}));
 for(const patch of [{state:'running'},{receipt},{data:'secret'}])assert(!validResult('inspectGeneration',{...result,...patch},{...inspectPayload,receipt}));
 assert(!validResult('inspectGeneration',result,{...inspectPayload,receipt:{...receipt,assistantStableIdHash:'e'.repeat(64)}}));
 assert(!validResult('inspectGeneration',result,{...inspectPayload,diagnoseOwnership:true}));
});

test('user churn: worker and native preserve first event atomically, restart and support diagnosis never retarget',async t=>{
 const content=contentFixture({noAssistant:true}),stored={},worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;f.bridge.developmentDiagnostics=true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),initial=fs.readFileSync(file),receipt=JSON.parse(initial).receipt,user=content.rows.at(-1);
 assert.equal((await f.provider.reconcile(context)).status,'running');assert.deepEqual(fs.readFileSync(file),initial);
 user.id='first-private-change';content.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'}]);
 await assert.rejects(f.provider.reconcile(context),{code:'RECOVERY_REQUIRED'});
 const saved=JSON.parse(fs.readFileSync(file)),d=saved.userAnchorChurn,assistantFailure=saved.assistantOwnershipFailure;
 assert.equal(d.kind,'SAME_NODE_ID_CHANGED');assert.equal(assistantFailure.terminalReason,'IDENTITY_MUTATED');assert.deepEqual(saved.receipt,receipt);
 assert.deepEqual(stored['generation-intent:'+job.id].userAnchorChurn,d);assert.equal(saved.verifiedOutput,undefined);
 assert(!fs.readdirSync(context.outputDirectory).some(n=>n.endsWith('.tmp')));
 const before=fs.readFileSync(file),jobs=fs.readFileSync(f.service.store.file),storage=JSON.stringify(stored);
 const report=await f.service.diagnoseMuseOwnership(job.id);assert.equal(report.historicalUserAnchorChurn.kind,d.kind);
 assert.equal(report.historicalAssistantOwnershipFailure.terminalReason,assistantFailure.terminalReason);assert.equal(report.diagnostic.ownedUserMatches,0);
 assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);assert.equal(JSON.stringify(stored),storage);
 // A fresh worker over the durable tombstone cannot repeat submit; later
 // bounded events also cannot overwrite first evidence at either layer.
 const newer={...d,kind:'OWNED_NODE_REMOVED'},replacementContent={send:async(_,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',assistantOwnershipFailure:require('./fixtures/muse-assistant-failure').failure('OPERATION_MISSING'),userAnchorChurn:newer})};
 const restarted=workerV2Harness(stored,replacementContent);
 f.bridge.command=async(type,p)=>JSON.parse(JSON.stringify(await restarted.run(type,p)));
 await assert.rejects(f.provider.reconcile(context),{code:'RECOVERY_REQUIRED'});assert.deepEqual(fs.readFileSync(file),before);assert.equal(JSON.stringify(stored),storage);
 assert.equal((await restarted.run('submitGeneration',{operationId:job.id,sceneId:job.sceneId,tabId:5,prompt:request().prompt,receipt})).state,'interrupted');
 assert(!restarted.calls.includes('submitGeneration'));assert.equal(content.clicks,1);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
});

test('user churn: native write failure leaves existing receipt bytes intact and no temporary diagnostic file',async t=>{
 const content=contentFixture({noAssistant:true}),stored={},worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),before=fs.readFileSync(file),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===file)throw Object.assign(Error('fixture full disk'),{code:'ENOSPC'});return rename(from,to);});
 const user=content.rows.at(-1);user.id='changed';content.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'}]);
 await assert.rejects(f.provider.reconcile(context));assert.deepEqual(fs.readFileSync(file),before);
 assert(!fs.readdirSync(context.outputDirectory).some(n=>n.endsWith('.tmp')));assert.equal(content.clicks,1);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
});

test('user churn: deterministic priority favors role, then parent, then native-ID evidence',async()=>{
 for(const expected of ['ROLE_CHANGED','PARENT_CHANGED','SAME_NODE_ID_CHANGED']){
   const f=contentFixture({noAssistant:true}),receipt=await acceptV2(f),user=f.rows.at(-1);user.id='changed';
   // Baseline churn and a second user must not hide the original node mutation.
   f.rows[0].id='changed-baseline';f.rows.push(f.node('user','independent-user'));
   if(expected==='ROLE_CHANGED')user.role='assistant';
   if(expected==='PARENT_CHANGED')user.parentNode={};
   f.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'}]);
   const r=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(r.userAnchorChurn.kind,expected);assert.equal(r.receipt,undefined);assert.equal(f.clicks,1);
 }
});

test('user churn: released evidence remains bounded to 32 independent entries without retaining node references',async()=>{
 let sequence=0;const f=contentFixture({noAssistant:true,afterClick:f=>{f.rows.at(-1).id='owned-'+sequence++;}});
 for(let i=0;i<36;i++){
   const p={...v2Payload,operationId:'churn-'+i},prepared=await f.send('prepareGeneration',p);assert.equal(prepared.state,'prepared');
   const accepted=await f.send('submitGeneration',{...operation,...p,receipt:prepared.receipt}),user=f.rows.at(-1);assert.equal(accepted.state,'running');
   const old=user.id;user.id='changed-'+i;f.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:old}]);
   const r=await f.send('inspectGeneration',{...p,receipt:accepted.receipt});assert.equal(r.userAnchorChurn.kind,'SAME_NODE_ID_CHANGED');
   assert.equal(f.operationCount,0);assert(f.assistantFailureCount<=32);
 }
 assert.equal(f.assistantFailureCount,32);assert.equal(f.clicks,36);
 const prepared=await f.send('prepareGeneration',{...v2Payload,operationId:'after-churn-rotation'});assert.equal(prepared.state,'prepared');
 await f.send('cancelGeneration',{...inspectPayload,operationId:'after-churn-rotation'});
});
async function bindV2(f) {
 const user=await acceptV2(f);
 const assistant=await observeMediaV2(f,user);
 assert.equal(assistant.state,'running');assert(assistant.receipt.assistantStableIdHash);return assistant.receipt;
}
async function observeMediaV2(f,user,id='new-assistant') {
 // Explicit fixture media attachment; never grants production ownership.
 const row=f.rows.find(r=>r.role==='assistant' && r.id===id);assert(row);
 if(!row.querySelectorAll('video').length){const video=media();video.closest=()=>row;row.querySelectorAll=s=>s==='video'?[video]:[];f.mutate([{type:'childList',target:row,addedNodes:[video],removedNodes:[]}]);}
 f.finish();
 const pending=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(pending.state,'running');assert.equal(pending.receipt.assistantStableIdHash,undefined);
 return f.send('inspectGeneration',{...v2Payload,receipt:user});
}

for(const statusRow of [false,true])test('assistant block binds the sole stable direct-video owner, including a fast assistant tail: '+statusRow,async()=>{
 const bytes=Buffer.alloc(20,7),source='blob:https://muse.ai/owned-block-fixture';let fetched=0;
 const video={...media(),currentSrc:source};
 const f=contentFixture({noAssistant:true,historicalVideos:[media()],afterClick:f=>{
   if(statusRow)f.inject(f.node('assistant','status-row'));
   f.inject(f.node('assistant','media-owner',video));
 },fetch:async url=>{assert.equal(url,source);fetched++;return new Response(bytes,{headers:{'content-type':'video/mp4'}});}});
 const historic=f.rows[1],historicVideo=media();historicVideo.closest=()=>historic;historic.querySelectorAll=s=>s==='video'?[historicVideo]:[];
 const user=await acceptV2(f);assert.equal(f.lineage.logicalCount,1);assert.equal(f.lineage.maxConcurrent,1);
 const first=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(first.state,'running');assert.equal(first.receipt.assistantStableIdHash,undefined);
 const anchored=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(anchored.state,'running');
 assert.equal(anchored.receipt.assistantStableIdHash,shaBytes('op\0assistant\0media-owner'));assert.equal(anchored.receipt.result,undefined);assert.equal(f.operationCount,0);
 const result=await f.send('inspectGeneration',{...v2Payload,receipt:anchored.receipt});assert.equal(result.state,'result');assert.equal(result.receipt.result.ownerAssistantStableIdHash,anchored.receipt.assistantStableIdHash);
 const acquired=await f.send('acquireGenerationResult',{...v2Payload,receipt:result.receipt,transferId:'owned-block-transfer',sequence:0,offset:0,mediaKind:'video'});
 assert.equal(acquired.state,'result');assert.equal(fetched,1);assert.equal(f.clicks,1);
 // An anchored receipt survives reinjection without user/baseline/op-map state.
 const next=contentFixture();next.replace([next.node('assistant','media-owner',media()),next.node('assistant','unrelated',media())]);
 const recovered=await next.send('inspectGeneration',{...v2Payload,receipt:anchored.receipt});assert.equal(recovered.state,'result');assert.equal(recovered.receipt.assistantStableIdHash,anchored.receipt.assistantStableIdHash);assert.equal(next.clicks,0);
});

for(const mode of ['zero media','old media','page-global media','generation active'])test('assistant block remains pending without a completed stable media owner: '+mode,async()=>{
 const f=contentFixture({active:mode==='generation active',noAssistant:true,historicalVideos:[media()],afterClick:f=>{
   f.inject(f.node('assistant','status-a'));f.inject(f.node('assistant','status-b',mode==='generation active'?media():null));
 }});
 if(mode==='old media'){const old=f.rows[1],v=media();v.closest=()=>old;old.querySelectorAll=s=>s==='video'?[v]:[];}
 const user=await acceptV2(f);
 for(let i=0;i<3;i++){const r=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(r.state,'running');assert.equal(r.receipt.assistantStableIdHash,undefined);}
 if(mode==='generation active'){
   f.finish();const pending=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(pending.receipt.assistantStableIdHash,undefined);
   assert((await f.send('inspectGeneration',{...v2Payload,receipt:user})).receipt.assistantStableIdHash);
 }
 assert.equal(f.clicks,1);
});

for(const mode of ['two media owners','multiple videos in owner','next user','foreign parent','block reparent','unknown row gap','manual interaction','user disappears','user ID changes','baseline changes'])test('assistant block fails closed on '+mode,async()=>{
 const f=contentFixture({video:media()}),user=await acceptV2(f);
 const owner=f.rows.at(-1);
 if(mode==='two media owners')f.inject(f.node('assistant','second-media',media()));
 if(mode==='multiple videos in owner'){const videos=[media(),media()];videos.forEach(v=>v.closest=()=>owner);owner.querySelectorAll=s=>s==='video'?videos:[];}
 if(mode==='next user'){f.inject(f.node('user','another-user'));f.inject(f.node('assistant','unowned-newer',media()));}
 if(mode==='foreign parent')owner.parentNode={querySelectorAll:()=>[owner]};
 if(mode==='block reparent'){const userRow=f.rows.find(r=>r.id==='new-user'),parent={parentNode:f.messageParent,querySelectorAll:()=>[userRow,owner]};userRow.parentNode=parent;owner.parentNode=parent;}
 if(mode==='unknown row gap')f.replace([...f.rows.slice(0,-1),f.node('system','unexpected-message'),owner]);
 if(mode==='manual interaction')f.foreign('pointerdown');
 if(mode==='user disappears')f.replace(f.rows.filter(r=>r.id!=='new-user'));
 if(mode==='user ID changes')f.rows.find(r=>r.id==='new-user').id='changed-user';
 if(mode==='baseline changes')f.rows[0].id='changed-baseline';
 const result=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
});

for(const churn of ['different ID','same ID remount','attribute ID change','transient restored video'])test('assistant block resets stabilization on '+churn,async()=>{
 const f=contentFixture({video:media()}),user=await acceptV2(f);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt:user})).receipt.assistantStableIdHash,undefined);
 const old=f.rows.at(-1);let id='new-assistant';
 if(churn==='different ID'){id='canonical-media';f.replace([...f.rows.slice(0,-1),f.node('assistant',id,media())]);}
 if(churn==='same ID remount')f.replace([...f.rows.slice(0,-1),f.node('assistant',id,media())]);
 if(churn==='attribute ID change'){id='hydrated-media';old.id=id;f.mutate([{type:'attributes',target:old,attributeName:'data-message-id',oldValue:'new-assistant'}]);}
 if(churn==='transient restored video')f.mutate([{type:'childList',target:old,addedNodes:[],removedNodes:[]}]);
 const pending=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(pending.state,'running');assert.equal(pending.receipt.assistantStableIdHash,undefined);
 const stable=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(stable.receipt.assistantStableIdHash,shaBytes('op\0assistant\0'+id));assert.equal(f.clicks,1);
});

for(const count of [8,9])test('assistant block has an explicit eight-row bound: '+count,async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{for(let i=0;i<count;i++)f.inject(f.node('assistant','row-'+i,i===count-1?media():null));}});
 if(count===8){const user=await acceptV2(f);await f.send('inspectGeneration',{...v2Payload,receipt:user});assert((await f.send('inspectGeneration',{...v2Payload,receipt:user})).receipt.assistantStableIdHash);}
 else {const prep=await f.send('prepareGeneration',v2Payload),r=await f.send('submitGeneration',{...operation,...v2Payload,receipt:prep.receipt});assert.equal(r.state,'interrupted');assert.equal(r.receipt,undefined);}
 assert.equal(f.clicks,1);
});

test('assistant block candidate churn cannot outlive the existing operation lifetime',async()=>{
 let now=1000;const f=contentFixture({video:media(),clock:()=>now}),user=await acceptV2(f);
 for(let i=0;i<4;i++){
   f.replace([...f.rows.slice(0,-1),f.node('assistant','candidate-'+i,media())]);
   const r=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(r.state,'running');assert.equal(r.receipt.assistantStableIdHash,undefined);now+=1000;
 }
 now+=20*60*1000;
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt:user})).state,'interrupted');assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
});

test('assistant block census is bounded, read-only, and does not stabilize or upgrade a receipt',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{f.inject(f.node('assistant','status'));f.inject(f.node('assistant','owner',media()));}}),user=await acceptV2(f);
 const before=JSON.stringify(f.structuralTrace),count=f.operationCount;
 const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:user.userStableIdHash};
 const r=await f.send('inspectGeneration',p),b=r.ownershipDiagnostic.responseBlock;
 assert.deepEqual(JSON.parse(JSON.stringify(b)),{ownedResponseBlockCount:1,assistantBlockRowCount:2,mediaAssistantCandidateCount:1,mediaAssistantStable:false,generationActive:false,nextUserObserved:false,assistantBlockWithinBound:true});
 assert(validResult('inspectGeneration',JSON.parse(JSON.stringify(r)),p));assert.equal(JSON.stringify(f.structuralTrace),before);assert.equal(f.operationCount,count);assert.equal(r.receipt,undefined);
 for(const patch of [{rawId:'forbidden'},{assistantBlockRowCount:10},{mediaAssistantStable:'yes'}]){
   const invalid=JSON.parse(JSON.stringify(r));Object.assign(invalid.ownershipDiagnostic.responseBlock,patch);assert(!validResult('inspectGeneration',invalid,p));
 }
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt:user})).receipt.assistantStableIdHash,undefined);
});

test('assistant block media authority does not select the last assistant or infer ownership from a nested foreign video',async()=>{
 const f=contentFixture({video:media(),afterClick:f=>f.inject(f.node('assistant','last-status'))}),user=await acceptV2(f);
 await f.send('inspectGeneration',{...v2Payload,receipt:user});
 const owner=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(owner.receipt.assistantStableIdHash,shaBytes('op\0assistant\0new-assistant'));
 const nested=media(),g=contentFixture({noAssistant:true,afterClick:f=>{const row=f.node('assistant','outer',nested);nested.closest=()=>({});f.inject(row);}}),other=await acceptV2(g);
 for(let i=0;i<3;i++){const r=await g.send('inspectGeneration',{...v2Payload,receipt:other});assert.equal(r.state,'running');assert.equal(r.receipt.assistantStableIdHash,undefined);}
});

test('assistant block tail remount during user acceptance does not create a second logical user',async()=>{
 const f=contentFixture({onPostSendTick:(f,tick)=>{
   if(tick!==2)return;
   const old=f.rows.at(-1),replacement=f.node('assistant','canonical-media',media()),user=f.rows.at(-2);
   f.transaction([...f.rows.slice(0,-1),replacement],[userMutation(f,[replacement],[old],user)]);
 }});
 const user=await acceptV2(f);assert.equal(f.lineage.logicalCount,1);assert.equal(f.lineage.maxConcurrent,1);
 const first=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(first.receipt.assistantStableIdHash,undefined);
 const bound=await f.send('inspectGeneration',{...v2Payload,receipt:user});assert.equal(bound.receipt.assistantStableIdHash,shaBytes('op\0assistant\0canonical-media'));assert.equal(f.clicks,1);
});

test('assistant block native pipeline persists media assistant before result and acquires only after the result receipt',async t=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(210000,3)]),content=contentFixture({noAssistant:true,afterClick:f=>{f.inject(f.node('assistant','status'));f.inject(f.node('assistant','owned-media',media()));},fetch:async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})});
 const stored={},worker=workerV2Harness(stored,content);let native,inspectCount=0,acquired=false;
 const f=fixture(t,{verifyVideo:async file=>{assert.deepEqual(fs.readFileSync(file),bytes);},command:async(type,p)=>{
   if(type==='inspectGeneration' || type==='acquireGenerationResult'){
     const disk=JSON.parse(fs.readFileSync(path.join(native.root,'outputs',p.operationId,'muse-operation.json')));
     assert(disk.receipt.userStableIdHash);
     if(type==='inspectGeneration'){
       inspectCount++;
       if(inspectCount<=2)assert.equal(disk.receipt.assistantStableIdHash,undefined);
       else {assert.equal(disk.receipt.assistantStableIdHash,shaBytes(p.operationId+'\0assistant\0owned-media'));assert.equal(disk.receipt.result,undefined);}
     }else {assert(disk.receipt.assistantStableIdHash);assert.equal(disk.receipt.result.ownerAssistantStableIdHash,disk.receipt.assistantStableIdHash);acquired=true;}
   }
   return JSON.parse(JSON.stringify(await worker.run(type,p)));
 }});native=f;f.bridge.receiptV2Ready=async()=>true;
 const job=await f.service.submit(request());await until(f.service,job.id,'running');
 await f.service.recover(job.id);assert.equal(acquired,false);
 await f.service.recover(job.id);assert.equal(acquired,false);
 const completed=await f.service.recover(job.id);assert.equal(completed.status,'completed');assert(acquired);assert.equal(inspectCount,3);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert.equal(content.clicks,1);
});

test('v2 browser streams owned HTTPS/blob bytes with hashes and rejects replay, source replacement, and oversized body',async()=>{
 for(const kind of ['https','blob','replacement','oversized','order','abort']) {
   const bytes=Buffer.alloc(210000,7);let fetched=0,aborted=false;
   const f=contentFixture({fetch:async(url,options)=>{fetched++;options.signal.addEventListener('abort',()=>aborted=true);assert.equal(options.redirect,'error');return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':kind==='oversized'?'268435457':String(bytes.length)}});}});
   const receipt=await bindV2(f),v=media();if(kind==='blob')v.currentSrc='blob:https://muse.ai/fixture';
   f.replace([f.node('assistant','new-assistant',v)]);
   const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
   const p={...v2Payload,receipt:candidate.receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'};
   const first=await f.send('acquireGenerationResult',p);
   if(kind==='oversized'){assert.equal(first.state,'interrupted');assert(aborted);continue;}
   assert.equal(first.state,'result');assert.equal(first.done,false);assert.equal(first.chunkHash,shaBytes(bytes.subarray(0,196608)));
   const next={...p,sequence:1,offset:196608};
   if(kind==='replacement')v.currentSrc='https://muse.ai/files/replaced.mp4';
   if(kind==='order')next.sequence=0;
   if(kind==='abort')next.abort=true;
   const last=await f.send('acquireGenerationResult',next);
   if(['replacement','order','abort'].includes(kind))assert.equal(last.state,'interrupted');
   else {assert.equal(last.done,true);assert.equal(last.total,bytes.length);assert.deepEqual(Buffer.concat([Buffer.from(first.data,'base64'),Buffer.from(last.data,'base64')]),bytes);}
   assert.equal(fetched,1);assert(aborted);
 }
});
test('v2 browser expiry aborts a stalled fetch and worker persists only ownership, never bytes',async()=>{
 const f=contentFixture({transferTimeout:true,fetch:(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))))});
 const receipt=await bindV2(f);f.replace([f.node('assistant','new-assistant',media())]);
 const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
 const p={...inspectPayload,receipt:candidate.receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'};
 const stored={'generation-intent:op':{tabId:5,sceneId:'scene',receipt:candidate.receipt}},before=JSON.stringify(stored);
 const worker=workerV2Harness(stored,f);
 // Keep the test alive while the browser's intentionally unref'ed timer expires.
 const keep=setTimeout(()=>{},1000);try{assert.equal((await worker.run('acquireGenerationResult',p)).state,'interrupted');}finally{clearTimeout(keep);}
 assert.equal(JSON.stringify(stored),before);assert(!worker.calls.includes('submitGeneration'));
});
test('v2 worker transports bounded chunks after suspension without submission',async()=>{
 const bytes=Buffer.alloc(20,4),f=contentFixture({fetch:async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})});
 const receipt=await bindV2(f);f.replace([f.node('assistant','new-assistant',media())]);
 const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
 const stored={'generation-intent:op':{tabId:5,sceneId:'scene',receipt:candidate.receipt}},worker=workerV2Harness(stored,f);
 const p={...inspectPayload,receipt:candidate.receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'};
 const r=await worker.run('acquireGenerationResult',p);assert.equal(r.state,'result');assert.equal(r.data,bytes.toString('base64'));
 assert(validResult('acquireGenerationResult',JSON.parse(JSON.stringify(r)),p));assert(!JSON.stringify(stored).includes('chunkHash'));assert.deepEqual(worker.calls,['acquireGenerationResult']);
});
test('v2 baseline precedes typing; accepted durable-user echo precedes exactly one causal assistant anchor',async()=>{
 const f=contentFixture(),user=await acceptV2(f);
 assert.equal(user.baselineAssistantMessageIds.length,1);
 const result=await observeMediaV2(f,user);
 assert.equal(result.state,'running');assert(result.receipt.assistantStableIdHash);assert.equal(result.receipt.result,undefined);
 assert(!user.baselineAssistantMessageIds.includes(result.receipt.assistantStableIdHash));assert.equal(f.clicks,1);
 assert(validResult('inspectGeneration',JSON.parse(JSON.stringify(result)),{...inspectPayload,receipt:JSON.parse(JSON.stringify(user))}));
});

for(const transition of ['composer root','editor','send removed','send replaced','no UI corroboration']) {
 test('v2 acceptance survives post-send '+transition+' with one stable structural user',async()=>{
   const f=contentFixture({noClear:true,keepButton:true,afterClick:f=>{
     if(transition==='composer root')f.replaceComposer();
     if(transition==='editor')f.replaceEditor();
     if(transition==='send removed')f.removeSend();
     if(transition==='send replaced')f.replaceSend();
   }});
   const receipt=await acceptV2(f);
   assert(receipt.acceptance.baselineIntact);assert(receipt.acceptance.uniqueUserTurn);
   assert.equal(receipt.acceptance.composerCleared,false);
   assert.equal(receipt.acceptance.generationControlObserved,false);
   assert.equal(f.documentListenerCount,4,'Manual activity protection outlives composer replacement and acceptance');
   const assistant=await observeMediaV2(f,receipt);
   assert(assistant.receipt.assistantStableIdHash);assert.equal(f.clicks,1);
   assert.equal(f.documentListenerCount,0,'Assistant anchoring releases observer and foreign-activity listeners');
 });
}

const userMutation=(f,addedNodes,removedNodes,previousSibling,nextSibling=null,target=f.messageParent)=>({type:'childList',target,addedNodes,removedNodes,previousSibling,nextSibling});
function appendPendingRole(f) {
 const shell=f.node(null,null),tail=f.rows.at(-1);
 f.transaction([...f.rows,shell],[userMutation(f,[shell],[],tail)]);return shell;
}
function hydratePendingRole(f,shell,id='status') {
 shell.role='assistant';shell.id=id;
 f.mutate([{type:'attributes',target:shell,attributeName:'data-message-role',oldValue:null},
   {type:'attributes',target:shell,attributeName:'data-message-id',oldValue:null}]);
}
for(const active of [false,true])test('pending missing-role shell stays running without anchor or durable failure, then hydrates through normal status/media stabilization: '+active,async()=>{
 const f=contentFixture({noAssistant:true,active}),stored={},worker=workerV2Harness(stored,f);f.transaction(f.rows);
 const prepared=await worker.run('prepareGeneration',inspectPayload),accepted=await worker.run('submitGeneration',{...operation,receipt:prepared.receipt}),receipt=JSON.parse(JSON.stringify(accepted.receipt));
 const before=JSON.stringify(stored),shell=appendPendingRole(f);assert.equal(f.operationCount,1);assert.equal(f.assistantFailureCount,0);
 for(let i=0;i<4;i++){
   const r=await worker.run('inspectGeneration',{...inspectPayload,receipt});assert.equal(r.state,'running');assert.deepEqual(JSON.parse(JSON.stringify(r.receipt)),receipt);
   assert.equal(r.assistantOwnershipFailure,undefined);assert.equal(r.receipt.assistantStableIdHash,undefined);assert.equal(f.operationCount,1);
 }
 assert.equal(JSON.stringify(stored),before,'No new receipt/diagnostic is persisted on settling polls');
 const observation=f.assistantTrace.findLast(frame=>frame.terminalReason==='PENDING_ROLE_SETTLING');assert(observation);assert.equal(observation.terminal,false);
 assert.equal(observation.firstMismatchCategory,'MISSING_ROLE');assert.equal(observation.pendingDirectMessageItemCount,1);assert.equal(observation.missingRoleDirectMessageCount,1);assert.equal(observation.stabilizationSamples,0);
 hydratePendingRole(f,shell);
 f.inject(f.node('assistant','owned-media',media()));
 if(active){for(let i=0;i<3;i++)assert.equal((await worker.run('inspectGeneration',{...inspectPayload,receipt})).receipt.assistantStableIdHash,undefined);f.finish();}
 const first=await worker.run('inspectGeneration',{...inspectPayload,receipt});assert.equal(first.state,'running');assert.equal(first.receipt.assistantStableIdHash,undefined);
 const second=await worker.run('inspectGeneration',{...inspectPayload,receipt});assert.equal(second.state,'running');assert.equal(second.receipt.assistantStableIdHash,shaBytes('op\0assistant\0owned-media'));
 assert.equal(second.receipt.result,undefined);assert.equal(stored['generation-intent:op'].assistantOwnershipFailure,undefined);
 assert.equal(f.operationCount,0);assert.equal(f.clicks,1);assert(!worker.calls.includes('acquireGenerationResult'));
});

test('pending missing role resets an in-progress assistant stabilization and requires two new matching polls',async()=>{
 const f=contentFixture({video:media()}),receipt=await acceptV2(f);f.transaction(f.rows);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).receipt.assistantStableIdHash,undefined);
 assert(f.assistantTrace.some(frame=>frame.stabilizationSamples===1));
 const shell=appendPendingRole(f);
 for(let i=0;i<2;i++)assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).receipt.assistantStableIdHash,undefined);
 assert.equal(f.assistantTrace.at(-1).stabilizationSamples,0);
 hydratePendingRole(f,shell,'tail-status');
 const first=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(first.receipt.assistantStableIdHash,undefined);
 const second=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(second.receipt.assistantStableIdHash,shaBytes('op\0assistant\0new-assistant'));
 assert.equal(f.clicks,1);assert.equal(f.assistantFailureCount,0);
});

for(const phase of ['user','assistant'])test('pending missing role appearing during async '+phase+' hashing prevents assistant commit',async()=>{
 let armed=false,shell,f;
 const webcrypto=require('node:crypto').webcrypto;
 const crypto={subtle:{digest:async(algorithm,data)=>{
   const result=await webcrypto.subtle.digest(algorithm,data);
   if(armed && new TextDecoder().decode(data).includes('\0'+phase+'\0')){armed=false;shell=appendPendingRole(f);}
   return result;
 }}};
 f=contentFixture({video:media(),crypto});f.transaction(f.rows);const receipt=await acceptV2(f);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).receipt.assistantStableIdHash,undefined);
 armed=true;
 const raced=await f.send('inspectGeneration',{...v2Payload,receipt});assert(shell);assert.equal(raced.state,'running');assert.equal(raced.receipt.assistantStableIdHash,undefined);
 assert.equal(raced.assistantOwnershipFailure,undefined);assert.equal(f.operationCount,1);
 hydratePendingRole(f,shell,'after-hash-status');
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).receipt.assistantStableIdHash,undefined);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).receipt.assistantStableIdHash,shaBytes('op\0assistant\0new-assistant'));
 assert.equal(f.clicks,1);
});

for(const failure of ['next user','parent change','baseline change','invalid shell ID','assigned shell ID','unsupported role','multiple media owners','manual input','user ID mutation','missing user in sequence','wrong position','short tail','extra direct item','two pending shells','shell with video','shell with nested message','overflow','scene mismatch','token mismatch','receipt mismatch','user hash mismatch'])test('pending missing-role tolerance remains fail-closed on '+failure,async()=>{
 const f=contentFixture({noAssistant:failure!=='multiple media owners' && failure!=='wrong position' && failure!=='short tail',video:media()}),receipt=await acceptV2(f);
 f.transaction(f.rows);const shell=appendPendingRole(f),p={...v2Payload,receipt};
 if(failure==='next user')f.inject(f.node('user','unowned'));
 if(failure==='parent change')f.rows.find(row=>row.id==='new-user').parentNode={};
 if(failure==='baseline change'){f.rows[0].id='changed';f.mutate([{type:'attributes',target:f.rows[0],attributeName:'data-message-id',oldValue:'history-user'}]);}
 if(failure==='invalid shell ID'){shell.id='invalid id';f.mutate([{type:'attributes',target:shell,attributeName:'data-message-id',oldValue:null}]);}
 if(failure==='assigned shell ID'){shell.id='assigned-without-role';f.mutate([{type:'attributes',target:shell,attributeName:'data-message-id',oldValue:null}]);}
 if(failure==='unsupported role'){shell.role='tool';f.mutate([{type:'attributes',target:shell,attributeName:'data-message-role',oldValue:null}]);}
 if(failure==='multiple media owners'){
   const owner=f.node('assistant','second-owner',media());f.transaction([...f.rows.slice(0,-1),owner,shell],[userMutation(f,[owner],[],f.rows.at(-2),shell)]);
 }
 if(failure==='manual input')f.foreign('input');
 if(failure==='user ID mutation'){const user=f.rows.find(row=>row.id==='new-user');user.id='mutated';f.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'}]);}
 if(failure==='missing user in sequence')f.messageParent.querySelectorAll=()=>f.rows.filter(row=>row.id!=='new-user');
 if(failure==='wrong position')f.messageParent.querySelectorAll=()=>[...f.rows.slice(0,-2),shell,f.rows.at(-2)];
 if(failure==='short tail')f.messageParent.querySelectorAll=()=>f.rows.slice(0,-2);
 if(failure==='extra direct item'){const extra=f.node('assistant','unrecognized');f.messageParent.querySelectorAll=()=>[...f.rows.slice(0,-1),extra,shell];}
 if(failure==='two pending shells')appendPendingRole(f);
 if(failure==='shell with video'){shell.querySelectorAll=selector=>selector==='video'?[media()]:[];}
 if(failure==='shell with nested message'){shell.querySelectorAll=selector=>selector==='[data-message-item]'?[f.node(null,null)]:[];}
 if(failure==='overflow'){
   const status=Array.from({length:8},(_,i)=>f.node('assistant','status-'+i));f.transaction([...f.rows.slice(0,-1),...status,shell]);
 }
 if(failure==='scene mismatch')p.sceneId='other';
 if(failure==='token mismatch')p.observationToken='wrong-token';
 if(failure==='receipt mismatch')p.receipt={...receipt,acceptance:{...receipt.acceptance,composerCleared:!receipt.acceptance.composerCleared}};
 if(failure==='user hash mismatch'){
   // The echoed receipt cannot change an established native anchor.
   p.receipt={...receipt,userStableIdHash:'e'.repeat(64)};
 }
 const r=await f.send('inspectGeneration',p);assert.equal(r.state,'interrupted');assert.equal(r.receipt,undefined);assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
 assert(receiptV2.validAssistantFailure(JSON.parse(JSON.stringify(r.assistantOwnershipFailure))));
 if(failure==='multiple media owners')assert.equal(r.assistantOwnershipFailure.terminalReason,'BLOCK_MULTIPLE_MEDIA_OWNERS');
 if(failure==='two pending shells' || failure==='invalid shell ID' || failure==='assigned shell ID')assert.equal(r.assistantOwnershipFailure.terminalReason,'BLOCK_NONCONTIGUOUS');
});

for(const failure of ['contact stale','operation expired'])test('pending missing role remains bounded by existing '+failure,async()=>{
 let now=1000;const f=contentFixture({noAssistant:true,clock:()=>now}),receipt=await acceptV2(f);f.transaction(f.rows);appendPendingRole(f);
 if(failure==='contact stale')now+=10001;
 else {for(let i=0;i<133;i++){now+=9000;const r=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(r.state,'running');assert.equal(r.receipt.assistantStableIdHash,undefined);}now+=4001;}
 const r=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(r.state,'interrupted');assert.equal(r.assistantOwnershipFailure.terminalReason,failure==='contact stale'?'CONTACT_STALE':'OPERATION_EXPIRED');
 assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
});

test('pending role observation is nonterminal only; historical 0.3.9 MISSING_ROLE failure remains readable unchanged',()=>{
 const {failure}=require('./fixtures/muse-assistant-failure'),d=failure('BLOCK_NONCONTIGUOUS');d.build='muse-content-v0-3-9-contract3-receipt2-assistdiag2';
 Object.assign(d.frames[0],receiptV2.emptyAssistantSequence(),{firstMismatchCategory:'MISSING_ROLE',missingRoleDirectMessageCount:1,pendingDirectMessageItemCount:1});
 const before=JSON.stringify(d);assert(receiptV2.validAssistantFailure(d));assert.equal(JSON.stringify(d),before);
 const bad=structuredClone(d);bad.terminalReason='PENDING_ROLE_SETTLING';bad.frames[0].terminalReason='PENDING_ROLE_SETTLING';assert(!receiptV2.validAssistantFailure(bad));
 const observed={...bad.frames[0],terminal:false};assert(receiptV2.validAssistantFrame(observed));assert(!receiptV2.valid(observed,'op'));
});

test('pending role hydration native pipeline persists the assistant before restart-safe exact-owned acquisition',async t=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(210000,4)]),source='blob:https://muse.ai/owned-hydration-fixture';
 const content=contentFixture({noAssistant:true}),stored={};content.transaction(content.rows);
 let worker=workerV2Harness(stored,content),native,acquired=false,verified=0;
 const f=fixture(t,{verifyVideo:async file=>{assert.deepEqual(fs.readFileSync(file),bytes);verified++;},command:async(type,p)=>{
   if(type==='acquireGenerationResult'){
     const disk=JSON.parse(fs.readFileSync(path.join(native.root,'outputs',p.operationId,'muse-operation.json')));
     assert.equal(disk.receipt.assistantStableIdHash,shaBytes(p.operationId+'\0assistant\0owned-media'));assert(disk.receipt.result);
     assert.equal(disk.assistantOwnershipFailure,undefined);acquired=true;
   }
   return JSON.parse(JSON.stringify(await worker.run(type,p)));
 }});native=f;f.bridge.receiptV2Ready=async()=>true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),before=fs.readFileSync(file),shell=appendPendingRole(content);
 for(let i=0;i<3;i++)assert.equal((await f.provider.reconcile(context)).status,'running');
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(acquired,false);assert.equal(f.service.get(job.id).asset,null);
 hydratePendingRole(content,shell);
 content.inject(content.node('assistant','owned-media',media()));
 await f.provider.reconcile(context);assert.equal(JSON.parse(fs.readFileSync(file)).receipt.assistantStableIdHash,undefined);
 await f.provider.reconcile(context);const anchored=JSON.parse(fs.readFileSync(file));
 assert.equal(anchored.receipt.assistantStableIdHash,shaBytes(job.id+'\0assistant\0owned-media'));assert.equal(anchored.receipt.result,undefined);
 assert.equal(anchored.assistantOwnershipFailure,undefined);assert.equal(acquired,false);
 const v={...media(),currentSrc:source};let fetchCount=0;
 const next=contentFixture({historicalVideos:[media()],fetch:async url=>{assert.equal(url,source);fetchCount++;return new Response(bytes,{headers:{'content-type':'video/mp4'}});}});
 next.replace([next.node('assistant','unrelated-old',media()),next.node('assistant','owned-media',v),next.node('assistant','unrelated-newest',media())]);
 worker=workerV2Harness(stored,next);
 const done=await f.service.recover(job.id);assert.equal(done.status,'completed');assert(done.asset);assert(acquired);assert(verified>0);assert.equal(fetchCount,1);
 assert.deepEqual(fs.readFileSync(path.join(context.outputDirectory,job.id+'.mp4')),bytes);
 assert.equal(done.projectId,job.projectId);assert.equal(done.sceneId,job.sceneId);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert.equal(content.clicks,1);assert.equal(next.clicks,0);
 assert(!worker.calls.includes('submitGeneration'));assert(!worker.calls.includes('prepareGeneration'));
});

for(const scenario of ['missing role','unsupported role','extra valid item','tail length','wrong position','missing user','pending ID','invalid ID','normal'])test('Gate-D sequence evidence V2 classifies bounded direct structural mismatch: '+scenario,()=>{
 const f=contentFixture(),user=f.node('user','fixture-user-private'),a=f.node('assistant','fixture-status-private'),b=f.node('assistant','fixture-media-private');
 const rows=[{node:a},{node:b}];let sequence=[user,a,b],index=0,contiguous=false;
 if(scenario==='missing role')sequence=[user,f.node(null,'shell-private'),a,b];
 if(scenario==='unsupported role')sequence=[user,f.node('tool','shell-private'),a,b];
 if(scenario==='extra valid item')sequence=[user,a,b,f.node('assistant','extra-private')];
 if(scenario==='tail length')sequence=[user,a];
 if(scenario==='wrong position')sequence=[user,b,a];
 if(scenario==='missing user')index=-1;
 // Pure projection inputs isolate the classification for a direct shell not
 // in the recognized set. They do not change what live structure() recognizes.
 if(scenario==='pending ID')sequence=[user,f.node('assistant',null),a,b];
 if(scenario==='invalid ID')sequence=[user,f.node('assistant','https://private.invalid'),a,b];
 if(scenario==='normal')contiguous=true;
 const evidence=f.sequenceEvidence(rows,sequence,index,contiguous);
 const expected={'missing role':'MISSING_ROLE','unsupported role':'UNSUPPORTED_ROLE','extra valid item':'EXTRA_DIRECT_MESSAGE_ITEM',
   'tail length':'SEQUENCE_TAIL_LENGTH_MISMATCH','wrong position':'RECOGNIZED_ROW_POSITION_MISMATCH','missing user':'USER_NOT_IN_SEQUENCE',
   'pending ID':'PENDING_MESSAGE_ID','invalid ID':'INVALID_MESSAGE_ID',normal:'NONE'};
 assert.equal(evidence.firstMismatchCategory,expected[scenario]);assert.equal(evidence.recognizedFreshRowCount,3);assert.equal(evidence.recognizedAssistantRowCount,2);
 assert.equal(evidence.expectedSequenceLength,2);assert.equal(evidence.userSequenceIndexValid,index>=0);
 if(index>=0){assert.equal(evidence.directSequenceTailCount,sequence.length-1);assert.equal(evidence.directMessageItemTailCount,sequence.length-1);assert.equal(evidence.sequenceTailLength,sequence.length-1);}
 assert.equal(evidence.pendingDirectMessageItemCount,scenario==='pending ID'?1:index<0?null:0);
 assert.equal(evidence.invalidIdentityDirectMessageCount,scenario==='invalid ID'?1:index<0?null:0);
 assert.equal(evidence.missingRoleDirectMessageCount,scenario==='missing role'?1:index<0?null:0);
 assert.equal(evidence.unsupportedRoleDirectMessageCount,scenario==='unsupported role'?1:index<0?null:0);
 assert.equal(evidence.recognizedRowsMatchDirectSequence,index<0?null:['normal','extra valid item'].includes(scenario));
 for(const [key,value] of Object.entries(evidence))assert(key==='firstMismatchCategory'?typeof value==='string':value===null||typeof value==='number'||typeof value==='boolean');
 for(const secret of ['fixture-','shell-private','https:','extra-private'])assert(!JSON.stringify(evidence).includes(secret));
 assert.equal(f.clicks,0);
});

test('Gate-D sequence V2 mismatch priority is deterministic, bounded and has a length-only case',()=>{
 const f=contentFixture(),user=f.node('user','private-user'),a=f.node('assistant','private-assistant');
 const d=f.sequenceEvidence([{node:a}],[user,f.node(null,null),f.node('tool','invalid id'),a],0,false);
 assert.equal(d.firstMismatchCategory,'MISSING_ROLE');assert.equal(d.missingRoleDirectMessageCount,1);assert.equal(d.unsupportedRoleDirectMessageCount,1);
 assert.equal(d.pendingDirectMessageItemCount,1);assert.equal(d.invalidIdentityDirectMessageCount,1);
 assert.equal(f.sequenceEvidence([{node:a}],[user,a],0,false).firstMismatchCategory,'UNKNOWN_BOUNDED','Inconsistent false predicate is never explained by a guess');
 // Expected zero recognized assistants, one direct item: extra takes priority
 // over the tail-length discrepancy, which remains visible in the counts.
 const extra=f.sequenceEvidence([],[user,f.node('assistant','private-extra')],0,false);
 assert.equal(extra.firstMismatchCategory,'EXTRA_DIRECT_MESSAGE_ITEM');assert.equal(extra.expectedSequenceLength,0);assert.equal(extra.sequenceTailLength,1);
 let reads=0;const shell={getAttribute:()=>{reads++;return null;}};
 const overflow=f.sequenceEvidence([],[user,...Array(300).fill(shell)],0,false);
 assert.equal(overflow.directSequenceTailCount,257);assert.equal(overflow.firstMismatchCategory,'UNKNOWN_BOUNDED');assert.equal(reads,512);
 const unavailable=f.sequenceEvidence([],[user,{getAttribute(){throw Error('private');}}],0,false);
 assert.equal(unavailable.firstMismatchCategory,'UNKNOWN_BOUNDED');assert(!JSON.stringify(unavailable).includes('private'));
});

for(const mode of ['missing role shell','pending assistant ID','invalid assistant ID','unsupported role shell'])test('Gate-D sequence V2 live diagnostic preserves existing shell behavior: '+mode,async()=>{
 const f=contentFixture({noAssistant:true});f.transaction(f.rows);
 const receipt=await acceptV2(f),before=JSON.stringify(receipt),user=f.rows.at(-1);
 const role=mode==='missing role shell'?null:mode==='unsupported role shell'?'tool':'assistant';
 const id=mode==='pending assistant ID'?null:mode==='invalid assistant ID'?'invalid private id':'private-shell';
 const shell=f.node(role,id);
 f.transaction([...f.rows,shell],[userMutation(f,[shell],[],user)]);
 const result=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(JSON.stringify(receipt),before);
 if(mode==='pending assistant ID'){
   assert.equal(result.state,'running');assert.equal(result.receipt.assistantStableIdHash,undefined);
   const frame=f.assistantTrace.findLast(frame=>frame.firstMismatchCategory!==null);
   assert.equal(frame.firstMismatchCategory,'NONE');assert.equal(frame.pendingDirectMessageItemCount,1);assert.equal(frame.recognizedAssistantRowCount,1);
   await f.send('cancelGeneration',inspectPayload);
 }else {
   assert.equal(result.state,'interrupted');const d=result.assistantOwnershipFailure;assert(receiptV2.validAssistantFailure(JSON.parse(JSON.stringify(d))));
   if(mode==='invalid assistant ID'){
     assert.equal(d.terminalReason,'UNKNOWN_BOUNDED','structure() rejects invalid recognized identity before the sequence check');
     assert.equal(d.frames.at(-1).firstMismatchCategory,null);
   }else {
     assert.equal(d.terminalReason,'BLOCK_NONCONTIGUOUS');const frame=d.frames.at(-1);
     assert.equal(frame.recognizedAssistantRowCount,0);assert.equal(frame.directMessageItemTailCount,1);assert.equal(frame.recognizedRowsMatchDirectSequence,true);
     assert.equal(frame.firstMismatchCategory,mode==='missing role shell'?'MISSING_ROLE':'UNSUPPORTED_ROLE');
     const first=JSON.stringify(d);f.transaction(f.rows.filter(row=>row!==shell));
     const later=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(JSON.stringify(later.assistantOwnershipFailure),first);
   }
   assert.equal(result.receipt,undefined);
 }
 assert.equal(f.clicks,1);assert.equal(f.assistantFailureCount<=1,true);
});

test('Gate-D sequence V2 normal live two-assistant block reports no mismatch before unchanged anchoring',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{f.inject(f.node('assistant','status'));f.inject(f.node('assistant','owner',media()));}});
 const receipt=await acceptV2(f),running=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(running.state,'running');
 const frame=f.assistantTrace.findLast(frame=>frame.firstMismatchCategory!==null);
 assert.equal(frame.firstMismatchCategory,'NONE');assert.equal(frame.recognizedFreshRowCount,3);assert.equal(frame.recognizedAssistantRowCount,2);
 assert.equal(frame.expectedSequenceLength,2);assert.equal(frame.directSequenceTailCount,2);assert.equal(frame.directMessageItemTailCount,2);
 assert.equal(frame.userSequenceIndexValid,true);assert.equal(frame.recognizedRowsMatchDirectSequence,true);
 for(const key of ['pendingDirectMessageItemCount','invalidIdentityDirectMessageCount','missingRoleDirectMessageCount','unsupportedRoleDirectMessageCount'])assert.equal(frame[key],0);
 const anchored=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(anchored.receipt.assistantStableIdHash,shaBytes('op\0assistant\0owner'));
 assert.equal(anchored.assistantOwnershipFailure,undefined);assert.equal(f.clicks,1);
});

for(const change of ['missing tail row','wrong position'])test('Gate-D sequence V2 records discrepancy between recognized and direct sequence snapshots: '+change,async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{f.inject(f.node('assistant','status-private'));f.inject(f.node('assistant','owner-private',media()));}});
 f.transaction(f.rows);const receipt=await acceptV2(f),all=f.rows.slice(),userIndex=all.findIndex(row=>row.id==='new-user');
 // A deterministic divergent direct-query snapshot exercises the unchanged
 // responseBlock predicate. It is not a claim that live Muse produced this.
 f.messageParent.querySelectorAll=()=>change==='missing tail row'?all.slice(0,-1):[...all.slice(0,userIndex+1),all.at(-1),all.at(-2)];
 const result=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(result.state,'interrupted');
 const d=result.assistantOwnershipFailure,frame=d.frames.at(-1);assert.equal(d.terminalReason,'BLOCK_NONCONTIGUOUS');
 assert.equal(frame.recognizedAssistantRowCount,2);assert.equal(frame.directSequenceTailCount,change==='missing tail row'?1:2);
 assert.equal(frame.firstMismatchCategory,change==='missing tail row'?'SEQUENCE_TAIL_LENGTH_MISMATCH':'RECOGNIZED_ROW_POSITION_MISMATCH');
 assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
 f.messageParent.querySelectorAll=()=>f.rows;
 const later=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(JSON.stringify(later.assistantOwnershipFailure),JSON.stringify(d));
});

test('Gate-D sequence V2 schema accepts legacy 0.3.8 frames byte-for-byte and rejects partial/private extensions',()=>{
 const {failure}=require('./fixtures/muse-assistant-failure'),old=failure('BLOCK_NONCONTIGUOUS');old.build='muse-content-v0-3-8-contract3-receipt2-assistdiag1';
 const original=JSON.stringify(old);assert(receiptV2.validAssistantFailure(old));assert(receiptV2.validAssistantSummary(receiptV2.assistantFailureSummary(old)));
 assert.equal(JSON.stringify(old),original);assert.equal(Object.hasOwn(receiptV2.assistantFailureSummary(old).lastFrame,'recognizedFreshRowCount'),false);
 const extended=structuredClone(old);Object.assign(extended.frames[0],receiptV2.emptyAssistantSequence());assert(receiptV2.validAssistantFailure(extended));
 for(const mutate of [f=>delete f.sequenceTailLength,f=>f.recognizedFreshRowCount=258,f=>f.pendingDirectMessageItemCount=-1,
   f=>f.userSequenceIndexValid='true',f=>f.firstMismatchCategory='private native id',f=>f.rawHtml='private']){
   const bad=structuredClone(extended);mutate(bad.frames[0]);assert(!receiptV2.validAssistantFailure(bad));
 }
 assert(!receiptV2.valid(extended,'op'));assert(!validPayload('inspectGeneration',{...inspectPayload,assistantOwnershipFailure:extended}));
});

test('Gate-D sequence V2 terminal detail survives worker/native persistence and read-only support summary',async t=>{
 const content=contentFixture({noAssistant:true}),stored={},worker=workerV2Harness(stored,content);
 content.transaction(content.rows);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;f.bridge.developmentDiagnostics=true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),before=JSON.parse(fs.readFileSync(file)),user=content.rows.at(-1);
 const shell=content.node(null,'assigned-without-role'),originalRows=content.rows.slice();
 content.transaction([...originalRows,shell],[userMutation(content,[shell],[],user)]);
 await assert.rejects(f.provider.reconcile(context),{code:'RECOVERY_REQUIRED'});
 const saved=JSON.parse(fs.readFileSync(file)),failure=saved.assistantOwnershipFailure,last=failure.frames.at(-1);
 assert.equal(failure.terminalReason,'BLOCK_NONCONTIGUOUS');assert.equal(last.firstMismatchCategory,'MISSING_ROLE');
 assert.equal(last.pendingDirectMessageItemCount,0);assert.equal(last.missingRoleDirectMessageCount,1);
 assert.equal(last.recognizedAssistantRowCount,0);assert.equal(last.directMessageItemTailCount,1);assert.equal(last.sequenceTailLength,1);
 assert.deepEqual(saved.receipt,before.receipt);assert.equal(saved.receipt.assistantStableIdHash,undefined);
 assert.deepEqual(stored['generation-intent:'+job.id].assistantOwnershipFailure,failure);
 // Current census may now settle; it cannot rewrite the historical frame.
 content.transaction([...originalRows,content.node('assistant','status'),content.node('assistant','media',media())]);
 const evidence=fs.readFileSync(file),jobBytes=fs.readFileSync(f.service.store.file);
 const report=await f.service.diagnoseMuseOwnership(job.id);
 assert.equal(report.ok,true);assert.deepEqual(report.historicalAssistantOwnershipFailure.lastFrame,last);
 assert.equal(report.diagnostic.responseBlock.assistantBlockRowCount,2);assert.equal(report.diagnostic.responseBlock.mediaAssistantCandidateCount,1);
 assert.deepEqual(fs.readFileSync(file),evidence);assert.deepEqual(fs.readFileSync(f.service.store.file),jobBytes);
 assert.equal(content.clicks,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
 for(const secret of [request().prompt,'new-user','history-user','https://','private'])assert(!JSON.stringify(failure).includes(secret));
});

for(const transient of ['foreign parent','unknown row gap','foreign parent after stabilization sample'])test('Gate-D preserves first transient block failure even after final DOM settles: '+transient,async()=>{
 const content=contentFixture({noAssistant:true,afterClick:f=>{f.inject(f.node('assistant','status'));f.inject(f.node('assistant','media-owner',media()));}}),stored={},worker=workerV2Harness(stored,content),key='generation-intent:op';
 content.transaction(content.rows);
 const prep=await worker.run('prepareGeneration',inspectPayload),accepted=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 const receipt=JSON.stringify(accepted.receipt),rows=content.rows.slice(),assistant=rows.at(-1);
 assert.equal(content.assistantTrace,null,'No trace before durable user echo');
 if(transient.includes('after stabilization')){
   const running=await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});assert.equal(running.state,'running');assert.equal(running.receipt.assistantStableIdHash,undefined);
   assert(content.assistantTrace.some(frame=>frame.stabilizationSamples===1));
 }
 if(transient.startsWith('foreign parent')){
   const foreign={};content.transaction(rows,[userMutation(content,[],[assistant],rows.at(-2)),userMutation(content,[assistant],[],null,null,foreign)],()=>{assistant.parentNode=foreign;});
 }else {
   const gap=content.node('tool','unclassified');content.transaction([...rows.slice(0,-1),gap,assistant],[userMutation(content,[gap],[],rows.at(-2),assistant)]);
 }
 assert.equal(content.operationCount,0);
 content.transaction(rows); // A later settled document cannot repair causality.
 const result=await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 const failure=JSON.parse(JSON.stringify(result.assistantOwnershipFailure));
 assert.equal(result.state,'interrupted');assert(receiptV2.validAssistantFailure(failure));
 assert.equal(failure.terminalReason,transient.startsWith('foreign parent')?'BLOCK_PARENT_MISMATCH':'BLOCK_NONCONTIGUOUS');
 if(transient.includes('after stabilization'))assert(failure.frames.some(frame=>frame.terminalReason==='STABILIZATION_RESET' && frame.stabilizationReset));
 assert.equal(failure.terminalPhase,'sample_before_block');assert.equal(failure.frames.filter(f=>f.terminal).length,1);
 assert(validResult('inspectGeneration',JSON.parse(JSON.stringify(result)),{...inspectPayload,receipt:JSON.parse(receipt)}));
 assert.equal(JSON.stringify(stored[key].receipt),receipt);assert.deepEqual(stored[key].assistantOwnershipFailure,failure);
 const storedBefore=JSON.stringify(stored),diagnosis=await worker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:accepted.receipt.userStableIdHash});
 assert.equal(diagnosis.ownershipDiagnostic.ownedUserMatches,1);assert.equal(diagnosis.ownershipDiagnostic.responseBlock.ownedResponseBlockCount,1);
 assert.equal(diagnosis.ownershipDiagnostic.responseBlock.assistantBlockRowCount,2);
 assert.equal(diagnosis.ownershipDiagnostic.responseBlock.mediaAssistantCandidateCount,1);assert.equal(diagnosis.ownershipDiagnostic.responseBlock.mediaAssistantStable,false);
 assert.equal(JSON.stringify(stored),storedBefore);assert.equal(diagnosis.receipt,undefined);
 const again=await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 assert.deepEqual(JSON.parse(JSON.stringify(again.assistantOwnershipFailure)),failure);
 assert.equal(JSON.stringify(stored),storedBefore);assert.equal(content.clicks,1);
 assert(!worker.calls.includes('acquireGenerationResult'));assert.equal(stored[key].receipt.assistantStableIdHash,undefined);
 // Worker restart may now see OPERATION_MISSING, but its first failure wins.
 const restarted=workerV2Harness(stored,contentFixture());
 const afterRestart=await restarted.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 assert.deepEqual(JSON.parse(JSON.stringify(afterRestart.assistantOwnershipFailure)),failure);assert.equal(JSON.stringify(stored),storedBefore);
});

test('Gate-D trace is memory-bounded on running polls and terminal reason is immutable',async()=>{
 const f=contentFixture({video:media(),active:true}),receipt=await acceptV2(f);
 for(let i=0;i<24;i++){
   const r=await f.send('inspectGeneration',{...v2Payload,receipt});assert.equal(r.state,'running');assert.equal(r.assistantOwnershipFailure,undefined);
 }
 assert.equal(f.assistantTrace.length,16);assert(f.assistantTrace.every(frame=>!frame.terminal));
 assert(f.assistantTrace.some(frame=>frame.terminalReason==='STABILIZATION_NOT_READY'));
 f.foreign('pointerdown');
 const interrupted=await f.send('inspectGeneration',{...v2Payload,receipt}),d=JSON.parse(JSON.stringify(interrupted.assistantOwnershipFailure));
 assert(receiptV2.validAssistantFailure(d));assert.equal(d.frames.length,16);assert.equal(d.terminalReason,'MANUAL_INTERFERENCE');
 assert.equal(d.frames.filter(f=>f.terminal).length,1);assert.equal(d.frames.at(-1).terminal,true);
 assert.equal(f.operationCount,0);assert.equal(f.clicks,1);
});

for(const reason of ['OPERATION_MISSING','SCENE_MISMATCH','OBSERVATION_TOKEN_MISMATCH','CONTACT_STALE','OPERATION_EXPIRED','RECEIPT_MISMATCH'])test('Gate-D distinguishes precheck '+reason,async()=>{
 let now=1000;const f=contentFixture({noAssistant:true,clock:()=>now}),receipt=await acceptV2(f),p={...v2Payload,receipt};
 if(reason==='OPERATION_MISSING')await f.send('cancelGeneration',inspectPayload);
 if(reason==='SCENE_MISMATCH')p.sceneId='other-scene';
 if(reason==='OBSERVATION_TOKEN_MISMATCH')p.observationToken='other-epoch';
 if(reason==='CONTACT_STALE')now+=10001;
 if(reason==='OPERATION_EXPIRED'){
   for(let i=0;i<133;i++){now+=9000;assert.equal((await f.send('inspectGeneration',p)).state,'running');}
   now+=4001; // Contact is fresh, but the original operation lifetime expired.
 }
 if(reason==='RECEIPT_MISMATCH')p.receipt={...receipt,acceptance:{...receipt.acceptance,composerCleared:!receipt.acceptance.composerCleared}};
 const result=await f.send('inspectGeneration',p);assert.equal(result.state,'interrupted');
 assert.equal(result.assistantOwnershipFailure.terminalReason,reason);
 assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
});

test('Gate-D native persistence is atomic, first-only, separate from receipt and absent on running polls',async t=>{
 const content=contentFixture({active:true,video:media()}),stored={},worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),before=fs.readFileSync(file),receipt=JSON.parse(before).receipt;
 for(let i=0;i<4;i++)assert.equal((await f.provider.reconcile(context)).status,'running');
 assert.deepEqual(fs.readFileSync(file),before);
 const rows=content.rows.slice(),assistant=rows.at(-1);
 content.transaction(rows,[],()=>{assistant.parentNode={};});content.transaction(rows);
 await assert.rejects(f.provider.reconcile(context),{code:'RECOVERY_REQUIRED'});
 const persisted=JSON.parse(fs.readFileSync(file)),failure=persisted.assistantOwnershipFailure;
 assert(receiptV2.validAssistantFailure(failure));assert.equal(failure.terminalReason,'BLOCK_PARENT_MISMATCH');assert.deepEqual(persisted.receipt,receipt);
 assert.equal(persisted.receipt.assistantStableIdHash,undefined);assert.equal(persisted.verifiedOutput,undefined);
 assert(!fs.readdirSync(context.outputDirectory).some(name=>name.endsWith('.tmp')));
 const terminal=fs.readFileSync(file);
 f.bridge.command=async(type,p)=>{assert.equal(type,'inspectGeneration');return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',assistantOwnershipFailure:require('./fixtures/muse-assistant-failure').failure('OPERATION_MISSING')};};
 await assert.rejects(f.provider.reconcile(context),{code:'RECOVERY_REQUIRED'});assert.deepEqual(fs.readFileSync(file),terminal);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
});

test('Gate-D successful stabilization returns exactly the original receipt extension without diagnostic persistence',async()=>{
 const f=contentFixture({video:media()}),user=await acceptV2(f),before=JSON.stringify(user);
 const assistant=await observeMediaV2(f,user);
 assert.deepEqual(JSON.parse(JSON.stringify(assistant)),{operationId:'op',sceneId:'scene',state:'running',receipt:{...JSON.parse(before),assistantStableIdHash:shaBytes('op\0assistant\0new-assistant')}});
 assert.equal(f.operationCount,0);assert.equal(f.assistantFailureCount,0);assert.equal(f.clicks,1);
});

test('Gate-D native write failure preserves the receipt and cleans the diagnostic temporary file',async t=>{
 const content=contentFixture({video:media()}),stored={},worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;
 const submitted=await f.service.submit(request()),job=await until(f.service,submitted.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const context=f.service.context(job),file=path.join(context.outputDirectory,'muse-operation.json'),before=fs.readFileSync(file);
 const rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(source,destination)=>{if(destination===file)throw Object.assign(Error('fixture disk failure'),{code:'ENOSPC'});return rename(source,destination);});
 content.foreign('pointerdown');await assert.rejects(f.provider.reconcile(context));
 assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(context.outputDirectory),['muse-operation.json']);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
 assert.equal(f.service.get(job.id).asset,null);
});

test('Gate-D released failure cache remains bounded without exhausting fresh operation capacity',async()=>{
 let sequence=0;const f=contentFixture({noAssistant:true,afterClick:f=>{f.rows.at(-1).id='independent-user-'+sequence++;}});
 for(let i=0;i<36;i++){
   const p={...v2Payload,operationId:'diagnostic-'+i},prepared=await f.send('prepareGeneration',p);assert.equal(prepared.state,'prepared');
   const user=await f.send('submitGeneration',{...operation,...p,receipt:prepared.receipt});assert.equal(user.state,'running');
   f.foreign('pointerdown');const r=await f.send('inspectGeneration',{...p,receipt:user.receipt});
   assert.equal(r.assistantOwnershipFailure.terminalReason,'MANUAL_INTERFERENCE');assert.equal(f.operationCount,0);assert(f.assistantFailureCount<=32);
 }
 assert.equal(f.assistantFailureCount,32);assert.equal(f.clicks,36,'All clicks are isolated fixture callbacks, no browser transport');
 assert.equal((await f.send('prepareGeneration',{...v2Payload,operationId:'fresh-after-cache-rotation'})).state,'prepared');
 await f.send('cancelGeneration',{...inspectPayload,operationId:'fresh-after-cache-rotation'});
});

for(const bad of ['private frame','extra receipt','success state'])test('Gate-D worker rejects malformed diagnostic output without receipt/storage mutation: '+bad,async()=>{
 const f=contentFixture(),stored={},worker=workerV2Harness(stored,f),prepared=await worker.run('prepareGeneration',inspectPayload);
 const user=await worker.run('submitGeneration',{...operation,receipt:prepared.receipt}),before=JSON.stringify(stored);
 worker.context.chrome.tabs.sendMessage=async()=>{
   const r={operationId:'op',sceneId:'scene',state:'interrupted',assistantOwnershipFailure:require('./fixtures/muse-assistant-failure').failure()};
   if(bad==='private frame')r.assistantOwnershipFailure.frames[0].url='private';
   if(bad==='extra receipt')r.receipt={...user.receipt,assistantStableIdHash:'d'.repeat(64)};
   if(bad==='success state')r.state='running';return r;
 };
 const result=await worker.run('inspectGeneration',{...inspectPayload,receipt:user.receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.assistantOwnershipFailure,undefined);assert.equal(JSON.stringify(stored),before);assert.equal(f.clicks,1);
 await f.send('cancelGeneration',inspectPayload);
});

test('Gate-D schema rejects private/unbounded data and cannot enter receipt or execution inputs',()=>{
 const {failure}=require('./fixtures/muse-assistant-failure'),d=failure();assert(receiptV2.validAssistantFailure(d));
 assert(receiptV2.validAssistantSummary(receiptV2.assistantFailureSummary(d)));
 for(const mutate of [d=>d.frames=Array(17).fill(d.frames[0]),d=>d.terminalReason='private exception',d=>d.frames[0].url='private',d=>d.frames[0].blockRowCount=10,d=>d.frames[0].stabilizationSamples=3,d=>d.frames[0].terminalReason='STABILIZATION_RESET',d=>d.frames[0].terminal=false,d=>d.nativeId='private']){
   const bad=structuredClone(d);mutate(bad);assert(!receiptV2.validAssistantFailure(bad));
 }
 assert(!receiptV2.valid(d,'op'));assert(!receiptV2.valid({...anchoredReceipt('op'),assistantOwnershipFailure:d},'op'));
 assert(!validPayload('inspectGeneration',{...inspectPayload,receipt:anchoredReceipt('op'),assistantOwnershipFailure:d}));
 assert(!validResult('submitGeneration',{...inspectPayload,state:'interrupted',assistantOwnershipFailure:d},operation));
});

for(const role of ['assistant','user'])test('acceptance projection gives internal baseline '+role+' wrapper churn no message authority',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{
   const row=f.rows.find(r=>r.role===role),user=f.rows.at(-1),tail=f.rows.at(-2);
   const content={tagName:'SPAN',getAttribute:()=>null,querySelectorAll:()=>[]};
   f.transaction(f.rows,[userMutation(f,[user],[],tail),userMutation(f,[content],[],null,null,row)]);
 }});f.transaction(f.rows);
 const stored={},worker=workerV2Harness(stored,f),prepared=await worker.run('prepareGeneration',inspectPayload);
 const result=await worker.run('submitGeneration',{...operation,receipt:prepared.receipt});
 assert.equal(result.state,'running');assert.equal(result.receipt.userStableIdHash,shaBytes('op\0user\0new-user'));
 const trace=f.structuralTrace,frame=trace.frames[0],wrapper=frame.events.find(e=>e.event==='wrapper');
 assert.equal(frame.baselineValid,true);assert(wrapper);assert.equal(wrapper.role,'none');assert.equal(wrapper.identity,0);assert.equal(wrapper.position,-1);
 assert(frame.events.some(e=>e.event==='added' && e.role==='user' && e.position===trace.baseline.count && e.identity>0));
 assert.equal(require('../extensions/meta-muse-bridge/acceptance-replay').replay(trace).status,'accepted');
 assert.equal(stored['generation-intent:op'].receipt.userStableIdHash,result.receipt.userStableIdHash);
 assert.equal(f.lineage.logicalCount,1);assert.equal(f.clicks,1);
 assert.equal((await worker.run('submitGeneration',{...operation,receipt:prepared.receipt})).state,'interrupted');assert.equal(f.clicks,1);
 await worker.run('cancelGeneration',inspectPayload);
});

for(const role of ['assistant','user'])test('acceptance projection retains actual baseline '+role+' removal authority even when prefix is restored',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{
   const row=f.rows.find(r=>r.role===role),user=f.rows.at(-1),tail=f.rows.at(-2);
   f.transaction(f.rows,[userMutation(f,[user],[],tail),userMutation(f,[],[row],row.previousSibling,row.nextSibling),userMutation(f,[row],[],row.previousSibling,row.nextSibling)]);
 }});f.transaction(f.rows);
 const prepared=await f.send('prepareGeneration',v2Payload);
 const result=await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:prepared.receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.acceptanceDiagnostic.failureReason,'BASELINE_CHANGED');assert.equal(result.receipt,undefined);
 const frame=result.acceptanceTrace.frames[0];assert.equal(frame.baselineValid,true);
 for(const action of ['removed','added'])assert(frame.events.some(e=>e.event===action && e.role===role && e.position<2 && e.position>=0 && e.identity>0));
 assert.equal(f.clicks,1);assert.equal(f.operationCount,0);
});

for(const change of ['native ID','role','transient native ID','prefix order'])test('acceptance projection still fails closed on baseline '+change,async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{
   const row=f.rows[0],old=row.id;
   let records;
   if(change==='prefix order')f.transaction([f.rows[1],row,...f.rows.slice(2)]);
   else {
     if(change==='role')row.role='assistant';
     else if(change==='native ID')row.id='changed-baseline';
     records=[{type:'attributes',target:row,attributeName:change==='role'?'data-message-role':'data-message-id',oldValue:change==='role'?'user':change==='transient native ID'?'temporary-baseline':old}];
     f.transaction(f.rows,records);
   }
 }});f.transaction(f.rows);
 const prepared=await f.send('prepareGeneration',v2Payload);
 const result=await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:prepared.receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);assert.equal(f.operationCount,0);
 assert.equal(result.acceptanceDiagnostic.failureReason,change==='transient native ID'?'IDENTITY_MUTATED':'BASELINE_CHANGED');
 if(change!=='prefix order')assert(result.acceptanceTrace.frames[0].events.some(e=>e.event==='id_changed' && e.role!=='none' && e.identity>0));
});

test('acceptance projection preserves fresh user and assistant events through a fast status/media tail with baseline wrapper churn',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{
   const baseline=f.rows.slice(0,-1),user=f.rows.at(-1),status=f.node('assistant','status-row'),owner=f.node('assistant','media-owner',media());
   f.transaction([...f.rows,status,owner],[userMutation(f,[user],[],baseline.at(-1)),
     userMutation(f,[],[],null,null,baseline[1]),userMutation(f,[status],[],user),userMutation(f,[owner],[],status)]);
 }});f.transaction(f.rows);
 const user=await acceptV2(f),trace=f.structuralTrace,events=trace.frames[0].events;
 assert.equal(trace.frames[0].baselineValid,true);
 assert.equal(events.filter(e=>e.event==='added' && e.role==='user').length,1);
 assert.equal(events.filter(e=>e.event==='added' && e.role==='assistant').length,2);
 assert(events.filter(e=>e.event==='added').every(e=>e.identity>0 && e.position>=trace.baseline.count));
 assert(events.filter(e=>e.event==='wrapper').every(e=>e.role==='none' && e.identity===0 && e.position===-1));
 assert.equal(f.lineage.logicalCount,1);assert.equal(f.lineage.maxConcurrent,1);
 const assistant=await observeMediaV2(f,user,'media-owner');
 assert.equal(assistant.receipt.assistantStableIdHash,shaBytes('op\0assistant\0media-owner'));
 assert.equal(assistant.receipt.result,undefined);assert.equal(f.clicks,1);
});

function replaceOptimisticUser(f,{split=false,chain=false}={}) {
 const old=f.rows.at(-1),baseline=f.rows.slice(0,-1),tail=baseline.at(-1),canonical=f.node('user','canonical-user');
 const records=[userMutation(f,[old],[],tail)];
 if(chain){
   const intermediate=f.node('user','intermediate-user');intermediate.isConnected=false;
   records.push(userMutation(f,[intermediate],[old],tail),userMutation(f,[canonical],[intermediate],tail));
 }else if(split)records.push(userMutation(f,[],[old],tail),userMutation(f,[canonical],[],tail));
 else records.push(userMutation(f,[canonical],[old],tail));
 f.transaction([...baseline,canonical],records);
}
for(const mode of ['atomic','split same delivery','three identities'])test('v2 proven logical suffix replacement accepts canonical ID: '+mode,async()=>{
 const f=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>replaceOptimisticUser(f,{split:mode==='split same delivery',chain:mode==='three identities'})});
 f.transaction(f.rows);
 const receipt=await acceptV2(f);
 assert.equal(receipt.userStableIdHash,shaBytes('op\0user\0canonical-user'));
 assert.notEqual(receipt.userStableIdHash,shaBytes('op\0user\0optimistic-user'));
 assert.equal(receipt.assistantStableIdHash,undefined);
 assert.deepEqual(f.lineage,{identityCount:mode==='three identities'?3:2,logicalCount:1,maxConcurrent:1,replacementCount:mode==='three identities'?2:1,replacementObserved:true});
 const serialized=JSON.stringify(receipt);assert(!serialized.includes('optimistic'));assert(!serialized.includes('canonical-user'));assert(!serialized.includes('aliases'));
 f.inject(f.node('assistant','causal-assistant'));
 const assistant=await observeMediaV2(f,receipt,'causal-assistant');
 assert.equal(assistant.receipt.assistantStableIdHash,shaBytes('op\0assistant\0causal-assistant'));assert.equal(f.clicks,1);
});

test('v2 replacement of an already sampled optimistic user restarts canonical stabilization',async()=>{
 let optimistic,canonical;
 const f=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>{
   optimistic=f.rows.at(-1);f.transaction(f.rows,[userMutation(f,[optimistic],[],f.rows.at(-2))]);
 },onPostSendTick:(f,tick)=>{
   if(tick===2){canonical=f.node('user','canonical-user');f.transaction([...f.rows.slice(0,-1),canonical],[userMutation(f,[canonical],[optimistic],f.rows.at(-2))]);}
 }});
 f.transaction(f.rows);const receipt=await acceptV2(f);
 assert.equal(receipt.userStableIdHash,shaBytes('op\0user\0canonical-user'));assert.equal(f.lineage.replacementCount,1);
 assert.equal(f.clicks,1);await f.send('cancelGeneration',inspectPayload);
});

test('v2 lineage diagnostics distinguish identity history from logical turns and preserve legacy schema',async()=>{
 const f=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>replaceOptimisticUser(f),onPostSendTick:(f,tick)=>{if(tick===1)f.foreign('pointerdown');}});
 f.transaction(f.rows);const stored={},worker=workerV2Harness(stored,f),prep=await worker.run('prepareGeneration',inspectPayload);
 const result=await worker.run('submitGeneration',{...operation,receipt:prep.receipt}),d=JSON.parse(JSON.stringify(result.acceptanceDiagnostic));
 assert.equal(result.state,'interrupted');assert(receiptV2.validAcceptanceDiagnostic(d));
 assert.equal(d.freshUserIdentityCount,2);assert.equal(d.logicalFreshUserTurnCount,1);assert.equal(d.maxConcurrentFreshUserRows,1);
 assert.equal(d.identityReplacementObserved,true);assert.equal(d.replacementCandidateCount,1);assert.equal(d.replacementAmbiguous,false);
 assert.equal(d.canonicalUserStable,false);assert.equal(d.manualInterferenceObserved,true);
 for(const patch of [{logicalFreshUserTurnCount:129},{replacementCandidateCount:-1},{replacementAliases:['private']},{canonicalUserStable:'yes'},{freshUserIdentityCount:undefined}])assert(!receiptV2.validAcceptanceDiagnostic({...d,...patch}));
 const legacy={...d};for(const key of ['freshUserIdentityCount','logicalFreshUserTurnCount','maxConcurrentFreshUserRows','replacementCandidateCount','identityReplacementObserved','canonicalUserStable','replacementAmbiguous'])delete legacy[key];
 assert(receiptV2.validAcceptanceDiagnostic(legacy));assert(!JSON.stringify(d).includes('canonical-user'));assert.equal(f.clicks,1);
});

test('v2 historical replacement aliases cannot reappear as user authority after canonical anchoring',async()=>{
 const f=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>replaceOptimisticUser(f)});f.transaction(f.rows);
 const receipt=await acceptV2(f);
 f.inject(f.node('user','optimistic-user'));f.inject(f.node('assistant','unowned-assistant'));
 const result=await f.send('inspectGeneration',{...v2Payload,receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
});

for(const failure of ['concurrent','appended','gap','assistant between','manual second','baseline changed','transient baseline removal','ID mutation','wrong parent','wrong slot','no records','transient second'])test('v2 logical lineage rejects '+failure,async()=>{
 let old;
 const f=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>{
   old=f.rows.at(-1);f.transaction(f.rows,[userMutation(f,[old],[],f.rows.at(-2))]);
 },onPostSendTick:(f,tick)=>{
   if(tick!==1)return;
   const second=f.node('user','second-user'),baseline=f.rows.slice(0,-1),tail=baseline.at(-1);
   if(failure==='concurrent' || failure==='appended')f.transaction([...f.rows,second],[userMutation(f,[second],[],old)]);
   if(failure==='manual second'){f.foreign('input');f.transaction([...f.rows,second],[userMutation(f,[second],[],old)]);}
   if(failure==='gap')f.transaction(baseline,[userMutation(f,[],[old],tail)]);
   if(failure==='assistant between'){
     const assistant=f.node('assistant','intervening');assistant.isConnected=false;
     f.transaction([...baseline,second],[userMutation(f,[assistant],[],old),userMutation(f,[],[assistant],old),userMutation(f,[second],[old],tail)]);
   }
   if(failure==='baseline changed')f.transaction([...baseline.slice().reverse(),second],[userMutation(f,[second],[old],tail)]);
   if(failure==='transient baseline removal')f.transaction(f.rows,[userMutation(f,[],[baseline[0]],null,tail),userMutation(f,[baseline[0]],[],null,tail)]);
   if(failure==='ID mutation'){old.id='mutated';f.mutate([{type:'attributes',target:old,attributeName:'data-message-id',oldValue:'optimistic-user'}]);}
   if(failure==='wrong parent')f.transaction([...baseline,second],[userMutation(f,[second],[old],tail,null,{})]);
   if(failure==='wrong slot')f.transaction([...baseline,second],[userMutation(f,[second],[old],null)]);
   if(failure==='no records')f.transaction([...baseline,second]);
   if(failure==='transient second'){
     second.isConnected=false;f.transaction(f.rows,[userMutation(f,[second],[second],old)]);
   }
 },});
 f.transaction(f.rows);
 const stored={},worker=workerV2Harness(stored,f),prep=await worker.run('prepareGeneration',inspectPayload);
 const result=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
 assert(receiptV2.validAcceptanceDiagnostic(result.acceptanceDiagnostic));
 if(['concurrent','appended'].includes(failure)){assert.equal(result.acceptanceDiagnostic.maxConcurrentFreshUserRows,2);assert.equal(result.acceptanceDiagnostic.logicalFreshUserTurnCount,2);}
 if(['gap','wrong parent','wrong slot','no records','assistant between','transient second'].includes(failure))assert.equal(result.acceptanceDiagnostic.replacementAmbiguous,true);
 assert.equal(stored['generation-intent:op'].receipt.userStableIdHash,undefined);
 const again=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});assert.equal(again.state,'interrupted');assert.equal(f.clicks,1);
 assert.equal(f.operationCount,0);assert.equal(f.documentListenerCount,0);
});

test('v2 canonical replacement anchor is durable in main before assistant binding and result acquisition',async t=>{
 const content=contentFixture({noAssistant:true,userId:'optimistic-user',afterClick:f=>replaceOptimisticUser(f)});content.transaction(content.rows);
 const stored={},worker=workerV2Harness(stored,content);
 let native;
 const f=fixture(t,{command:async(type,p)=>{
   if(type==='inspectGeneration'){
     const persisted=JSON.parse(fs.readFileSync(path.join(native.root,'outputs',p.operationId,'muse-operation.json')));
     assert.equal(persisted.receipt.userStableIdHash,shaBytes(p.operationId+'\0user\0canonical-user'));
     assert.equal(persisted.receipt.assistantStableIdHash,undefined);
     if(!content.rows.some(r=>r.id==='causal-assistant'))content.inject(content.node('assistant','causal-assistant',media()));
   }
   return JSON.parse(JSON.stringify(await worker.run(type,p)));
 }});native=f;f.bridge.receiptV2Ready=async()=>true;
 const job=await f.service.submit(request());await until(f.service,job.id,'running');
 const file=path.join(f.root,'outputs',job.id,'muse-operation.json');
 assert.equal(JSON.parse(fs.readFileSync(file)).receipt.userStableIdHash,shaBytes(job.id+'\0user\0canonical-user'));
 assert.equal(JSON.parse(fs.readFileSync(file)).receipt.assistantStableIdHash,undefined);
 await f.service.recover(job.id);
 assert.equal(JSON.parse(fs.readFileSync(file)).receipt.assistantStableIdHash,undefined);
 await f.service.recover(job.id);
 assert.equal(JSON.parse(fs.readFileSync(file)).receipt.assistantStableIdHash,shaBytes(job.id+'\0assistant\0causal-assistant'));
 assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));assert.equal(content.clicks,1);
 assert(!fs.readFileSync(file,'utf8').includes('optimistic-user'));
});

for(const scenario of ['cross-batch','wrapper replacement','expired','different container'])test('v3 live DOM adapter and offline trace agree: '+scenario,async()=>{
 let now=1000,old,baseline,tail;
 const f=contentFixture({noAssistant:true,userId:'temporary',clock:()=>-now,monotonicClock:()=>now+0.5,afterClick:f=>{
   old=f.rows.at(-1);baseline=f.rows.slice(0,-1);tail=baseline.at(-1);
   f.transaction(f.rows,[userMutation(f,[old],[],tail)]);
 },onPostSendTick:(f,tick)=>{
   now=1000+tick*200;
   if(tick===1){
     if(scenario==='wrapper replacement'){
       const wrapper={tagName:'DIV',querySelectorAll:()=>[old]};f.transaction(baseline,[userMutation(f,[],[wrapper],tail)]);
     }else f.transaction(baseline,[userMutation(f,[],[old],tail)]);
   }
   if(tick===2)f.mutate([{type:'childList',target:f.messageParent,addedNodes:[],removedNodes:[],previousSibling:null,nextSibling:null}]);
   if(tick===(scenario==='expired'?4:3)){
     const canonical=f.node('user','canonical');
     if(scenario==='different container')f.transaction([...baseline,canonical],[userMutation(f,[canonical],[],tail,null,{})],()=>{canonical.parentNode={};});
     else if(scenario==='wrapper replacement'){
       const wrapper={tagName:'DIV',parentNode:f.messageParent,previousSibling:tail,nextSibling:null,querySelectorAll:()=>[canonical]};
       f.transaction([...baseline,canonical],[userMutation(f,[wrapper],[],tail)],()=>{canonical.parentNode=wrapper;});
     }else f.transaction([...baseline,canonical],[userMutation(f,[canonical],[],tail)]);
   }
 }});f.transaction(f.rows);
 const stored={},worker=workerV2Harness(stored,f),prep=await worker.run('prepareGeneration',inspectPayload);
 const result=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 if(['expired','different container'].includes(scenario)){
   assert.equal(result.state,'interrupted');assert(receiptV2.validAcceptanceTrace(result.acceptanceTrace));
   const trace=JSON.parse(JSON.stringify(result.acceptanceTrace)),replayed=require('../extensions/meta-muse-bridge/acceptance-replay').replay(trace);
   assert.equal(replayed.reason,result.acceptanceDiagnostic.failureReason);
   assert.equal(replayed.canonicalIdentity,null);
 }else {
   assert.equal(result.state,'running');assert.equal(result.receipt.userStableIdHash,shaBytes('op\0user\0canonical'));
   assert.equal(f.lineage.replacementCount,1);assert.equal(result.acceptanceTrace,undefined);
   assert.equal(require('../extensions/meta-muse-bridge/acceptance-replay').replay(f.structuralTrace).status,'accepted');
   await worker.run('cancelGeneration',inspectPayload);
 }
 assert.equal(f.clicks,1);
});

test('v3 failure trace is private, bounded, persisted and support-exported read-only with trusted IPC',async t=>{
 const content=contentFixture({noAssistant:true,afterClick:f=>f.replace([...f.rows,f.node('user','private-second-id')])});
 const stored={},worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;f.bridge.developmentDiagnostics=true;
 const job=await f.service.submit(request());await until(f.service,job.id,'interrupted');
 const file=path.join(f.root,'outputs',job.id,'muse-operation.json'),before=fs.readFileSync(file),jobs=fs.readFileSync(f.service.store.file),calls=f.calls.length;
 const record=JSON.parse(before),trace=record.acceptanceTrace;
 assert(receiptV2.validAcceptanceTrace(trace));assert.equal(require('../extensions/meta-muse-bridge/acceptance-replay').replay(trace).status,'ambiguous');
 for(const secret of ['private-second-id','new-user','history-user',request().prompt,'https:','token'])assert(!JSON.stringify(trace).includes(secret));
 assert(!receiptV2.valid({...record.receipt,acceptanceTrace:trace},job.id));assert(!validPayload('inspectGeneration',{...inspectPayload,acceptanceTrace:trace}));
 const failedResult={operationId:job.id,sceneId:job.sceneId,state:'interrupted',invocation:record.invocation,acceptanceTrace:trace};
 assert(validResult('submitGeneration',failedResult,{operationId:job.id,sceneId:job.sceneId,receipt:record.receipt}));
 assert(!validResult('submitGeneration',failedResult,{operationId:job.id,sceneId:job.sceneId,receipt:{...record.receipt,userStableIdHash:'c'.repeat(64)}}));
 const report=await f.service.acceptanceTrace(job.id);assert.deepEqual(report.trace,trace);assert.equal(report.operationId,job.id);
 const handlers={};require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{handle:(n,fn)=>handlers[n]=fn},getService:()=>f.service,trusted:e=>e.trusted});
 assert.equal((await handlers['generation:acceptance-trace']({trusted:true},job.id)).ok,true);
 assert.equal((await handlers['generation:acceptance-trace']({trusted:false},job.id)).errorCode,'UNAVAILABLE');
 assert.equal((await handlers['generation:acceptance-trace']({trusted:true},{id:job.id})).errorCode,'INVALID_REQUEST');
 f.bridge.developmentDiagnostics=false;await assert.rejects(f.service.acceptanceTrace(job.id),{code:'UNAVAILABLE'});
 assert.equal(f.calls.length,calls);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
 // Missing scalar diagnostics must not hide a valid bounded failure trace.
 f.bridge.developmentDiagnostics=true;const traceOnly={...record};delete traceOnly.acceptanceDiagnostic;fs.writeFileSync(file,JSON.stringify(traceOnly));
 const traceOnlyBytes=fs.readFileSync(file);assert.equal((await f.service.acceptanceTrace(job.id)).diagnostic,null);assert.deepEqual(fs.readFileSync(file),traceOnlyBytes);
 assert.equal(content.clicks,1);assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
});

test('v3 trace overflow interrupts without resubmission and remains offline-readable',async()=>{
 const f=contentFixture({noAssistant:true,afterClick:f=>{for(let i=0;i<70;i++)f.mutate([]);}});
 const stored={},worker=workerV2Harness(stored,f),prep=await worker.run('prepareGeneration',inspectPayload);
 const result=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.acceptanceDiagnostic.failureReason,'OBSERVATION_LIMIT');
 assert(result.acceptanceTrace.overflow);assert.equal(result.acceptanceTrace.frames.length,64);
 assert(receiptV2.validAcceptanceTrace(result.acceptanceTrace));
 assert.equal(require('../extensions/meta-muse-bridge/acceptance-replay').replay(JSON.parse(JSON.stringify(result.acceptanceTrace))).reason,'OBSERVATION_LIMIT');
 assert.equal(f.clicks,1);assert.equal(f.operationCount,0);
});

test('v2 delayed stable user ID and late generation control require no composer transition',async()=>{
 let pending;
 const f=contentFixture({noNewUser:true,noAssistant:true,noClear:true,keepButton:true,
   afterClick:f=>{pending=f.node('user',null);f.inject(pending);},
   onPostSendTick:(f,tick)=>{
     if(tick===5){pending.id='assigned-user';f.mutate([{type:'attributes',target:pending,attributeName:'data-message-id',oldValue:null}]);}
   }});
 const receipt=await acceptV2(f);
 assert.equal(receipt.acceptance.composerCleared,false);
 assert.equal(receipt.acceptance.sendControlTransition,false);
 assert.equal(receipt.acceptance.generationControlObserved,false);
 f.stop(); // Control mounts after the user receipt was already returned.
 f.inject(f.node('assistant','late-assistant'));
 assert((await observeMediaV2(f,receipt,'late-assistant')).receipt.assistantStableIdHash);
 assert.equal(f.clicks,1);
});

for(const ambiguity of ['zero user','two users','identity mutation','manual input','manual pointer','baseline removal']) {
 test('v2 post-send ambiguity fails closed without a second send: '+ambiguity,async()=>{
   const f=contentFixture({noNewUser:ambiguity==='zero user',noAssistant:ambiguity==='zero user',
     afterClick:f=>{
       if(ambiguity==='two users')f.inject(f.node('user','foreign-user'));
       if(ambiguity==='baseline removal')f.replace(f.rows.slice(2));
     },onPostSendTick:(f,tick)=>{
       if(tick!==1)return;
       if(ambiguity==='identity mutation'){
         const user=f.rows.find(r=>r.id==='new-user');user.id='changed-user';
         f.mutate([{type:'attributes',target:user,attributeName:'data-message-id',oldValue:'new-user'}]);
       }
       if(ambiguity==='manual input' || ambiguity==='manual pointer'){
         f.replaceComposer();f.foreign(ambiguity==='manual input'?'input':'pointerdown');
       }
     }});
   const stored={},worker=workerV2Harness(stored,f),prep=await worker.run('prepareGeneration',inspectPayload);
   const result=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
   assert.equal(result.state,'interrupted');assert.equal(result.invocation.send,'invoked');
   assert(receiptV2.validAcceptanceDiagnostic(result.acceptanceDiagnostic));
   assert.equal(result.acceptanceDiagnostic.workerBuild,'muse-worker-v0-3-11-contract3-receipt2-userchurn1');
   assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
   assert.equal(f.operationCount,0);assert.equal(f.documentListenerCount,0);
   const restarted=workerV2Harness(stored,f),before=JSON.stringify(stored);
   assert.equal((await restarted.run('submitGeneration',{...operation,receipt:prep.receipt})).state,'interrupted');
   assert.equal((await restarted.run('inspectGeneration',{...inspectPayload,receipt:prep.receipt})).state,'interrupted');
   assert.deepEqual(restarted.calls,[]);assert.equal(JSON.stringify(stored),before);assert.equal(f.clicks,1);
 });
}

test('v2 simultaneous submit commands claim the prepared observation before awaiting',async()=>{
 const f=contentFixture(),prep=await f.send('prepareGeneration',v2Payload);
 const payload={...operation,observationToken:v2Payload.observationToken,receipt:prep.receipt};
 const [a,b]=await Promise.all([f.send('submitGeneration',payload),f.send('submitGeneration',payload)]);
 assert.equal(a.state,'running');assert.equal(b.state,'interrupted');assert.equal(f.clicks,1);
 await f.send('cancelGeneration',inspectPayload);assert.equal(f.documentListenerCount,0);
});

test('v2 manual interference after user acceptance cannot bind an assistant on a replaced composer',async()=>{
 const f=contentFixture(),receipt=await acceptV2(f);
 f.replaceComposer();f.replaceEditor();f.foreign('keydown');
 const result=await f.send('inspectGeneration',{...v2Payload,receipt});
 assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);
 assert.equal(f.clicks,1);assert.equal(f.documentListenerCount,0);
});

test('v2 transient unidentified post-send turn fails closed even if removed before a sample',async()=>{
 const f=contentFixture({noNewUser:true,noAssistant:true,afterClick:f=>{
   const unassigned=f.node('user',null);
   f.mutate([{type:'childList',addedNodes:[unassigned],removedNodes:[unassigned]}]);
 }});
 const prep=await f.send('prepareGeneration',v2Payload);
 const result=await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:prep.receipt});
 assert.equal(result.state,'interrupted');assert.equal(f.clicks,1);assert.equal(f.documentListenerCount,0);
});

test('v2 structural receipts preserve legacy validation, monotonicity and both acquisition anchors',()=>{
 const p={version:2,operationId:'op',baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)]};
 const a={baselineIntact:true,uniqueUserTurn:true,composerCleared:false,sendControlTransition:false,generationControlObserved:false};
 const u={...p,userStableIdHash:'c'.repeat(64),acceptance:a};
 assert(receiptV2.valid(u,'op'));assert(receiptV2.extendsReceipt(p,u));
 for(const patch of [{baselineIntact:false},{uniqueUserTurn:false},{baselineIntact:undefined},{uniqueUserTurn:undefined},{rawText:'private'}])assert(!receiptV2.valid({...u,acceptance:{...a,...patch}},'op'));
 const legacy={...u,acceptance:{composerCleared:true,sendControlTransition:true,generationControlObserved:false}};
 assert(receiptV2.valid(legacy,'op'));assert(!receiptV2.extendsReceipt(legacy,u));
 const assistant={...u,assistantStableIdHash:'d'.repeat(64)},result={...assistant,result:{kind:'video',ownerAssistantStableIdHash:'d'.repeat(64)}};
 assert(receiptV2.extendsReceipt(u,assistant));assert(receiptV2.extendsReceipt(assistant,result));
 for(const receipt of [p,u,assistant,{...result,userStableIdHash:undefined},{...result,assistantStableIdHash:undefined}]){
   assert(!validPayload('acquireGenerationResult',{...inspectPayload,receipt,transferId:'transfer',sequence:0,offset:0,mediaKind:'video'}));
 }
});

test('v2 historical invoked but unaccepted intent is safely classified through IPC without rewriting or resubmitting',async t=>{
 const f=fixture(t,{command:async(type,p)=>{
   if(type==='prepareGeneration')return {operationId:p.operationId,sceneId:p.sceneId,state:'prepared',receipt:{version:2,operationId:p.operationId,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)]}};
   assert.equal(type,'submitGeneration');return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',invocation:{delivery:'content-script',send:'invoked',reason:'acceptance-unproven'}};
 }});
 f.bridge.receiptV2Ready=async()=>true;
 const job=await f.service.submit(request());await until(f.service,job.id,'interrupted');
 const file=path.join(f.service.context(job).outputDirectory,'muse-operation.json'),bytes=fs.readFileSync(file),jobs=fs.readFileSync(f.service.store.file);
 const restarted=new GenerationService({root:f.root,registry:f.registry}),handlers={};
 require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{handle:(name,fn)=>handlers[name]=fn},getService:()=>restarted,trusted:()=>true});
 const publicJob=(await handlers['generation:get']({},job.id)).value;
 assert.equal(publicJob.recoveryState,'acceptance_unproven');
 assert.equal((await handlers['generation:list']({},job.projectId)).value[0].recoveryState,'acceptance_unproven');
 assert(!JSON.stringify(publicJob).includes('baselineUserMessageIds'));assert(!JSON.stringify(publicJob).includes('profile-one'));
 assert.equal(restarted.get(job.id).recoveryState,undefined,'Presentation must not rewrite historical jobs');
 await restarted.recover(job.id);assert.equal((await restarted.submit(request())).id,job.id);
 assert.equal(f.calls.filter(c=>c.type==='prepareGeneration').length,1);assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
 assert.equal(f.calls.filter(c=>c.type==='inspectGeneration').length,0);assert.equal(f.calls.filter(c=>c.type==='acquireGenerationResult').length,0);
 assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readFileSync(f.service.store.file),jobs);
});

test('v2 acceptance failure diagnostics persist actual builds and bounded structure without granting ownership',async t=>{
 const stored={},content=contentFixture({noNewUser:true,noAssistant:true}),worker=workerV2Harness(stored,content);
 const f=fixture(t,{command:async(type,p)=>JSON.parse(JSON.stringify(await worker.run(type,p)))});f.bridge.receiptV2Ready=async()=>true;
 const job=await f.service.submit(request());await until(f.service,job.id,'interrupted');
 const record=JSON.parse(fs.readFileSync(path.join(f.root,'outputs',job.id,'muse-operation.json'))),d=record.acceptanceDiagnostic;
 assert(receiptV2.validAcceptanceDiagnostic(d));
 assert.equal(d.acceptanceBuild,'muse-content-v0-3-11-contract3-receipt2-userchurn1');
 assert.equal(d.workerBuild,'muse-worker-v0-3-11-contract3-receipt2-userchurn1');
 assert.equal(d.failureReason,'ACCEPTANCE_UNCERTAIN');assert.equal(d.deadlineReached,true);
 assert.equal(d.freshUserCount,0);assert.equal(d.freshAssistantCount,0);assert.equal(d.baselinePrefixValid,true);
 assert.equal(record.receipt.userStableIdHash,undefined);assert.equal(record.receipt.assistantStableIdHash,undefined);
 assert(!receiptV2.valid({...record.receipt,acceptanceDiagnostic:d},job.id));
 assert(!validPayload('inspectGeneration',{...inspectPayload,acceptanceDiagnostic:d}));
 for(const patch of [{message:'private'},{url:'https://private'},{freshUserCount:129},{failureReason:'arbitrary'},{acceptanceBuild:'raw browser state'}])assert(!receiptV2.validAcceptanceDiagnostic({...d,...patch}));
 assert(!JSON.stringify(d).includes(request().prompt));assert(!JSON.stringify(d).includes('history-user'));
 const before=fs.readFileSync(path.join(f.root,'outputs',job.id,'muse-operation.json'));
 await f.service.recover(job.id);
 assert.deepEqual(fs.readFileSync(path.join(f.root,'outputs',job.id,'muse-operation.json')),before);
 assert.equal(content.clicks,1);assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
 assert(!f.calls.some(c=>c.type==='acquireGenerationResult'));
});

for(const kind of ['two media assistants','additional user','temporary additional user','epoch change','user absent']) {
 test('v2 causal capture interrupts on '+kind+' without adopting an assistant',async()=>{
   const f=contentFixture({video:media()}),user=await acceptV2(f);
   if(kind==='two media assistants')f.inject(f.node('assistant','competing-assistant',media()));
   if(kind.includes('additional user'))f.inject(f.node('user','manual-turn'));
   if(kind==='temporary additional user')f.replace([f.node('user','new-user'),f.node('assistant','new-assistant')]);
   if(kind==='user absent')f.replace([f.node('assistant','new-assistant')]);
   const result=await f.send('inspectGeneration',{...v2Payload,...(kind==='epoch change'?{observationToken:'new-bridge'}:{}),receipt:user});
   assert.equal(result.state,'interrupted');assert.equal(result.receipt,undefined);assert.equal(f.clicks,1);
 });
}

test('v2 old assistants never qualify and zero new assistant remains pending',async()=>{
 const f=contentFixture({noAssistant:true}),user=await acceptV2(f);
 const result=await f.send('inspectGeneration',{...v2Payload,receipt:user});
 assert.equal(result.state,'running');assert.equal(result.receipt.assistantStableIdHash,undefined);assert.equal(f.clicks,1);
});

test('v2 missing assistant times out without binding or resubmitting',async()=>{
 let now=1000;const f=contentFixture({noAssistant:true,clock:()=>now}),user=await acceptV2(f);
 now+=20*60*1000+1;
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt:user})).state,'interrupted');assert.equal(f.clicks,1);
});

test('v2 preparation baseline changes prevent typing even if the new DOM stabilizes',async()=>{
 const f=contentFixture(),p=await f.send('prepareGeneration',v2Payload);
 f.inject(f.node('assistant','unexpected-hydration'));
 const r=await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:p.receipt});
 assert.equal(r.state,'interrupted');assert.equal(f.clicks,0);
});

test('v2 user-only receipt cannot infer causal ownership after page restart',async()=>{
 const f=contentFixture(),user=await acceptV2(f),next=contentFixture();
 next.replace([next.node('user','new-user'),next.node('assistant','new-assistant',media())]);
 assert.equal((await next.send('inspectGeneration',{...v2Payload,receipt:user})).state,'interrupted');assert.equal(next.clicks,0);
});

for(const kind of ['zero','one','multiple','unrelated','missing assistant','DOM replacement','page restart']) {
 test('v2 persisted assistant scoped video behavior: '+kind,async()=>{
   const f=contentFixture(),receipt=await bindV2(f),next=kind==='page restart'?contentFixture():f;
   const a=next.node('assistant','new-assistant',kind==='zero'?null:media());
   if(kind==='multiple'){const videos=[media(),media()];videos.forEach(v=>v.closest=()=>a);a.querySelectorAll=s=>s==='video'?videos:[];}
   if(kind==='unrelated')next.replace([next.node('assistant','new-assistant'),next.node('assistant','unrelated-video',media())]);
   else if(kind==='missing assistant')next.replace([next.node('assistant','unrelated-video',media())]);
   else next.replace([a]); // All baseline and user nodes unmounted.
   const result=await next.send('inspectGeneration',{...v2Payload,observationToken:'new-worker-and-bridge',receipt});
   assert.equal(result.state,['multiple','missing assistant'].includes(kind)?'interrupted':['zero','unrelated'].includes(kind)?'running':'result');
   if(result.state==='result')assert.equal(result.receipt.result.ownerAssistantStableIdHash,receipt.assistantStableIdHash);
   assert.equal(next.clicks,kind==='page restart'?0:1);
 });
}

test('v2 receipt monotonicity rejects anchor replacement, downgrade, raw URL, and legacy migration',()=>{
 const prepared={version:2,operationId:'op',baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)]};
 const user={...prepared,userStableIdHash:'c'.repeat(64),acceptance:{composerCleared:true,sendControlTransition:true,generationControlObserved:false}};
 const assistant={...user,assistantStableIdHash:'d'.repeat(64)};
 assert(receiptV2.extendsReceipt(prepared,user));assert(receiptV2.extendsReceipt(user,assistant));
 assert(!receiptV2.extendsReceipt(assistant,user));assert(!receiptV2.extendsReceipt(assistant,{...assistant,assistantStableIdHash:'e'.repeat(64)}));
 assert(!receiptV2.valid({...assistant,result:{kind:'video',ownerAssistantStableIdHash:assistant.assistantStableIdHash,url:'https://private'}},'op'));
 assert(!receiptV2.extendsReceipt(receiptFor({operationId:'op'}),assistant));
});

test('v2 scoped candidate rejects unsupported sources without fetching any bytes',async()=>{
 const f=contentFixture(),receipt=await bindV2(f),video=media();video.currentSrc='https://untrusted.example/video.mp4';
 f.replace([f.node('assistant','new-assistant',video)]);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt})).state,'interrupted');
 assert.equal((await f.send('acquireGenerationResult',{...inspectPayload,offset:0})).state,'interrupted');
});

test('v2 native service persists baseline, user and assistant; failed recovery acquisition never resubmits',async t=>{
 let phase='assistant',durableUser=false,durableBaseline=false,durableAssistant=false;
 const f=fixture(t,{command:async(type,p)=>{
   const base={operationId:p.operationId,sceneId:p.sceneId};
   const file=path.join(f.root,'outputs',p.operationId,'muse-operation.json');
   if(type==='prepareGeneration')return {...base,state:'prepared',receipt:{version:2,operationId:p.operationId,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)]}};
   if(type==='submitGeneration'){
     durableBaseline=JSON.parse(fs.readFileSync(file)).receipt.version===2;
     return {...base,state:'running',receipt:{...p.receipt,userStableIdHash:'c'.repeat(64),acceptance:{baselineIntact:true,uniqueUserTurn:true,composerCleared:false,sendControlTransition:false,generationControlObserved:false}}};
   }
   if(type==='acquireGenerationResult'){
     const r=JSON.parse(fs.readFileSync(file)).receipt;
     durableAssistant=!!r.userStableIdHash && !!r.assistantStableIdHash && !!r.result;
     throw Error('fixture acquisition failure');
   }
   assert.equal(type,'inspectGeneration');
   durableUser=!!JSON.parse(fs.readFileSync(file)).receipt.userStableIdHash;
   if(phase==='loss')throw Error('bridge lost');
   const receipt={...p.receipt,assistantStableIdHash:'d'.repeat(64)};
   if(phase==='result')receipt.result={kind:'video',ownerAssistantStableIdHash:receipt.assistantStableIdHash};
   return {...base,state:phase==='result'?'result':'running',receipt};
 }});
 f.bridge.receiptV2Ready=async()=>true;
 const job=await f.service.submit(request());await until(f.service,job.id,'running');
 await f.service.recover(job.id);assert(durableBaseline);assert(durableUser);
 const file=path.join(f.root,'outputs',job.id,'muse-operation.json');const persisted=fs.readFileSync(file);
 assert(JSON.parse(persisted).receipt.assistantStableIdHash);
 phase='loss';await f.service.recover(job.id);assert.equal(f.service.get(job.id).status,'interrupted');assert.deepEqual(fs.readFileSync(file),persisted);
 const restart=new GenerationService({root:f.root,registry:f.registry});phase='result';
 await restart.recover(job.id);assert.equal(restart.get(job.id).status,'interrupted');assert.equal(restart.get(job.id).output,null);
 assert(JSON.parse(fs.readFileSync(file)).receipt.result);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);assert(f.calls.some(c=>c.type==='acquireGenerationResult'));
 assert(durableAssistant,'Both anchors and result must be durable before any acquisition');
});

test('v2 remembers an added-and-removed manual turn from a single mutation batch',async()=>{
 const f=contentFixture(),user=await acceptV2(f);
 const transient=f.node('user','manual-transient');
 f.mutate([{type:'childList',addedNodes:[transient],removedNodes:[transient]}]);
 assert.equal((await f.send('inspectGeneration',{...v2Payload,receipt:user})).state,'interrupted');assert.equal(f.clicks,1);
});

function workerV2Harness(stored,content,production=false,manifest) {
 const calls=[];
 const chrome={runtime:{id:'ext',getManifest:()=>manifest||({version:'0.3.0',...(production?{}:{version_name:'development-diagnostics'})}),onConnect:{addListener(){}},onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
   storage:{local:{get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,JSON.parse(JSON.stringify(values)))}},
   tabs:{query:async()=>[{id:5}],sendMessage:async(id,m)=>{calls.push(m.command);return content.send(m.command,m.payload);}},alarms:{create(){},onAlarm:{addListener(){}}}};
 const c={chrome,navigator:{userAgent:'Edg/1'},crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout,clearTimeout};
 vm.createContext(c);vm.runInContext(fs.readFileSync('extensions/meta-muse-bridge/acceptance-replay.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/receipt-v2.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/service-worker.js','utf8'),c);
 return {calls,context:c,run:async(type,p)=>{c.command={id:'cmd',type,payload:p};return vm.runInContext('execute(command)',c);}};
}

test('actual effective staged manifests control both extension gates without user settings or submission',()=>{
 const {readBundle}=require('../services/generation/bridge/extension-bundle'),{configuration}=require('../services/generation/bridge/extension-distribution');
 const source=path.resolve('extensions/meta-muse-bridge');
 const production=JSON.parse(readBundle(source,configuration()).files.find(f=>f.file==='manifest.json').data);
 const development=JSON.parse(readBundle(source,configuration(),{developmentDiagnostics:true}).files.find(f=>f.file==='manifest.json').data);
 assert.equal(production.version_name,undefined);assert.equal(development.version_name,'development-diagnostics');
});
for(const dev of [false,true])test('actual managed manifest enables only dev diagnosis and reaches missing worker intent without execution: '+dev,async()=>{
 const {readBundle}=require('../services/generation/bridge/extension-bundle'),{configuration}=require('../services/generation/bridge/extension-distribution');
 const manifest=JSON.parse(readBundle(path.resolve('extensions/meta-muse-bridge'),configuration(),{developmentDiagnostics:dev}).files.find(f=>f.file==='manifest.json').data);
 const content=contentFixture({empty:true,manifest}),stored={},worker=workerV2Harness(stored,content,false,manifest);
 const result=await worker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'c'.repeat(64)});
 assert.equal(result.ownershipFailure.reason,dev?'WORKER_INTENT_UNAVAILABLE':'EXTENSION_DIAGNOSTICS_DISABLED');
 if(dev)assert((await content.send('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'c'.repeat(64)})).ownershipDiagnostic);
 else assert(content.rejects('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'c'.repeat(64)}));
 assert.equal(content.clicks,0);assert.deepEqual(stored,{});assert.deepEqual(worker.calls,[]);
 assert.equal(require('../services/generation/bridge/ownership-diagnosis').report(result.ownershipFailure.reason).layer,dev?'worker_intent':'extension_diagnostics');
 worker.context.chrome.tabs.sendMessage=async(_,m)=>m.type==='viral-ai:muse-handshake'?content.handshake():content.status();
 const [tab]=await vm.runInContext('museTabs()',worker.context);
 assert.equal(tab.runtimeBuild.diagnosticsEnabled,dev);
 assert.equal(tab.runtimeBuild.workerBuild,'muse-worker-v0-3-11-contract3-receipt2-userchurn1');
 assert.equal(tab.runtimeBuild.contentBuild,'muse-content-v0-3-11-contract3-receipt2-userchurn1');
});

test('V2 ownership diagnostic uses the durable user anchor without receipt or DOM mutation, even after worker restart',async()=>{
 const content=contentFixture({empty:true,draftLength:17}),user=content.node('user','owned-user'),assistant=content.node('assistant','unproven-assistant',media());
 user.nextElementSibling=assistant;content.replace([user,assistant]);
 const receipt={version:2,operationId:'op',baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)],userStableIdHash:shaBytes('op\0user\0owned-user'),acceptance:{baselineIntact:true,uniqueUserTurn:true,composerCleared:true,sendControlTransition:true,generationControlObserved:true}};
 const stored={'generation-intent:op':{version:2,tabId:5,sceneId:'scene',receipt}},before=JSON.stringify(stored);
 for(let i=0;i<2;i++){
   const worker=workerV2Harness(stored,content);
   const result=await worker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:receipt.userStableIdHash});
   assert.equal(result.ownershipDiagnostic.ownedUserMatches,1);assert.equal(result.ownershipDiagnostic.rows[0].ownedUser,true);
   assert.equal(result.ownershipDiagnostic.rows[1].videoCount,1);assert.equal(result.receipt,undefined);
   assert.equal(JSON.stringify(stored),before);assert.deepEqual(worker.calls,['inspectGeneration']);
   assert.equal(content.clicks,0);assert.equal(content.status().devEvidence.composerEmpty,false);assert.equal(content.lineage,null);
   assert(!JSON.stringify(result).includes('owned-user'));assert(!JSON.stringify(result).includes('https://'));
 }
 for(const scenario of ['no user','assistant anchored','wrong scene','production']){
   const copy=JSON.parse(before);
   if(scenario==='no user'){delete copy['generation-intent:op'].receipt.userStableIdHash;delete copy['generation-intent:op'].receipt.acceptance;}
   if(scenario==='assistant anchored')copy['generation-intent:op'].receipt.assistantStableIdHash='d'.repeat(64);
   if(scenario==='wrong scene')copy['generation-intent:op'].sceneId='other';
   const snapshot=JSON.stringify(copy),worker=workerV2Harness(copy,content,scenario==='production');
   if(scenario==='production')assert.equal((await worker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:receipt.userStableIdHash})).ownershipFailure.reason,'EXTENSION_DIAGNOSTICS_DISABLED');
   else assert.equal((await worker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:receipt.userStableIdHash})).ownershipFailure.reason,'WORKER_RECEIPT_MISMATCH');
   assert.equal(JSON.stringify(copy),snapshot);assert.deepEqual(worker.calls,[]);
 }
 const badWorker=workerV2Harness(stored,{send:async()=>({operationId:'op',sceneId:'scene',state:'running',receipt})});
 assert.equal((await badWorker.run('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:receipt.userStableIdHash})).ownershipFailure.reason,'CONTENT_DIAGNOSIS_REJECTED');
 assert.equal(JSON.stringify(stored),before);
});

for(const scenario of ['intent absent','user absent','hash mismatch','receiver absent','diagnostic rejected','tab absent'])test('0.3.11 worker reports the first ownership diagnostic gate without storage writes: '+scenario,async()=>{
 const receipt={version:2,operationId:'op',baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:['b'.repeat(64)],userStableIdHash:'c'.repeat(64),acceptance:{baselineIntact:true,uniqueUserTurn:true,composerCleared:true,sendControlTransition:true,generationControlObserved:true}};
 const stored={'generation-intent:op':{version:2,tabId:5,sceneId:'scene',receipt}};
 if(scenario==='intent absent')delete stored['generation-intent:op'];
 if(scenario==='user absent'){delete receipt.userStableIdHash;delete receipt.acceptance;}
 if(scenario==='hash mismatch')receipt.userStableIdHash='d'.repeat(64);
 const content={send:async()=>{if(scenario==='receiver absent')throw Error('private receiver error');return {operationId:'op',sceneId:'scene',state:'interrupted'};}};
 const before=JSON.stringify(stored),worker=workerV2Harness(stored,content);
 if(scenario==='tab absent')worker.context.chrome.tabs.query=async()=>[{id:99}];
 const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:'c'.repeat(64)};
 const result=await worker.run('inspectGeneration',p),failure=result.ownershipFailure;
 assert.equal(failure.reason,{'intent absent':'WORKER_INTENT_UNAVAILABLE','user absent':'WORKER_RECEIPT_MISMATCH','hash mismatch':'WORKER_RECEIPT_MISMATCH','receiver absent':'CONTENT_RECEIVER_UNAVAILABLE','diagnostic rejected':'CONTENT_DIAGNOSIS_REJECTED','tab absent':'TARGET_TAB_UNAVAILABLE'}[scenario]);
 assert(validResult('inspectGeneration',JSON.parse(JSON.stringify(result)),p));assert.equal(JSON.stringify(stored),before);
 if(scenario==='user absent')assert.equal(failure.workerUserAnchor,false);
 assert(worker.calls.every(type=>type==='inspectGeneration'));assert(!JSON.stringify(result).includes('private'));
});

test('v2 actual worker/content persist each stage, refuse replay, and restore an anchored receipt after both restart',async()=>{
 const stored={},content=contentFixture({video:media()}),worker=workerV2Harness(stored,content),key='generation-intent:op';
 const prep=await worker.run('prepareGeneration',inspectPayload);
 assert.equal(prep.state,'prepared');assert.equal(stored[key].receipt.version,2);assert.equal(content.clicks,0);
 const accepted=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 assert.equal(accepted.state,'running');assert(stored[key].receipt.userStableIdHash);assert.equal(content.clicks,1);
 assert.equal((await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt})).receipt.assistantStableIdHash,undefined);
 const assistant=await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 assert.equal(assistant.state,'running');assert(stored[key].receipt.assistantStableIdHash);
 // Main may still have its user receipt if delivery of the assistant reply was lost.
 const nextContent=contentFixture();nextContent.replace([nextContent.node('assistant','new-assistant',media())]);
 const nextWorker=workerV2Harness(stored,nextContent);
 const recovered=await nextWorker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 assert.equal(recovered.state,'result');assert.equal(recovered.receipt.assistantStableIdHash,assistant.receipt.assistantStableIdHash);
 assert(stored[key].receipt.result);assert.equal(nextContent.clicks,0);
 const before=JSON.stringify(stored);
 assert.equal((await nextWorker.run('submitGeneration',{...operation,receipt:prep.receipt})).state,'interrupted');
 await assert.rejects(nextWorker.run('acquireGenerationResult',{...inspectPayload,offset:0}));
 assert.equal(JSON.stringify(stored),before);assert(!nextWorker.calls.includes('submitGeneration'));assert(!nextWorker.calls.includes('acquireGenerationResult'));
});

test('v2 worker restart before assistant persistence breaks causal continuity and never binds from a later delta',async()=>{
 const stored={},content=contentFixture(),worker=workerV2Harness(stored,content);
 const prep=await worker.run('prepareGeneration',inspectPayload);
 const accepted=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 const before=JSON.stringify(stored),next=workerV2Harness(stored,content);
 const result=await next.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});assert.equal(result.state,'interrupted');
 assert.equal(result.assistantOwnershipFailure.terminalReason,'OBSERVATION_TOKEN_MISMATCH');
 const expected=JSON.parse(before);expected['generation-intent:op'].assistantOwnershipFailure=JSON.parse(JSON.stringify(result.assistantOwnershipFailure));
 assert.equal(JSON.stringify(stored),JSON.stringify(expected));assert.equal(content.clicks,1);assert(!next.calls.includes('submitGeneration'));
});

test('v2 conflicting desktop receipt cannot replace worker-owned anchors',async()=>{
 const stored={},content=contentFixture({video:media()}),worker=workerV2Harness(stored,content);
 const prep=await worker.run('prepareGeneration',inspectPayload),accepted=await worker.run('submitGeneration',{...operation,receipt:prep.receipt});
 await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 const assistant=await worker.run('inspectGeneration',{...inspectPayload,receipt:accepted.receipt});
 const before=JSON.stringify(stored),calls=worker.calls.length;
 assert.equal((await worker.run('inspectGeneration',{...inspectPayload,receipt:{...assistant.receipt,assistantStableIdHash:'f'.repeat(64)}})).state,'interrupted');
 assert.equal(worker.calls.length,calls);assert.equal(JSON.stringify(stored),before);
});

test('v2 recovery does not migrate or mutate a legacy interrupted second-operation fixture',async t=>{
 const f=fixture(t);f.service.execute=async()=>{};
 const old=await f.service.submit(request());const legacy=f.service.commit({...old,status:'interrupted',error:{code:'RECOVERY_REQUIRED'}});
 const context=f.service.context(legacy);fs.mkdirSync(context.outputDirectory,{recursive:true});
 const file=path.join(context.outputDirectory,'muse-operation.json');
 const r={operationId:old.id,sceneId:old.sceneId,digest:require('node:crypto').createHash('sha256').update(old.sceneId+'\0'+old.request.prompt).digest('hex'),target:{instanceId:'profile-one',tabId:5},createdAt:Date.now(),receipt:receiptFor({operationId:old.id})};
 fs.writeFileSync(file,JSON.stringify(r));const before=fs.readFileSync(file),jobBefore=JSON.stringify(f.service.get(old.id));
 f.bridge.command=async()=>{throw Error('legacy unavailable');};f.bridge.receiptV2Ready=async()=>true;
 await f.service.recover(old.id);assert.deepEqual(fs.readFileSync(file),before);assert.equal(JSON.stringify(f.service.get(old.id)),jobBefore);assert.equal(f.calls.length,0);
});

for(const scenario of ['initial','DOM replacement','reinjection']) {
 test('linkage diagnostics retain explicit turn and reply ID relationships: '+scenario,async()=>{
   const build=()=>{
     const f=contentFixture({empty:true}),nodes=[];
     for(let i=0;i<3;i++) {
       const user=f.node('user','user-'+i),assistant=f.node('assistant','assistant-'+i);
       const parent={getAttribute:k=>k==='data-turn-id'?'turn-'+i:null,parentElement:null};
       user.parentElement=parent;assistant.parentElement=parent;user.nextElementSibling=assistant;
       const get=assistant.getAttribute.bind(assistant);
       assistant.getAttribute=k=>k==='data-reply-to-id'?'user-'+i:get(k);
       nodes.push(user,assistant);
     }
     f.replace(nodes);return f;
   };
   const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:null};
   const f=build(),first=await f.send('inspectGeneration',p);
   const next=scenario==='initial'?f:build(),second=await next.send('inspectGeneration',p);
   assert.deepEqual(JSON.parse(JSON.stringify(first.ownershipDiagnostic.rows)),JSON.parse(JSON.stringify(second.ownershipDiagnostic.rows)));
   const rows=second.ownershipDiagnostic.rows;
   for(let i=0;i<6;i+=2) {
     assert.equal(rows[i].linkage.find(e=>e.attribute==='data-message-id').value,rows[i+1].linkage.find(e=>e.attribute==='data-reply-to-id').value);
     assert.equal(rows[i].linkage.find(e=>e.attribute==='data-turn-id').value,rows[i+1].linkage.find(e=>e.attribute==='data-turn-id').value);
   }
   assert.equal(second.state,'interrupted');assert.equal(next.clicks,0);
 });
}

test('adjacent unrelated assistant has no inferred pairing or acquisition authority',async()=>{
 const f=contentFixture({empty:true}),u=f.node('user','u'),a=f.node('assistant','a');u.nextElementSibling=a;
 f.replace([u,a]);const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:null};
 const r=await f.send('inspectGeneration',p);
 assert.equal(r.ownershipDiagnostic.rows[0].nextSiblingIndex,1);
 assert(r.ownershipDiagnostic.rows.every(row=>row.linkage.every(e=>e.attribute==='data-message-id')));
 assert.equal(r.state,'interrupted');assert.equal(f.clicks,0);
});

for(const kind of ['owned descendant','DOM replacement','no media ID','nested foreign message']) {
 test('media linkage diagnostic: '+kind,async()=>{
   const build=()=>{
     const f=contentFixture({empty:true}),v=media(),a=f.node('assistant','assistant',v);
     const parent={getAttribute:k=>kind!=='no media ID' && k==='data-result-id'?'result-one':null,parentElement:a};
     v.parentElement=parent;v.closest=()=>kind==='nested foreign message'?{}:a;
     v.getAttribute=()=>null;v.querySelectorAll=()=>[{getAttribute:k=>kind!=='no media ID' && k==='data-attachment-id'?'attachment-one':null}];
     f.replace([a]);return f;
   };
   const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:null},f=build();
   const r=await f.send('inspectGeneration',p),row=r.ownershipDiagnostic.rows[0];
   assert.equal(row.videoCount,1);
   const links=row.linkage.filter(e=>['media-ancestor','source'].includes(e.scope));
   assert.equal(links.length,['no media ID','nested foreign message'].includes(kind)?0:2);
   if(kind==='DOM replacement')assert.deepEqual(JSON.parse(JSON.stringify(row.linkage)),JSON.parse(JSON.stringify((await build().send('inspectGeneration',p)).ownershipDiagnostic.rows[0].linkage)));
   assert.equal(r.state,'interrupted');assert.equal((await f.send('acquireGenerationResult',{...inspectPayload,offset:0})).state,'interrupted');assert.equal(f.clicks,0);
 });
}

test('page-global video is not attributed to any message by diagnostics',async()=>{
 const f=contentFixture({empty:true});f.replace([f.node('assistant','a')]);
 const r=await f.send('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:null});
 assert.equal(r.ownershipDiagnostic.rows[0].videoCount,0);assert.equal(f.clicks,0);
});

test('read-only receipt-anchored diagnosis survives reinjection and global history removal without claiming ownership',async()=>{
 const original=contentFixture({active:true});
 const accepted=await original.send('submitGeneration',operation);
 const fresh=contentFixture({empty:true,draftLength:17});
 const user=fresh.node('user','new-user'),assistant=fresh.node('assistant','paired',media());
 const parent={getAttribute:k=>k==='data-response-group-id'?'safe-group':null,parentElement:null};
 user.parentElement=parent;assistant.parentElement=parent;user.nextElementSibling=assistant;
 fresh.replace([user,assistant]);
 const result=await fresh.send('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:accepted.receipt.submittedUserMessageId});
 const d=result.ownershipDiagnostic;
 assert.equal(result.state,'interrupted');assert.equal(d.ownedUserMatches,1);
 assert.equal(d.rows[0].nextSiblingIndex,1);assert.equal(d.rows[0].parentIndex,d.rows[1].parentIndex);
 assert.equal(d.rows[1].videoCount,1);assert.equal(d.rows[1].sourceTypes[0],'https');
 assert.equal(d.rows[0].ancestors[0].value,d.rows[1].ancestors[0].value);
 assert.equal(fresh.clicks,0);assert.equal(fresh.status().devEvidence.composerEmpty,false);
 assert(!JSON.stringify(result).includes('safe-group'));assert(!JSON.stringify(result).includes('https://'));
 assert.equal(validResult('inspectGeneration',JSON.parse(JSON.stringify(result)),{...inspectPayload,diagnoseOwnership:true}),true);
});

test('diagnosis reports unrelated and newest videos without authorizing acquisition or submission',async()=>{
 const f=contentFixture({empty:true});
 f.replace([f.node('user','unrelated'),f.node('assistant','newest',media())]);
 const result=await f.send('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'a'.repeat(64)});
 assert.equal(result.ownershipDiagnostic.ownedUserMatches,0);assert.equal(result.state,'interrupted');
 assert.equal((await f.send('acquireGenerationResult',{...inspectPayload,offset:0})).state,'interrupted');
 assert.equal(f.clicks,0);
});

test('ownership diagnostic protocol rejects text, URLs, arbitrary inputs and generative use',()=>{
 assert.equal(validPayload('inspectGeneration',{...inspectPayload,diagnoseOwnership:true}),true);
 assert.equal(validPayload('submitGeneration',{...operation,diagnoseOwnership:true}),false);
 assert.equal(validPayload('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'a'.repeat(64)}),true);
 assert.equal(validPayload('inspectGeneration',{...inspectPayload,ownedUserHash:'a'.repeat(64)}),false);
 assert.equal(validPayload('inspectGeneration',{...inspectPayload,diagnoseOwnership:true,ownedUserHash:'raw-native-id'}),false);
 const result={operationId:'op',sceneId:'scene',state:'interrupted',ownershipDiagnostic:{receiptAvailable:true,ownedUserMatches:0,rows:[]}};
 assert.equal(validResult('inspectGeneration',result,{...inspectPayload,diagnoseOwnership:true}),true);
 for(const field of ['text','url','html'])assert.equal(validResult('inspectGeneration',{...result,ownershipDiagnostic:{...result.ownershipDiagnostic,[field]:'private'}},{...inspectPayload,diagnoseOwnership:true}),false);
});

for(const scenario of ['DOM replacement','page reinjection','sibling reorder','global assistant count decrease']) {
 test('native-ID hash excludes volatile inputs: '+scenario,async()=>{
   const f=contentFixture({empty:true});
   f.replace([f.node('user','persistent-user'),f.node('assistant','persistent-response'),f.node('assistant','unrelated')]);
   const payload={...inspectPayload,diagnoseOwnership:true,ownedUserHash:null};
   const before=(await f.send('inspectGeneration',payload)).ownershipDiagnostic.rows;
   const next=scenario==='page reinjection'?contentFixture({empty:true}):f;
   next.replace(scenario==='sibling reorder'?[next.node('assistant','persistent-response'),next.node('user','persistent-user')]:[next.node('user','persistent-user'),next.node('assistant','persistent-response')]);
   const after=(await next.send('inspectGeneration',payload)).ownershipDiagnostic.rows;
   for(const role of ['user','assistant']) {
     const a=before.find(r=>r.role===role),b=after.find(r=>r.role===role);
     assert.equal(a.id,b.id);assert.equal(a.candidates[0].value,b.candidates[0].value);
   }
   assert.equal(next.clicks,0);
   // Constant fixture native IDs prove hash mechanics, not Muse's ID lifetime.
 });
}

test('changed native ID is never guessed from role, order or matching media',async()=>{
 const f=contentFixture({empty:true});
 f.replace([f.node('user','optimistic-user'),f.node('assistant','response',media())]);
 const p={...inspectPayload,diagnoseOwnership:true,ownedUserHash:null};
 const before=await f.send('inspectGeneration',p);
 f.replace([f.node('user','persisted-user'),f.node('assistant','response',media())]);
 const after=await f.send('inspectGeneration',{...p,ownedUserHash:before.ownershipDiagnostic.rows[0].id});
 assert.equal(after.ownershipDiagnostic.ownedUserMatches,0);assert.equal(after.state,'interrupted');
 assert.equal((await f.send('acquireGenerationResult',{...inspectPayload,offset:0})).state,'interrupted');assert.equal(f.clicks,0);
});

test('accepted user receipt survives bridge loss and desktop restart without resubmission',async t=>{
 const f=fixture(t);const job=await f.service.submit(request());await until(f.service,job.id,'running');
 clearTimeout(f.service.monitors.get(job.id));f.service.monitors.clear();
 const file=path.join(f.service.context(job).outputDirectory,'muse-operation.json'),before=fs.readFileSync(file);
 f.setReady(false);await f.service.recover(job.id);
 assert.equal(f.service.get(job.id).status,'interrupted');assert.deepEqual(fs.readFileSync(file),before);
 const restarted=new GenerationService({root:f.root,registry:f.registry});await restarted.recover(job.id);
 assert.equal(restarted.get(job.id).status,'interrupted');assert.deepEqual(fs.readFileSync(file),before);
 assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
});
test('initial zero history waits for delayed hydration and uses the stable identities',async()=>{
 const f=contentFixture({empty:true});
 assert.equal(f.status().canSubmit,false);
 const pending=f.send('submitGeneration',operation);
 assert.equal(f.clicks,0);
 setTimeout(()=>{f.inject(f.node('user','hydrated-user'));f.inject(f.node('assistant','hydrated-assistant'));},15);
 const result=await pending;
 assert.equal(result.state,'running');assert.equal(result.receipt.baselineUserMessageIds.length,1);
 assert.equal(result.receipt.baselineAssistantMessageIds.length,1);assert.equal(f.clicks,1);assert(f.disconnected>0);
});
test('stable empty DOM is not a positively identified empty conversation; timeout never types or clicks',async()=>{
 const f=contentFixture({empty:true});
 const result=await f.send('submitGeneration',operation);
 assert.equal(result.state,'interrupted');assert.equal(result.invocation.reason,'baseline-unready');
 assert.equal(result.invocation.send,'not-invoked');assert.equal(f.status().devEvidence.composerEmpty,true);assert.equal(f.clicks,0);assert(f.disconnected>0);
});
test('continuously changing structural identities time out and disconnect without invocation',async()=>{
 const f=contentFixture({mutating:true});
 const result=await f.send('submitGeneration',operation);
 assert.equal(result.state,'interrupted');assert.equal(result.invocation.send,'not-invoked');assert.equal(f.clicks,0);assert(f.disconnected>0);
});
test('duplicate while baseline stabilization is pending cannot create another send',async()=>{
 const f=contentFixture();const first=f.send('submitGeneration',operation),second=f.send('submitGeneration',operation);
 assert.equal((await second).state,'interrupted');assert.equal((await first).state,'running');assert.equal(f.clicks,1);
});
test('typed invocation separates no click, uncertain click, invoked but unaccepted, and acceptance',async()=>{
 for(const [options,send,reason] of [[{disabled:true},'not-invoked','send-unready'],[{clickThrows:true},'uncertain','invocation-uncertain'],[{clickOnly:true},'invoked','acceptance-unproven'],[{},'invoked','accepted']]) {
   const result=await contentFixture(options).send('submitGeneration',operation);
   assert.equal(result.invocation.delivery,'content-script');assert.equal(result.invocation.send,send);assert.equal(result.invocation.reason,reason);
   assert(validResult('submitGeneration',JSON.parse(JSON.stringify(result)),operation));
 }
 const invalid={operationId:'op',sceneId:'scene',state:'interrupted',invocation:{delivery:'content-script',send:'invoked',reason:'accepted'}};
 assert.equal(validResult('submitGeneration',invalid,operation),false);
});
test('own synchronous trusted insertion input is allowed but later trusted interaction interrupts',async()=>{
 const f=contentFixture({ownTrustedInput:true});assert.equal((await f.send('submitGeneration',operation)).state,'running');assert.equal(f.clicks,1);
 const g=contentFixture({ownTrustedInput:true,disturb:true});assert.equal((await g.send('submitGeneration',operation)).state,'interrupted');assert.equal(g.clicks,0);
});
test('interrupted invocation evidence persists privately without an acceptance receipt',async t=>{
 const f=fixture(t,{command:async(type,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',invocation:{delivery:'content-script',send:'not-invoked',reason:'baseline-unready'}})});
 const job=await f.service.submit(request());const interrupted=await until(f.service,job.id,'interrupted');
 const record=JSON.parse(fs.readFileSync(path.join(f.service.context(interrupted).outputDirectory,'muse-operation.json'),'utf8'));
 assert.equal(record.invocation.send,'not-invoked');assert.equal(record.receipt,undefined);
 assert(!JSON.stringify(interrupted).includes('invocation'));assert(!JSON.stringify(interrupted).includes('content-script'));
});
test('structural acceptance never reads draft/message strings and yields a typed receipt',async()=>{
 const f=contentFixture();f.inject(f.node('user','baseline-user'));f.inject(f.node('assistant','baseline-assistant'));
 assert.equal(f.status().canSubmit,false);
 const result=await f.send('submitGeneration',operation);
 assert.equal(result.state,'running');
 assert(validReceipt(JSON.parse(JSON.stringify(result.receipt)),'op'));
 const serialized=JSON.stringify(result);
 for(const value of ['Exact prompt','baseline-user','baseline-assistant','new-user'])assert(!serialized.includes(value));
 await f.send('submitGeneration',operation);assert.equal(f.clicks,1);
 assert.equal((await f.send('inspectGeneration',inspectPayload)).state,'running');
});
test('click alone, old IDs, absent clear/transition and concurrent user interaction never prove acceptance',async()=>{
 for(const option of [{clickOnly:true},{noNewUser:true},{noClear:true},{keepButton:true},{disturb:true}]) {
   const f=contentFixture(option);
   assert.equal((await f.send('submitGeneration',operation)).state,'interrupted');
   await f.send('submitGeneration',operation);assert(f.clicks<=1);
 }
 const reused=contentFixture({userId:'old-user'});reused.inject(reused.node('user','old-user'));
 assert.equal((await reused.send('submitGeneration',operation)).state,'interrupted');
});
test('send is restricted to one visible enabled action-slot button and preserves a user draft',async()=>{
 for(const option of [{twoButtons:true},{hidden:true},{disabled:true},{ariaDisabled:true},{draftLength:4}]) {
  const f=contentFixture(option);assert.equal((await f.send('submitGeneration',operation)).state,'interrupted');assert.equal(f.clicks,0);
 }
});
test('new user plus cleared composer and actual generation control is accepted',async()=>{
 const f=contentFixture({keepButton:true,active:true});
 const result=await f.send('submitGeneration',operation);assert.equal(result.state,'running');
 assert.equal(result.receipt.acceptance.sendControlTransition,false);
 assert.equal(result.receipt.acceptance.generationControlObserved,true);
});
test('result requires the new associated assistant and rejects old videos or unrelated media',async()=>{
 const f=contentFixture({video:media()});
 const result=await f.send('submitGeneration',operation);assert.equal(result.state,'result');assert.match(result.assistantMessageId,/^[a-f0-9]{64}$/);
 f.inject(f.node('user','unrelated-user'));assert.equal((await f.send('inspectGeneration',inspectPayload)).state,'interrupted');
 const old=contentFixture({video:media()});old.inject(old.node('assistant','old-assistant',media()));
 assert.equal((await old.send('submitGeneration',operation)).state,'interrupted');
 const noVideo=contentFixture();assert.equal((await noVideo.send('submitGeneration',operation)).state,'running');
 noVideo.inject(noVideo.node('assistant','unrelated-assistant',media()));assert.equal((await noVideo.send('inspectGeneration',inspectPayload)).state,'interrupted');
});
test('changed/missing baseline, changed response, auth loss and navigation interrupt without resubmit',async()=>{
 const f=contentFixture();f.inject(f.node('user','old-user'));
 await f.send('submitGeneration',operation);f.replace([f.node('user','new-user'),f.node('assistant','new-assistant')]);
 assert.equal((await f.send('inspectGeneration',inspectPayload)).state,'interrupted');
 const g=contentFixture();await g.send('submitGeneration',operation);g.offline();assert.equal((await g.send('inspectGeneration',inspectPayload)).state,'interrupted');
 const h=contentFixture();await h.send('submitGeneration',operation);h.replace([h.node('user','new-user'),h.node('assistant','changed-assistant',media())]);assert.equal((await h.send('inspectGeneration',inspectPayload)).state,'interrupted');
 const restarted=contentFixture();assert.equal((await restarted.send('inspectGeneration',inspectPayload)).state,'interrupted');assert.equal(restarted.clicks,0);
});
test('receipts reject unbounded IDs, text, reused identity, missing acceptance and forged completion',()=>{
 const receipt=receiptFor(operation);
 for(const patch of [{submittedUserMessageId:'raw-id'},{baselineUserMessageIds:Array(129).fill('a'.repeat(64))},{submittedUserMessageId:'a'.repeat(64)},{messageText:'private'},{acceptance:{composerCleared:true,sendControlTransition:false,generationControlObserved:false}}])assert.equal(validReceipt({...receipt,...patch},'op'),false);
 assert.equal(validResult('submitGeneration',{operationId:'op',sceneId:'scene',state:'running'},operation),false);
 assert.equal(validResult('inspectGeneration',{operationId:'op',sceneId:'scene',state:'result',receipt,assistantMessageId:'b'.repeat(64)},inspectPayload),false);
});
test('native receipt is durable and private; changed or missing receipts interrupt',async t=>{
 for(const changed of [false,true]) {
  const f=fixture(t,{command:async(type,p)=>({operationId:p.operationId,sceneId:p.sceneId,state:'running',receipt:type==='submitGeneration'?receiptFor(p):changed?{...receiptFor(p),submittedUserMessageId:'e'.repeat(64)}:null})});
  const job=await f.service.submit(request());await until(f.service,job.id,'running');
  const record=JSON.parse(fs.readFileSync(path.join(f.root,'outputs',job.id,'muse-operation.json'),'utf8'));
  assert(validReceipt(record.receipt,job.id));
  const renderer=JSON.stringify(f.service.get(job.id));assert(!renderer.includes('submittedUserMessageId'));assert(!renderer.includes('c'.repeat(64)));
  await f.service.recover(job.id);assert.equal(f.service.get(job.id).status,'interrupted');
  assert.equal(f.calls.filter(c=>c.type==='submitGeneration').length,1);
 }
});
test('acquisition rejects assistant ownership changing between chunks',async t=>{
 const f=await acquisitionFixture(t,{transfer:(p,bytes)=>transferReply(p,bytes,p.offset?{receipt:{...p.receipt,assistantStableIdHash:'e'.repeat(64),result:{kind:'video',ownerAssistantStableIdHash:'e'.repeat(64)}}}:{})});
 const job=f.job;await f.service.recover(job.id);
 assert.equal(f.service.get(job.id).status,'interrupted');assert.equal(f.service.get(job.id).asset,null);
 assert(!fs.existsSync(path.join(f.root,'outputs',job.id,job.id+'.partial.mp4')));
});


test('v2 40 prepare/cancel cycles free capacity, preserve worker replay tombstones across restart, and never send',async()=>{
 const content=contentFixture(),stored={},worker=workerV2Harness(stored,content);
 for(let i=0;i<40;i++) {
   const p={...inspectPayload,operationId:'cancel-'+i};
   const prepared=await worker.run('prepareGeneration',p);assert.equal(prepared.state,'prepared');
   assert.equal(content.operationCount,1);
   assert.equal((await content.send('prepareGeneration',{...v2Payload,operationId:'competitor'})).state,'interrupted');
   await worker.run('cancelGeneration',p);assert.equal(content.operationCount,0);
   const restarted=workerV2Harness(stored,content);
   assert.equal((await restarted.run('prepareGeneration',p)).state,'interrupted');
   assert.equal((await restarted.run('submitGeneration',{...operation,...p,receipt:prepared.receipt})).state,'interrupted');
   assert.equal(restarted.calls.length,0);
 }
 assert.equal(content.clicks,0);assert(!worker.calls.includes('submitGeneration'));
});
test('v2 40 fixture assistant anchors release observation entries without losing durable receipts',async()=>{
 const content=contentFixture({video:media()}),stored={},worker=workerV2Harness(stored,content);
 for(let i=0;i<40;i++) {
   content.replace([content.node('user','history-user'),content.node('assistant','history-assistant')]);
   const p={...inspectPayload,operationId:'anchor-'+i};
   const prepared=await worker.run('prepareGeneration',p);assert.equal(prepared.state,'prepared');
   const accepted=await worker.run('submitGeneration',{...operation,...p,receipt:prepared.receipt});
   await worker.run('inspectGeneration',{...p,receipt:accepted.receipt});
   const anchored=await worker.run('inspectGeneration',{...p,receipt:accepted.receipt});
   assert(anchored.receipt.assistantStableIdHash);assert.equal(content.operationCount,0);
   assert.equal(stored['generation-intent:'+p.operationId].receipt.assistantStableIdHash,anchored.receipt.assistantStableIdHash);
 }
});
test('v2 released observation leaves active transfer alive and blocks competing preparation',async()=>{
 const bytes=Buffer.alloc(210000,7),f=contentFixture({fetch:async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})});
 const receipt=await bindV2(f);assert.equal(f.operationCount,0);
 f.replace([f.node('assistant','new-assistant',media())]);
 const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
 const p={...v2Payload,receipt:candidate.receipt,transferId:'capacity-stream',sequence:0,offset:0,mediaKind:'video'};
 const first=await f.send('acquireGenerationResult',p);assert.equal(first.done,false);assert.equal(f.transferCount,1);
 assert.equal((await f.send('prepareGeneration',{...v2Payload,operationId:'competing'})).state,'interrupted');
 await f.send('cancelGeneration',{...inspectPayload,operationId:'unrelated'});assert.equal(f.transferCount,1);
 const last=await f.send('acquireGenerationResult',{...p,sequence:1,offset:196608});assert.equal(last.done,true);
 assert.equal(f.transferCount,0);assert.deepEqual(Buffer.concat([Buffer.from(first.data,'base64'),Buffer.from(last.data,'base64')]),bytes);
});
test('v2 cancellation during ownership lookup prevents even fixture fetch',async()=>{
 let fetched=0;const f=contentFixture({fetch:async()=>{fetched++;throw Error('unexpected');}}),receipt=await bindV2(f);
 f.replace([f.node('assistant','new-assistant',media())]);
 const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
 const pending=f.send('acquireGenerationResult',{...v2Payload,receipt:candidate.receipt,transferId:'pending',sequence:0,offset:0,mediaKind:'video'});
 await f.send('cancelGeneration',inspectPayload);
 assert.equal((await pending).state,'interrupted');assert.equal(fetched,0);assert.equal(f.transferCount,0);
});

test('v2 cancellation during baseline wait releases capacity and late preparation cannot revive it',async()=>{
 const f=contentFixture();
 const pending=f.send('prepareGeneration',v2Payload);
 await f.send('cancelGeneration',inspectPayload);assert.equal(f.operationCount,0);
 assert.equal((await pending).state,'interrupted');assert.equal(f.operationCount,0);
 assert.equal((await f.send('prepareGeneration',{...v2Payload,operationId:'fresh'})).state,'prepared');
 await f.send('cancelGeneration',{...inspectPayload,operationId:'fresh'});assert.equal(f.clicks,0);
});
test('v2 changed baseline submit failure immediately releases observation without typing',async()=>{
 const f=contentFixture(),prepared=await f.send('prepareGeneration',v2Payload);
 f.inject(f.node('assistant','hydrated'));
 assert.equal((await f.send('submitGeneration',{...operation,observationToken:v2Payload.observationToken,receipt:prepared.receipt})).state,'interrupted');
 assert.equal(f.operationCount,0);assert.equal(f.clicks,0);
});

test('v2 worker cancellation tombstone blocks acquisition after observation cleanup and restart',async()=>{
 const f=contentFixture(),receipt=await bindV2(f);assert.equal(f.operationCount,0);
 f.replace([f.node('assistant','new-assistant',media())]);
 const candidate=await f.send('inspectGeneration',{...v2Payload,receipt});
 const stored={'generation-intent:op':{tabId:5,sceneId:'scene',receipt:candidate.receipt}},worker=workerV2Harness(stored,f);
 await worker.run('cancelGeneration',inspectPayload);
 const restarted=workerV2Harness(stored,f);
 assert.equal((await restarted.run('acquireGenerationResult',{...inspectPayload,receipt:candidate.receipt,transferId:'after-cancel',sequence:0,offset:0,mediaKind:'video'})).state,'interrupted');
 assert.equal(restarted.calls.length,0);
});


// Historical fixture receipt only: these transfer regressions never submit.
function tombstoneFixture(size=20) {
 const bytes=Buffer.alloc(size,7);let fetched=0;
 const content=contentFixture({historicalVideos:[media()],fetch:async()=>{fetched++;return new Response(bytes,{headers:{'content-type':'video/mp4'}});}});
 const receipt=anchoredReceipt('op');
 receipt.assistantStableIdHash=shaBytes('op\0assistant\0owned-assistant');
 receipt.result.ownerAssistantStableIdHash=receipt.assistantStableIdHash;
 content.replace([content.node('assistant','owned-assistant',media())]);
 const stored={'generation-intent:op':{tabId:5,sceneId:'scene',receipt}},worker=workerV2Harness(stored,content);
 const payload=id=>({...inspectPayload,receipt,transferId:id,sequence:0,offset:0,mediaKind:'video'});
 return {content,worker,payload,get fetched(){return fetched;}};
}
for(const aborted of [false,true])test('v2 FIFO tombstones remain bounded after 70 '+(aborted?'aborted':'successful')+' transfers without submission',async()=>{
 const f=tombstoneFixture(aborted?210000:20);
 for(let i=0;i<70;i++) {
   const p=f.payload('closed-'+i),r=await f.worker.run('acquireGenerationResult',p);
   assert.equal(r.state,'result');assert.equal(r.done,!aborted);
   if(aborted)assert.equal((await f.worker.run('acquireGenerationResult',{...p,abort:true})).state,'interrupted');
   assert.equal(f.content.transferCount,0);assert.equal(f.content.tombstones.length,Math.min(i+1,64));
 }
 assert.equal(f.content.tombstones[0],'closed-6');assert.equal(f.content.tombstones.at(-1),'closed-69');
 const fetched=f.fetched;
 for(const id of ['closed-6','closed-69'])assert.equal((await f.worker.run('acquireGenerationResult',f.payload(id))).state,'interrupted');
 assert.equal(f.fetched,fetched);
 const fresh=f.payload('fresh');assert.equal((await f.worker.run('acquireGenerationResult',fresh)).state,'result');
 await f.worker.run('acquireGenerationResult',{...fresh,abort:true});
 assert.equal(f.content.tombstones.length,64);
 // Evicted IDs still cannot fetch an unowned/page-global video.
 f.content.replace([f.content.node('assistant','unowned-assistant',media())]);
 const before=f.fetched;
 assert.equal((await f.worker.run('acquireGenerationResult',f.payload('closed-0'))).state,'interrupted');
 assert.equal(f.fetched,before);
 const forged=f.payload('closed-1');forged.receipt={...forged.receipt,assistantStableIdHash:'e'.repeat(64),result:{kind:'video',ownerAssistantStableIdHash:'e'.repeat(64)}};
 assert.equal((await f.worker.run('acquireGenerationResult',forged)).state,'interrupted');
 assert.equal(f.fetched,before);assert.equal(f.content.clicks,0);
 assert(f.worker.calls.every(c=>c==='acquireGenerationResult'));
});
test('v2 active transfer collisions cannot replace or abort its owner and matching cancel still aborts',async()=>{
 const f=tombstoneFixture(210000),p={...f.payload('active'),observationToken:v2Payload.observationToken};
 const pending=f.content.send('acquireGenerationResult',p);
 assert.equal((await f.content.send('acquireGenerationResult',p)).state,'interrupted');
 assert.equal((await pending).state,'result');assert.equal(f.fetched,1);
 assert.equal((await f.content.send('acquireGenerationResult',{...p,sceneId:'other'})).state,'interrupted');
 assert.equal((await f.content.send('acquireGenerationResult',{...p,transferId:'different-id'})).state,'interrupted');
 assert.equal(f.content.transferCount,1);assert.equal(f.fetched,1);
 await f.worker.run('cancelGeneration',inspectPayload);
 assert.equal(f.content.transferCount,0);assert.deepEqual(f.content.tombstones,['active']);
 assert.equal((await f.worker.run('acquireGenerationResult',{...f.payload('active'),offset:196608,sequence:1})).state,'interrupted');
 assert.equal(f.content.clicks,0);assert(!f.worker.calls.includes('submitGeneration'));
});

test('v2 late close cannot delete an active successor after FIFO eviction',async()=>{
 const f=tombstoneFixture(210000),first=f.payload('reused');
 await f.worker.run('acquireGenerationResult',first);
 const closeOld=f.content.captureTransferClose();
 await f.worker.run('acquireGenerationResult',{...first,abort:true});
 for(let i=0;i<64;i++) {
   const p=f.payload('rotate-'+i);await f.worker.run('acquireGenerationResult',p);
   await f.worker.run('acquireGenerationResult',{...p,abort:true});
 }
 assert(!f.content.tombstones.includes('reused'));
 assert.equal((await f.worker.run('acquireGenerationResult',first)).state,'result');
 closeOld();assert.equal(f.content.transferCount,1);assert(!f.content.tombstones.includes('reused'));
 const end=await f.worker.run('acquireGenerationResult',{...first,sequence:1,offset:196608});
 assert.equal(end.done,true);assert.equal(f.content.transferCount,0);assert.equal(f.content.tombstones.length,64);
 assert.equal(f.content.clicks,0);assert(f.worker.calls.every(c=>c==='acquireGenerationResult'));
});
