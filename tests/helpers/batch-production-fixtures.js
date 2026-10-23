"use strict";
const f = require("./production-manager-fixtures");
const model = require("../../renderer/core-batch-production-model");
const storeModule = require("../../renderer/core-batch-production-store");
const runtimeModule = require("../../renderer/core-batch-production-runtime");
const audioModel = require("../../renderer/core-project-audio-model");
const managerModel = require("../../renderer/core-production-manager-model");
function voice(p) {
  const plan = audioModel.voicePlan(p, f.player.buildProjectPlayback(p));
  p.workflow.voice.result = {...plan, textSource:plan.requestedSource, segments:plan.segments.map(s => ({...s, audioPath:"C:/fixture/voice.wav", audioUrl:"file:///C:/fixture/voice.wav", audioDuration:s.end-s.start}))};
}
function projects() {
  const ps = Array.from({length:8}, (_,i) => f.project("P" + (i+1), 2));
  ps[0].workflow.jobs.push(f.job(ps[0], "ready"));
  ps[1].mediaAssembly.slots.forEach(s => {s.selectedAssetId = null;});
  for (const p of [ps[3], ps[4]]) {p.workflow.renderOptions.voiceEnabled = true; p.workflow.voice.assignments = {"speaker-1":"fixture-voice"}; p.workflow.speech.language = "vi";}
  voice(ps[3]); ps[5].workflow.renderOptions.bgmAssetId = "missing-bgm";
  ps[7].mediaAssembly.slots.forEach(s => {s.selectedAssetId = null;});
  return ps;
}
function deferred() {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject};}
function memory(seed = null) {
  const values = new Map(seed ? [[storeModule.KEY, typeof seed === "string" ? seed : JSON.stringify(seed)]] : []);
  let broken = false, writes = 0;
  return {values, get writes() {return writes;}, fail() {broken=true;},
    getItem:key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {if (broken) throw Error("quota"); writes++; values.set(key,value);}, removeItem:key => values.delete(key)};
}
function harness(options = {}) {
  const data = new Map((options.projects || projects()).map(p => [p.projectId, f.clone(p)])), calls = [], storage = options.storage || memory();
  const store = storeModule.create({storage}), health = new Map(), holds = new Map(), failures = new Map(), watchers = new Set();
  let active = "initial", productionView = {state:"idle", settling:false}, productionTask = Promise.resolve(), running = 0, max = 0, runtime, protectedProject = false;
  const pendingVoice = new Set(), pendingRender = new Set();
  const changed = () => {
    if (!runtime) return;
    const v = runtime.view();
    if (v.progress.active > 1) throw Error("multiple active items");
    for (const w of [...watchers]) if (w.predicate(v)) {watchers.delete(w); w.resolve(v);}
    options.changed?.(v);
  };
  const persistence = {listProjects:() => [...data.values()].map(p => ({projectId:p.projectId, projectName:p.projectName})),
    projectAudioSnapshot:id => data.has(id) ? f.clone(data.get(id)) : null, activeProjectId:() => active,
    openProject(id) {calls.push(["open",id]); if (failures.get("open:"+id)) throw Error(failures.get("open:"+id)); active=id; runtime?.observe();},
    storageError:() => protectedProject ? "fixture" : null, unsupportedSchemaVersion:() => null};
  const wait = (stage,id) => {const hold=holds.get(stage+":"+id);hold?.entered.resolve();return hold?.promise || Promise.resolve();};
  const production = {view:() => f.clone(productionView), settled:() => productionTask,
    start(id,mode) {
      calls.push(["materials",id,mode]); if (failures.get("materials-start:"+id)) return false;
      productionView = {state:"running", settling:true, run:{projectId:id}, summary:{scenes:[]}, current:id+"-scene-0", phase:"sourcing"};
      productionTask = Promise.resolve().then(async () => {
        await wait("materials",id);
        const p=data.get(id), failed=failures.get("materials:"+id) || (id === "P8" ? "RECOVERY_REQUIRED" : null);
        if (p && !failed && active===id) p.mediaAssembly.slots.forEach(s => {s.selectedAssetId=s.candidateAssetIds[0]; s.selectionSource="auto";});
        productionView = {state:failed ? "needs_attention" : "completed", settling:false, run:{projectId:id}, summary:{scenes:failed ? [{reason:failed}] : []}};
      }); return true;
    }, pause() {throw Error("lower pause forbidden");}, stop() {throw Error("lower stop forbidden");}};
  const audio = {view:id => ({busy:pendingVoice.has(id), state:"generating", percent:30}), async generate(id) {
    calls.push(["voice",id]); pendingVoice.add(id);
    try {await wait("voice",id); const reason=failures.get("voice:"+id); if (reason) return {ok:false,reason}; if(data.has(id)) voice(data.get(id)); return {ok:true};}
    finally {pendingVoice.delete(id);}
  }, cancel() {throw Error("voice cancel forbidden");}};
  const render = {view:id => ({projectId:id, busy:pendingRender.has(id), state:"scenes", percent:35, sceneIndex:1, sceneCount:2}), async start(id,dir) {
    calls.push(["render",id,dir]); pendingRender.add(id); running++; max=Math.max(max,running);
    try {await wait("render",id); const reason=failures.get("render:"+id) || (id === "P7" ? "fixture failure / raw stack" : null);
      if (reason) return {ok:false,reason}; const p=data.get(id); if(p)p.workflow.jobs.push(f.job(p,"render-"+id)); return {ok:true};}
    finally {pendingRender.delete(id); running--;}
  }, cancel() {throw Error("render cancel forbidden");}};
  const desktop = {async fileStatus(path) {const directory=!path.endsWith(".mp4");calls.push([directory?"directory":"file",path]); await wait("file",path); const value=health.get(path); if(value instanceof Error)throw value; return value || (directory?{exists:false,sizeBytes:0,modifiedAt:1}:{exists:true,sizeBytes:1024});}};
  runtime = runtimeModule.create({model,store,persistence,productionModel:f.productionModel,actionModel:f.actionModel,production,audioModel,audio,renderModel:f.renderModel,render,
    player:f.player,managerModel,desktop,id:() => "batch-fixture-"+(storage.writes+1),changed});
  return {runtime,store,storage,data,calls,health,holds,failures,persistence,production,audio,render,desktop,
    active:() => active, switch(id) {active=id;runtime.observe();}, protect() {protectedProject=true;}, max:() => max,
    hold(stage,id) {const d=deferred();d.entered=deferred();holds.set(stage+":"+id,d);return d;},
    until(predicate) {const v=runtime.view();if(predicate(v))return Promise.resolve(v);return new Promise(resolve => watchers.add({predicate,resolve}));},
    create(ids,dir="C:/batch-output") {return runtime.create(ids,dir);}};
}
module.exports = {...f,model,storeModule,runtimeModule,audioModel,managerModel,voice,projects,memory,harness,deferred};
