"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {FILES,readBundle,matches,stageBundle}=require('../services/generation/bridge/extension-bundle');
const {configuration,compatibility}=require('../services/generation/bridge/extension-distribution');
const {MetaMuseExtensionBridge}=require('../services/generation/bridge/meta-muse-extension-bridge');
const source=path.resolve('extensions/meta-muse-bridge'),config=configuration();
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-dev-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('production source stays unmarked; only explicit native dev staging produces the exact deterministic overlay',t=>{
 const root=temporary(t),original=FILES.map(name=>fs.readFileSync(path.join(source,name)));
 const production=readBundle(source,config),development=readBundle(source,config,{developmentDiagnostics:true});
 const devAgain=readBundle(source,config,{developmentDiagnostics:true});
 assert.equal(JSON.parse(production.files[0].data).version_name,undefined);
 assert.equal(JSON.parse(development.files[0].data).version_name,'development-diagnostics');
 for(let i=0;i<FILES.length;i++){
   assert.deepEqual(development.files[i].data,devAgain.files[i].data);assert.deepEqual(fs.readFileSync(path.join(source,FILES[i])),original[i]);
   if(FILES[i]!=='manifest.json')assert.deepEqual(development.files[i].data,production.files[i].data);
 }
 const destination=path.join(root,'extension');stageBundle(source,destination,config,{developmentDiagnostics:true});
 assert(matches(destination,development));assert(!matches(destination,production));
 const manifest=path.join(destination,'manifest.json');fs.appendFileSync(manifest,' ');assert(!matches(destination,development));
 stageBundle(source,destination,config);assert(matches(destination,production));assert(!matches(destination,development));
 assert.equal(compatibility('0.3.4',1,config),'extension_outdated');assert.equal(config.expectedExtensionVersion,'0.3.13');
});
test('a user/distribution preference cannot opt production staging into diagnostics',async t=>{
 const root=temporary(t),bridge=new MetaMuseExtensionBridge({userDataPath:root,extensionSourceDir:source,distribution:{developmentDiagnostics:true,diagnosticsEnabled:true}});
 await bridge.revealExtension();
 assert.equal(bridge.developmentDiagnostics,false);assert.equal(JSON.parse(fs.readFileSync(path.join(bridge.installDir,'manifest.json'))).version_name,undefined);
 assert(bridge.stagedBundleVerified());
 const dev=new MetaMuseExtensionBridge({userDataPath:path.join(root,'dev'),extensionSourceDir:source,developmentDiagnostics:true});
 await dev.revealExtension();assert.equal(JSON.parse(fs.readFileSync(path.join(dev.installDir,'manifest.json'))).version_name,'development-diagnostics');assert(dev.stagedBundleVerified());
});
test('source manifest tampering is rejected even when requesting the development overlay',t=>{
 const root=temporary(t);fs.cpSync(source,path.join(root,'source'),{recursive:true});
 const manifest=path.join(root,'source','manifest.json'),value=JSON.parse(fs.readFileSync(manifest));value.version_name='development-diagnostics';fs.writeFileSync(manifest,JSON.stringify(value));
 assert.throws(()=>readBundle(path.dirname(manifest),config),{code:'INVALID_REQUEST'});
 assert.throws(()=>readBundle(path.dirname(manifest),config,{developmentDiagnostics:true}),{code:'INVALID_REQUEST'});
});
for(const development of [false,true])test('main authority controls preload ownership API exposure; preferences/arguments cannot enable it: '+development,async()=>{
 const handlers={},events={};let invoked=0;
 require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{handle:(k,v)=>handlers[k]=v,on:(k,v)=>events[k]=v},getService:()=>({diagnoseMuseOwnership:()=>{invoked++;return {};}}),trusted:e=>e.trusted===true,developmentDiagnostics:development});
 const sync=events['generation:development-diagnostics'];const event={trusted:true};sync(event);assert.equal(event.returnValue,development);
 const untrusted={trusted:false};sync(untrusted);assert.equal(untrusted.returnValue,false);
 let api;const calls=[];
 vm.runInNewContext(fs.readFileSync('preload.js','utf8'),{process:{argv:['--development-diagnostics']},localStorage:{getItem:()=>true},require:name=>{
   assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer:{sendSync:channel=>{assert.equal(channel,'generation:development-diagnostics');return event.returnValue;},invoke:(...args)=>calls.push(args)}};
 }});
 assert.equal(typeof api.diagnoseMuseOwnership,development?'function':'undefined');
 const result=await handlers['generation:ownership-diagnosis']({trusted:true},'job');assert.equal(result.ok,development);assert.equal(invoked,development?1:0);
 if(development){api.diagnoseMuseOwnership('job');assert.deepEqual(calls,[['generation:ownership-diagnosis','job']]);}
 const main=fs.readFileSync('main.js','utf8');assert.match(main,/registerGenerationIpc\(\{[^\n]+developmentDiagnostics: !app\.isPackaged/);
});
test('default native IPC diagnostics capability fails closed despite an enabled service',async()=>{
 const events={},handlers={};require('../services/generation/generation-ipc').registerGenerationIpc({ipcMain:{on:(k,v)=>events[k]=v,handle:(k,v)=>handlers[k]=v},getService:()=>({diagnoseMuseOwnership:()=>{throw Error('must not execute');}}),trusted:()=>true});
 const event={};events['generation:development-diagnostics'](event);assert.equal(event.returnValue,false);
 assert.equal((await handlers['generation:ownership-diagnosis']({},'job')).errorCode,'UNAVAILABLE');
});
