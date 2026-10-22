"use strict";
// Isolated virtual document, adapted from the existing acceptance regression fixture.
// Never loaded by packaged runtime; fetch is supplied locally by each fixture.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
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
 const c={document,window,URL,fetch:options.fetch,AbortController,btoa,location:{origin:'https://muse.ai'},HTMLTextAreaElement:Textarea,Event:class{},NodeFilter:{SHOW_TEXT:4},crypto:options.crypto?{...options.crypto,randomUUID:require('node:crypto').randomUUID}:require('node:crypto').webcrypto,TextEncoder,Date:options.clock?{now:options.clock}:Date,performance:options.monotonicClock?{now:options.monotonicClock}:undefined,
   setTimeout:(fn,ms)=>ms>=15000?setTimeout(fn,options.transferTimeout && ms===15000?20:ms).unref():setTimeout(()=>{if(options.disturb && events.input)events.input({isTrusted:true});if(options.mutating){rows=[node('user','changing-'+Math.random())];observerCallback?.();}if(clicks)options.onPostSendTick?.(api,++postSendTicks);fn();},ms===5000?100:1),clearTimeout,
   MutationObserver:class {constructor(fn){this.fn=records=>fn(records,this);}observe(){observerCallbacks.add(this.fn);}disconnect(){observerCallbacks.delete(this.fn);disconnected++;}},
   getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),chrome:{runtime:{id:'ext',getManifest:()=>options.manifest||({version:'0.3.0',...(options.production?{}:{version_name:'development-diagnostics'})}),onMessage:{addListener:f=>listeners.push(f)},connect:()=>({onDisconnect:{addListener(){}}})}}};
 c.chrome.storage={local:options.storage};
 vm.runInNewContext(fs.readFileSync('extensions/meta-muse-bridge/execution-audit.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/acceptance-replay.js','utf8')+';'+fs.readFileSync('extensions/meta-muse-bridge/receipt-v2.js','utf8')+';'+['manual-recovery-contract.js','manual-recovery.js','content-manual-recovery.js','content-script.js'].map(f=>fs.readFileSync('extensions/meta-muse-bridge/'+f,'utf8')).join(';'),c);
 const send=(command,payload)=>new Promise(resolve=>listeners[0]({type:'viral-ai:muse-execution',command,payload},{id:'ext'},resolve));
 const status=()=>{let result;listeners[0]({type:'viral-ai:muse-status'},{id:'ext'},r=>result=r);return result;};
 const api={
   context:c,
   message:message=>new Promise(resolve=>listeners[0](message,{id:'ext'},resolve)),
   audit:vm.runInNewContext('contentAudit',c),
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
   get baselineDrift(){return JSON.parse(vm.runInNewContext('JSON.stringify([...operations.values()][0]?.baselineDrift||null)',c));},
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
function memoryStorage(data = {}) {
  return {data, get:async keys=>JSON.parse(JSON.stringify(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>data[k]!==undefined).map(k=>[k,data[k]])))),
    set:async values=>Object.assign(data,JSON.parse(JSON.stringify(values))),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
function projectFixture(job, service, {failWrite=false,failPresentation=false}={}) {
  const model=require('../renderer/core-project-scene-plan'),scenes=require('../renderer/core-scene-plan-model');
  const key='viral-ai-core-project-registry-v1', reports=[], writes=[];
  const project={...model.createDraftProject({projectId:job.projectId,projectName:'Audit DEV'}),
    scenePlan:scenes.normalizePlan({scenes:[{id:job.sceneId}],selectedSceneId:job.sceneId})};
  const data=new Map([[key,JSON.stringify({schemaVersion:1,activeProjectId:job.projectId,projects:[project]})]]);
  let failure=failWrite,presentation=failPresentation;
  class Storage {
    getItem(k){return data.get(k)??null;}
    setItem(k,v){if(failure && k===key)throw Error('DEV quota');writes.push(k);data.set(k,String(v));}
    removeItem(k){data.delete(k);}
  }
  const state={...model.toLegacyState(project,{}),locale:'en',page:'home',projectId:job.projectId};
  const window={ViralCoreProjectSnapshot:model,ViralCoreScenePlanModel:scenes,crypto,
    addEventListener(){},dispatchEvent(){if(presentation)throw Error('DEV presentation');},
    desktopAPI:{reportGenerationAttachment:async payload=>{reports.push(payload);return {ok:true,value:service.reportGenerationAttachment(payload)};}}};
  const c={window,state,crypto,HTMLElement:class{},HTMLVideoElement:class{},Storage,localStorage:new Storage(),document:{readyState:'loading',addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null},
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/core-project-persistence.js','utf8'),c);
  return {api:window.ViralCoreProjectPersistence,reports,writes,data,key,state,
    set fail(v){failure=v;},set failPresentation(v){presentation=v;},
    persisted:()=>JSON.parse(data.get(key)).projects[0]};
}
async function automaticFixture({root,bytes,verifyVideo,clickThrows=false,lostSubmit=false}={}) {
  const {GenerationService}=require('../services/generation/generation-service');
  const {ProviderRegistry}=require('../services/generation/provider-registry');
  const {createMuseProvider}=require('../services/generation/providers/muse-provider');
  const storage=memoryStorage(),calls=[],bindings=new Map();let fetches=0,service;
  const video={getAttribute:()=>null,querySelectorAll:()=>[],currentSrc:'blob:https://muse.ai/dev-audit-output',duration:1,videoWidth:160,videoHeight:90,readyState:4};
  const content=contentFixture({storage,noAssistant:true,clickThrows,afterClick:f=>f.inject(f.node('assistant','dev-result-owner',video)),
    fetch:async source=>{if(source!==video.currentSrc)throw Error('DEV foreign source');fetches++;return new Response(bytes,{headers:{'content-type':'video/mp4'}});}});
  const deliver=packet=>service.ingestExecutionWitness(JSON.parse(JSON.stringify(packet)),{instanceId:'audit-fixture',tabId:5});
  const chrome={runtime:{id:'ext',getManifest:()=>require('../extensions/meta-muse-bridge/manifest.json'),onConnect:{addListener(){}},onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
    storage:{local:storage},tabs:{query:async()=>[{id:5}],sendMessage:async(id,m)=>{
      if(id!==5)throw Error('DEV wrong tab');
      if(m.type==='viral-ai:muse-execution')return content.send(m.command,m.payload);
      return content.message(m);
    }},alarms:{create(){},onAlarm:{addListener(){}}}};
  content.context.chrome.runtime.sendMessage=async m=>deliver(m.packet);
  const wc={chrome,navigator:{userAgent:'Edg/DEV'},crypto:crypto.webcrypto,TextEncoder,setTimeout,clearTimeout};
  vm.createContext(wc);vm.runInContext(['execution-audit.js','acceptance-replay.js','receipt-v2.js','manual-recovery-contract.js','worker-manual-recovery.js','service-worker.js'].map(f=>fs.readFileSync(path.join('extensions/meta-muse-bridge',f),'utf8')).join(';\n'),wc);
  wc.auditDeliver=deliver;vm.runInContext('forwardExecutionAudit=async packet=>auditDeliver(packet)',wc);
  const bridge={executionReady:async()=>true,receiptV2Ready:async()=>true,executionTarget:async()=>({instanceId:'audit-fixture',tabId:5}),
    observeExecutionAudit:(c,target)=>bindings.set(c.jobId,{jobId:c.jobId,auditId:c.executionAudit.auditId}),
    command:async(type,p,target)=>{
      if(target.instanceId!=='audit-fixture' || target.tabId!==5)throw Error('DEV wrong target');calls.push(type);
      wc.command={id:crypto.randomUUID(),type,payload:p,audit:bindings.get(p.operationId)};
      vm.runInContext('prepareExecutionAuditSafely(command)',wc);
      const result=await vm.runInContext('execute(command)',wc);
      if(lostSubmit && type==='submitGeneration')throw Error('DEV lost response');
      return JSON.parse(JSON.stringify(result));
    }};
  const registry=new ProviderRegistry(),provider=createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:bridge,verifyVideo});registry.register(provider);
  service=new GenerationService({root,registry});
  const workerAudit=vm.runInContext('workerAudit',wc);
  return {service,registry,provider,content,workerAudit,wc,storage,calls,get fetches(){return fetches;},
    async drain(){for(let i=0;i<3;i++){await workerAudit.drain(deliver);await content.audit.drain(deliver);}},
    async admit(){const job=await service.submit({projectId:crypto.randomUUID(),sceneId:crypto.randomUUID(),providerId:'muse',idempotencyKey:crypto.randomUUID(),prompt:'DEV PRIVATE PROMPT NEVER IN AUDIT'});
      for(let i=0;i<200 && !['running','interrupted'].includes(service.get(job.id).status);i++)await new Promise(r=>setTimeout(r,5));return service.get(job.id);},
    close(){for(const t of service.monitors.values())clearTimeout(t);for(const op of vm.runInContext('[...operations.values()]',content.context))op.cleanup?.();}};
}
module.exports={contentFixture,memoryStorage,projectFixture,automaticFixture};
