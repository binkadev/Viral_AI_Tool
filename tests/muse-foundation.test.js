"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const {ProviderRegistry} = require("../services/generation/provider-registry");
const {ProviderConfigStore} = require("../services/generation/provider-config-store");
const {createMuseProvider} = require("../services/generation/providers/muse-provider");
const {GenerationService} = require("../services/generation/generation-service");
const {registerGenerationIpc} = require("../services/generation/generation-ipc");
const {normalizeProviderStatus} = require("../services/generation/provider-contract");
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"muse-foundation-test-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=new ProviderConfigStore(path.join(root,"provider-config")), registry=new ProviderRegistry();
  const muse=createMuseProvider({configStore:config}); registry.register(muse);
  const service=new GenerationService({root,registry,providerConfigStore:config});
  const handlers={};
  registerGenerationIpc({ipcMain:{handle:(name,fn)=>handlers[name]=fn},getService:()=>service,trusted:event=>event.trusted===true});
  return {root,config,registry,muse,service,handlers};
}
test("Muse registers without invented models; absent, disabled and enabled config are never ready",async t=>{
  const f=fixture(t);
  assert(f.registry.hasProvider("muse"));
  assert.equal(f.muse.displayName,"Muse");
  assert.deepEqual(f.muse.capabilities,["text-to-video"]);
  assert.deepEqual(f.muse.modelIds,[]);
  assert.equal((await f.service.checkProvider("muse")).state,"unconfigured");
  assert.equal((await f.service.configureProvider("muse",{enabled:false})).messageCode,"DISABLED");
  const enabled=await f.service.configureProvider("muse",{enabled:true});
  assert.equal(enabled.state,"unavailable");
  assert.equal(enabled.messageCode,"GENERATION_NOT_IMPLEMENTED");
  assert.equal(enabled.ready,false);
  assert(Number.isFinite(Date.parse(enabled.checkedAt)));
  const restarted=new ProviderConfigStore(f.config.root);
  assert.deepEqual(restarted.read("muse"),{enabled:true});
  assert.equal((await createMuseProvider({configStore:restarted}).readiness()).ready,false);
  const ready=await f.service.readiness();
  assert.equal(ready.ready,false);assert.deepEqual(ready.modelIds,[]);
});
test("unready Muse cannot create jobs, output directories or successful operations",async t=>{
  const f=fixture(t);
  for(const config of [null,{enabled:false},{enabled:true}]) {
    if(config) await f.service.configureProvider("muse",config);
    const request={projectId:"project",idempotencyKey:"one",prompt:"A scene"};
    await assert.rejects(f.service.submit(request),{code:"NO_GENERATION_ROUTE"});
    await assert.rejects(f.service.submit({...request,modelId:"muse:invented"}),{code:"INVALID_REQUEST"});
    for(const operation of ["start","reconcile","cancel"]) await assert.rejects(f.muse[operation]({}),{code:"PROVIDER_UNAVAILABLE"});
    assert.equal((await f.muse.preflight()).ready,false);
    assert.deepEqual(f.service.list("project"),[]);
    assert(!fs.existsSync(path.join(f.root,"jobs.json")));
    assert(!fs.existsSync(path.join(f.root,"outputs")));
  }
});
test("config rejects secrets, unknown options and traversal; errors are recoverable and sanitized",async t=>{
  const f=fixture(t);
  for(const config of [{enabled:"true"},{enabled:true,password:"secret"},{enabled:true,endpoint:"https://secret"}, {enabled:true,mode:"browser"},null]) {
    assert.throws(()=>f.config.write("muse",config),{code:"INVALID_REQUEST"});
  }
  assert.throws(()=>f.config.read("../outside"),{code:"INVALID_REQUEST"});
  f.config.write("muse",{enabled:true});
  fs.writeFileSync(f.config.file("muse"),JSON.stringify({version:1,enabled:true,cookie:"secret"}));
  const status=await f.service.checkProvider("muse");
  assert.equal(status.state,"error");assert(!JSON.stringify(status).includes("secret"));
  f.config.write("muse",{enabled:false});
  assert.deepEqual(JSON.parse(fs.readFileSync(f.config.file("muse"))),{version:1,enabled:false});
  assert.deepEqual(fs.readdirSync(f.config.root),["muse.json"]);
  // An unwritable destination must fail without pretending to save.
  const blocked=path.join(f.root,"not-a-directory");fs.writeFileSync(blocked,"file");
  assert.throws(()=>new ProviderConfigStore(blocked).write("muse",{enabled:true}),{code:"PROVIDER_CONFIG_ERROR"});
});
test("IPC validates both new channels, blocks untrusted frames and returns status only",async t=>{
  const f=fixture(t), event={trusted:true};
  for(const [channel,payload] of [["provider-check","muse"],["provider-configure",{id:"muse",enabled:true}]]) {
    assert.deepEqual(await f.handlers["generation:"+channel]({},payload),{ok:false,errorCode:"UNAVAILABLE"});
  }
  for(const payload of [null,{}, {id:"muse",enabled:1},{id:"muse",enabled:true,token:"secret"},{id:"unknown",enabled:true}]) {
    assert.equal((await f.handlers["generation:provider-configure"](event,payload)).errorCode,"INVALID_REQUEST");
  }
  for(const payload of ["../bad",{},"unknown"]) assert.equal((await f.handlers["generation:provider-check"](event,payload)).ok,false);
  const saved=await f.handlers["generation:provider-configure"](event,{id:"muse",enabled:true});
  assert(saved.ok); assert.equal(saved.value.ready,false);
  assert.deepEqual(Object.keys(saved.value).sort(),["capabilities","checkedAt","enabled","id","messageCode","ready","state"].sort());
  assert.equal((await f.handlers["generation:providers"](event)).value.providers[0].state,"unavailable");
  f.service.checkProvider=async()=>{throw Error("secret stack");};
  assert.deepEqual(await f.handlers["generation:provider-check"](event,"muse"),{ok:false,errorCode:"UNAVAILABLE"});
});
test("registry allowlists status fields and cannot route a connection-only adapter",async()=>{
  const registry=new ProviderRegistry();
  const adapter={id:"muse",modelIds:[],readiness:async()=>({id:"secret",state:"ready",ready:true,enabled:true,
    messageCode:"secret",capabilities:["text-to-video","secret"],checkedAt:"secret",cookie:"secret",password:"secret",stack:"secret"}),
    preflight:async()=>({ready:false}),start:async()=>{},reconcile:async()=>{},cancel:async()=>{}};
  registry.register(adapter);
  const status=await registry.getProviderStatus("muse");
  assert.equal(status.state,"unavailable");assert.equal(status.ready,false);
  assert.equal(status.id,"muse");assert(!JSON.stringify(status).includes("secret"));
  assert.deepEqual((await registry.readiness()).modelIds,[]);
  assert.equal(normalizeProviderStatus({state:"ready",ready:false}).ready,false);
});
test("preload has fixed channels and exposes no provider credentials or generic invocation",()=>{
  let api;const calls=[];
  vm.runInNewContext(fs.readFileSync("preload.js","utf8"),{require:()=>({
    contextBridge:{exposeInMainWorld:(_,value)=>api=value},
    ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true});}}
  })});
  api.checkGenerationProvider("muse");api.configureGenerationProvider({id:"muse",enabled:true});
  assert.deepEqual(calls.map(c=>c[0]),["generation:provider-check","generation:provider-configure"]);
  assert.equal(api.invoke,undefined);
  assert(!Object.keys(api).some(k=>/muse.*(password|cookie|token)/i.test(k)));
});
test("production ignores all attempted dev Muse readiness and authentication overrides",()=>{
  const {execFileSync}=require("child_process");
  const source='const {createMuseProvider}=require("./services/generation/providers/muse-provider");createMuseProvider({configStore:{read:()=>({enabled:true})}}).readiness().then(s=>console.log(JSON.stringify(s)));';
  const output=execFileSync(process.execPath,["-e",source],{cwd:path.resolve(__dirname,".."),encoding:"utf8",
    env:{...process.env,NODE_ENV:"production",VIRAL_AI_DEV_MODE:"1",VIRAL_AI_DEV_MUSE_STATE:"ready",
      VIRAL_AI_MUSE_READY:"1",VIRAL_AI_MUSE_TOKEN:"secret",VIRAL_AI_DEV_GENERATION_STATE:"completed"}});
  const status=JSON.parse(output);
  assert.equal(status.ready,false);assert.equal(status.state,"unavailable");
  assert(!output.includes("secret"));
  const sourceText=fs.readFileSync("services/generation/providers/muse-provider.js","utf8");
  assert(!sourceText.includes("process.env"));
  assert(!require("../package.json").build.files.some(p=>p.startsWith("dev/")));
});
test("nested runtime imports resolve; production registration and CI coverage are present",()=>{
  const {builtinModules,createRequire}=require("module"),pkg=require("../package.json");
  for(const file of ["services/generation/providers/muse-provider.js","services/generation/provider-config-store.js"]) {
    const req=createRequire(path.resolve(file));
    for(const match of fs.readFileSync(file,"utf8").matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name=match[1];
      if(name.startsWith(".")) assert.doesNotThrow(()=>req.resolve(name));
      else assert(builtinModules.includes(name)||pkg.dependencies?.[name]||pkg.devDependencies?.[name]);
    }
  }
  assert(fs.readFileSync("main.js","utf8").includes("registry.register(createMuseProvider"));
  assert(pkg.scripts["test:core-commercial"].includes("test:muse-foundation"));
  const ci=fs.readFileSync(".github/workflows/core-commercial.yml","utf8");
  assert(ci.includes('"services/generation/**"'));assert(ci.includes('"renderer/**"'));
});
