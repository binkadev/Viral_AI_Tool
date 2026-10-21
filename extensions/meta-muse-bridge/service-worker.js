"use strict";
const WORKER_BUILD='muse-worker-v0-3-5-contract3-receipt2-ownershipdiag2';
if(typeof importScripts==='function')importScripts('acceptance-replay.js','receipt-v2.js');
const WORKER_EPOCH=crypto.randomUUID();
let observationEpoch=WORKER_EPOCH;
const PORTS=Array.from({length:11},(_,i)=>32147+i), MUSE_URL="https://muse.ai/";
let bridge=null, running=null, keepAlive=0;
const developmentDiagnostics=chrome.runtime.getManifest().version_name==='development-diagnostics';
let lastBridgeErrorCode='NONE';
const chromeOnly=()=>!/(Edg|OPR)\//.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent);
async function identity() {
  const stored=await chrome.storage.local.get(["instanceId","profileLabel"]);
  if(!/^[a-zA-Z0-9._:-]{8,160}$/.test(stored.instanceId||"")) {
    stored.instanceId=crypto.randomUUID();stored.profileLabel="";
    await chrome.storage.local.set({instanceId:stored.instanceId,profileLabel:""});
  }
  return {instanceId:stored.instanceId,profileLabel:String(stored.profileLabel||"").slice(0,80)};
}
async function request(port,pathname,{token="",body,timeout=2000}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch("http://127.0.0.1:"+port+pathname,{method:body===undefined?"GET":"POST",cache:"no-store",credentials:"omit",redirect:"error",
      headers:{...(token?{"X-Viral-Muse-Token":token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
      body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    if(!response.ok){lastBridgeErrorCode=[400,401,403,409].includes(response.status)?'HTTP_'+response.status:'HTTP_OTHER';throw Error("UNAVAILABLE");}
    return await response.json();
  } catch(error) {
    if(!lastBridgeErrorCode.startsWith('HTTP_'))lastBridgeErrorCode=error?.name==='AbortError'?'BRIDGE_TIMEOUT':'BRIDGE_UNREACHABLE';
    throw error;
  } finally {clearTimeout(timer);}
}
async function connect() {
  if(bridge)return bridge;
  for(const port of PORTS) {
    try {
      const ping=await request(port,"/v1/ping",{timeout:500});
      if(ping.bridge!=="meta-muse-extension" || typeof ping.serverId!=="string")continue;
      const registered=await request(port,"/v1/register",{body:{...await identity(),browserName:"Chrome",extensionVersion:chrome.runtime.getManifest().version,protocolVersion:1}});
      if(!/^[a-f0-9]{64}$/.test(registered.token))continue;
      bridge={port,token:registered.token,serverId:registered.serverId};return bridge;
    } catch {}
  }
  throw Error("UNAVAILABLE");
}
async function contentMessage(tabId,type) {
  let timer;
  try{return await Promise.race([chrome.tabs.sendMessage(tabId,{type}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RESPONSE_TIMEOUT')),1500);})]);}
  finally{clearTimeout(timer);}
}
function contentError(error) {
  if(error?.message==='RESPONSE_TIMEOUT')return 'RESPONSE_TIMEOUT';
  if(/receiving end does not exist|could not establish connection/i.test(error?.message||''))return 'NO_RECEIVER';
  return 'MESSAGE_FAILED';
}
async function museTabs() {
  const tabs=await chrome.tabs.query({url:[MUSE_URL+"*"]});
  return Promise.all(tabs.slice(0,20).map(async tab=>{
    let handshake,status,errorCode='NONE';
    try{handshake=await contentMessage(tab.id,'viral-ai:muse-handshake');}catch(error){errorCode=contentError(error);}
    try{status=await contentMessage(tab.id,'viral-ai:muse-status');}catch(error){errorCode=contentError(error);}
    if(status?.contentError==='STATUS_EXCEPTION')errorCode='STATUS_EXCEPTION';
    if(!status && errorCode==='NONE')errorCode='EMPTY_RESPONSE';
    const version=Number.isSafeInteger(handshake?.contractVersion)?handshake.contractVersion:Number.isSafeInteger(status?.executionContract)?status.executionContract:0;
    const age=Number.isSafeInteger(status?.sampledAt)?Date.now()-status.sampledAt:null;
    const fresh=age!==null && age>=0 && age<=12000;
    const compatible=version===3 && status?.executionContract===3;
    const diagnostic={serviceWorkerAlive:true,museContentScriptHeartbeatSeen:!!status,museContentScriptHandshakeSeen:handshake?.contractVersion===3,museContentScriptContractVersion:Math.min(100,Math.max(0,version)),museTabEvidenceFresh:fresh,museTabEvidenceAgeBucket:age===null?'absent':fresh?'fresh':'stale',composerDetected:status?.composerReady===true,authenticatedEvidencePresent:fresh && status?.composerReady===true,generationActiveEvidencePresent:typeof status?.devEvidence?.generationActive==='boolean',hostPatternMatched:true,lastContentScriptErrorCode:errorCode,lastBridgeErrorCode};
    diagnostic.workerBuild=WORKER_BUILD;
    diagnostic.contentBuild=/^muse-content-[a-z0-9-]{1,64}$/.test(handshake?.buildMarker||'')?handshake.buildMarker:'unreported';
    diagnostic.generationActive=status?.devEvidence?.generationActive===true;
    return {tabId:tab.id,url:MUSE_URL,composerReady:fresh && status?.composerReady===true,canSubmit:fresh && compatible && status?.canSubmit===true,inspectionComplete:fresh && status?.inspectionComplete===true,executionContract:fresh && compatible?3:null,ownershipReceiptVersion:fresh && status?.ownershipReceiptVersion===2?2:null,
      runtimeBuild:{workerBuild:WORKER_BUILD,contentBuild:errorCode==='NONE' && fresh && handshake?.contractVersion===3?diagnostic.contentBuild:'unreported',diagnosticsEnabled:developmentDiagnostics && errorCode==='NONE' && fresh && handshake?.diagnosticsEnabled===true},devEvidence:fresh?status?.devEvidence:undefined,...(developmentDiagnostics?{devConnection:diagnostic}:{})};
  }));
}
async function openMuse(tabId) {
  const tabs=await chrome.tabs.query({url:[MUSE_URL+"*"]});
  let selected;
  if(Number.isSafeInteger(tabId)) {
    selected=tabs.find(t=>t.id===tabId);if(!selected)throw Error("UNAVAILABLE");
  } else if(tabs.length===1)selected=tabs[0];
  else if(tabs.length>1)throw Error("UNAVAILABLE");
  const tab=selected?await chrome.tabs.update(selected.id,{active:true}):await chrome.tabs.create({url:MUSE_URL,active:true});
  await chrome.windows.update(tab.windowId,{focused:true});
  return {tabId:tab.id,url:MUSE_URL};
}
async function poll() {
  if(!chromeOnly())return false;
  try {
    const b=await connect(),ident=await identity(),suffix="?instanceId="+encodeURIComponent(ident.instanceId);
    await request(b.port,"/v1/heartbeat"+suffix,{token:b.token,body:{profileLabel:ident.profileLabel,browserName:"Chrome",tabs:await museTabs()}});
    lastBridgeErrorCode='NONE';
    const response=await request(b.port,"/v1/poll"+suffix,{token:b.token});
    if(response.command) {
      const c=response.command;
      if(typeof c.id!=="string" || c.id.length>80)throw Error("UNAVAILABLE");
      // Keep heartbeats alive while the content script acquires a video.
      const execution=execute(c).then(result=>request(b.port,"/v1/result"+suffix,{token:b.token,body:{commandId:c.id,ok:true,result,error:null}}),
        ()=>request(b.port,"/v1/result"+suffix,{token:b.token,body:{commandId:c.id,ok:false,result:null,error:null}})).catch(()=>{observationEpoch=crypto.randomUUID();});
      if(c.type==='openMuse')await execution;
    }
    return true;
  } catch {observationEpoch=crypto.randomUUID();bridge=null;return false;}
}
function run() {
  if(running)return running;
  running=(async()=>{
    let failures=0,cycles=0;
    do {const ok=await poll();failures=ok?0:failures+1;
      if(!keepAlive && failures>=2)break;
      await new Promise(resolve=>setTimeout(resolve,ok?900:3000));
    } while(++cycles<30 && (keepAlive || failures<2));
  })().finally(()=>{running=null;});return running;
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=="viral-ai-muse-tab" || port.sender?.id!==chrome.runtime.id || port.sender?.frameId!==0 || !port.sender?.url?.startsWith(MUSE_URL))return;
  keepAlive++;run();port.onDisconnect.addListener(()=>{keepAlive=Math.max(0,keepAlive-1);});
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL("popup.html"))return false;
  (async()=>{
    if(message?.type==="viral-ai:bridge-state")return {ok:true,...await identity(),connected:!!bridge};
    if(message?.type==="viral-ai:set-profile-label" && typeof message.profileLabel==="string" && message.profileLabel.length<=80) {
      await chrome.storage.local.set({profileLabel:message.profileLabel.replace(/[\x00-\x1f\x7f]/g,"").trim()});run();return {ok:true};
    }
    if(message?.type==="viral-ai:open-muse") {await openMuse();return {ok:true};}
    if(message?.type==="viral-ai:reconnect") {run();return {ok:true};}
    return {ok:false};
  })().then(reply,()=>reply({ok:false}));return true;
});
chrome.runtime.onInstalled.addListener(()=>{chrome.storage.local.remove(["bridgeToken","bridgePort","bridgeServerId"]);chrome.alarms.create("viral-ai-muse-heartbeat",{periodInMinutes:0.5});run();});
chrome.runtime.onStartup.addListener(()=>run());
// Fresh tab/document events restart a bounded rendezvous. Never inject scripts,
// reload pages or replay an execution command as a recovery mechanism.
chrome.tabs.onUpdated?.addListener((id,change,tab)=>{if(change.status==='complete' && tab?.url?.startsWith(MUSE_URL))run();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==="viral-ai-muse-heartbeat")run();});
chrome.alarms.create('viral-ai-muse-heartbeat',{periodInMinutes:0.5});
run();

const executionTypes=new Set(['submitGeneration','inspectGeneration','acquireGenerationResult','cancelGeneration','prepareGeneration']);
const claimed=new Set();
let v2Tail=Promise.resolve();
async function execute(c) {
  const p=c.payload;
  if(c.type==='openMuse') {
    if(!p || Object.keys(p).some(k=>k!=='tabId'))throw Error('INVALID');
    return openMuse(p.tabId);
  }
  if(!executionTypes.has(c.type) || !p || Object.keys(p).some(k=>!['tabId','operationId','sceneId','prompt','offset','diagnoseOwnership','ownedUserHash','receipt','transferId','sequence','mediaKind','abort','diagnoseAcquisition'].includes(k)) ||
    !Number.isSafeInteger(p.tabId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.operationId||'') || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.sceneId||''))throw Error('INVALID');
  if(c.type==='submitGeneration' && (typeof p.prompt!=='string' || !p.prompt.trim() || p.prompt.length>8000 || p.offset!==undefined))throw Error('INVALID');
  if(c.type==='submitGeneration' && !developmentDiagnostics && p.receipt?.version!==2)throw Error('RECEIPT_REQUIRED');
  if(c.type!=='submitGeneration' && p.prompt!==undefined)throw Error('INVALID');
  if(p.diagnoseOwnership!==undefined && (c.type!=='inspectGeneration' || p.diagnoseOwnership!==true || p.offset!==undefined))throw Error('INVALID');
  if(p.ownedUserHash!==undefined && (p.diagnoseOwnership!==true || !/^[a-f0-9]{64}$/.test(p.ownedUserHash||'')))throw Error('INVALID');
  if(c.type==='acquireGenerationResult' && (!Number.isSafeInteger(p.offset) || p.offset<0 || p.offset>268435456))throw Error('INVALID');
  if(c.type!=='acquireGenerationResult' && p.offset!==undefined)throw Error('INVALID');
  if(c.type==='prepareGeneration' && (p.receipt!==undefined || p.diagnoseOwnership!==undefined))throw Error('INVALID');
  if(p.receipt!==undefined && (!['submitGeneration','inspectGeneration','acquireGenerationResult'].includes(c.type) || !MuseReceiptV2.valid(p.receipt,p.operationId) || p.diagnoseOwnership!==undefined))throw Error('INVALID_RECEIPT');
  if(c.type==='acquireGenerationResult' && !MuseReceiptV2.transferRequest(p))throw Error('INVALID_TRANSFER');
  if(!(c.type==='acquireGenerationResult' && p.receipt) && ['transferId','sequence','mediaKind','abort'].some(k=>p[k]!==undefined))throw Error('INVALID_TRANSFER');
  if(p.diagnoseOwnership===true && !developmentDiagnostics)return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipFailure:{reason:'EXTENSION_DIAGNOSTICS_DISABLED',tabMatch:null,workerIntentPresent:null,workerUserAnchor:null,workerAssistantAnchor:null}};
  if(p.diagnoseAcquisition!==undefined && !developmentDiagnostics)throw Error('DIAGNOSTICS_DISABLED');
  if(p.diagnoseOwnership===true)return diagnoseStoredOwnership(p);
  const tabs=await chrome.tabs.query({url:[MUSE_URL+'*']});
  if(!tabs.some(t=>t.id===p.tabId))throw Error('UNAVAILABLE');
  if(c.type==='cancelGeneration') {
    const key='generation-intent:'+p.operationId,saved=(await chrome.storage.local.get(key))[key];
    if(saved?.version===2 || saved?.receipt?.version===2) {
      if(saved.tabId!==p.tabId || saved.sceneId!==p.sceneId)throw Error('CONFLICT');
      // A separate monotonic tombstone prevents a cancelled preparation from
      // submitting after page/worker restart. Never rewrite receipt anchors.
      await chrome.storage.local.set({[key]:{...saved,localCancelled:true}});
    }
  }
  if(p.diagnoseAcquisition!==undefined) {
    if(!MuseReceiptV2.capabilityRequest(c.type,p))throw Error('INVALID');
    const r=await chrome.tabs.sendMessage(p.tabId,{type:'viral-ai:muse-execution',command:c.type,payload:p});
    if(r?.operationId!==p.operationId || r?.sceneId!==p.sceneId || r.state!=='interrupted' || Object.keys(r).some(k=>!['operationId','sceneId','state','acquisitionDiagnostic'].includes(k)) || !MuseReceiptV2.capabilityReport(r.acquisitionDiagnostic))throw Error('INVALID');
    return r;
  }
  if(c.type==='prepareGeneration' || p.receipt) {
    const task=v2Tail.then(()=>executeV2(c));v2Tail=task.catch(()=>{});return task;
  }
  // Never let a v2 record fall back into legacy submission/acquisition.
  if(c.type==='acquireGenerationResult' || c.type==='submitGeneration') {
    const saved=(await chrome.storage.local.get('generation-intent:'+p.operationId))['generation-intent:'+p.operationId];
    if(saved?.receipt?.version===2)throw Error('RECOVERY_REQUIRED');
  }
  let type=c.type;
  if(type==='submitGeneration') {
    const key='generation-intent:'+p.operationId;
    if(claimed.has(key))return {operationId:p.operationId,sceneId:p.sceneId,state:'interrupted'};
    claimed.add(key);
    try {
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p.sceneId+'\0'+p.prompt)))).map(v=>v.toString(16).padStart(2,'0')).join('');
      const saved=(await chrome.storage.local.get(key))[key];
      if(saved) {
        if(saved.digest!==digest || saved.tabId!==p.tabId)throw Error('CONFLICT');
        type='inspectGeneration';
      } else {
        // Durable before sending to the content script. Never erase/retry this intent.
        await chrome.storage.local.set({[key]:{digest,tabId:p.tabId}});
      }
    } finally {claimed.delete(key);}
  }
  const payload={...p};if(type!=='submitGeneration')delete payload.prompt;
  const result=await chrome.tabs.sendMessage(p.tabId,{type:'viral-ai:muse-execution',command:type,payload});
  if(['running','result'].includes(result?.state)) {
    const r=result.receipt,hash=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
    const keys=['version','operationId','baselineUserMessageIds','baselineAssistantMessageIds','submittedUserMessageId','acceptance'];
    if(!r || Object.keys(r).some(k=>!keys.includes(k)) || r.version!==1 || r.operationId!==p.operationId || !hash(r.submittedUserMessageId) ||
      [r.baselineUserMessageIds,r.baselineAssistantMessageIds].some(a=>!Array.isArray(a) || a.length>128 || a.some(v=>!hash(v))) ||
      !r.acceptance || Object.keys(r.acceptance).some(k=>!['composerCleared','sendControlTransition','generationControlObserved'].includes(k)) ||
      r.acceptance.composerCleared!==true || typeof r.acceptance.sendControlTransition!=='boolean' || typeof r.acceptance.generationControlObserved!=='boolean' ||
      !(r.acceptance.sendControlTransition || r.acceptance.generationControlObserved))throw Error('INVALID_RECEIPT');
    const key='generation-intent:'+p.operationId,saved=(await chrome.storage.local.get(key))[key];
    if(!saved || saved.tabId!==p.tabId || (saved.receipt && JSON.stringify(saved.receipt)!==JSON.stringify(r)))throw Error('RECEIPT_CONFLICT');
    if(!saved.receipt)await chrome.storage.local.set({[key]:{...saved,receipt:r}});
  }
  return result;
}
async function diagnoseStoredOwnership(p) {
  // Read only: never enter executeV2, update the intent, or reconstruct ownership.
  const evidence={tabMatch:null,workerIntentPresent:null,workerUserAnchor:null,workerAssistantAnchor:null};
  const failed=reason=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted',ownershipFailure:{reason,...evidence}});
  if(Object.keys(p).some(k=>!['tabId','operationId','sceneId','diagnoseOwnership','ownedUserHash'].includes(k)))return failed('CONTENT_DIAGNOSIS_REJECTED');
  let tabs;try{tabs=await chrome.tabs.query({url:[MUSE_URL+'*']});}catch{return failed('TARGET_TAB_UNAVAILABLE');}
  evidence.tabMatch=tabs.some(t=>t.id===p.tabId);
  if(!evidence.tabMatch)return failed('TARGET_TAB_UNAVAILABLE');
  let saved;const key='generation-intent:'+p.operationId;
  try{saved=(await chrome.storage.local.get(key))[key];}catch{return failed('WORKER_INTENT_UNAVAILABLE');}
  evidence.workerIntentPresent=!!saved;
  if(!saved)return failed('WORKER_INTENT_UNAVAILABLE');
  const receipt=saved.receipt;
  evidence.workerUserAnchor=!!receipt?.userStableIdHash;evidence.workerAssistantAnchor=!!receipt?.assistantStableIdHash;
  if(saved.tabId!==p.tabId || saved.sceneId!==p.sceneId || !MuseReceiptV2.valid(receipt,p.operationId) ||
    !receipt.userStableIdHash || receipt.assistantStableIdHash || receipt.userStableIdHash!==p.ownedUserHash)return failed('WORKER_RECEIPT_MISMATCH');
  let result;
  try{result=await chrome.tabs.sendMessage(p.tabId,{type:'viral-ai:muse-execution',command:'inspectGeneration',payload:{...p,ownedUserHash:receipt.userStableIdHash}});}
  catch{return failed('CONTENT_RECEIVER_UNAVAILABLE');}
  if(!result)return failed('CONTENT_RECEIVER_UNAVAILABLE');
  if(result.operationId!==p.operationId || result.sceneId!==p.sceneId || result.state!=='interrupted' ||
    !result.ownershipDiagnostic || Object.keys(result).some(k=>!['operationId','sceneId','state','ownershipDiagnostic'].includes(k)))return failed('CONTENT_DIAGNOSIS_REJECTED');
  return result;
}
async function executeV2(c) {
  const p=c.payload,key='generation-intent:'+p.operationId;
  const interrupted=()=>({operationId:p.operationId,sceneId:p.sceneId,state:'interrupted'});
  let saved=(await chrome.storage.local.get(key))[key];
  if(c.type==='prepareGeneration') {
    if(saved)return interrupted();
    // Reserve before talking to the page; even a lost prepare is not replayed.
    saved={tabId:p.tabId,sceneId:p.sceneId,version:2};
    await chrome.storage.local.set({[key]:saved});
  } else {
    if(!saved || saved.tabId!==p.tabId || saved.sceneId!==p.sceneId || !MuseReceiptV2.valid(saved.receipt,p.operationId))return interrupted();
    if(!MuseReceiptV2.extendsReceipt(p.receipt,saved.receipt) && !MuseReceiptV2.extendsReceipt(saved.receipt,p.receipt))return interrupted();
    if(c.type==='submitGeneration') {
      if(saved.localCancelled || saved.invoked || saved.receipt.userStableIdHash || p.receipt.userStableIdHash)return interrupted();
      saved={...saved,invoked:true};await chrome.storage.local.set({[key]:saved});
    } else if(!saved.receipt.userStableIdHash)return interrupted();
  }
  const receipt=saved.receipt;
  if(c.type==='acquireGenerationResult' && (saved.localCancelled || !receipt?.result || !MuseReceiptV2.transferRequest({...p,receipt})))return interrupted();
  const payload={...p,...(receipt?{receipt}:{}),observationToken:observationEpoch+'_'+(bridge?.serverId||'offline')};
  const result=await chrome.tabs.sendMessage(p.tabId,{type:'viral-ai:muse-execution',command:c.type,payload});
  if(result?.operationId!==p.operationId || result?.sceneId!==p.sceneId)return interrupted();
  if(c.type==='submitGeneration' && result.state==='interrupted' && result.invocation?.send==='invoked' && MuseReceiptV2.validAcceptanceDiagnostic(result.acceptanceDiagnostic)) {
    result.acceptanceDiagnostic={...result.acceptanceDiagnostic,workerBuild:WORKER_BUILD};
  }
  if(c.type==='acquireGenerationResult' && result.state==='result' && !MuseReceiptV2.transferResult(result,payload))return interrupted();
  if(['prepared','running','result'].includes(result.state)) {
    if(!MuseReceiptV2.valid(result.receipt,p.operationId) || receipt && !MuseReceiptV2.extendsReceipt(receipt,result.receipt))return interrupted();
    if(c.type==='prepareGeneration' ? result.state!=='prepared' || !!result.receipt.userStableIdHash : !result.receipt.userStableIdHash || result.state==='prepared')return interrupted();
    if(c.type==='submitGeneration' && (result.state!=='running' || result.receipt.assistantStableIdHash!==undefined))return interrupted();
    if(result.receipt.result && !receipt?.assistantStableIdHash)return interrupted();
    if(result.state==='result' && !result.receipt.result)return interrupted();
    // Worker durable before main receives; a lost reply can recover this exact
    // monotonic receipt without replaying submit or inventing a delta.
    const latest=(await chrome.storage.local.get(key))[key];
    saved={...saved,receipt:result.receipt,...(latest?.localCancelled?{localCancelled:true}:{})};await chrome.storage.local.set({[key]:saved});
  }
  return result;
}
