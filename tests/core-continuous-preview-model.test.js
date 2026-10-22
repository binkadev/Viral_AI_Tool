"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),m=require("../renderer/core-player-model");
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(kinds=["video","video","video"],durations=[4,6,3]){
 return {projectId:"A",scenePlan:{selectedSceneId:"s1",scenes:kinds.map((kind,i)=>({id:"s"+i,order:i,start:50+i*10,end:50+i*10+durations[i],title:"Scene "+i}))},
 media:{selectedAssetId:"unrelated",assets:kinds.map((kind,i)=>({id:"a"+i,kind,status:"ready",fileState:"available",localPath:"C:/"+i+(kind==="video"?".mp4":".png"),meta:{duration:kind==="video"?durations[i]:999}}))},
 mediaAssembly:{slots:kinds.map((_,i)=>({sceneId:"s"+i,role:"primary",candidateAssetIds:["a"+i],selectedAssetId:"a"+i}))}};
}
test("canonical Scene order and exact selected asset produce 0-4,4-10,10-13 spans",()=>{
 const p=fixture(),before=clone(p);p.scenePlan.scenes.reverse();const projection=m.buildProjectPlayback(p);
 assert.deepEqual(projection.entries.map(e=>[e.sceneId,e.assetId,e.projectStart,e.projectEnd]),[["s0","a0",0,4],["s1","a1",4,10],["s2","a2",10,13]]);
 assert.equal(projection.duration,13);assert.equal(projection.complete,true);p.scenePlan.scenes.reverse();assert.deepEqual(p,before);
});
for(const [time,id,local,ended]of [[0,"s0",0,false],[2.5,"s0",2.5,false],[4-1e-7,"s0",4-1e-7,false],[4,"s1",0,false],[7,"s1",3,false],[10,"s2",0,false],[12,"s2",2,false],[13,"s2",3,true],[999,"s2",3,true]])test("project time "+time+" resolves exact half-open boundary",()=>{
 const x=m.locateProjectTime(m.buildProjectPlayback(fixture()),time);assert.equal(x.entry.sceneId,id);assert.equal(x.localTime,local);assert.equal(x.ended,ended);
});
test("Scene/local time maps back to Project clock and rejects absent Scene",()=>{
 const p=m.buildProjectPlayback(fixture());assert.equal(m.projectTimeForScene(p,"s1",3),7);assert.equal(m.projectTimeForScene(p,"s2",999),13);assert.equal(m.projectTimeForScene(p,"gone"),null);
});
test("video duration follows asset metadata without trimming to source Scene duration",()=>{
 const p=fixture();p.scenePlan.scenes[0].end=51;p.media.assets[0].meta.duration=8;assert.equal(m.buildProjectPlayback(p).entries[0].duration,8);
});
test("image duration follows positive Scene source span, never asset duration or invented default",()=>{
 const p=fixture(["video","image","video"]);const result=m.buildProjectPlayback(p);assert.equal(result.entries[1].duration,6);assert.equal(result.duration,13);
 p.scenePlan.scenes[1].end=p.scenePlan.scenes[1].start;const zero=m.buildProjectPlayback(p);assert.equal(zero.entries[1].playableState,"duration-unresolved");assert.equal(zero.entries[1].duration,null);
 assert.equal(zero.entries[2].projectStart,null);assert.equal(zero.complete,false);assert.equal(m.locateProjectTime(zero,999).entry.sceneId,"s1");
});
test("unresolved video accepts ephemeral metadata only when canonical duration unknown",()=>{
 const p=fixture();p.media.assets[0].meta.duration=0;assert.equal(m.buildProjectPlayback(p).entries[0].playableState,"duration-unresolved");
 const x=m.buildProjectPlayback(p,{a0:{duration:5}});assert.equal(x.entries[0].duration,5);assert.equal(p.media.assets[0].meta.duration,0);
 p.media.assets[0].meta.duration=4;assert.equal(m.buildProjectPlayback(p,{a0:{duration:999}}).entries[0].duration,4);
});
for(const [label,mutate,state]of [["no assignment",p=>p.mediaAssembly.slots[1].selectedAssetId=null,"missing-media"],
 ["asset deleted",p=>p.media.assets.splice(1,1),"unavailable"],["not candidate",p=>p.mediaAssembly.slots[1].candidateAssetIds=[],"unavailable"],
 ["missing file",p=>p.media.assets[1].fileState="missing","missing-file"],["trashed file",p=>p.media.assets[1].fileState="trashed","missing-file"],
 ["pending asset",p=>p.media.assets[1].status="downloading","unavailable"],["remote only",p=>p.media.assets[1].localPath=null,"unavailable"]])test("blocked "+label+" remains represented and never borrows global media selection",()=>{
 const p=fixture();mutate(p);const x=m.buildProjectPlayback(p);assert.equal(x.entries.length,3);assert.equal(x.entries[1].playableState,state);assert.equal(x.entries[1].projectStart,4);
});
test("reorder and shared AssetRef preserve stable Scene ownership and source timestamps",()=>{
 const p=fixture(),before=clone(p);p.scenePlan.scenes[2].order=0;p.scenePlan.scenes[0].order=1;p.scenePlan.scenes[1].order=2;
 p.mediaAssembly.slots[1]={...p.mediaAssembly.slots[1],candidateAssetIds:["a0"],selectedAssetId:"a0"};const x=m.buildProjectPlayback(p);
 assert.deepEqual(x.entries.map(e=>[e.sceneId,e.assetId]),[["s2","a2"],["s0","a0"],["s1","a0"]]);assert.equal(x.duration,11);
 for(const s of p.scenePlan.scenes)assert.equal(s.start,before.scenePlan.scenes.find(a=>a.id===s.id).start);
});
test("floating boundaries use machine precision without skipping just-before times",()=>{
 const p=m.buildProjectPlayback(fixture(undefined,[.1,.2,.3]));assert.equal(m.locateProjectTime(p,.3).entry.sceneId,"s2");assert.equal(m.locateProjectTime(p,.3-1e-7).entry.sceneId,"s1");
});
test("projection does not mutate deeply frozen canonical inputs",()=>{
 function freeze(v){if(v&&typeof v==="object"){Object.values(v).forEach(freeze);Object.freeze(v)}return v}const p=freeze(fixture());assert.equal(m.buildProjectPlayback(p).duration,13);
});
module.exports={fixture};
