"use strict";
const PORTS=Array.from({length:11},(_,i)=>32147+i), MUSE_URL="https://muse.ai/";
let bridge=null, running=null, keepAlive=0;
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
    if(!response.ok)throw Error("UNAVAILABLE");
    return await response.json();
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
async function museTabs() {
  const tabs=await chrome.tabs.query({url:[MUSE_URL+"*"]});
  return Promise.all(tabs.slice(0,20).map(async tab=>{
    let status,timer;
    try {status=await Promise.race([chrome.tabs.sendMessage(tab.id,{type:"viral-ai:muse-status"}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("UNAVAILABLE")),1000);})]);} catch {} finally {clearTimeout(timer);}
    return {tabId:tab.id,url:MUSE_URL,composerReady:status?.composerReady===true,inspectionComplete:status?.inspectionComplete===true};
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
    const response=await request(b.port,"/v1/poll"+suffix,{token:b.token});
    if(response.command) {
      const c=response.command;let result=null,ok=false;
      if(typeof c.id!=="string" || c.id.length>80 || c.type!=="openMuse" || !c.payload || Object.keys(c.payload).some(k=>k!=="tabId"))throw Error("UNAVAILABLE");
      try {result=await openMuse(c.payload.tabId);ok=true;} catch {}
      await request(b.port,"/v1/result"+suffix,{token:b.token,body:{commandId:c.id,ok,result,error:null}});
    }
    return true;
  } catch {bridge=null;return false;}
}
function run() {
  if(running)return running;
  running=(async()=>{
    let failures=0;
    do {const ok=await poll();failures=ok?0:failures+1;
      if(!keepAlive && failures>=2)break;
      await new Promise(resolve=>setTimeout(resolve,ok?900:3000));
    } while(keepAlive || failures<2);
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
chrome.alarms.onAlarm.addListener(a=>{if(a.name==="viral-ai-muse-heartbeat")run();});
run();
