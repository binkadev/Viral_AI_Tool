"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {harness,draft,KEY,clone,snapshotModel}=require('./helpers/project-media-harness');
const f=require('./helpers/production-manager-fixtures'),audio=require('../renderer/core-project-audio-model');
const identity=require('../renderer/core-project-identity');
const seed=projects=>new Map([[KEY,JSON.stringify({schemaVersion:1,activeProjectId:projects[0].projectId,projects})]]);
const labelOnly=p=>{const q=clone(p);delete q.projectName;delete q.updatedAt;return q;};

test('active rename commits Registry before live metadata and preserves every other semantic field',()=>{
  const h=harness();h.api.flush();const before=h.api.snapshot(),events=h.events.length;
  h.inspect=()=>{assert.equal(h.state.projectName,before.projectName);assert.equal(h.api.snapshot().projectName,before.projectName);};
  const next=h.api.renameProject('A','  Campaign Tết 2027  ');assert.equal(next.projectName,'Campaign Tết 2027');
  assert.equal(h.state.projectName,next.projectName);assert.equal(h.api.activeProjectId(),'A');assert.deepEqual(labelOnly(next),labelOnly(before));
  assert.equal(JSON.parse(h.data.get(KEY)).projects.find(p=>p.projectId==='A').projectName,next.projectName);
  assert.deepEqual(h.events.slice(events).filter(e=>e.detail?.reason==='project-rename').map(e=>e.type),['viral-ai:project-snapshot-saved','viral-ai:core-state-changed']);
  assert.deepEqual(clone(h.events.at(-2).detail),{reason:'project-rename',projectId:'A',schemaVersion:5});
});
test('active rename durably preserves pending Scene/brief changes through existing flush',()=>{
  const h=harness();h.state.scenePlan.scenes[0].title='Pending edit';h.data.set('viral-ai-generation-brief','Unsaved brief');
  h.api.renameProject('A','Renamed');assert.equal(h.api.snapshot().scenePlan.scenes[0].title,'Pending edit');assert.equal(h.api.snapshot().workflow.generationBrief,'Unsaved brief');
});
test('inactive rename never changes active snapshot/runtime/page/playback and only emits save',()=>{
  const h=harness(),live=clone(h.state),active=h.api.snapshot(),stored=h.api.projectAudioSnapshot('B'),events=h.events.length;
  const next=h.api.renameProject('B','Review iPhone 18 Pro');assert.deepEqual(h.state,live);assert.deepEqual(h.api.snapshot(),active);assert.equal(h.api.activeProjectId(),'A');
  assert.deepEqual(labelOnly(next),labelOnly(stored));assert.deepEqual(h.events.slice(events).map(e=>e.type),['viral-ai:project-snapshot-saved']);
});
for(const name of ['', '   ', '\n\t'])test('explicit empty name rejected without any mutation '+JSON.stringify(name),()=>{
  const h=harness(),before=h.data.get(KEY),live=clone(h.state),writes=h.writes;
  assert.throws(()=>h.api.renameProject('A',name),/PROJECT_NAME_INVALID/);assert.equal(h.data.get(KEY),before);assert.deepEqual(h.state,live);assert.equal(h.writes,writes);
});
for(const name of ['Video sản phẩm — Áo khoác','我的视频项目','  spaces  inside  preserved  ','Rất dài '.repeat(300)])test('Unicode and unbounded explicit names round-trip '+name.slice(0,30),()=>{
  const h=harness();assert.equal(h.api.renameProject('A',name).projectName,name.trim());assert.equal(h.api.listProjects()[0].projectName,name.trim());
});
test('duplicate custom names allowed; no name-based ownership',()=>{const h=harness();h.api.renameProject('A','Same');h.api.renameProject('B','Same');assert.deepEqual(clone(h.api.listProjects().map(p=>p.projectName)),['Same','Same']);assert.equal(h.api.activeProjectId(),'A');});
test('normalized identical name is idempotent even with pending runtime edits',()=>{
  const h=harness(),p=h.api.snapshot(),before=h.data.get(KEY),writes=h.writes,events=h.events.length;h.state.scenePlan.scenes[0].title='Not flushed by no-op';
  assert.deepEqual(h.api.renameProject('A','  A  '),p);assert.equal(h.data.get(KEY),before);assert.equal(h.writes,writes);assert.equal(h.events.length,events);
});
test('Registry write failure preserves old live and durable name for active/inactive',()=>{
  for(const id of ['A','B']){const h=harness();h.api.flush();const live=clone(h.state),before=h.data.get(KEY);h.fail=true;
    assert.throws(()=>h.api.renameProject(id,'Never committed'),/quota/);assert.equal(h.data.get(KEY),before);assert.deepEqual(h.state,live);assert(!h.events.some(e=>e.detail?.reason==='project-rename'&&e.type==='viral-ai:project-snapshot-saved'));}
});
test('mismatched runtime identity and readonly name fail before rename commit',()=>{
  for(const mode of ['mismatch','readonly','accessor']){const h=harness(),before=h.data.get(KEY),writes=h.writes;
    if(mode==='mismatch')h.state.projectId='B';else Object.defineProperty(h.state,'projectName',mode==='readonly'?{value:'A',writable:false}:{get:()=> 'A'});
    assert.throws(()=>h.api.renameProject('A','No'),/PROJECT_STATE_UNAVAILABLE/);assert.equal(h.data.get(KEY),before);assert.equal(h.writes,writes);}
});
test('transition reentrancy is rejected at Registry boundary',()=>{const h=harness();h.api.flush();let calls=0;h.inspect=()=>{calls++;assert.throws(()=>h.api.renameProject('B','No'),/PROJECT_TRANSITION_PENDING/);};h.api.renameProject('A','Yes');assert.equal(calls,1);});
test('missing target never recreates storage; protected Registry never overwritten',()=>{
  const h=harness(),writes=h.writes;assert.throws(()=>h.api.renameProject('gone','Name'),/PROJECT_NOT_FOUND/);assert.equal(h.writes,writes);
  const protectedData=new Map([[KEY,'{"schemaVersion":99,"projects":[]}']]),p=(()=>{class Storage{getItem(k){return protectedData.get(k)??null;}setItem(){throw Error('Must not write');}removeItem(){}}const c={Storage,localStorage:new Storage(),window:{ViralCoreProjectSnapshot:snapshotModel,dispatchEvent(){}},document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},state:{}};vm.runInNewContext(fs.readFileSync('renderer/core-project-persistence.js','utf8'),c);return {api:c.window.ViralCoreProjectPersistence};})();assert.throws(()=>p.api.renameProject('A','Name'),/PROJECT_STORAGE_PROTECTED/);assert.equal(protectedData.get(KEY),'{"schemaVersion":99,"projects":[]}');
});
test('restart repairs stale compatibility names and locale/switch never replace rename',()=>{
  const h=harness();h.api.renameProject('A','Video thời trang TikTok');h.data.set(snapshotModel.LEGACY_STATE_KEY,JSON.stringify({projectName:'Wrong legacy',locale:'en'}));
  const r=harness(h.data);assert.equal(r.state.projectName,'Video thời trang TikTok');assert.equal(r.state.projectId,'A');
  assert.equal(JSON.parse(r.data.get(snapshotModel.LEGACY_STATE_KEY)).projectName,'Video thời trang TikTok');r.state.locale='vi';r.api.flush();r.api.openProject('B');r.api.openProject('A');assert.equal(r.state.projectName,'Video thời trang TikTok');assert.equal(harness(r.data).api.snapshot().projectName,'Video thời trang TikTok');
});
test('old names are not migrated or localized and imported names do not rename files',()=>{
  const a=draft('A');a.projectName='Dự án AI mới';const h=harness(seed([a,draft('B')]));assert.equal(h.api.snapshot().projectName,'Dự án AI mới');
  const imported=f.snapshot.buildSnapshot({jobs:[{id:'source',name:'Original.mp4',sourcePath:'C:/media/Original.mp4',status:'completed'}]}, {},null,0),p=harness(seed([imported]));
  const before=p.api.snapshot();const after=p.api.renameProject('source','New imported label');assert.equal(after.projectKind,'imported');assert.deepEqual(labelOnly(after),labelOnly(before));assert.equal(after.source.path,'C:/media/Original.mp4');
});
test('current render signature/output and historical job name survive rename exactly',()=>{
  const p=f.project('A');p.workflow.jobs.push(f.job(p,'completed'));const h=harness(seed([p,draft('B')])),before=h.api.snapshot(),plan=f.renderModel.build(before),output=f.renderModel.outputs(before,plan);
  assert(plan.ready&&output[0].current);const after=h.api.renameProject('A','New video label'),next=f.renderModel.build(after);
  assert.equal(next.renderInputSignature,plan.renderInputSignature);assert.equal(f.renderModel.outputs(after,next)[0].current,true);assert.deepEqual(after.workflow.jobs,before.workflow.jobs);
  const manager=require('../renderer/core-production-manager-model'),summarize=s=>manager.summarize({snapshot:s,materialSummary:f.productionModel.summarize(s,f.actionModel),renderPlan:f.renderModel.build(s),renderOutputs:f.renderModel.outputs(s,f.renderModel.build(s)),health:()=> 'available'});
  assert.equal(summarize(before).status,'ready');assert.equal(summarize(after).status,'ready');
});
test('current Voice/audio signature and all generation/material structures survive rename',()=>{
  const {setup,result}=require('./helpers/project-audio-harness'),a=setup(),p=a.project(),plan=a.plan();
  const voice={projectId:'A',inputSignature:plan.inputSignature,...result({...plan,jobId:'voice',segments:plan.segments})};
  a.h.state.voice.result=voice;a.h.api.flush();const before=a.project(),current=audio.currentVoice(before,a.plan());assert(current);
  const after=a.h.api.renameProject('A','Voice label');assert.equal(audio.voicePlan(after,a.player.buildProjectPlayback(after)).inputSignature,plan.inputSignature);assert.deepEqual(after.workflow,before.workflow);assert.deepEqual(after.media,before.media);assert.deepEqual(after.mediaAssembly,before.mediaAssembly);assert.deepEqual(after.scenePlan,before.scenePlan);assert.deepEqual(audio.currentVoice(after,a.plan()),current);
});
test('Batch membership/order/status remains byte-identical while Manager resolves renamed labels',()=>{
  const h=harness(),storeModule=require('../renderer/core-batch-production-store'),store=storeModule.create({storage:h.c.localStorage}),now='2026-10-23T12:00:00Z';
  store.write({schemaVersion:1,current:{batchId:'batch-identity',projectIds:['B','A'],outputDir:'C:/exports',status:'paused',cursor:0,pauseRequested:false,stopRequested:false,reason:null,createdAt:now,updatedAt:now,startedAt:now,completedAt:null,items:['B','A'].map(projectId=>({projectId,status:'pending',stage:'pending',reason:null,startedAt:null,completedAt:null}))}});const before=h.data.get(storeModule.KEY),view=store.read();
  h.api.renameProject('B','Batch label');assert.equal(h.data.get(storeModule.KEY),before);assert.deepEqual(store.read(),view);assert.equal(h.api.listProjects().find(p=>p.projectId==='B').projectName,'Batch label');assert(!h.events.some(e=>e.type.includes('telegram')||e.type.includes('batch-production')));
});

function editorHarness({failure=null,delay=false}={}) {
  const handlers={},calls=[],projects=[{projectId:'A',projectName:'Before'},{projectId:'B',projectName:'Other'}];let current='A',resolve,reject,changed=0;
  const c={window:{}};vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),c);
  const controller=identity.create({owner:'ai',locale:()=> 'vi',currentId:()=>current,document:{addEventListener:(n,fn)=>handlers[n]=fn},i18n:c.window.I18N,changed:()=>changed++,
    persistence:{listProjects:()=>projects,renameProject:(id,name)=>{calls.push({id,name});if(delay)return new Promise((a,b)=>{resolve=a;reject=b;});if(failure)throw Error(failure);projects.find(p=>p.projectId===id).projectName=name.trim();}}});
  const node=kind=>({value:'',disabled:false,closest:s=>s==='[data-project-identity]'?{dataset:{projectIdentity:'ai'}}:s===kind?{}:null,matches:s=>s===kind});
  return {controller,calls,projects,handlers,html:()=>controller.markup(current,projects.find(p=>p.projectId===current).projectName),click(kind){handlers.click({target:node(kind)});},input(value){const n=node('[data-project-name]');n.value=value;handlers.input({target:n});},key(key){handlers.keydown({target:node('[data-project-name]'),key,preventDefault(){}});},switch(id){current=id;},resolve:()=>resolve?.(),reject:()=>reject?.(Error('quota')),get changed(){return changed;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('inline editor Cancel/Escape never persist, Enter saves once, and full input is accessible without maxlength',async()=>{
  const h=editorHarness();h.click('[data-project-name-rename]');h.input('Draft');assert(h.html().includes('value="Draft"'));assert(!h.html().includes('maxlength'));assert(h.html().includes('<label'));
  h.key('Escape');assert.equal(h.calls.length,0);assert(h.html().includes('Before'));h.click('[data-project-name-rename]');h.input(' New ');h.key('Enter');h.click('[data-project-name-save]');await tick();assert.deepEqual(h.calls,[{id:'A',name:' New '}]);assert(h.html().includes('New'));
});
test('pending rename survives rerender and duplicate Save intent is suppressed',async()=>{const h=editorHarness({delay:true});h.click('[data-project-name-rename]');h.input('Submitted');h.click('[data-project-name-save]');assert(h.html().includes('disabled'));h.click('[data-project-name-save]');h.key('Enter');assert.equal(h.calls.length,1);h.resolve();await tick();});
test('selection change cannot retarget pending rename or attach stale feedback',async()=>{const h=editorHarness({delay:true});h.click('[data-project-name-rename]');h.input('Exact A');h.key('Enter');h.switch('B');assert(h.html().includes('Other'));h.reject();await tick();assert(h.html().includes('Other'));assert(!h.html().includes('role="alert"'));assert.deepEqual(h.calls,[{id:'A',name:'Exact A'}]);});
test('rename failures keep draft open with friendly localized alert and retry available',async()=>{for(const failure of ['PROJECT_NAME_INVALID','PROJECT_NOT_FOUND','PROJECT_TRANSITION_PENDING','PROJECT_STORAGE_PROTECTED','quota']){const h=editorHarness({failure});h.click('[data-project-name-rename]');h.input('Keep draft');h.key('Enter');await tick();const html=h.html();assert(html.includes('Keep draft')&&html.includes('role="alert"'));assert(!html.includes(failure));assert(!html.includes(' disabled'));}});

function aiHarness(locale, existing=null) {
  const handlers={},created=[],ensured=[],submitted=[],data=new Map([['viral-ai-generation-brief','Local fixture brief']]);let project=existing;
  class Element{constructor(kind){this.kind=kind;this.dataset={};}closest(s){return s===this.kind?this:null;}}
  const document={readyState:'loading',documentElement:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(n,fn)=>(handlers[n]||=[]).push(fn)};
  const window={crypto:{randomUUID:()=> 'request-id'},ViralCoreScenePlanModel:{},addEventListener(){},
    ViralCoreProjectPersistence:{snapshot:()=>project,listProjects:()=>project?[{...project,projectKind:'ai'}]:[],activeProjectId:()=>project?.projectId,
      createProject:async options=>{created.push(options);project={projectId:'new-id',projectName:options.projectName,scenePlan:{selectedSceneId:'scene'}};return project;},
      ensureProject:options=>{ensured.push(options);project ||= {projectId:'implicit-id',projectName:options.projectName,scenePlan:{selectedSceneId:'scene'}};return project;}},
    desktopAPI:{getGenerationStatus:async()=>({ok:true,value:{state:'ready',ready:true}}),submitGeneration:async payload=>{submitted.push(payload);return {ok:true,value:{}};}}};
  const c={window,document,state:{page:'ai-create',locale,jobs:[]},pages:{},pageMeta:{},render(){},Element,HTMLButtonElement:Element,HTMLTextAreaElement:Element,
    localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},Date:class extends Date{constructor(...args){super(...(args.length?args:[2026,9,23,21,49,32]));}},console};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);vm.runInContext(fs.readFileSync('renderer/core-ai-create.js','utf8'),c);handlers.DOMContentLoaded[0]();
  return {created,ensured,submitted,c,get project(){return project;},click(kind){for(const fn of handlers.click)fn({target:new Element(kind),detail:1});}};
}
for(const locale of ['vi','en'])for(const path of ['explicit','implicit'])test('localized timestamp default for '+locale+' '+path+' creation path',async()=>{
  const h=aiHarness(locale);await tick();h.click(path==='explicit'?'[data-ai-new-project]':'[data-ai-generate]');await tick();
  assert.equal(h.project.projectName,(locale==='vi'?'Dự án AI':'AI Project')+' · 2026-10-23 21:49:32');assert.equal((path==='explicit'?h.created:h.ensured).length,1);
  if(path==='implicit')assert.equal(h.submitted[0].projectId,'implicit-id');
});
test('Generate reuses canonical user identity after locale change without applying another default',async()=>{
  const project={projectId:'stable-id',projectName:'User name · 我的项目',scenePlan:{selectedSceneId:'selected-scene'}},h=aiHarness('vi',project);await tick();h.c.state.locale='en';h.click('[data-ai-generate]');await tick();
  assert.equal(h.project.projectName,project.projectName);assert.equal(h.submitted[0].projectId,'stable-id');assert.equal(h.submitted[0].sceneId,'selected-scene');assert.equal(h.created.length,0);
});
