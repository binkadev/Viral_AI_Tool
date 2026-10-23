"use strict";
// Virtual Muse only. Excluded from the packaged app; no browser/network request.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {GenerationService}=require('../services/generation/generation-service');
const {ProviderRegistry}=require('../services/generation/provider-registry');
const {createMuseProvider}=require('../services/generation/providers/muse-provider');
function createFixture({root,bytes,verifyVideo,executionAudit=false}) {
  const calls=[],focus=[],observers=new Set(),events=new Map(),windowEvents=new Map(),stored={},auditBindings=new Map();
  const auditStorage=require("./execution-audit-fixture").memoryStorage(stored);
  let clock=Date.now(),active=false,href='https://muse.ai/conversation/isolated',fetches=0,failPersistence=false,failOutputPersistence=false,onFetch=null,onRead=null;
  const listen=(map,k,f)=>{if(!map.has(k))map.set(k,new Set());map.get(k).add(f);};
  const remove=(map,k,f)=>map.get(k)?.delete(f);
  const video=(index)=>({isConnected:true,style:{outline:''},currentSrc:'blob:https://muse.ai/'+crypto.randomUUID(),duration:1,videoWidth:160,videoHeight:90,readyState:4,srcObject:null,
    getAttribute:k=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},scrollIntoView(){focus.push(['highlight',index]);},getBoundingClientRect:()=>({left:10,top:10,width:160,height:90})});
  let nodes=[video(1),video(2)];
  const first=Buffer.concat([bytes,Buffer.alloc(16)]),sources=new Map([[nodes[0].currentSrc,first],[nodes[1].currentSrc,bytes]]);
  const editor={isConnected:true,tagName:'TEXTAREA',getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{}]};
  const composerRoot={isConnected:true,contains:n=>n===composerRoot,closest:()=>null,getClientRects:()=>[{}],querySelectorAll:s=>s==='[data-hatch-composer-action-slot]'?[{}]:[editor]};
  const container={isConnected:true,querySelectorAll:q=>q==='video'?nodes:[],contains:n=>n===container || nodes.includes(n)};
  const docroot={appendChild:n=>{n.isConnected=true;}};
  const document={readyState:'complete',documentElement:docroot,querySelectorAll:q=>q==='[data-hatch-composer-root]'?[composerRoot]:q==='[data-testid="hatch-composer-stop-button"]'?(active?[{isConnected:true}]:[]):[],
    createElement:()=>({style:{},setAttribute(){},remove(){}}),addEventListener:(k,f)=>listen(events,k,f),removeEventListener:(k,f)=>remove(events,k,f)};
  const window={addEventListener:(k,f)=>listen(windowEvents,k,f),removeEventListener:(k,f)=>remove(windowEvents,k,f)};window.top=window;
  const context={document,window,location:{origin:'https://muse.ai',get href(){return href;}},URL,TextEncoder,crypto:crypto.webcrypto,AbortController,Uint8Array,btoa,console,
    Date:{now:()=>clock},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);if(ms>=15000)t.unref();return t;},clearTimeout,setInterval:(f,ms)=>{const t=setInterval(f,ms);t.unref();return t;},clearInterval,
    getComputedStyle:()=>({display:'block',visibility:'visible'}),MutationObserver:class {constructor(fn){this.fn=fn;}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
    chrome:{storage:{local:auditStorage},runtime:{id:'fixture',getManifest:()=>({version:'0.3.18'}),onMessage:{addListener(){}},connect:()=>({onDisconnect:{addListener(){}}})}},
    fetch:async(source)=>{
      fetches++;calls.push({type:'fetch',sourceIndex:[...sources.keys()].indexOf(source)});
      onFetch?.();
      const b=sources.get(source);if(!b)throw Error('Unknown fixture source');
      if(onRead) {
        let sent=false;
        return new Response(new ReadableStream({pull(controller){if(!sent){sent=true;controller.enqueue(b);onRead();}else controller.close();}}),{headers:{'content-type':'video/mp4','content-length':String(b.length)}});
      }
      return new Response(b,{headers:{'content-type':'video/mp4','content-length':String(b.length)}});
    }
  };
  vm.createContext(context);
  const files=[...(executionAudit?['execution-audit.js']:[]),'acceptance-replay.js','receipt-v2.js','manual-recovery-contract.js','manual-recovery.js','content-manual-recovery.js','content-script.js'];
  vm.runInContext(files.map(f=>fs.readFileSync(path.join(__dirname,'../extensions/meta-muse-bridge',f),'utf8')).join(';\n'),context);
  // The production composer resolver is replaced only inside this DEV VM. No
  // fake production flag or branch exists in renderer/provider/security code.
  context.composerRoot=composerRoot;vm.runInContext('composer=()=>({root:composerRoot});generationActive=()=>false',context);
  function retain(p) {
    context.binding=p;context.fixtureContainer=container;
    vm.runInContext('manualRecovery.prepare(binding);manualRecovery.retain(binding.operationId,{sceneId:binding.sceneId,observationToken:binding.observationToken,projection:{container:fixtureContainer}})',context);
  }
  const contentSend=async(id,m)=>{
    if(id!==5)throw Error('Wrong pinned tab');
    const p=m.payload;
    if(m.type==='viral-ai:muse-audit-bind') {
      context.auditBinding=m.binding;
      const ok=await vm.runInContext('contentAudit.bind(auditBinding)',context);
      await vm.runInContext('contentAudit.drain(packet=>chrome.runtime.sendMessage({type:"viral-ai:muse-audit-packet",packet}))',context);
      return {ok};
    }
    if(m.type==='viral-ai:muse-audit-drain')return {ok:true};
    if(m.type==='viral-ai:muse-manual-recovery') {
      context.command=m.command;context.payload=p;
      return JSON.parse(JSON.stringify(await vm.runInContext('manualRecovery.execute(command,payload)',context)));
    }
    if(m.command==='prepareGeneration') {retain(p);return {operationId:p.operationId,sceneId:p.sceneId,state:'prepared',receipt:{version:2,operationId:p.operationId,baselineUserMessageIds:['a'.repeat(64)],baselineAssistantMessageIds:[]}};}
    // Simulated interrupted automatic attempt; never touches the composer.
    return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted'};
  };
  const wc={crypto:crypto.webcrypto,TextEncoder,setTimeout,clearTimeout,navigator:{userAgent:'Edg/1'},chrome:{
    runtime:{id:'fixture',getManifest:()=>({version:'0.3.18'}),onConnect:{addListener(){}},onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
    storage:{local:auditStorage},
    tabs:{query:async()=>[{id:5,windowId:7}],update:async(id,p)=>{focus.push(['tab',id]);return {id,windowId:7};},sendMessage:contentSend},windows:{update:async id=>focus.push(['window',id])},alarms:{create(){},onAlarm:{addListener(){}}}}};
  vm.createContext(wc);
  vm.runInContext([...(executionAudit?['execution-audit.js']:[]),'acceptance-replay.js','receipt-v2.js','manual-recovery-contract.js','worker-manual-recovery.js','service-worker.js'].map(f=>fs.readFileSync(path.join(__dirname,'../extensions/meta-muse-bridge',f),'utf8')).join(';\n'),wc);
  const bridge={executionReady:async()=>true,receiptV2Ready:async()=>true,executionTarget:async()=>({instanceId:'fixture-instance',tabId:5}),
    observeExecutionAudit:(c,target)=>{if(executionAudit)auditBindings.set(c.jobId,{version:c.executionAudit.version,jobId:c.jobId,auditId:c.executionAudit.auditId});},
    command:async(type,p,target)=>{if(target.instanceId!=='fixture-instance' || target.tabId!==5)throw Error('Wrong pinned instance');calls.push({type,p:JSON.parse(JSON.stringify(p))});wc.command={id:crypto.randomUUID(),type,payload:p,...(executionAudit?{audit:auditBindings.get(p.operationId)}:{})};if(executionAudit)await vm.runInContext('prepareExecutionAuditSafely(command)',wc);return await vm.runInContext('execute(command)',wc);}};
  const registry=new ProviderRegistry(),provider=createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:bridge,verifyVideo});registry.register(provider);
  const service=new GenerationService({root,registry}),originalSave=service.store.save.bind(service.store);
  const auditDeliver=packet=>service.ingestExecutionWitness(JSON.parse(JSON.stringify(packet)),{instanceId:'fixture-instance',tabId:5});
  if(executionAudit){
    wc.auditDeliver=auditDeliver;vm.runInContext('forwardExecutionAudit=async packet=>auditDeliver(packet)',wc);
    context.chrome.runtime.sendMessage=async m=>auditDeliver(m.packet);
  }
  async function drainAudit(){if(executionAudit)for(let i=0;i<3;i++){await vm.runInContext('workerAudit',wc).drain(auditDeliver);await vm.runInContext('contentAudit',context).drain(auditDeliver);}}
  service.store.save=jobs=>{
    if(failPersistence && jobs.some(j=>j.outputResolution?.phase==='confirmed') || failOutputPersistence && jobs.some(j=>j.outputResolution?.phase==='verified'))throw Object.assign(Error('STORE_UNAVAILABLE'),{code:'STORE_UNAVAILABLE'});
    originalSave(jobs);
  };
  async function admit(projectId='project',sceneId='scene') {
    const job=await service.submit({projectId,sceneId,providerId:'muse',idempotencyKey:crypto.randomUUID(),prompt:'DEV virtual interrupted video'});
    for(let i=0;i<100 && service.get(job.id).status!=='interrupted';i++)await new Promise(r=>setTimeout(r,5));
    if(service.get(job.id).status!=='interrupted')throw Error('Fixture interruption failed');
    return service.get(job.id);
  }
  function mutate(records=[{type:'childList',target:container,addedNodes:[],removedNodes:[]}]){for(const fn of [...observers])fn(records);}
  return {service,registry,provider,bridge,calls,focus,stored,context,wc,admit,mutate,drainAudit,get nodes(){return nodes;},get fetches(){return fetches;},
    setBytes:value=>{sources.set(nodes[0].currentSrc,Buffer.concat([value,Buffer.alloc(16)]));sources.set(nodes[1].currentSrc,value);},
    expire:()=>{clock+=120001;},navigate:()=>{href+='changed';mutate([]);},reload:()=>vm.runInContext('manualRecovery.controller.reset()',context),
    restartWorker:()=>vm.runInContext('observationEpoch=crypto.randomUUID()',wc),
    replaceContent:()=>vm.runInContext('globalThis.__viralMuseRecovery.reset()',context),
    accountUncertain:()=>{editor.readOnly=true;mutate([]);},
    containerChange:()=>{container.isConnected=false;mutate([]);},
    transientRemove:()=>mutate([{type:'childList',target:container,removedNodes:[nodes[1]],addedNodes:[nodes[1]]}]),
    remount:()=>{nodes[1].isConnected=false;nodes[1]={...nodes[1],isConnected:true};mutate();},
    disappear:()=>{nodes[1].isConnected=false;nodes.pop();mutate();},
    sourceChange:()=>{nodes[1].currentSrc='blob:https://muse.ai/'+crypto.randomUUID();mutate();},
    more:()=>{while(nodes.length<9)nodes.push(video(nodes.length+1));mutate();},
    activity:()=>{for(const fn of events.get('input')||[])fn({isTrusted:true,target:composerRoot});},
    set failPersistence(v){failPersistence=v;},set failOutputPersistence(v){failOutputPersistence=v;},
    set onFetch(fn){onFetch=fn;},set onRead(fn){onRead=fn;},
    close:()=>{vm.runInContext('manualRecovery.controller.reset()',context);for(const t of service.monitors.values())clearTimeout(t);}
  };
}
module.exports={createFixture};
