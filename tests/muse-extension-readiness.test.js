"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm');
const {MetaMuseExtensionBridge,PORT_START,PORT_END,SESSION_TTL_MS}=require('../services/generation/bridge/meta-muse-extension-bridge');
const {sanitizeSession}=require('../services/generation/bridge/session-status');
const {ProviderRegistry}=require('../services/generation/provider-registry');
const {createMuseProvider}=require('../services/generation/providers/muse-provider');
const {GenerationService}=require('../services/generation/generation-service');
const {registerGenerationIpc}=require('../services/generation/generation-ipc');
const origin='chrome-extension://'+'a'.repeat(32),otherOrigin='chrome-extension://'+'b'.repeat(32);
async function fixture(t,options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-extension-test-'));let now=1000;
 const bridge=new MetaMuseExtensionBridge({userDataPath:root,now:()=>now,commandTimeoutMs:40,...options});
 t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});await bridge.start();
 async function request(route,{method='GET',body,token,requestOrigin=origin,host,raw}={}) {
  return new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port:bridge.port,path:route,method,headers:{...(requestOrigin?{Origin:requestOrigin}:{}),...(host?{Host:host}:{}),...(token?{'X-Viral-Muse-Token':token}:{}),...(body!==undefined||raw?{'Content-Type':'application/json'}:{})}},res=>{
    let data='';res.on('data',d=>data+=d);res.on('end',()=>{let value;try{value=JSON.parse(data)}catch{}resolve({status:res.statusCode,value});});
   });req.on('error',reject);req.end(raw|| (body===undefined?undefined:JSON.stringify(body)));
  });
 }
 const register=async(instanceId='profile-one',extra={})=>{
  const r=await request('/v1/register',{method:'POST',body:{instanceId,profileLabel:'Work',browserName:'Chrome',extensionVersion:'0.2.0'},...extra});
  assert.equal(r.status,200);return r.value.token;
 };
 const beat=(token,tabs=[],id='profile-one',extra={})=>request('/v1/heartbeat?instanceId='+id,{method:'POST',token,body:{profileLabel:'Work',browserName:'Chrome',tabs},...extra});
 return {root,bridge,request,register,beat,advance:()=>now+=SESSION_TTL_MS+1};
}
const tab=(id=1,ready=true)=>({tabId:id,url:'https://muse.ai/',composerReady:ready});

test('loopback binding and compatible discovery range; originless GET ping is safe',async t=>{
 const f=await fixture(t);assert.equal(f.bridge.server.address().address,'127.0.0.1');
 assert.equal(PORT_START,32147);assert.equal(PORT_END,32157);assert(f.bridge.port>=PORT_START&&f.bridge.port<=PORT_END);
 const ping=await f.request('/v1/ping',{requestOrigin:null});assert.equal(ping.status,200);assert.equal(ping.value.bridge,'meta-muse-extension');
 assert.match(ping.value.serverId,/^[a-f0-9-]{36}$/);
 for(const requestOrigin of ['https://muse.ai','https://evil.example','chrome-extension://bad'])assert.equal((await f.request('/v1/ping',{requestOrigin})).status,403);
 assert.equal((await f.request('/v1/ping',{host:'evil.example'})).status,403);
});

test('port rendezvous skips an occupied port and server identifiers rotate',async t=>{
 const first=await fixture(t),second=await fixture(t);
 assert.notEqual(first.bridge.port,second.bridge.port);assert.notEqual(first.bridge.serverId,second.bridge.serverId);
});

test('registration rotates random tokens, binds origin, rejects unauthorized requests and foreign takeover',async t=>{
 const f=await fixture(t),token=await f.register();assert.match(token,/^[a-f0-9]{64}$/);
 const token2=await f.register('profile-two');assert.notEqual(token,token2);
 assert.equal((await f.beat('',[tab()])).status,401);
 assert.equal((await f.beat(token2,[tab()])).status,401);
 assert.equal((await f.beat(token,[tab()],'profile-one',{requestOrigin:otherOrigin})).status,401);
 assert.equal((await f.beat(token,[tab()])).status,200);
 assert.equal((await f.request('/v1/register',{method:'POST',body:{instanceId:'profile-one',profileLabel:'Work',browserName:'Chrome',extensionVersion:'0.2.0'}})).status,409);
 const rotated=await f.register('profile-one',{token});assert.notEqual(rotated,token);
 assert.equal((await f.beat(token,[tab()])).status,401);
});

test('strict bounded payloads reject unsupported fields, non-Muse tabs, malformed JSON and non-Chrome instances',async t=>{
 const f=await fixture(t),token=await f.register();
 for(const tabs of [[{...tab(),url:'https://muse.ai.evil.example/'}],[{...tab(),dom:'secret'}],[tab(),tab()],Array.from({length:21},(_,i)=>tab(i+1))])assert.equal((await f.beat(token,tabs)).status,400);
 assert.equal((await f.request('/v1/heartbeat?instanceId=profile-one',{method:'POST',token,raw:'{\"x\":\"'+'a'.repeat(33000)+'\"}'})).status,400);
 assert.equal((await f.request('/v1/heartbeat?instanceId=profile-one',{method:'POST',token,raw:'{'})).status,400);
 assert.equal((await f.request('/v1/register',{method:'POST',body:{instanceId:'profile-edge',profileLabel:'Edge',browserName:'Edge',extensionVersion:'0.2.0'}})).status,400);
 assert.equal((await f.request('/v1/event?instanceId=profile-one',{method:'POST',token,body:{}})).status,404);
});

test('heartbeat TTL expires evidence; polling alone cannot keep it alive',async t=>{
 const f=await fixture(t),token=await f.register();await f.beat(token,[tab()]);assert.equal(f.bridge.snapshot().state,'authenticated');
 await f.request('/v1/poll?instanceId=profile-one',{token});f.advance();
 assert.equal(f.bridge.snapshot().state,'extension_offline');assert.equal((await f.beat(token,[tab()])).status,401);
});

test('empty tabs, missing composer, ready composer and unavailable inspection remain distinct',async t=>{
 const f=await fixture(t),token=await f.register();assert.equal(f.bridge.snapshot().state,'muse_tab_missing');
 await f.beat(token,[tab(1,false)]);assert.equal(f.bridge.snapshot().state,'authentication_required');
 await f.beat(token,[{...tab(),inspectionComplete:false}]);assert.equal(f.bridge.snapshot().state,'unknown');
 await f.beat(token,[tab()]);assert.equal(f.bridge.snapshot().state,'authenticated');
});

test('multiple profiles and multiple tabs require explicit selection; only instance ID persists',async t=>{
 const f=await fixture(t),one=await f.register(),two=await f.register('profile-two');
 await f.beat(one,[tab()]);await f.beat(two,[tab(2)],'profile-two');
 assert.equal(f.bridge.snapshot().state,'selection_required');await assert.rejects(f.bridge.open());
 await f.bridge.selectSession({instanceId:'profile-one',tabId:1});assert.equal(f.bridge.snapshot().state,'authenticated');
 assert.deepEqual(JSON.parse(fs.readFileSync(f.bridge.selectionFile)),{instanceId:'profile-one'});
 await f.beat(one,[tab(3),tab(4)]);assert.equal(f.bridge.snapshot().state,'selection_required');
 await assert.rejects(f.bridge.selectSession({instanceId:'profile-one',tabId:1}));
 await f.bridge.selectSession({instanceId:'profile-one',tabId:4});assert.equal(f.bridge.snapshot().selectedTabId,4);
 f.advance();await f.register('profile-two');await f.beat((f.bridge.sessions.get('profile-two')).token,[tab(2)],'profile-two');
 assert.equal(f.bridge.snapshot().state,'selection_required');
});

test('restart restores only profile selection and safely resolves changed tab IDs',async t=>{
 const f=await fixture(t),token=await f.register();await f.beat(token,[tab()]);await f.bridge.selectSession({instanceId:'profile-one',tabId:1});f.bridge.close();
 const restarted=new MetaMuseExtensionBridge({userDataPath:f.root});t.after(()=>restarted.close());await restarted.start();
 assert.equal(restarted.selectedInstanceId,'profile-one');assert.equal(restarted.selectedTabId,null);assert.equal(restarted.snapshot().state,'extension_offline');
});

test('legacy metadata is discarded; renderer status has no token, URL, account identity or DOM',async t=>{
 const f=await fixture(t),token=await f.register();await f.beat(token,[{...tab(),loggedIn:true,title:'private title',accountLabel:'private account',url:'https://muse.ai/?secret=private'}]);
 const status=f.bridge.snapshot(),json=JSON.stringify(status);
 for(const forbidden of [token,'private','accountLabel','composerReady','serverId','url','title'])assert(!json.includes(forbidden));
 const value=sanitizeSession({...status,token:'private',accountLabel:'private',dom:'private'});assert(!JSON.stringify(value).includes('private'));
});

test('only openMuse is queued, duplicate opens coalesce, results are bounded and timeout removes command',async t=>{
 const f=await fixture(t,{commandTimeoutMs:200}),token=await f.register();await f.beat(token,[tab()]);
 const first=f.bridge.open(),second=f.bridge.open();await new Promise(r=>setImmediate(r));
 const command=(await f.request('/v1/poll?instanceId=profile-one',{token})).value.command;
 assert.equal(command.type,'openMuse');assert.deepEqual(command.payload,{tabId:1});
 assert.equal((await f.request('/v1/poll?instanceId=profile-one',{token})).value.command,null);
 assert.equal((await f.request('/v1/result?instanceId=profile-one',{method:'POST',token,body:{commandId:command.id,ok:true,result:{tabId:1,url:'https://muse.ai/'},error:null}})).status,200);
 await Promise.all([first,second]);assert.equal(f.bridge.pending.size,0);
 await assert.rejects(f.bridge.open(),{code:'PROVIDER_UNAVAILABLE'});assert.equal((await f.request('/v1/poll?instanceId=profile-one',{token})).value.command,null);
 const pending=f.bridge.open();await new Promise(r=>setImmediate(r));f.bridge.close();await assert.rejects(pending);assert.equal(f.bridge.pending.size,0);
});

test('GenerationService and trusted IPC sanitize sessions, validate selection, and never create jobs',async t=>{
 const f=await fixture(t),token=await f.register();await f.beat(token,[tab()]);
 const registry=new ProviderRegistry();registry.register(createMuseProvider({configStore:{read:()=>({enabled:true})},extensionBridge:f.bridge}));
 const service=new GenerationService({root:f.root,registry}),handlers={};
 registerGenerationIpc({ipcMain:{handle:(n,fn)=>handlers[n]=fn},getService:()=>service,trusted:e=>e.trusted});
 assert.equal((await service.providerSession('muse')).state,'authenticated');assert.equal((await service.readiness()).ready,false);
 await assert.rejects(service.submit({projectId:'project',idempotencyKey:'key',prompt:'test'}),{code:'NO_GENERATION_ROUTE'});assert.deepEqual(service.list('project'),[]);
 const select=handlers['generation:provider-session-select'];
 assert.equal((await select({}, {id:'muse',instanceId:'profile-one',tabId:1})).ok,false);
 for(const payload of [{id:'muse',instanceId:'profile-one',tabId:'1'},{id:'muse',instanceId:'profile-one',tabId:1,url:'secret'},{}])assert.equal((await select({trusted:true},payload)).ok,false);
 const selected=await select({trusted:true},{id:'muse',instanceId:'profile-one',tabId:1});assert.equal(selected.ok,true);assert(!JSON.stringify(selected).includes(token));
});

test('canonical Muse integration has no browser process access or legacy automation and preserves production isolation',()=>{
 const main=fs.readFileSync('main.js','utf8');assert(main.includes('extensionBridge: museExtensionBridge'));assert(!main.includes('MuseBrowserBridge'));assert(main.includes('museExtensionBridge?.close()'));
 for(const file of ['services/generation/bridge/meta-muse-extension-bridge.js','extensions/meta-muse-bridge/service-worker.js']){
  const source=fs.readFileSync(file,'utf8');for(const forbidden of ['remote-debugging','DevTools','child_process','meta-muse-profile','browser-sessions','localStorage','sessionStorage','document.cookie','chrome.cookies','chrome.debugger','chrome.downloads','process.env','generateVideo','downloadMedia'])assert(!source.includes(forbidden),file+' '+forbidden);
 }
 const manifest=require('../extensions/meta-muse-bridge/manifest.json');assert.deepEqual(manifest.permissions,['storage','alarms']);assert.deepEqual(manifest.host_permissions,['https://muse.ai/*','http://127.0.0.1/*']);
 const preload=fs.readFileSync('preload.js','utf8');assert(preload.includes('selectGenerationProviderSession'));assert(!/Runtime\.evaluate|sendBrowserCommand/.test(preload));
 const pkg=require('../package.json');assert(pkg.scripts['test:core-commercial'].includes('test:muse-extension'));assert(pkg.build.files.includes('extensions/**/*'));
});

test('content script proves visible editable composer presence without reading text or account details',()=>{
 const source=fs.readFileSync('extensions/meta-muse-bridge/content-script.js','utf8');
 for(const forbidden of ['textContent','innerHTML','innerText','value','cookie','localStorage','sessionStorage','accountLabel','fetch(','XMLHttpRequest','viral-ai:muse-generate'])assert(!source.includes(forbidden));
 let listener,visible=true,rootPresent=true,disabled=false,editable=true;
 const editor={tagName:'DIV',get disabled(){return disabled},readOnly:false,get isContentEditable(){return editable},getAttribute:()=>null,closest:()=>null,getClientRects:()=>visible?[{}]:[]};
 const root={querySelector:()=>editor,closest:()=>null,getClientRects:()=>visible?[{}]:[]};
 const window={};window.top=window;
 const context={window,location:{origin:'https://muse.ai'},document:{readyState:'complete',querySelector:()=>rootPresent?root:null},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),chrome:{runtime:{id:'test',onMessage:{addListener:fn=>listener=fn},connect:()=>({onDisconnect:{addListener(){}}})}}};
 vm.runInNewContext(source,context);
 const status=()=>{let result;listener({type:'viral-ai:muse-status'},{id:'test'},v=>result=v);return result;};
 assert.equal(status().composerReady,true);assert.deepEqual(Object.keys(status()).sort(),['composerReady','inspectionComplete']);
 visible=false;assert.equal(status().composerReady,false);visible=true;
 disabled=true;assert.equal(status().composerReady,false);disabled=false;
 editable=false;assert.equal(status().composerReady,false);editable=true;
 rootPresent=false;assert.equal(status().composerReady,false);rootPresent=true;
 context.location.origin='https://www.instagram.com';assert.equal(status().inspectionComplete,false);
 let called=false;listener({type:'viral-ai:muse-status'},{id:'other'},()=>called=true);assert.equal(called,false);
});

test('popup strings derive from VI/EN product i18n and all runtime imports resolve',()=>{
 const c={window:{}};vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),c);vm.runInNewContext(fs.readFileSync('extensions/meta-muse-bridge/strings.js','utf8'),c);
 for(const locale of ['vi','en']) {
  assert.deepEqual(JSON.parse(JSON.stringify(c.window.MuseStrings[locale])),JSON.parse(JSON.stringify(c.window.I18N.messages[locale].videoProviders.extensionPopup)));
  for(const state of ['extension_offline','muse_tab_missing','selection_required','authentication_required','authenticated','unknown'])assert(c.window.I18N.messages[locale].videoProviders.sessionStates[state]);
 }
 const {createRequire,builtinModules}=require('node:module'),pkg=require('../package.json');
 for(const file of fs.readdirSync('services/generation/bridge').filter(f=>f.endsWith('.js'))){
  const absolute=path.resolve('services/generation/bridge',file),req=createRequire(absolute);
  for(const match of fs.readFileSync(absolute,'utf8').matchAll(/require\(["']([^"']+)["']\)/g)){
   const name=match[1];if(name.startsWith('.'))assert.doesNotThrow(()=>req.resolve(name));else assert(builtinModules.includes(name.replace(/^node:/,''))||pkg.dependencies[name]);
  }
 }
 for(const file of fs.readdirSync('extensions/meta-muse-bridge').filter(f=>f.endsWith('.js')))assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join('extensions/meta-muse-bridge',file),'utf8')));
});

test('extension setup copies only app-managed source files without creating browser profiles',async t=>{
 const f=await fixture(t,{extensionSourceDir:path.resolve('extensions/meta-muse-bridge')});
 await f.bridge.revealExtension();assert.equal(JSON.parse(fs.readFileSync(path.join(f.bridge.installDir,'manifest.json'))).version,'0.2.0');
 assert(!fs.existsSync(path.join(f.root,'browser-sessions')));assert(!fs.existsSync(path.join(f.root,'meta-muse-profile')));
});


test('extension setup refuses a redirected installation directory',async t=>{
 const f=await fixture(t,{extensionSourceDir:path.resolve('extensions/meta-muse-bridge')});
 const destination=path.join(f.root,'destination');fs.mkdirSync(destination);
 fs.symlinkSync(destination,f.bridge.installDir,process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.bridge.revealExtension(),{code:'INVALID_REQUEST'});
 assert.deepEqual(fs.readdirSync(destination),[]);
});

test('extension worker keeps credentials transient, reuses a selected Muse tab and rejects unsupported commands',async()=>{
 const calls=[],stored=[],opened=[];let command=null;
 const chrome={runtime:{id:'extension',getManifest:()=>({version:'0.2.0'}),getURL:p=>'chrome-extension://extension/'+p,onConnect:{addListener(){}},onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  storage:{local:{get:async keys=>{assert.deepEqual(Array.from(keys),['instanceId','profileLabel']);return {instanceId:'profile-one',profileLabel:'Work'};},set:async data=>stored.push(data),remove(){}}},
  tabs:{query:async()=>[{id:5}],sendMessage:async()=>({composerReady:true,inspectionComplete:true}),update:async(id,options)=>{opened.push({id,options});return {id,windowId:7};},create:async options=>{opened.push(options);return {id:6,windowId:7};}},
  windows:{update:async()=>{}},alarms:{onAlarm:{addListener(){}},create(){}}};
 const context={chrome,navigator:{userAgent:'Edg/1'},crypto:{randomUUID:()=> 'profile-one'},AbortController,setTimeout:()=>1,clearTimeout(){},fetch:async(url,options)=>{
  calls.push({url,options});let result;
  if(url.endsWith('/v1/ping'))result={bridge:'meta-muse-extension',serverId:'server'};
  else if(url.endsWith('/v1/register'))result={token:'a'.repeat(64),serverId:'server'};
  else if(url.includes('/v1/poll'))result={command};else result={ok:true};
  return {ok:true,json:async()=>result};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync('extensions/meta-muse-bridge/service-worker.js','utf8'),context);
 await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);
 context.navigator.userAgent='Chrome/140';command={id:'cmd',type:'openMuse',payload:{tabId:5}};
 assert.equal(await vm.runInContext('poll()',context),true);assert.equal(opened.length,1);assert.equal(opened[0].id,5);
 assert.equal(stored.length,0);assert(calls.filter(c=>c.url.includes('/v1/heartbeat')).every(c=>c.options.headers['X-Viral-Muse-Token']==='a'.repeat(64)));
 assert(!calls.some(c=>c.url.includes('generate')));
 command={id:'bad',type:'generate',payload:{}};assert.equal(await vm.runInContext('poll()',context),false);assert.equal(opened.length,1);
 command={id:'bad',type:'openMuse',payload:{url:'https://evil.example'}};assert.equal(await vm.runInContext('poll()',context),false);assert.equal(opened.length,1);
});

test('an incomplete extension bundle leaves installed files untouched',async t=>{
 const f=await fixture(t,{extensionSourceDir:path.resolve('extensions/meta-muse-bridge')});await f.bridge.revealExtension();
 const before=fs.readFileSync(path.join(f.bridge.installDir,'manifest.json'),'utf8');
 f.bridge.source=path.join(f.root,'incomplete');fs.mkdirSync(f.bridge.source);
 await assert.rejects(f.bridge.revealExtension());
 assert.equal(fs.readFileSync(path.join(f.bridge.installDir,'manifest.json'),'utf8'),before);
 assert(!fs.readdirSync(f.bridge.installDir).some(f=>f.endsWith('.tmp')));
});


test('distribution compatibility, missing evidence and legacy 0.2.0 session preservation',async t=>{
 const f=await fixture(t);assert.equal(f.bridge.snapshot().extensionState,'extension_install_required');
 const token=await f.register();await f.beat(token,[tab()]);
 assert.equal(f.bridge.snapshot().extensionState,'extension_connected');assert.equal(f.bridge.snapshot().state,'authenticated');
 f.advance();assert.equal(f.bridge.snapshot().extensionState,'extension_install_required');
 for(const [extensionVersion,protocolVersion,expected] of [['0.1.0',undefined,'extension_outdated'],['0.1.0',1,'extension_outdated'],['0.2.0',2,'extension_error'],['0.2.0',0,'extension_error'],['0.2.0',1,'extension_connected']]) {
  const r=await f.request('/v1/register',{method:'POST',body:{instanceId:'version-test',profileLabel:'',browserName:'Chrome',extensionVersion,protocolVersion}});
  assert.equal(r.status,200);await f.beat(r.value.token,[tab()],'version-test');
  assert.equal(f.bridge.snapshot().extensionState,expected);
  if(expected!=='extension_connected')await assert.rejects(f.bridge.open());
  f.advance();f.bridge.snapshot();
 }
 const {compatibility,configuration}=require('../services/generation/bridge/extension-distribution');
 assert.equal(compatibility('0.2.0',1,configuration({protocolVersion:2})),'extension_update_required');
});

test('production official identity is enforced; support and development accept unpacked origins',async t=>{
 for(const distributionMode of ['production','support','development']) {
  const f=await fixture(t,{distribution:{distributionMode,chromeWebStoreExtensionId:'a'.repeat(32)}});
  const result=await f.request('/v1/register',{method:'POST',requestOrigin:otherOrigin,body:{instanceId:'other-profile',profileLabel:'',browserName:'Chrome',extensionVersion:'0.2.0',protocolVersion:1}});
  assert.equal(result.status,distributionMode==='production'?403:200);
  await f.register();
 }
});

test('store configuration opens only a validated official store page and coalesces clicks',async t=>{
 const opened=[],shell={openExternal:async url=>opened.push(url)};
 const f=await fixture(t,{shell});await assert.rejects(f.bridge.openStore());assert.deepEqual(opened,[]);
 const {configuration}=require('../services/generation/bridge/extension-distribution');
 const id='a'.repeat(32),url='https://chromewebstore.google.com/detail/muse/'+id;
 for(const chromeWebStoreUrl of ['https://evil.example/detail/'+id,'javascript:alert(1)',url+'?redirect=evil',url.replace(id,'b'.repeat(32))])assert.throws(()=>configuration({chromeWebStoreExtensionId:id,chromeWebStoreUrl}));
 f.bridge.distribution=configuration({chromeWebStoreExtensionId:id,chromeWebStoreUrl:url});
 await Promise.all([f.bridge.openStore(),f.bridge.openStore()]);assert.deepEqual(opened,[url]);
 assert.equal(f.bridge.snapshot().storeConfigured,true);
});

test('manual support action reveals only the managed manifest and never reports installed',async t=>{
 const shown=[];const f=await fixture(t,{extensionSourceDir:path.resolve('extensions/meta-muse-bridge'),shell:{showItemInFolder:file=>shown.push(file)}});
 assert.deepEqual(await f.bridge.revealExtension(),{id:'muse',folderRevealed:true});
 assert.deepEqual(shown,[path.join(f.root,'meta-muse-extension','manifest.json')]);
 assert.equal(f.bridge.snapshot().extensionState,'extension_install_required');
});

test('production packaging includes complete extension with matching version contract',()=>{
 const pkg=require('../package.json'),config=require('../services/generation/bridge/extension-distribution.json');
 assert(pkg.build.files.includes('extensions/**/*'));assert(pkg.build.files.includes('services/**/*'));
 assert.equal(pkg.build.afterPack,'scripts/verify-muse-package.js');
 const root='extensions/meta-muse-bridge',manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 assert.equal(manifest.version,config.expectedExtensionVersion);
 for(const file of ['manifest.json',manifest.background.service_worker,manifest.action.default_popup,'popup.js','popup.css','strings.js',...manifest.content_scripts.flatMap(s=>s.js)])assert(fs.statSync(path.join(root,file)).isFile());
 assert(fs.readFileSync(path.join(root,manifest.background.service_worker),'utf8').includes('protocolVersion:'+config.protocolVersion));
});


test('packaging guard fails if a production archive loses an extension file',async t=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'muse-package-test-'));
 t.after(()=>{try{fs.rmSync(stage,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}});
 const source=path.join(stage,'source');fs.mkdirSync(source);
 fs.cpSync('extensions',path.join(source,'extensions'),{recursive:true});
 const configDir=path.join(source,'services/generation/bridge');fs.mkdirSync(configDir,{recursive:true});
 fs.copyFileSync('services/generation/bridge/extension-distribution.json',path.join(configDir,'extension-distribution.json'));
 const asar=require('@electron/asar'),{verify}=require('../scripts/verify-muse-package');
 const good=path.join(stage,'good.asar');await asar.createPackage(source,good);assert.doesNotThrow(()=>verify(good));
 fs.unlinkSync(path.join(source,'extensions/meta-muse-bridge/service-worker.js'));
 const bad=path.join(stage,'bad.asar');await asar.createPackage(source,bad);assert.throws(()=>verify(bad));
});
