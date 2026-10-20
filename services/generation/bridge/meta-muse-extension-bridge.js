"use strict";
// Readiness-only adaptation of feat/meta-muse-extension-bridge. No browser process access.
const {configuration, compatibility} = require("./extension-distribution");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {failure} = require("../generation-job");
const {validPayload, validResult} = require("./execution-contract");
const {validDiagnostic,validRuntimeBuild}=require('./connection-diagnostics');
const {readBundle,matches,stageBundle,identity:bundleIdentity}=require('./extension-bundle');
const {sanitizeSession, instanceId, tabId, label} = require("./session-status");
const PORT_START = 32147, PORT_END = 32157, SESSION_TTL_MS = 12000;
const validOrigin = origin => /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(k => keys.includes(k));
const text = (value, max) => typeof value === "string" && value.length <= max;
function museUrl(value) {try {const u=new URL(value);return u.origin === "https://muse.ai" && !u.username && !u.password;} catch {return false;}}
function check(ok) {if(!ok) throw failure("INVALID_REQUEST");}
async function body(req) {
  check(req.headers["content-type"]?.split(";")[0] === "application/json");
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;check(size<=300000);chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {throw failure("INVALID_REQUEST");}
}
class MetaMuseExtensionBridge {
  constructor({userDataPath, extensionSourceDir, shell, now=Date.now, commandTimeoutMs=10000, distribution, developmentDiagnostics=false}) {
    if(!path.isAbsolute(userDataPath)) throw failure("PROVIDER_CONFIG_ERROR");
    this.distribution=configuration(distribution);
    this.developmentDiagnostics=developmentDiagnostics===true;this.evidenceExpired=false;
    this.root=userDataPath;this.source=extensionSourceDir;this.shell=shell;this.now=now;this.commandTimeoutMs=commandTimeoutMs;
    this.selectionFile=path.join(userDataPath,"meta-muse-extension-selection.json");
    this.installDir=path.join(userDataPath,"meta-muse-extension");
    this.serverId=crypto.randomUUID();this.sessions=new Map();this.pending=new Map();
    this.selectedInstanceId=null;this.selectedTabId=null;this.server=null;this.port=0;this.starting=null;this.stopped=false;
  }
  start() {
    if(this.stopped) return Promise.reject(failure("UNAVAILABLE"));
    if(this.server) return Promise.resolve();
    if(!this.starting) this.starting=this.startNow().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async startNow() {
    try {
      const stat=fs.lstatSync(this.selectionFile);
      if(!stat.isSymbolicLink() && stat.isFile() && stat.size<512) {
        const saved=JSON.parse(fs.readFileSync(this.selectionFile,"utf8"));
        if(exact(saved,["instanceId"]) && instanceId(saved.instanceId)) this.selectedInstanceId=saved.instanceId;
      }
    } catch {}
    for(let port=PORT_START;port<=PORT_END && !this.stopped;port++) {
      const server=http.createServer({maxHeaderSize:8192},(req,res)=>{
        req.setTimeout(3000,()=>req.destroy());
        this.handle(req,res).catch(()=>this.reply(res,400,{ok:false,error:"invalid-request"}));
      });
      server.requestTimeout=4000;server.headersTimeout=4000;server.keepAliveTimeout=1000;server.maxConnections=32;
      try {
        await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
        if(this.stopped){server.close();throw failure("UNAVAILABLE");}
        this.server=server;this.port=port;return;
      } catch(error) {server.close();if(error.code!=="EADDRINUSE") throw failure("UNAVAILABLE");}
    }
    throw failure("UNAVAILABLE");
  }
  reply(res,code,value) {if(res.destroyed||res.writableEnded)return;res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(value));}
  prune() {
    for(const [id,s] of this.sessions) if(this.now()-s.lastSeen>SESSION_TTL_MS) {
      this.sessions.delete(id);this.finish(id,false);
      this.evidenceExpired=true;
    }
  }
  finish(instance,ok,result) {
    const pending=this.pending.get(instance);if(!pending)return;
    this.pending.delete(instance);clearTimeout(pending.timer);
    ok ? pending.resolve(result) : pending.reject(failure("PROVIDER_UNAVAILABLE"));
  }
  async handle(req,res) {
    const origin=String(req.headers.origin||"");
    if(req.socket.remoteAddress!=="127.0.0.1" || req.headers.host!=="127.0.0.1:"+this.port || (origin ? (!validOrigin(origin) || (this.distribution.distributionMode==="production" && this.distribution.chromeWebStoreExtensionId && origin!=="chrome-extension://"+this.distribution.chromeWebStoreExtensionId)) : req.method!=="GET")) return this.reply(res,403,{ok:false,error:"forbidden"});
    if(origin)res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");
    if(req.method==="OPTIONS") {
      res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Viral-Muse-Token, Cache-Control");
      res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");return this.reply(res,204,{});
    }
    check(typeof req.url==="string" && req.url.length<512 && req.url.startsWith("/v1/"));
    const url=new URL(req.url,"http://127.0.0.1");this.prune();
    if(req.method==="GET" && url.pathname==="/v1/ping") return this.reply(res,200,{ok:true,bridge:"meta-muse-extension",serverId:this.serverId});
    if(req.method==="POST" && url.pathname==="/v1/register") {
      const b=await body(req);
      check(exact(b,["instanceId","profileLabel","browserName","extensionVersion","protocolVersion"]) && instanceId(b.instanceId) && text(b.profileLabel,120) && b.browserName==="Chrome" && text(b.extensionVersion,40));
      const old=this.sessions.get(b.instanceId);
      if(old && (old.origin!==origin || req.headers["x-viral-muse-token"]!==old.token)) return this.reply(res,409,{ok:false,error:"instance-in-use"});
      check(old || this.sessions.size<16);this.finish(b.instanceId,false);
      const token=crypto.randomBytes(32).toString("hex");
      this.sessions.set(b.instanceId,{instanceId:b.instanceId,profileLabel:label(b.profileLabel),extensionState:compatibility(b.extensionVersion,b.protocolVersion,this.distribution),token,origin,tabs:[],lastSeen:this.now()});
      return this.reply(res,200,{ok:true,token,serverId:this.serverId,pollIntervalMs:900});
    }
    check([...url.searchParams.keys()].every(k=>k==="instanceId") && url.searchParams.getAll("instanceId").length===1);
    const s=this.sessions.get(url.searchParams.get("instanceId"));
    const token=req.headers["x-viral-muse-token"];
    if(!s || (origin && s.origin!==origin) || typeof token!=="string" || token.length!==s.token.length || !crypto.timingSafeEqual(Buffer.from(token),Buffer.from(s.token))) return this.reply(res,401,{ok:false,error:"session-required"});
    if(req.method==="POST" && url.pathname==="/v1/heartbeat") {
      const b=await body(req);
      check(exact(b,["profileLabel","browserName","tabs"]) && text(b.profileLabel,120) && b.browserName==="Chrome" && Array.isArray(b.tabs) && b.tabs.length<=20);
      const ids=new Set();
      const tabs=b.tabs.map(t=>{
        // Legacy 0.1.0 metadata is bounded then discarded, never stored or returned.
        check(exact(t,["tabId","url","title","loggedIn","composerReady","accountLabel","inspectionComplete","executionContract","canSubmit","devEvidence","devConnection","ownershipReceiptVersion","runtimeBuild"]) && tabId(t.tabId) && !ids.has(t.tabId) && text(t.url,3000) && museUrl(t.url) && typeof t.composerReady==="boolean");
        if(t.devConnection!==undefined)check(validDiagnostic(t.devConnection));
        if(t.runtimeBuild!==undefined)check(validRuntimeBuild(t.runtimeBuild));
        check(t.canSubmit===undefined || typeof t.canSubmit==='boolean');
        if(this.developmentDiagnostics && t.devEvidence && exact(t.devEvidence,['root','editor','actionSlot','actionableButtons','composerEmpty','generationActive','userMessageCount','assistantMessageCount','messageIdentityValid','assistantVideoPresent']) && Object.values(t.devEvidence).every(v=>typeof v==='boolean' || (Number.isInteger(v)&&v>=0&&v<=128)))this.devEvidence=t.devEvidence;
        check(t.executionContract===undefined || t.executionContract===null || [1,2,3].includes(t.executionContract));
        for(const key of ["title","accountLabel"]) check(t[key]===undefined || text(t[key],240));
        check(t.loggedIn===undefined || typeof t.loggedIn==="boolean");
        check(t.inspectionComplete===undefined || typeof t.inspectionComplete==="boolean");ids.add(t.tabId);
        return {ownershipReceiptVersion:t.ownershipReceiptVersion===2?2:null,tabId:t.tabId,canSubmit:t.canSubmit===true,executionContract:t.executionContract===3?3:null,
          ...(t.runtimeBuild?{runtimeBuild:t.runtimeBuild}:{}),authState:t.inspectionComplete===false ? "unknown" : t.composerReady ? "authenticated" : "authentication_required",...(this.developmentDiagnostics && t.devConnection?{diagnostic:t.devConnection,generationActive:typeof t.devEvidence?.generationActive==='boolean'?t.devEvidence.generationActive:null}:{})};
      });
      s.tabs=tabs;s.profileLabel=label(b.profileLabel);s.lastSeen=this.now();s.heartbeatSeen=true;this.evidenceExpired=false;
      return this.reply(res,200,{ok:true});
    }
    if(req.method==="GET" && url.pathname==="/v1/poll") {
      if(s.extensionState!=="extension_connected") return this.reply(res,200,{ok:true,command:null});
      const p=this.pending.get(s.instanceId);
      const command=p&&!p.sent ? {id:p.id,type:p.type || "openMuse",payload:p.payload || (p.tabId?{tabId:p.tabId}:{})} : null;
      if(command)p.sent=true;
      return this.reply(res,200,{ok:true,command});
    }
    if(req.method==="POST" && url.pathname==="/v1/result") {
      const b=await body(req);
      check(exact(b,["commandId","ok","result","error"]) && text(b.commandId,80) && typeof b.ok==="boolean");
      const p=this.pending.get(s.instanceId);check(p && p.sent && p.id===b.commandId);
      check(p.type ? (b.ok ? validResult(p.type,b.result,p.payload) : b.result==null) : b.result==null || (exact(b.result,["tabId","url"]) && tabId(b.result.tabId) && (b.result.url===undefined || (text(b.result.url,3000)&&museUrl(b.result.url)))));
      check(b.error==null || (exact(b.error,["code","message"]) && text(b.error.code,80) && text(b.error.message,800)));
      this.finish(s.instanceId,b.ok,b.result);return this.reply(res,200,{ok:true});
    }
    return this.reply(res,404,{ok:false,error:"unsupported"});
  }
  snapshot() {
    this.prune();const sessions=[...this.sessions.values()];
    let selected=sessions.find(s=>s.instanceId===this.selectedInstanceId);
    // A remembered but absent profile must never silently fall back to another.
    if(!selected && !this.selectedInstanceId && sessions.length===1)selected=sessions[0];
    let tab=selected?.tabs.find(t=>t.tabId===this.selectedTabId);
    if(!tab && selected?.tabs.length===1)tab=selected.tabs[0];
    const extensionState=this.stagingFailed?'extension_error':(selected || sessions.find(s=>s.extensionState!=="extension_connected"))?.extensionState || (sessions.length ? "extension_connected" : "extension_install_required");
    const state=extensionState!=="extension_connected"?"extension_offline":!sessions.length?"extension_offline":!selected?"selection_required":!selected.tabs.length?"muse_tab_missing":!tab?"selection_required":tab.authState;
    return sanitizeSession({state,extensionState,storeConfigured:this.distribution.storeConfigured,sessions,selectedInstanceId:selected?.instanceId || this.selectedInstanceId,selectedTabId:tab?.tabId});
  }
  async check() {await this.start();return this.snapshot();}
  connectionDiagnosis() {
    if(!this.developmentDiagnostics)throw failure('UNAVAILABLE');
    const state=this.snapshot(),s=this.sessions.get(state.selectedInstanceId),tab=s?.tabs.find(t=>t.tabId===state.selectedTabId),d=tab?.diagnostic;
    let reason='READY';
    if(!s)reason=this.evidenceExpired?'BRIDGE_HEARTBEAT_EXPIRED':this.selectedInstanceId?'SELECTED_INSTANCE_MISSING':'INSTANCE_MISSING';
    else if(!s.heartbeatSeen)reason='HEARTBEAT_MISSING';
    else if(!tab)reason=s.tabs.length?'TAB_SELECTION_REQUIRED':'MUSE_TAB_MISSING';
    else if(!d)reason='DIAGNOSTICS_UNAVAILABLE';
    else if(d.lastContentScriptErrorCode!=='NONE')reason=d.lastContentScriptErrorCode;
    else if(!d.museContentScriptHeartbeatSeen)reason='CONTENT_EVIDENCE_MISSING';
    else if(d.museTabEvidenceAgeBucket==='stale')reason='CONTENT_EVIDENCE_STALE';
    else if(d.museContentScriptContractVersion!==3)reason='CONTRACT_INCOMPATIBLE';
    else if(!d.museTabEvidenceFresh)reason='CONTENT_TIMESTAMP_MISSING';
    else if(tab.executionContract!==3)reason='STATUS_CONTRACT_MISSING';
    else if(tab.authState!=='authenticated')reason='COMPOSER_UNREADY';
    return {extensionInstanceRegistered:!!s,localhostBridgeConnected:!!s?.heartbeatSeen,registrationCompatible:s?.extensionState==='extension_connected',reason,...(d||{})};
  }
  receiverDiagnosis() {
    if(!this.developmentDiagnostics)throw failure('UNAVAILABLE');
    const selected=this.snapshot(),sessions=[...this.sessions.values()];
    const receivers=sessions.flatMap((s,sessionIndex)=>s.tabs.map((t,receiverIndex)=>{
      const d=t.diagnostic;
      return {sessionIndex,receiverIndex,selected:s.instanceId===selected.selectedInstanceId && t.tabId===selected.selectedTabId,
        reachable:!!d && (d.museContentScriptHandshakeSeen || d.museContentScriptHeartbeatSeen),
        contract:d?.museContentScriptContractVersion??null,workerBuild:d?.workerBuild||'unreported',contentBuild:d?.contentBuild||'unreported',
        freshness:d?.museTabEvidenceAgeBucket||'absent',authenticated:d?.authenticatedEvidencePresent===true,composerDetected:d?.composerDetected===true,generationActive:d?.generationActive??t.generationActive??null};
    }));
    return {selectionState:selected.state,selectionReason:selected.state==='selection_required'?'AMBIGUOUS':receivers.some(r=>r.selected)?'EXISTING_SELECTION_OR_SOLE_TAB':'NO_SELECTED_RECEIVER',
      enumerationMayBeTruncated:sessions.some(s=>s.tabs.length===20),receivers};
  }
  async executionReady() {
    await this.start();const state=this.snapshot();
    const session=this.sessions.get(state.selectedInstanceId);
    const tab=session?.tabs.find(t=>t.tabId===state.selectedTabId);
    return state.extensionState==="extension_connected" && state.state==="authenticated" && tab?.executionContract===3 && tab.canSubmit===true &&
      (!this.source || this.stagedBundleVerified()) && (!this.developmentDiagnostics || this.runtimeBuildPreflight().ready);
  }
  stagedBundleVerified() {
    try{return matches(this.installDir,readBundle(this.source,this.distribution));}catch{return false;}
  }
  runtimeBuildPreflight() {
    if(!this.developmentDiagnostics)throw failure('UNAVAILABLE');
    const selected=this.snapshot(),s=this.sessions.get(selected.selectedInstanceId),tab=s?.tabs.find(t=>t.tabId===selected.selectedTabId),d=tab?.diagnostic;
    const expected=this.distribution,build=tab?.runtimeBuild||d;
    let sourceBuild=null;
    try{sourceBuild=readBundle(this.source,expected).summary;}catch{}
    let reason='READY';
    if(selected.extensionState!=='extension_connected' || selected.state!=='authenticated' || !s?.heartbeatSeen || tab?.executionContract!==3 || tab?.ownershipReceiptVersion!==2 || !tab?.canSubmit)reason='SESSION_UNREADY';
    else if(!build || (d && (!d.museTabEvidenceFresh || !d.museContentScriptHandshakeSeen || d.lastContentScriptErrorCode!=='NONE' || d.lastBridgeErrorCode!=='NONE')) || !build.workerBuild || !build.contentBuild || build.contentBuild==='unreported')reason='BUILD_EVIDENCE_MISSING';
    else if(build.workerBuild!==expected.expectedWorkerBuild)reason='WORKER_BUILD_MISMATCH';
    else if(build.contentBuild!==expected.expectedContentBuild)reason='CONTENT_BUILD_MISMATCH';
    else if(!sourceBuild || !this.stagedBundleVerified())reason='STAGING_UNVERIFIED';
    return {ready:reason==='READY',reason,sourceBuild,stagedBuild:bundleIdentity(this.installDir),stagedBundleVerified:this.stagedBundleVerified(),expectedWorkerBuild:expected.expectedWorkerBuild,expectedContentBuild:expected.expectedContentBuild,
      executingWorkerBuild:build?.workerBuild||'unreported',executingContentBuild:build?.contentBuild||'unreported'};
  }
  async executionTarget() {
    if(!await this.executionReady())throw failure("PROVIDER_UNAVAILABLE");
    const s=this.snapshot();return {instanceId:s.selectedInstanceId,tabId:s.selectedTabId};
  }
  async receiptV2Ready() {
    if(!await this.executionReady())return false;
    const s=this.snapshot();return this.sessions.get(s.selectedInstanceId)?.tabs.find(t=>t.tabId===s.selectedTabId)?.ownershipReceiptVersion===2;
  }
  async command(type,payload,target) {
    if((payload?.diagnoseAcquisition!==undefined || payload?.diagnoseOwnership!==undefined) && !this.developmentDiagnostics)throw failure('INVALID_REQUEST');
    await this.start();this.prune();
    const s=this.sessions.get(target?.instanceId),tab=s?.tabs.find(t=>t.tabId===target?.tabId);
    check(validPayload(type,payload) && payload.tabId===target?.tabId);
    if(this.stagingFailed || (this.source && !this.stagedBundleVerified()) || s?.extensionState!=="extension_connected" || tab?.authState!=="authenticated" || tab.executionContract!==3 || this.pending.has(s.instanceId))throw failure("PROVIDER_UNAVAILABLE");
    let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});
    const timer=setTimeout(()=>this.finish(s.instanceId,false),type==='acquireGenerationResult'?70000:this.commandTimeoutMs);
    this.pending.set(s.instanceId,{id:crypto.randomUUID(),type,payload,promise,resolve,reject,timer,sent:false});
    return promise;
  }
  async selectSession(selection) {
    check(exact(selection,["instanceId","tabId"]) && instanceId(selection.instanceId) && (selection.tabId===null || tabId(selection.tabId)));
    await this.start();this.prune();const s=this.sessions.get(selection.instanceId);
    check(s && (selection.tabId===null ? s.tabs.length===0 : s.tabs.some(t=>t.tabId===selection.tabId)));
    const temp=this.selectionFile+"."+crypto.randomUUID()+".tmp";
    try {fs.mkdirSync(this.root,{recursive:true});fs.writeFileSync(temp,JSON.stringify({instanceId:s.instanceId}),{flag:"wx",mode:0o600});fs.renameSync(temp,this.selectionFile);}
    catch {throw failure("PROVIDER_CONFIG_ERROR");}
    finally {try{fs.unlinkSync(temp);}catch{}}
    this.selectedInstanceId=s.instanceId;this.selectedTabId=selection.tabId;return this.snapshot();
  }
  async open() {
    await this.start();const state=this.snapshot();
    if(["extension_offline","selection_required"].includes(state.state))throw failure("PROVIDER_UNAVAILABLE");
    const id=state.selectedInstanceId;
    if(!this.pending.has(id)) {
      let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});
      const timer=setTimeout(()=>this.finish(id,false),this.commandTimeoutMs);
      this.pending.set(id,{id:crypto.randomUUID(),tabId:state.selectedTabId,promise,resolve,reject,timer,sent:false});
    }
    await this.pending.get(id).promise;return this.snapshot();
  }
  async openStore() {
    if(!this.distribution.storeConfigured || !this.shell?.openExternal) throw failure("PROVIDER_CONFIG_ERROR");
    if(!this.storeOpening) this.storeOpening=Promise.resolve().then(()=>this.shell.openExternal(this.distribution.chromeWebStoreUrl)).finally(()=>{this.storeOpening=null;});
    await this.storeOpening;return {id:"muse",opened:true};
  }
  async revealExtension() {
    check(typeof this.source==="string");
    let summary;
    try {
      summary=stageBundle(this.source,this.installDir,this.distribution);this.stagingFailed=false;
    } catch(error) {this.stagingFailed=true;throw error;}
    this.shell?.showItemInFolder(path.join(this.installDir,"manifest.json"));
    return {id:"muse",folderRevealed:true,extensionVersion:summary.extensionVersion,bundleVerified:summary.bundleVerified};
  }
  close() {
    this.stopped=true;for(const id of this.pending.keys())this.finish(id,false);
    this.sessions.clear();this.server?.close();this.server?.closeAllConnections();this.server=null;this.port=0;
  }
}
module.exports={MetaMuseExtensionBridge,PORT_START,PORT_END,SESSION_TTL_MS};
