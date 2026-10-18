"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("vm"),fs=require("fs");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
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


test("extension states, explicit selection and Open Muse remain separate from generation in VI/EN",async()=>{
 for(const language of ["vi","en"]){
  const listeners={},focus=[];let sessionState="extension_offline",opens=0,selected=null,installed=0;
  const root={innerHTML:"",setAttribute(){},querySelector:selector=>({focus:()=>focus.push(selector)})};
  const provider={id:"muse",enabled:true,state:"unavailable",ready:false,messageCode:"GENERATION_NOT_IMPLEMENTED"};
  const session=()=>({id:"muse",state:sessionState,sessions:sessionState==="extension_offline"?[]:[{instanceId:"profile-one",profileLabel:"Work <script>",tabs:[{tabId:1,authState:sessionState}]}],selectedInstanceId:selected?.instanceId,selectedTabId:selected?.tabId});
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
  assert(root.innerHTML.includes(c.setup));
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
