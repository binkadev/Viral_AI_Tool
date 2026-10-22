const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const model=require('../renderer/core-project-media-assembly'),sceneModel=require('../renderer/core-scene-plan-model');
function harness(data=new Map(),options={}) {
 let fail=false,ids=0,submissions=[];
 class Storage {getItem(k){return data.get(k)??null;}setItem(k,v){if(fail&&k==="viral-ai-core-project-registry-v1")throw Error('quota');data.set(k,String(v));}removeItem(k){data.delete(k);}}
 const storage=new Storage(),state={page:'ai-create',locale:'en',jobs:[],media:{schemaVersion:1,assets:[],selectedAssetId:null}};
 const button={setAttribute(){}};
 const document={readyState:'loading',addEventListener(){},querySelector:s=>s==='[data-ai-generate]'?button:null,documentElement:{dataset:{}}};
 const window={ViralCoreProjectSnapshot:model,ViralCoreScenePlanModel:sceneModel,crypto:{randomUUID:()=>{ids++;return crypto.randomUUID();}},addEventListener(){},dispatchEvent(){},desktopAPI:{getGenerationStatus:async()=>({ok:true,value:{ready:options.ready!==false,state:options.ready===false?'unavailable':'ready',providers:[{id:'muse',ready:true}],modelIds:[]}}),submitGeneration:async request=>{
   const persisted=JSON.parse(storage.getItem(model.SNAPSHOT_KEY));assert.equal(persisted.projectId,request.projectId);assert.equal(persisted.scenePlan.selectedSceneId,request.sceneId);
   submissions.push(request);if(options.wait)await options.wait;return {ok:true,value:{id:'fixture-job',projectId:request.projectId}};
 }}};
 const c={window,document,Storage,localStorage:storage,state,console,HTMLVideoElement:class{},HTMLElement:class{},CustomEvent:class{},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){}};vm.createContext(c);
 vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);
 vm.runInContext(fs.readFileSync('renderer/core-project-persistence.js','utf8'),c);
 // Expose private renderer actions only inside this VM; no production test hooks.
 vm.runInContext(fs.readFileSync('renderer/core-ai-create.js','utf8').replace('  function install() {','  window.actions={generate,canGenerate,refreshReadiness,updateGenerationControls,beginNewRequest};\n  function install() {'),c);
 return {window,state,storage,data,button,submissions,get ids(){return ids;},setFail:v=>fail=v,async ready(prompt='fixture prompt'){storage.setItem('viral-ai-generation-brief',prompt);await window.actions.refreshReadiness();}};
}
(async()=>{
 const h=harness();await h.ready();assert(h.window.actions.canGenerate());assert.equal(h.window.ViralCoreProjectPersistence.snapshot(),null);
 await h.window.actions.generate();assert.equal(h.submissions.length,1);const first=h.window.ViralCoreProjectPersistence.snapshot();
 assert.equal(first.schemaVersion,5);assert.equal(first.projectKind,'ai');assert.equal(first.source,null);assert.equal(first.media.assets.length,0);assert(first.projectName);assert.equal(h.ids,3); // idempotency + project + scene
 for(let i=0;i<5;i++)h.window.actions.updateGenerationControls();assert.equal(h.ids,3);
 const admission=harness();await admission.ready();await admission.window.actions.generate();
 const admissionProject=admission.window.ViralCoreProjectPersistence.snapshot();
 const oldKey=admission.submissions[0].idempotencyKey;
 admission.window.actions.beginNewRequest({detail:{projectId:'unrelated-project'}});
 await admission.window.actions.generate();assert.equal(admission.submissions[1].idempotencyKey,oldKey);
 admission.window.actions.beginNewRequest({detail:{projectId:admissionProject.projectId}});
 assert.equal(admission.submissions.length,2,'Explicit new request prepares identity but never submits');
 await admission.window.actions.generate();assert.notEqual(admission.submissions[2].idempotencyKey,oldKey);
 assert.equal(admission.submissions[2].projectId,admissionProject.projectId);
 assert.equal(admission.submissions[2].sceneId,admissionProject.scenePlan.selectedSceneId);
 h.storage.setItem('viral-ai-generation-brief','edited prompt');assert.equal(h.window.ViralCoreProjectPersistence.ensureProject().projectId,first.projectId);
 const restart=harness(h.data);assert.equal(restart.window.ViralCoreProjectPersistence.snapshot().projectId,first.projectId);assert.equal(restart.ids,0);
 assert.equal(restart.window.ViralCoreProjectPersistence.ensureProject().scenePlan.selectedSceneId,first.scenePlan.selectedSceneId);assert.equal(restart.ids,0);
 // Normal Studio source attachment and canonical media library preserve the AI project.
 restart.state.jobs=[{id:'generated-source',name:'generated.mp4',sourcePath:'C:/app/generation/fixture.mp4',status:'completed'}];
 restart.state.media={schemaVersion:1,assets:[{id:'generated-asset',kind:'video',origin:'local',name:'generated.mp4',localPath:'C:/app/generation/fixture.mp4',status:'ready',fileState:'available'}],selectedAssetId:'generated-asset'};
 const attached=restart.window.ViralCoreProjectPersistence.flush('studio-attach');assert.equal(attached.projectId,first.projectId);assert.equal(attached.source.jobId,'generated-source');assert.equal(attached.media.assets[0].id,'generated-asset');
 assert.equal(harness(restart.data).window.ViralCoreProjectPersistence.snapshot().projectId,first.projectId);
 const bad=harness();await bad.ready();bad.setFail(true);await bad.window.actions.generate();assert.equal(bad.submissions.length,0);assert.equal(bad.window.ViralCoreProjectPersistence.snapshot(),null);assert.equal(bad.storage.getItem(model.SNAPSHOT_KEY),null);
 for(const [ready,prompt] of [[true,'   '],[false,'prompt']]){const f=harness(new Map(),{ready});await f.ready(prompt);assert(!f.window.actions.canGenerate());await f.window.actions.generate();assert.equal(f.ids,0);assert.equal(f.submissions.length,0);}
 let finish;const concurrent=harness(new Map(),{wait:new Promise(r=>finish=r)});await concurrent.ready();const pending=concurrent.window.actions.generate();await Promise.resolve();await concurrent.window.actions.generate();assert.equal(concurrent.submissions.length,1);assert.equal(concurrent.ids,3);finish();await pending;
 const old={schemaVersion:3,projectId:'imported',projectName:'Old project',source:{identity:'source',jobId:'source',path:'C:/old.mp4'},workflow:{jobs:[{id:'source',sourcePath:'C:/old.mp4'}]},scenePlan:{scenes:[]}};
 const migrated=model.migrateSnapshot(old);assert(migrated.migrated);assert.equal(migrated.snapshot.projectId,'imported');assert.equal(migrated.snapshot.projectKind,'imported');assert.equal(migrated.snapshot.schemaVersion,5);
 assert.equal(model.migrateSnapshot({...old,source:null,projectKind:'ai'}).snapshot,null,'old source-less snapshots are not silently reinterpreted');
 const imported=harness(new Map([[model.SNAPSHOT_KEY,JSON.stringify(old)]]));imported.state.jobs=old.workflow.jobs;await imported.ready();await imported.window.actions.generate();assert.equal(imported.submissions[0].projectId,'imported');
 // Failed autosave cannot erase the durable AI identity.
 const stable=harness(h.data),before=stable.storage.getItem(model.SNAPSHOT_KEY);stable.setFail(true);stable.state.output='changed';assert.equal(stable.window.ViralCoreProjectPersistence.flush(),null);assert.equal(stable.storage.getItem(model.SNAPSHOT_KEY),before);
 await stable.ready();await stable.window.actions.generate();assert.equal(stable.submissions.length,0);assert.equal(stable.storage.getItem(model.SNAPSHOT_KEY),before);
 const vi=h.window.I18N.messages.vi.videoProviders;for(const key of ['connectionHint','storeUnavailable','manualSteps'])assert(!vi[key].includes('?'));assert(vi.connectionHint.includes('Chưa thấy'));
 console.log('AI-first project lifecycle: durable creation, restart, attachment, migration, admission, failure and concurrent-click regressions passed. No provider invoked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
