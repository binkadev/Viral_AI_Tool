"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("vm"),fs=require("fs");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("production guidance describes the Chrome session and both AI-first and import entry paths",()=>{
  const c={window:{}};vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),c);
  for(const [locale,session,prompt,importVideo] of [
    ["vi",/đã đăng nhập/,/mô tả.*AI/,/hoặc nhập video có sẵn/],
    ["en",/signed-in/,/AI prompt/,/or import an existing video/]
  ]){
    const copy=c.window.I18N.messages[locale];
    for(const text of [copy.videoProviders.foundationNote,copy.videoProviders.extensionPopup.note]){
      assert.match(text,session);assert.match(text,/Chrome/);
      assert.doesNotMatch(text,/chưa sẵn sàng|chưa khả dụng|not ready|unavailable|does not enable/i);
    }
    assert.match(copy.aiCreate.noProjectsHint,prompt);
    assert.match(copy.aiCreate.noProjectsHint,importVideo);
    assert.doesNotMatch(copy.aiCreate.noProjectsHint,/Dự án có video nguồn|Projects with a source video|Import a video to get started/i);
    // Retained only for the defensive legacy provider messageCode contract.
    assert(copy.videoProviders.messages.GENERATION_NOT_IMPLEMENTED);
  }
});
test("Settings labels are bilingual and preserve the same status/message contract",()=>{
  const c={window:{}};vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),c);
  const {vi,en}=c.window.I18N.messages;
  for(const key of Object.keys(en.videoProviders)) assert(vi.videoProviders[key]);
  for(const group of ["states","messages"]) assert.deepEqual(Object.keys(vi.videoProviders[group]),Object.keys(en.videoProviders[group]));
  for(const state of ["unconfigured","checking","ready","authentication_required","unavailable","error"]) assert(en.videoProviders.states[state]&&vi.videoProviders.states[state]);
  assert.equal(vi.videoProviders.states.authentication_required,"Cần đăng nhập");
  assert(en.videoProviders.foundationNote.includes("existing Chrome profile"));
});
test("Settings uses native status, prevents duplicate checks, handles failures, and preserves focus",async()=>{
  const listeners={},calls=[],focus=[];
  let resolveCheck;
  const root={innerHTML:"",setAttribute(){},querySelector:selector=>({focus:()=>focus.push(selector)})};
  const context={
    state:{locale:"en",page:"settings"},document:{readyState:"complete",activeElement:null,
      getElementById:()=>root,addEventListener:(name,fn)=>listeners[name]=fn},
    window:{addEventListener(){},desktopAPI:{
      checkGenerationProvider:id=>{calls.push(["check",id]);return new Promise(resolve=>resolveCheck=resolve);},
      configureGenerationProvider:async config=>{calls.push(["configure",config]);return {ok:true,value:{id:"muse",enabled:config.enabled,state:"authentication_required",ready:false,messageCode:"AUTHENTICATION_NOT_CONNECTED"}};}
    }}
  };
  vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),context);
  vm.runInNewContext(fs.readFileSync("renderer/core-video-provider-settings.js","utf8"),context);
  assert(root.innerHTML.includes("Checking"));
  const click=()=>listeners.click({target:{closest:selector=>selector==="[data-video-provider-check]"?{}:null}});
  click();assert.equal(calls.length,1);
  resolveCheck({ok:true,value:{id:"muse",enabled:false,state:"unconfigured",ready:false,messageCode:"NOT_CONFIGURED"}});await tick();
  assert(root.innerHTML.includes("Not connected"));
  listeners.change({target:{matches:()=>true,checked:true}});await tick();
  assert(root.innerHTML.includes("Authentication not connected"));
  assert(root.innerHTML.includes(" checked"));
  assert(focus.includes("[data-video-provider-enable]"));
  click();resolveCheck({ok:false,errorCode:"secret"});await tick();
  assert(root.innerHTML.includes('role="alert"'));assert(!root.innerHTML.includes("secret"));
  assert(focus.includes("[data-video-provider-check]"));
  const source=fs.readFileSync("renderer/core-video-provider-settings.js","utf8");
  for(const forbidden of ["localStorage","setInterval","setTimeout","submitGeneration"]) assert(!source.includes(forbidden));
  const markup=context.window.ViralVideoProviderSettings.html();
  assert(markup.includes('aria-labelledby="video-providers-title"'));
});
test("ready status does not render the not-configured fallback message",async()=>{
  const root={innerHTML:"",setAttribute(){},querySelector:()=>null};
  const context={
    state:{locale:"en",page:"settings"},
    document:{readyState:"complete",activeElement:null,getElementById:()=>root,addEventListener(){}},
    window:{addEventListener(){},desktopAPI:{
      checkGenerationProvider:async()=>({ok:true,value:{id:"muse",enabled:true,state:"ready",ready:true}}),
      configureGenerationProvider:async()=>({ok:false,errorCode:"UNAVAILABLE"})
    }}
  };
  vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),context);
  vm.runInNewContext(fs.readFileSync("renderer/core-video-provider-settings.js","utf8"),context);
  await tick();
  const copy=context.window.I18N.messages.en.videoProviders;
  assert(root.innerHTML.includes(copy.states.ready));
  assert(!root.innerHTML.includes(copy.messages.NOT_CONFIGURED));
});

test('runtime support block is development-only, bilingual, read-only, and handles duplicate checks and failure',async()=>{
 for(const locale of ['vi','en'])for(const enabled of [false,true]){
   const listeners={},focus=[],calls=[];let complete;
   const root={innerHTML:'',setAttribute(){},querySelector:selector=>({focus:()=>focus.push(selector)})};
   const report={readyForControlledE2E:true,expected:{extensionVersion:'0.3.8',workerBuild:'muse-worker-current',contentBuild:'muse-content-current'},runtime:{workerBuild:'muse-worker-current',contentBuild:'muse-content-current',heartbeatFresh:true,authenticated:true,composerReady:true},mismatches:[]};
   const context={state:{locale,page:'settings'},document:{readyState:'complete',activeElement:null,getElementById:()=>root,addEventListener:(name,fn)=>listeners[name]=fn},window:{addEventListener(){},desktopAPI:{
     checkGenerationProvider:async()=>{calls.push('provider');return {ok:true,value:{id:'muse',enabled:true,ready:true,state:'ready'}};},
     diagnoseGenerationProviderRuntime:async id=>{assert.equal(id,'muse');calls.push('diagnose');return enabled?{ok:true,value:report}:{ok:false,errorCode:'UNAVAILABLE'};}
   }}};
   vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),context);
   vm.runInNewContext(fs.readFileSync('renderer/core-video-provider-settings.js','utf8'),context);await tick();
   const c=context.window.I18N.messages[locale].videoProviders.runtimeDiagnostic;
   assert.equal(root.innerHTML.includes('data-muse-runtime-diagnostic'),enabled);
   if(!enabled){assert(!root.innerHTML.includes('muse-worker-current'));continue;}
   assert(root.innerHTML.includes(c.ready));assert(root.innerHTML.includes(c.details));assert(root.innerHTML.includes('muse-content-current'));
   assert(!root.innerHTML.includes('undefined'));assert(root.innerHTML.includes('white-space:pre-wrap'));
   calls.length=0;
   context.window.desktopAPI.diagnoseGenerationProviderRuntime=()=>{calls.push('diagnose');return new Promise(resolve=>complete=resolve);};
   const click=()=>listeners.click({target:{closest:selector=>selector==='[data-video-provider-diagnose]'?{}:null}});
   click();click();assert.deepEqual(calls,['diagnose']);assert(root.innerHTML.includes(c.checking));assert(!root.innerHTML.includes('muse-worker-current'));
   complete({ok:false,errorCode:'UNAVAILABLE'});await tick();assert(root.innerHTML.includes(c.unavailable));assert(!root.innerHTML.includes('muse-worker-current'));
   assert(focus.includes('[data-video-provider-diagnose]'));
   context.window.desktopAPI.diagnoseGenerationProviderRuntime=async()=>({ok:true,value:{...report,readyForControlledE2E:false,runtime:{...report.runtime,contentBuild:null}}});
   click();await tick();assert(root.innerHTML.includes(c.notReady));assert(root.innerHTML.includes(c.unproven));
   assert.deepEqual(calls,['diagnose']);
 }
});

test('ownership support view is dev-only, reads one explicit job, prevents duplicates and only copies sanitized diagnosis',async()=>{
 for(const locale of ['vi','en'])for(const enabled of [true,false]){
   const listeners={},calls=[],focus=[];let complete,copied;
   const input={value:'existing-job'},root={innerHTML:'',setAttribute(){},querySelector:s=>s==='[data-video-provider-ownership-id]'?input:s==='[data-video-provider-ownership-support]'?{open:true}:{focus:()=>focus.push(s)}};
   const report={operationId:'existing-job',userStableIdHash:'a'.repeat(64),diagnostic:{receiptAvailable:true,ownedUserMatches:1,rows:[]}};
   const context={state:{locale,page:'settings'},navigator:{clipboard:{writeText:async text=>copied=text}},document:{readyState:'complete',activeElement:null,getElementById:()=>root,addEventListener:(n,fn)=>listeners[n]=fn},window:{addEventListener(){},desktopAPI:{
     checkGenerationProvider:async()=>({ok:true,value:{id:'muse',ready:true,state:'ready'}}),
     diagnoseGenerationProviderRuntime:async()=>enabled?{ok:true,value:{expected:{},runtime:{},readyForControlledE2E:false}}:{ok:false,errorCode:'UNAVAILABLE'},
     diagnoseMuseOwnership:id=>{calls.push(id);return new Promise(resolve=>complete=resolve);}
   }}};
   vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),context);vm.runInNewContext(fs.readFileSync('renderer/core-video-provider-settings.js','utf8'),context);await tick();
   const c=context.window.I18N.messages[locale].videoProviders.runtimeDiagnostic;
   assert.equal(root.innerHTML.includes('data-video-provider-ownership-support'),enabled);
   const click=action=>listeners.click({target:{closest:s=>s==='[data-video-provider-ownership-'+action+']'?{}:null}});
   if(!enabled){click('read');assert.deepEqual(calls,[]);continue;}
   assert(root.innerHTML.includes(c.ownershipTitle));assert(root.innerHTML.includes(c.ownershipHint));assert(!root.innerHTML.includes('undefined'));
   click('read');click('read');assert.deepEqual(calls,['existing-job']);assert(root.innerHTML.includes(c.checking));
   complete({ok:true,value:report});await tick();assert(root.innerHTML.includes('ownedUserMatches'));assert(root.innerHTML.includes('data-video-provider-ownership-support open'));
   click('copy');await tick();assert.deepEqual(JSON.parse(copied),report);assert(root.innerHTML.includes(c.traceCopied));
   assert(focus.includes('[data-video-provider-ownership-read]'));assert(focus.includes('[data-video-provider-ownership-copy]'));
   input.value='../bad';click('read');assert.deepEqual(calls,['existing-job']);assert(root.innerHTML.includes(c.ownershipUnavailable));assert(!root.innerHTML.includes('ownedUserMatches'));
   input.value='existing-job';click('read');complete({ok:false,errorCode:'private error'});await tick();assert(root.innerHTML.includes(c.ownershipReasons.UNAVAILABLE));assert(!root.innerHTML.includes('private error'));
   for(const reason of require('../extensions/meta-muse-bridge/receipt-v2').ownershipFailureReasons){
     click('read');complete({ok:true,value:{ok:false,reason,instanceMatch:true,tabMatch:true}});await tick();
     assert(root.innerHTML.includes(c.ownershipReasons[reason]));assert(root.innerHTML.includes('data-video-provider-ownership-copy'));click('copy');await tick();assert.equal(JSON.parse(copied).reason,reason);
   }
 }
});

test('support trace view reads an explicit job, preserves focus and copies sanitized JSON without execution',async()=>{
 for(const locale of ['vi','en']){
   const listeners={},calls=[],focus=[];let complete,copied;
   const input={value:'job-1'},root={innerHTML:'',setAttribute(){},querySelector:s=>s==='[data-video-provider-trace-id]'?input:s==='[data-video-provider-trace-support]'?{open:true}:{focus:()=>focus.push(s)}};
   const trace=require('./fixtures/muse-acceptance-replay').cases[6].trace,report={operationId:'job-1',trace};
   const context={state:{locale,page:'settings'},navigator:{clipboard:{writeText:async text=>copied=text}},document:{readyState:'complete',activeElement:null,getElementById:()=>root,addEventListener:(n,fn)=>listeners[n]=fn},window:{addEventListener(){},desktopAPI:{
     checkGenerationProvider:async()=>({ok:true,value:{id:'muse',ready:true,state:'ready'}}),
     diagnoseGenerationProviderRuntime:async()=>({ok:true,value:{expected:{workerBuild:'current',contentBuild:'current'},runtime:{},readyForControlledE2E:false}}),
     getGenerationAcceptanceTrace:id=>{calls.push(id);return new Promise(resolve=>complete=resolve);}
   }}};
   vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),context);vm.runInNewContext(fs.readFileSync('renderer/core-video-provider-settings.js','utf8'),context);await tick();
   const c=context.window.I18N.messages[locale].videoProviders.runtimeDiagnostic;
   const click=action=>listeners.click({target:{closest:s=>s==='[data-video-provider-trace-'+action+']'?{}:null}});
   click('read');click('read');assert.deepEqual(calls,['job-1']);complete({ok:true,value:report});await tick();
   assert(root.innerHTML.includes('data-video-provider-trace-support open'));assert(root.innerHTML.includes(c.traceCopy));assert(root.innerHTML.includes('baselineValid'));
   assert(focus.includes('[data-video-provider-trace-read]'));
   click('copy');await tick();assert.deepEqual(JSON.parse(copied),report);assert(root.innerHTML.includes(c.traceCopied));
   context.navigator.clipboard.writeText=async()=>{throw Error('private error');};click('copy');await tick();assert(root.innerHTML.includes(c.traceCopyFailed));assert(!root.innerHTML.includes('private error'));
   input.value='../invalid';click('read');await tick();assert.deepEqual(calls,['job-1']);assert(root.innerHTML.includes(c.traceUnavailable));assert(!root.innerHTML.includes('baselineValid'));
 }
});


test("extension states, explicit selection and Open Muse remain separate from generation in VI/EN",async()=>{
 for(const language of ["vi","en"]){
  const listeners={},focus=[];let sessionState="extension_offline",opens=0,selected=null,installed=0;
  const root={innerHTML:"",setAttribute(){},querySelector:selector=>({focus:()=>focus.push(selector)})};
  const provider={id:"muse",enabled:true,state:"unavailable",ready:false,messageCode:"GENERATION_NOT_IMPLEMENTED"};
  const session=()=>({id:"muse",extensionState:sessionState==="extension_offline"?"extension_install_required":"extension_connected",state:sessionState,sessions:sessionState==="extension_offline"?[]:[{instanceId:"profile-one",profileLabel:"Work <script>",tabs:[{tabId:1,authState:sessionState}]}],selectedInstanceId:selected?.instanceId,selectedTabId:selected?.tabId});
  const context={state:{locale:language,page:"settings"},
   document:{readyState:"complete",activeElement:null,getElementById:()=>root,addEventListener:(name,fn)=>listeners[name]=fn},
   window:{addEventListener(){},desktopAPI:{
    checkGenerationProvider:async()=>({ok:true,value:provider}),
    checkGenerationProviderSession:async()=>({ok:true,value:session()}),
    openGenerationProviderSession:async id=>{assert.equal(id,"muse");opens++;return {ok:true,value:session()};},
    selectGenerationProviderSession:async value=>{selected=value;sessionState="authenticated";return {ok:true,value:session()};},
    revealGenerationProviderExtension:async()=>{installed++;return {ok:true,value:{id:"muse",installed:true}};}
   }}};
  vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),context);
  vm.runInNewContext(fs.readFileSync("renderer/core-video-provider-settings.js","utf8"),context);
  await tick();const c=context.window.I18N.messages[language].videoProviders;
  assert(root.innerHTML.includes(c.manualSteps));
  assert(root.innerHTML.includes(c.storeUnavailable));
  assert(root.innerHTML.includes(c.installExtension));
  const click=kind=>listeners.click({target:{closest:selector=>selector==='[data-video-provider-'+kind+']'?{}:null}});
  click("setup");await tick();assert.equal(installed,1);
  for(const next of ["muse_tab_missing","selection_required","authentication_required","authenticated","unknown"]){
   sessionState=next;click("check");await tick();assert(root.innerHTML.includes(c.sessionStates[next]));
   assert(!root.innerHTML.includes('data-provider-state="ready"'));assert(root.innerHTML.includes(c.messages.GENERATION_NOT_IMPLEMENTED));
  }
  listeners.change({target:{matches:s=>s==='[data-video-provider-session]',value:JSON.stringify({instanceId:"profile-one",tabId:1})}});await tick();
  assert.equal(selected.instanceId,"profile-one");assert.equal(selected.tabId,1);assert(focus.includes("[data-video-provider-session]"));
  assert(!root.innerHTML.includes("Work <script>"));assert(root.innerHTML.includes("Work &lt;script&gt;"));
  click("open");click("open");await tick();assert.equal(opens,1);
  for(const forbidden of ["DevTools","CDP","127.0.0.1","user-data-dir"])assert(!root.innerHTML.includes(forbidden));
 }
});
