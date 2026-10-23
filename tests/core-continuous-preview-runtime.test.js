"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),model=require("../renderer/core-player-model"),{create}=require("../renderer/core-player-project-runtime");
const clone=v=>JSON.parse(JSON.stringify(v)),drain=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
function project(kinds=["video","video","video"]){return {projectId:"A",scenePlan:{selectedSceneId:"s0",scenes:kinds.map((kind,i)=>({id:"s"+i,order:i,start:10*i,end:10*i+2}))},
 media:{assets:kinds.map((kind,i)=>({id:"a"+i,kind,status:"ready",localPath:"C:/"+i,meta:{duration:2}}))},mediaAssembly:{slots:kinds.map((_,i)=>({sceneId:"s"+i,role:"primary",candidateAssetIds:["a"+i],selectedAssetId:"a"+i}))}}}
function harness(p=project()){
 let time=0,id=0,fail=null,deferred=null;const frames=new Map(),bindings=[],states=[];
 const runtime=create({model,now:()=>time,raf:fn=>{frames.set(++id,fn);return id},cancel:id=>frames.delete(id),changed:s=>states.push(s),
 bind:(entry,asset,token,events)=>{const b={entry,asset,token,events,plays:0,pauses:0,disposed:0,seeks:[],play:()=>{b.plays++;return deferred||fail?deferred||Promise.reject(Error(fail)):Promise.resolve()},pause:()=>b.pauses++,dispose:()=>b.disposed++,seek:t=>b.seeks.push(t)};bindings.push(b);return b}});
 runtime.load(p);return {runtime,bindings,states,p,async ready(){await drain()},set fail(v){fail=v},set deferred(v){deferred=v},async tick(ms){time+=ms;const all=[...frames.values()];frames.clear();for(const fn of all)fn(time);await drain()},get frameCount(){return frames.size}};
}
test("video A→B→C advances once despite duplicate/stale ended/time signals; no selection writes",async()=>{
 const p=project(),before=clone(p),h=harness(p);await h.ready();h.runtime.play();h.runtime.play();await h.ready();assert.equal(h.bindings[0].plays,1);
 const a=h.bindings[0];a.events.time(2);a.events.ended();await h.ready();assert.equal(h.bindings.length,2);assert.equal(h.runtime.snapshot().activeSceneId,"s1");
 const state=h.runtime.snapshot();a.events.time(999);a.events.ended();a.events.metadata(999);a.events.error();assert.deepEqual(h.runtime.snapshot(),state);
 h.bindings[1].events.ended();await h.ready();h.bindings[2].events.ended();assert.equal(h.runtime.snapshot().playbackState,"ended");assert.equal(h.runtime.snapshot().currentTime,6);assert.deepEqual(p,before);
});
test("video→image→video uses monotonic RAF; pause/resume excludes paused time and transitions once",async()=>{
 const h=harness(project(["video","image","video"]));await h.ready();h.runtime.play();await h.ready();h.bindings[0].events.ended();await h.ready();
 assert.equal(h.runtime.snapshot().activeSceneId,"s1");await h.tick(500);assert.equal(h.runtime.snapshot().currentTime,2.5);
 h.runtime.pause();await h.tick(10000);assert.equal(h.runtime.snapshot().currentTime,2.5);h.runtime.play();await h.ready();await h.tick(500);assert.equal(h.runtime.snapshot().currentTime,3);
 await h.tick(1000);assert.equal(h.runtime.snapshot().activeSceneId,"s2");assert.equal(h.bindings.length,3);assert.equal(h.frameCount,0);
});
for(const playing of [false,true])test("cross-Scene seeks preserve "+(playing?"playing":"paused")+" intent",async()=>{
 const h=harness();await h.ready();if(playing){h.runtime.play();await h.ready()}
 for(const [t,id,local]of [[1,"s0",1],[2,"s1",0],[3,"s1",1],[4,"s2",0],[5.5,"s2",1.5]]){h.runtime.seek(t);await h.ready();assert.equal(h.runtime.snapshot().activeSceneId,id);assert.equal(h.bindings.at(-1).seeks.at(-1),local);assert.equal(h.runtime.snapshot().playbackState,playing?"playing":"paused")}
 h.runtime.seek(6);await h.ready();assert.equal(h.runtime.snapshot().playbackState,"ended");
});
test("blocked missing Scene is not skipped at boundary",async()=>{
 const p=project();p.mediaAssembly.slots[1].selectedAssetId=null;const h=harness(p);await h.ready();h.runtime.play();await h.ready();h.bindings[0].events.ended();await h.ready();
 assert.equal(h.runtime.snapshot().activeSceneId,"s1");assert.equal(h.runtime.snapshot().currentTime,2);assert.equal(h.runtime.snapshot().playbackState,"blocked");assert.equal(h.bindings.length,1);
});
test("zero-duration image stops at exact boundary without invented duration or hidden renderer",async()=>{
 const p=project(["video","image","video"]);p.scenePlan.scenes[1].end=p.scenePlan.scenes[1].start;const h=harness(p);await h.ready();h.runtime.play();await h.ready();h.bindings[0].events.ended();await h.ready();assert.equal(h.runtime.snapshot().reason,"duration-unresolved");assert.equal(h.runtime.snapshot().currentTime,2);assert.equal(h.bindings.length,1);
});
test("unknown native video duration resolves ephemerally and never alters AssetRef",async()=>{
 const p=project();p.media.assets[0].meta.duration=0;const before=clone(p),h=harness(p);await h.ready();assert.equal(h.runtime.snapshot().playbackState,"blocked");h.bindings[0].events.metadata(3);assert.equal(h.runtime.snapshot().duration,7);assert.equal(h.runtime.snapshot().playbackState,"paused");assert.deepEqual(p,before);
});
test("autoplay rejection pauses at next boundary and only explicit Play retries",async()=>{
 const h=harness();await h.ready();h.runtime.play();await h.ready();h.fail="autoplay";h.bindings[0].events.ended();await h.ready();assert.equal(h.runtime.snapshot().currentTime,2);assert.equal(h.runtime.snapshot().reason,"play-rejected");assert.equal(h.bindings[1].plays,1);
 await h.ready();assert.equal(h.bindings[1].plays,1);h.fail=null;h.runtime.play();await h.ready();assert.equal(h.runtime.snapshot().playbackState,"playing");
});
test("Project switch invalidates queued video events, metadata and image RAF",async()=>{
 const h=harness(project(["image","video","video"]));await h.ready();h.runtime.play();await h.tick(500);const old=h.bindings[0],b=project();b.projectId="B";h.runtime.load(b);await h.ready();const before=h.runtime.snapshot();
 old.events.time(999);old.events.ended();old.events.metadata(999);old.events.error();await h.tick(5000);assert.deepEqual(h.runtime.snapshot(),before);assert.equal(old.disposed,1);
});
test("late play promise cannot resume the old renderer after Project switch",async()=>{
 const h=harness();await h.ready();let done;h.deferred=new Promise(r=>done=r);h.runtime.play();const old=h.bindings[0];const b=project();b.projectId="B";h.runtime.load(b);h.deferred=null;await h.ready();const before=h.runtime.snapshot();done();await h.ready();assert.deepEqual(h.runtime.snapshot(),before);assert.equal(old.disposed,1);
});
for(const mutation of ["reorder","delete","material","candidate","asset"])test(mutation+" during playback invalidates binding, preserves only safe Scene/asset position and pauses",async()=>{
 const p=project(),h=harness(p);await h.ready();h.runtime.play();await h.ready();h.bindings[0].events.time(.5);const old=h.bindings[0];
 if(mutation==="reorder"){p.scenePlan.scenes[0].order=2;p.scenePlan.scenes[2].order=0}
 if(mutation==="delete")p.scenePlan.scenes.shift();
 if(mutation==="material"){p.mediaAssembly.slots[0].candidateAssetIds.push("a1");p.mediaAssembly.slots[0].selectedAssetId="a1"}
 if(mutation==="candidate")p.mediaAssembly.slots[0].candidateAssetIds=[];
 if(mutation==="asset")p.media.assets.shift();
 h.runtime.load(p);await h.ready();const before=h.runtime.snapshot();old.events.ended();old.events.time(2);assert.deepEqual(h.runtime.snapshot(),before);assert.notEqual(before.playbackState,"playing");if(mutation==="reorder"){assert.equal(before.activeSceneId,"s0");assert.equal(before.activeAssetId,"a0");assert.equal(before.currentTime,4.5)}
});
test("late asset metadata after selection changes cannot retarget replacement asset",async()=>{
 const p=project(),h=harness(p);await h.ready();const old=h.bindings[0];p.media.assets[1].meta.duration=0;p.mediaAssembly.slots[0].candidateAssetIds=["a1"];p.mediaAssembly.slots[0].selectedAssetId="a1";h.runtime.load(p);await h.ready();const before=h.runtime.snapshot();old.events.metadata(999);old.events.ended();assert.deepEqual(h.runtime.snapshot(),before);assert.equal(before.activeAssetId,"a1");
});
test("seek within the active Scene reuses one renderer and final endpoint can seek back paused",async()=>{
 const h=harness();await h.ready();h.runtime.seek(.2);h.runtime.seek(.8);await h.ready();assert.equal(h.bindings.length,1);assert.deepEqual(h.bindings[0].seeks,[0,.2,.8]);
 h.runtime.seek(6);await h.ready();h.runtime.seek(5);assert.equal(h.runtime.snapshot().playbackState,"paused");assert.equal(h.runtime.snapshot().currentTime,5);
});
test("late asynchronous binding is disposed and cannot bind a newly active Project",async()=>{
 const pending=[],bound=[];const r=create({model,raf:()=>1,cancel(){},bind:(e,a,t,events)=>new Promise(resolve=>pending.push({t,events,resolve})),changed(){}});
 r.load(project());await drain();const a=pending[0];const b=project();b.projectId="B";r.load(b);await drain();const before=r.snapshot();
 a.events.metadata(999);a.events.ended();a.resolve({dispose:()=>bound.push("disposed-A")});await drain();assert.deepEqual(r.snapshot(),before);assert.deepEqual(bound,["disposed-A"]);r.dispose();
});
test("early native EOF cannot fake canonical video duration or skip a Scene",async()=>{
 const h=harness();await h.ready();h.runtime.play();await h.ready();h.bindings[0].events.ended(.5);assert.equal(h.runtime.snapshot().playbackState,"blocked");assert.equal(h.runtime.snapshot().activeSceneId,"s0");assert.equal(h.bindings.length,1);
});
test("loading failure stops at the exact Scene and explicit Play alone retries",async()=>{
 const h=harness();await h.ready();h.bindings[0].events.error("missing-file");assert.equal(h.runtime.snapshot().reason,"missing-file");assert.equal(h.runtime.snapshot().activeSceneId,"s0");
 h.runtime.play();await h.ready();assert.equal(h.bindings.length,2);assert.equal(h.runtime.snapshot().playbackState,"playing");
});
test("paused image tick and disposed binding cannot advance after cancellation",async()=>{
 const h=harness(project(["image","video","video"]));await h.ready();h.runtime.play();await h.tick(250);h.runtime.pause();const before=h.runtime.snapshot();await h.tick(5000);assert.deepEqual(h.runtime.snapshot(),before);h.runtime.dispose();await h.tick(5000);assert.equal(h.frameCount,0);
});
test("video frame updates reuse cached projection without rewriting canonical Project state",async()=>{
 const p=project(),before=clone(p),h=harness(p);await h.ready();const projection=h.runtime.projection();h.runtime.play();await h.ready();for(let i=0;i<100;i++)h.bindings[0].events.time(i/100);assert.equal(h.runtime.projection(),projection);assert.deepEqual(p,before);assert.equal(h.bindings.length,1);
});
