"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const model=require('../renderer/core-project-media-assembly'),sceneModel=require('../renderer/core-scene-plan-model');
const KEY='viral-ai-core-project-registry-v1',BRIEF='viral-ai-generation-brief';
const json=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function imported(){
 return model.buildSnapshot({jobs:[{id:'source-old',name:'Original.mp4',sourcePath:'C:/media/original.mp4',status:'completed'},
  {id:'render-old',isRenderOutput:true,outputPath:'C:/exports/old-output.mp4',status:'completed'}],
  output:'C:/exports',media:{schemaVersion:1,selectedAssetId:'asset-old',assets:[{id:'asset-old',kind:'video',origin:'local',name:'Original.mp4',localPath:'C:/media/original.mp4',status:'ready',fileState:'available'}]},
  speech:{job:{id:'speech-old',status:'failed'},result:{sourcePath:'C:/media/original.mp4',segments:[{id:'s1',text:'old transcript'}]}},
  translation:{job:null,result:{text:'old translation'},staleJob:{id:'stale'},staleResult:{text:'stale'}},
  voice:{assignments:{speaker:'old-voice'},job:null,result:{audioPath:'old.wav'},staleResult:{audioPath:'stale.wav'}},
  scenePlan:{scenes:[{id:'scene-old',start:0,end:4}],selectedSceneId:'scene-old'}},
  {playback:{position:9},timeline:{selection:'subtitle:0',zoom:2}},null,0);
}
function harness(data=new Map(),options={}){
 let fail=options.fail||(()=>false),ids=0,renders=0,submissions=[];
 const writes=[],events=[],warnings=[];
 const feedback={textContent:""};
 class Storage{
  getItem(k){return data.get(k)??null;}
  setItem(k,v){if(fail(k,String(v)))throw Error('quota');writes.push(k);data.set(k,String(v));}
  removeItem(k){data.delete(k);}
 }
 class Element{constructor(dataset={}){this.dataset=dataset;}closest(selector){return this.targets?.[selector]||null;}}
 class Button extends Element{}
 const localStorage=new Storage(),button={disabled:true,setAttribute(){}},handlers={},windowHandlers={};
 const state={locale:'en',appearance:'midnight',motion:'reduced',scale:'comfortable',page:'ai-create',jobs:[],
  cloud:{auth:{signedIn:true},account:{fixture:true}},billing:{fixture:true},media:{schemaVersion:1,assets:[],selectedAssetId:null}};
 const document={readyState:'loading',documentElement:{dataset:{}},
  addEventListener:(name,fn)=>{(handlers[name]||=[]).push(fn);},
  querySelector:s=>s==='[data-ai-generate]'?button:s==='[data-ai-generation-feedback]'?feedback:null,querySelectorAll:()=>[],getElementById:()=>null};
 const window={ViralCoreProjectSnapshot:model,ViralCoreScenePlanModel:sceneModel,crypto:{randomUUID:()=>{ids++;return crypto.randomUUID();}},
  addEventListener:(name,fn)=>{(windowHandlers[name]||=[]).push(fn);},dispatchEvent:e=>{events.push(e);for(const fn of windowHandlers[e.type]||[])fn(e);},
  desktopAPI:{getGenerationStatus:async()=>({ok:true,value:{state:'ready',ready:true,providers:[{id:'muse',ready:true}],modelIds:[]}}),
   submitGeneration:async r=>{assert.equal(JSON.parse(data.get(KEY)).activeProjectId,r.projectId);submissions.push(r);return {ok:true,value:{id:'fixture-job',projectId:r.projectId}};}}};
 const c={window,document,Storage,localStorage,state,Element,HTMLButtonElement:Button,HTMLTextAreaElement:class extends Element{},HTMLVideoElement:class{},HTMLElement:Element,
  CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},console:{...console,warn:message=>warnings.push(message)},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},pages:{},pageMeta:{},render(){renders++;}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);
 vm.runInContext(fs.readFileSync('renderer/core-project-persistence.js','utf8'),c);
 const api=window.ViralCoreProjectPersistence;
 // Mimic the normal app bootstrap reading the compatibility projection.
 const restored=api.snapshot();if(restored)Object.assign(state,model.toLegacyState(restored,state));state.page='ai-create';
 vm.runInContext(fs.readFileSync('renderer/core-ai-create.js','utf8'),c);
 // Install the actual UI event handlers; persistence runtime is tested through its public API.
 handlers.DOMContentLoaded.at(-1)();
 function click(selector,dataset={},detail=1){const target=new Button(dataset);target.targets={[selector]:target};for(const fn of handlers.click||[])fn({target,detail});}
 return {api,state,data,localStorage,writes,events,warnings,feedback,window,submissions,button,click,context:c,
  input(text){const target=new c.HTMLTextAreaElement({aiBrief:""});target.value=text;for(const fn of handlers.input||[])fn({target});},
  get ids(){return ids;},get renders(){return renders;},setFail:f=>fail=f,
  async ready(){await tick();await tick();},page:()=>c.pages['ai-create']()};
}
const seed=()=>new Map([[model.SNAPSHOT_KEY,JSON.stringify(imported())],[BRIEF,'old project prompt']]);

test('single snapshot migration retains the canonical project exactly once across restarts',()=>{
 const data=seed(),h=harness(data),before=h.api.snapshot();
 assert.equal(h.api.listProjects().length,1);assert.equal(h.api.activeProjectId(),before.projectId);
 assert.equal(before.workflow.generationBrief,'old project prompt');
 for(let i=0;i<3;i++){
  const next=harness(data);assert.equal(next.api.listProjects().length,1);assert.equal(next.ids,0);
  assert.deepEqual(next.api.snapshot(),before);
 }
 const legacy=new Map([[model.LEGACY_STATE_KEY,JSON.stringify(model.toLegacyState(imported()))]]);
 assert.equal(harness(legacy).api.listProjects().length,1);assert.equal(harness(legacy).api.listProjects().length,1);
});
test('New AI Project retains old project, isolates runtime, and survives restart and repeated switching',async()=>{
 const h=harness(seed());await h.ready();const old=h.api.snapshot(),globals=json({cloud:h.state.cloud,billing:h.state.billing,locale:h.state.locale,appearance:h.state.appearance,motion:h.state.motion,scale:h.state.scale});
 h.state.speech.providerStatus={ready:true};h.state.speech.modelCatalog={global:true};
 const created=await h.api.createProject({kind:'ai',projectName:'Fresh AI'});
 assert.notEqual(created.projectId,old.projectId);assert.equal(created.projectKind,'ai');assert.equal(created.source,null);assert.equal(created.media.assets.length,0);
 assert.equal(created.scenePlan.scenes.length,1);assert.equal(created.scenePlan.scenes[0].sceneState,'draft');assert.equal(created.scenePlan.selectedSceneId,created.scenePlan.scenes[0].id);
 for(const section of ['speech','translation','voice'])for(const field of ['job','result','staleJob','staleResult'])assert(!h.state[section][field]);
 assert.deepEqual(h.state.voice.assignments,{});assert.equal(h.state.jobs.length,0);assert.equal(h.state.output,'');assert.equal(h.state.media.assets.length,0);
 assert.equal(h.localStorage.getItem(BRIEF),'');assert.equal(created.editor.playback.position,0);assert.equal(created.editor.timeline.selection,'none');
 assert.deepEqual(h.state.speech.providerStatus,{ready:true});
 assert.deepEqual(json({cloud:h.state.cloud,billing:h.state.billing,locale:h.state.locale,appearance:h.state.appearance,motion:h.state.motion,scale:h.state.scale}),globals);
 const registry=JSON.parse(h.data.get(KEY));assert.equal(registry.projects.length,2);assert.deepEqual(registry.projects.find(p=>p.projectId===old.projectId),old);
 const restarted=harness(h.data);await restarted.ready();assert.equal(restarted.api.listProjects().length,2);assert.equal(restarted.api.activeProjectId(),created.projectId);
 assert.equal(restarted.api.snapshot().scenePlan.selectedSceneId,created.scenePlan.selectedSceneId);
 const reopened=restarted.api.openProject(old.projectId);assert.equal(reopened.projectId,old.projectId);assert.deepEqual(reopened.source,old.source);assert.deepEqual(reopened.media,old.media);assert.deepEqual(reopened.scenePlan,old.scenePlan);
 assert.equal(restarted.localStorage.getItem(BRIEF),'old project prompt');assert.equal(restarted.state.speech.result.segments[0].text,'old transcript');
 assert.equal(restarted.api.openProject(created.projectId).projectId,created.projectId);assert.equal(restarted.state.speech.result,null);assert.equal(restarted.localStorage.getItem(BRIEF),'');
 const writes=restarted.writes.length;restarted.api.openProject(created.projectId);assert.equal(restarted.writes.length,writes);
 assert.equal(harness(restarted.data).api.activeProjectId(),created.projectId);
});
test('normal Create AI UI has separate New AI Project, coalesces double clicks, and Generate reuses its IDs',async()=>{
 const h=harness(seed());await h.ready();const html=h.page();assert(html.includes('data-ai-new-project'));assert(html.includes('data-ai-route="download"'));assert(html.includes('New AI Project'));
 h.click('[data-ai-new-project]');h.click('[data-ai-new-project]');await h.ready();h.click('[data-ai-new-project]',{},2);await h.ready();
 assert.equal(h.api.listProjects().length,2);const fresh=h.api.snapshot(),ids=h.ids;
 assert(h.page().includes('data-ai-open-project="source-old"'));assert(h.page().includes('Original.mp4'));
 h.page();h.page();assert.equal(h.ids,ids);
 h.input('fixture prompt only');await h.ready();assert.equal(h.button.disabled,false);
 h.click('[data-ai-generate]');h.click('[data-ai-generate]');await h.ready();assert.equal(h.submissions.length,1);
 assert.equal(h.submissions[0].projectId,fresh.projectId);assert.equal(h.submissions[0].sceneId,fresh.scenePlan.selectedSceneId);assert.equal(h.api.listProjects().length,2);
 h.click('[data-ai-open-project]',{aiOpenProject:'source-old'});await h.ready();assert.equal(h.api.activeProjectId(),'source-old');
});
test('failed flush/create/switch writes keep current runtime and durable selection and never submit',async()=>{
 const h=harness(seed());await h.ready();const id=h.api.activeProjectId(),dataBefore=h.data.get(KEY);
 h.state.output='unsaved export destination';h.setFail(k=>k===KEY);
 h.click('[data-ai-new-project]');await h.ready();assert.equal(h.api.activeProjectId(),id);assert.equal(h.api.listProjects().length,1);assert.equal(h.data.get(KEY),dataBefore);assert.equal(h.state.output,'unsaved export destination');assert.equal(h.submissions.length,0);
 h.setFail(()=>false);const ai=await h.api.createProject({kind:'ai',projectName:'Second'});const old=h.api.listProjects().find(p=>p.projectId!==ai.projectId);
 h.state.output='another unsaved edit';h.setFail(k=>k===KEY);const before=h.data.get(KEY);
 assert.throws(()=>h.api.openProject(old.projectId));assert.equal(h.api.activeProjectId(),ai.projectId);assert.equal(h.data.get(KEY),before);assert.equal(h.state.output,'another unsaved edit');
 h.setFail(()=>false);h.api.flush();let registryWrites=0;h.state.output='save current, fail new';
 h.setFail(k=>k===KEY&&++registryWrites===2);
 await assert.rejects(h.api.createProject({kind:'ai',projectName:'Must not exist'}));
 assert.equal(h.api.listProjects().length,2);assert.equal(JSON.parse(h.data.get(KEY)).activeProjectId,ai.projectId);assert.equal(h.state.output,'save current, fail new');
});
test('registry commit is authoritative across mirror failure and restart; corrupt/future data never overwritten',async()=>{
 const h=harness(seed());await h.ready();h.setFail(k=>k!==KEY);
 const fresh=await h.api.createProject({kind:'ai',projectName:'Registry owns selection'});
 assert.equal(h.api.activeProjectId(),fresh.projectId);assert.equal(h.localStorage.getItem(BRIEF),'');assert.equal(h.state.speech.result,null);
 h.setFail(()=>false);const restart=harness(h.data);assert.equal(restart.api.activeProjectId(),fresh.projectId);assert.equal(restart.api.snapshot().source,null);
 for(const registry of [{schemaVersion:99,activeProjectId:null,projects:[]},{schemaVersion:1,activeProjectId:'x',projects:[{...imported(),schemaVersion:99}]},'{invalid']){
  const value=typeof registry==='string'?registry:JSON.stringify(registry),data=seed();data.set(KEY,value);const f=harness(data);
  await assert.rejects(f.api.createProject({kind:'ai',projectName:'No'}));assert.throws(()=>f.api.ensureProject());assert.equal(data.get(KEY),value);assert.equal(f.api.flush(),null);
 }
 const future=seed();const futureValue=JSON.stringify({...imported(),schemaVersion:99});future.set(model.SNAPSHOT_KEY,futureValue);const f=harness(future);await assert.rejects(f.api.createProject({kind:'ai',projectName:'No'}));assert.equal(future.get(model.SNAPSHOT_KEY),futureValue);assert.equal(future.has(KEY),false);
 const invalid=new Map([[model.SNAPSHOT_KEY,JSON.stringify({schemaVersion:3,projectKind:'ai',projectId:'invalid',source:null,workflow:{}})]]);assert.equal(harness(invalid).api.listProjects().length,0);
});
test('active unscoped work blocks switching, and API concurrent creation returns one durable project',async()=>{
 const h=harness(seed());await h.ready();h.state.speech.job={status:'processing'};
 await assert.rejects(h.api.createProject({kind:'ai',projectName:'No'}),/PROJECT_WORK_RUNNING/);assert.equal(h.api.listProjects().length,1);
 h.state.speech.job={status:'failed'};const a=h.api.createProject({kind:'ai',projectName:'One'}),b=h.api.createProject({kind:'ai',projectName:'One'});assert.equal(a,b);assert.equal((await a).projectId,(await b).projectId);assert.equal(h.api.listProjects().length,2);assert.equal(h.submissions.length,0);
});
test('preview restoration runs again for a reopened project without mixing source objects',async()=>{
 const handlers={},timers=[];let reads=0;
 const old={sourcePath:'C:/media/original.mp4',fileState:'available'},state={jobs:[old]};
 const c={state,console,document:{readyState:'complete'},setTimeout:fn=>timers.push(fn),
  window:{addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent(){},desktopAPI:{fileStatus:async()=>({exists:true}),getVideoUrl:async()=>{reads++;return 'fixture-preview-'+reads;}}},save(){},render(){},CustomEvent:class{}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/core-media-restore.js','utf8'),c);
 await timers.shift()();assert.equal(old.previewUrl,'fixture-preview-1');
 handlers.focus();await timers.shift()();assert.equal(reads,1);
 const reopened={sourcePath:old.sourcePath,fileState:'available'};state.jobs=[reopened];
 handlers['viral-ai:core-state-changed']({detail:{reason:'project-switch'}});await timers.shift()();
 assert.equal(reopened.previewUrl,'fixture-preview-2');assert.equal(old.previewUrl,'fixture-preview-1');
});


test('valid registry remains authoritative over a future compatibility mirror and repairs it',async()=>{
 const h=harness(seed());await h.ready();const a=h.api.snapshot();
 const b=await h.api.createProject({kind:'ai',projectName:'Active B'});
 const registryBefore=h.data.get(KEY);
 h.data.set(model.SNAPSHOT_KEY,JSON.stringify({...a,schemaVersion:99}));
 const restarted=harness(h.data);await restarted.ready();
 assert.equal(restarted.api.storageError(),null);assert.equal(restarted.api.unsupportedSchemaVersion(),null);
 assert.equal(restarted.api.activeProjectId(),b.projectId);assert.equal(restarted.api.snapshot().projectId,b.projectId);
 assert.equal(restarted.api.listProjects().length,2);assert.equal(restarted.data.get(KEY),registryBefore);
 assert.equal(JSON.parse(restarted.data.get(model.SNAPSHOT_KEY)).projectId,b.projectId);
 assert.equal(JSON.parse(restarted.data.get(model.SNAPSHOT_KEY)).schemaVersion,5);
 assert.equal(restarted.api.openProject(a.projectId).projectId,a.projectId);
 assert.equal(restarted.api.openProject(b.projectId).projectId,b.projectId);
 assert.equal(restarted.submissions.length,0);
});
for(const stage of ['render','detach','pause'])test('committed project ownership survives presentation failure: '+stage,async()=>{
 const h=harness(seed());await h.ready();const a=h.api.snapshot();let failures=0;
 const fail=()=>{
  const id=JSON.parse(h.data.get(KEY)).activeProjectId;
  assert.equal(h.api.activeProjectId(),id);assert.equal(h.api.snapshot().projectId,id);assert.equal(h.state.projectId,id);
  failures++;throw Error('injected presentation failure');
 };
 if(stage==='render')h.context.render=fail;
 if(stage==='detach')h.context.document.getElementById=()=>({replaceChildren:fail});
 if(stage==='pause'){
  const video=new h.context.HTMLVideoElement();video.isConnected=true;video.pause=fail;
  const query=h.context.document.querySelector;h.context.document.querySelector=s=>s.includes('video.')?video:query(s);
 }
 const b=await h.api.createProject({kind:'ai',projectName:'Committed B'});
 assert.notEqual(b.projectId,a.projectId);assert.equal(h.api.activeProjectId(),b.projectId);assert.equal(h.state.projectId,b.projectId);
 assert.equal(h.state.projectName,b.projectName);assert.equal(h.state.jobs.length,0);assert.equal(h.state.scenePlan.selectedSceneId,b.scenePlan.selectedSceneId);
 assert(failures>0);assert(h.events.some(e=>e.type==='viral-ai:project-presentation-failed'&&e.detail.stage===stage));
 assert(!h.events.some(e=>e.type==='viral-ai:project-snapshot-save-failed'&&e.detail.reason==='project-switch'));
 assert.equal(h.api.openProject(a.projectId).projectId,a.projectId);assert.equal(h.state.projectId,a.projectId);assert.equal(h.state.jobs[0].sourcePath,a.source.path);
 await h.ready();assert.equal(harness(h.data).api.activeProjectId(),a.projectId);assert.equal(h.submissions.length,0);
});
test('UI action never reports current-workspace-retained after render fails for a committed switch',async()=>{
 const h=harness(seed());await h.ready();const a=h.api.activeProjectId();
 h.context.render=()=>{throw Error('presentation only');};
 h.click('[data-ai-new-project]');await h.ready();
 const b=h.api.activeProjectId();assert.notEqual(b,a);assert.equal(JSON.parse(h.data.get(KEY)).activeProjectId,b);
 assert.equal(h.api.snapshot().projectId,b);assert.equal(h.state.projectId,b);assert.equal(h.feedback.textContent,'');
 assert(h.warnings.length>0);assert.equal(h.api.listProjects().length,2);assert.equal(h.submissions.length,0);
});
test('target preparation failure and pre-commit registry failure leave runtime ownership unchanged',async()=>{
 const h=harness(seed());await h.ready();const a=h.api.snapshot();
 const b=await h.api.createProject({kind:'ai',projectName:'B'});h.api.openProject(a.projectId);
 const oldRuntime=h.state.speech,oldRegistry=h.data.get(KEY);
 Object.defineProperty(h.state,'media',{value:h.state.media,writable:false,configurable:true});
 assert.throws(()=>h.api.openProject(b.projectId),/PROJECT_STATE_UNAVAILABLE/);
 assert.equal(h.data.get(KEY),oldRegistry);assert.equal(h.api.activeProjectId(),a.projectId);assert.equal(h.state.projectId,a.projectId);assert.equal(h.state.speech,oldRuntime);
 Object.defineProperty(h.state,'media',{value:h.state.media,writable:true,configurable:true});
 h.setFail(k=>k===KEY);
 assert.throws(()=>h.api.openProject(b.projectId));assert.equal(h.data.get(KEY),oldRegistry);
 assert.equal(h.api.activeProjectId(),a.projectId);assert.equal(h.api.snapshot().projectId,a.projectId);assert.equal(h.state.projectId,a.projectId);assert.equal(h.state.speech,oldRuntime);
});
