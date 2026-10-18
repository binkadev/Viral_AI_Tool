"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs"),path=require("path"),os=require("os"),{EventEmitter}=require("events"),vm=require("vm");
const {MuseBrowserBridge,sanitizeSession,MUSE_URL}=require("../services/generation/browser/muse-browser-bridge");
const {connectBrowser}=require("../services/generation/browser/browser-connection");
const {ProviderRegistry}=require("../services/generation/provider-registry");
const {ProviderConfigStore}=require("../services/generation/provider-config-store");
const {createMuseProvider}=require("../services/generation/providers/muse-provider");
const {GenerationService}=require("../services/generation/generation-service");
const {registerGenerationIpc}=require("../services/generation/generation-ipc");
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"muse-browser-test-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[],children=[];let online=false,closedConnections=0;
 const bridge=new MuseBrowserBridge({userDataPath:root,
  discover:()=>({id:"chrome",executable:"C:\\Programs\\chrome.exe"}),
  launch:(exe,args,options)=>{
   calls.push({exe,args,options});const child=new EventEmitter();child.unref=()=>{};child.kill=()=>assert.fail("Never kill browser processes");
   children.push(child);online=true;const profile=args.find(a=>a.startsWith("--user-data-dir=")).slice(16);
   fs.writeFileSync(path.join(profile,"DevToolsActivePort"),"54321\n/devtools/browser/test-id\n");
   return child;
  },connect:async endpoint=>{
   assert.deepEqual(endpoint,{port:54321,browserPath:"/devtools/browser/test-id"});
   if(!online)throw Error("closed");
   return {alive:()=>online,close:()=>closedConnections++};
  },startupTimeoutMs:300});
 t.after(()=>bridge.detach());
 return {root,bridge,calls,children,setOnline:value=>online=value,closedConnections:()=>closedConnections};
}
test("launch uses fixed Muse URL, dedicated profile, ephemeral loopback endpoint and no shell",async t=>{
 const f=fixture(t);
 assert.equal((await f.bridge.check()).state,"browser_closed");
 const result=await f.bridge.open();assert.equal(result.state,"browser_connected");
 const call=f.calls[0];assert.equal(call.args.at(-1),"https://muse.ai/");assert.equal(MUSE_URL,"https://muse.ai/");
 assert(call.args.includes("--remote-debugging-port=0"));assert(call.args.includes("--remote-debugging-address=127.0.0.1"));
 assert(call.args.includes("--user-data-dir="+path.join(f.root,"browser-sessions","muse","chrome")));
 assert.equal(call.options.shell,false);assert.equal(call.options.stdio,"ignore");
 for(const forbidden of ["--remote-allow-origins","--no-sandbox","Default"])assert(!call.args.some(a=>a.includes(forbidden)));
 assert.deepEqual(Object.keys(result).sort(),["browser","checkedAt","id","state"]);
 assert(!JSON.stringify(result).includes(f.root));
});
test("parallel opens coalesce, checks do not launch, and closed browsers can reopen",async t=>{
 const f=fixture(t);
 const results=await Promise.all([f.bridge.open(),f.bridge.open(),f.bridge.open()]);
 assert(results.every(r=>r.state==="browser_connected"));assert.equal(f.calls.length,1);
 await f.bridge.open();await f.bridge.check();assert.equal(f.calls.length,1);
 f.setOnline(false);f.children[0].emit("exit",0);
 assert.equal((await f.bridge.check()).state,"browser_closed");
 assert.equal((await f.bridge.open()).state,"browser_connected");assert.equal(f.calls.length,2);
});
test("a fresh bridge reuses a live dedicated session; detach leaves profile and browser intact",async t=>{
 const f=fixture(t);await f.bridge.open();
 const second=new MuseBrowserBridge({userDataPath:f.root,discover:f.bridge.discover,connect:f.bridge.connect,
  launch:()=>assert.fail("Must reuse dedicated session")});
 assert.equal((await second.open()).state,"browser_connected");
 second.detach();f.bridge.detach();
 assert(f.closedConnections()>0);assert(fs.existsSync(path.join(f.root,"browser-sessions","muse","chrome")));
 assert.equal((await second.open()).state,"browser_closed");
});
test("missing browsers and failed launches return safe states",async t=>{
 const f=fixture(t);
 const missing=new MuseBrowserBridge({userDataPath:f.root,discover:()=>null});
 assert.equal((await missing.open()).state,"browser_unavailable");missing.detach();
 const bad=new MuseBrowserBridge({userDataPath:f.root,discover:f.bridge.discover,launch:()=>{throw Error("secret path");}});
 const result=await bad.open();assert.equal(result.messageCode,"BROWSER_LAUNCH_FAILED");assert(!JSON.stringify(result).includes("secret"));bad.detach();
});
test("invalid and stale endpoint descriptors cannot connect or expose arbitrary URLs",async t=>{
 const f=fixture(t);await f.bridge.check();
 const profile=path.join(f.root,"browser-sessions","muse","chrome");
 for(const descriptor of ["0\n/devtools/browser/a","65536\n/devtools/browser/a","1234\nws://attacker/","1234\n/devtools/browser/a?token=secret","x".repeat(1100)]) {
  fs.writeFileSync(path.join(profile,"DevToolsActivePort"),descriptor);assert.equal(f.bridge.descriptor(profile),null);
 }
});
test("version-only transport hardcodes loopback, verifies response and aborts cleanly",async()=>{
 const urls=[],sent=[];let closed=0;
 class Socket extends EventTarget {
  constructor(url){super();urls.push(url);this.readyState=1;queueMicrotask(()=>this.dispatchEvent(new Event("open")));}
  send(raw){sent.push(JSON.parse(raw));queueMicrotask(()=>this.dispatchEvent(new MessageEvent("message",{data:JSON.stringify({id:1,result:{product:"Chrome/140"}})})));}
  close(){this.readyState=3;closed++;}
 }
 const conn=await connectBrowser({port:45678,browserPath:"/devtools/browser/abc"},{WebSocketImpl:Socket});
 assert.deepEqual(urls,["ws://127.0.0.1:45678/devtools/browser/abc"]);
 assert.deepEqual(sent,[{id:1,method:"Browser.getVersion"}]);assert(conn.alive());conn.close();assert.equal(closed,1);
 await assert.rejects(connectBrowser({port:123,browserPath:"ws://remote"}));
 const abort=new AbortController();abort.abort();
 await assert.rejects(connectBrowser({port:123,browserPath:"/devtools/browser/abc"},{signal:abort.signal,WebSocketImpl:Socket}));
});
test("pending startup can detach without killing its own or unrelated processes",async t=>{
 const f=fixture(t);f.bridge.connect=async()=>{throw Error("not yet");};
 const pending=f.bridge.open();await new Promise(r=>setImmediate(r));f.bridge.detach();await pending;
 assert.equal((await f.bridge.check()).state,"browser_closed");assert.equal(f.calls.length,1);
});
test("fixed IPC sanitizes session metadata; browser connectivity never enables generation",async t=>{
 const f=fixture(t),config=new ProviderConfigStore(path.join(f.root,"config")),registry=new ProviderRegistry();
 registry.register(createMuseProvider({configStore:config,browserBridge:f.bridge}));
 const service=new GenerationService({root:f.root,registry,providerConfigStore:config}),handlers={};
 registerGenerationIpc({ipcMain:{handle:(key,fn)=>handlers[key]=fn},getService:()=>service,trusted:e=>e.trusted===true});
 for(const channel of ["provider-session-open","provider-session-check"]){
  const handler=handlers["generation:"+channel];
  assert.equal((await handler({},"muse")).ok,false);
  for(const payload of [null,{},"../muse","unknown",{id:"muse",url:"https://evil"}]) assert.equal((await handler({trusted:true},payload)).ok,false);
 }
 await assert.rejects(service.providerSession("muse",true),{code:"PROVIDER_UNAVAILABLE"});
 config.write("muse",{enabled:true});
 const result=await handlers["generation:provider-session-open"]({trusted:true},"muse");
 assert.equal(result.value.state,"browser_connected");
 assert.equal((await service.checkProvider("muse")).state,"authentication_required");
 assert.equal((await service.readiness()).ready,false);
 await assert.rejects(service.submit({projectId:"p",idempotencyKey:"k",prompt:"hello"}),{code:"NO_GENERATION_ROUTE"});
 assert.deepEqual(service.list("p"),[]);
 const sanitized=sanitizeSession({state:"browser_connected",browser:"chrome",port:1234,cookie:"secret",profile:"secret",url:"secret",messageCode:"secret"});
 assert(!JSON.stringify(sanitized).includes("secret"));assert(!("port" in sanitized));
});
test("preload fixes both session channels and never exports a generic browser command",()=>{
 let api;const calls=[];
 vm.runInNewContext(fs.readFileSync("preload.js","utf8"),{require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>api=value},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 api.openGenerationProviderSession("muse");api.checkGenerationProviderSession("muse");
 assert.deepEqual(calls.map(c=>c[0]),["generation:provider-session-open","generation:provider-session-check"]);
 assert.equal(api.sendBrowserCommand,undefined);
});
test("production transport has no dev activation, page evaluation, storage or credential APIs",()=>{
 for(const file of ["muse-browser-bridge.js","browser-connection.js","browser-profile.js"]){
  const source=fs.readFileSync("services/generation/browser/"+file,"utf8");
  for(const forbidden of ["process.env","Runtime.evaluate","Network.getCookies","Storage.get","password","--remote-allow-origins","taskkill",".kill("])assert(!source.includes(forbidden),file+" "+forbidden);
 }
 const pkg=require("../package.json");assert(pkg.scripts["test:core-commercial"].includes("test:muse-browser"));
 const main=fs.readFileSync("main.js","utf8");assert(main.includes("museBrowserBridge?.detach()"));
});

test("an Edge discovery result can never launch or reuse a Muse session",async t=>{
 const f=fixture(t);
 const bridge=new MuseBrowserBridge({userDataPath:f.root,discover:()=>({id:"edge",executable:"msedge.exe"}),
  launch:()=>assert.fail("No Edge fallback"),connect:()=>assert.fail("No Edge session reuse")});
 assert.equal((await bridge.open()).state,"browser_unavailable");
 assert.equal((await bridge.check()).state,"browser_unavailable");bridge.detach();
});
