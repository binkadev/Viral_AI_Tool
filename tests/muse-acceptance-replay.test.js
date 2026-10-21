"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const replay=require('../extensions/meta-muse-bridge/acceptance-replay');
const {cases,trace,frame,mount,event}=require('./fixtures/muse-acceptance-replay');
for(const fixture of cases)test('offline acceptance replay: '+fixture.name,()=>{
 const before=JSON.stringify(fixture.trace);assert(replay.validTrace(fixture.trace));
 const result=replay.replay(fixture.trace);assert.equal(result.status,fixture.expected);assert.equal(JSON.stringify(fixture.trace),before);
 if(fixture.expected==='accepted'){
   assert.equal(result.logicalCount,1);assert.equal(result.maxConcurrent,1);assert(result.canonicalStable);
   if(fixture.name.match(/replacement|wrapper/)){assert.equal(result.identityCount,2);assert.equal(result.canonicalIdentity,4);assert(result.replacementObserved);}
 }else assert.equal(result.canonicalIdentity,null);
});
test('offline trace schema is bounded, exact, private and overflow fails closed',()=>{
 const source=cases[3].trace;
 for(const edit of [t=>t.prompt='private',t=>t.frames[0].url='private',t=>t.frames[0].events[0].rawId='private',t=>t.frames[0].events[0].node=513,t=>t.frames[0].events[0].ancestors=Array(7).fill({node:1,category:'div'}),t=>t.frames[1].elapsedMs=-1]){
   const t=structuredClone(source);edit(t);assert(!replay.validTrace(t));assert.throws(()=>replay.replay(t),/INVALID_TRACE/);
 }
 const full=trace(Array.from({length:64},(_,i)=>frame(i*10,[],0)));
 assert(replay.validTrace(full));assert.equal(replay.replay(full).status,'pending');full.overflow=true;assert.equal(replay.replay(full).reason,'OBSERVATION_LIMIT');
 full.frames.push({...full.frames[0],batch:65});assert(!replay.validTrace(full));
 const tooMany=trace([frame(0,Array(256).fill(event('wrapper',1,0,{role:'none'})),0),frame(1,[event('wrapper',1,0,{role:'none'})],0)]);assert(!replay.validTrace(tooMany));
 const unknown=trace([frame(0,[event('added',10,3,{container:0}),mount(10,3)],1)]);assert.notEqual(replay.replay(unknown).status,'accepted');
});
test('offline CLI replays only sanitized input and has no live browser/service commands',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-offline-replay-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'trace.json');fs.writeFileSync(input,JSON.stringify(cases[4].trace));
 const result=spawnSync(process.execPath,['dev/replay-muse-acceptance.js',input],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'accepted');
 fs.writeFileSync(input,JSON.stringify({...cases[4].trace,token:'forbidden'}));
 const invalid=spawnSync(process.execPath,['dev/replay-muse-acceptance.js',input],{encoding:'utf8'});assert.equal(invalid.status,1);assert(!invalid.stderr.includes('forbidden'));
 const code=fs.readFileSync('dev/replay-muse-acceptance.js','utf8')+fs.readFileSync('extensions/meta-muse-bridge/acceptance-replay.js','utf8');
 for(const forbidden of ['submitGeneration','MetaMuseExtensionBridge','GenerationService','chrome.','fetch(','document.'])assert(!code.includes(forbidden));
});

test('trace version 2 accepts one user plus a bounded assistant tail; historical version 1 retains its semantics',()=>{
 const assistant=(position,id)=>event('mounted_sample',20+id,id,{role:'assistant',position,previous:'fresh_user'});
 const frames=[frame(0,[event('added'),mount(),assistant(3,5),assistant(4,6)],1,{freshAssistants:2}),
   frame(200,[mount(),assistant(3,5),assistant(4,6)],1,{kind:'sample',freshAssistants:2}),
   frame(400,[mount(),assistant(3,5),assistant(4,6)],1,{kind:'sample',freshAssistants:2})];
 const t=trace(frames),original=JSON.stringify(t);
 assert.equal(replay.replay(t).status,'ambiguous');assert.equal(JSON.stringify(t),original);
 t.version=2;const result=replay.replay(t);assert.equal(result.status,'accepted');assert.equal(result.logicalCount,1);assert.equal(result.maxConcurrent,1);
 const tooMany=structuredClone(t);tooMany.frames[0].freshAssistants=9;assert.notEqual(replay.replay(tooMany).status,'accepted');
});
