"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const R=require('../extensions/meta-muse-bridge/receipt-v2');
const {validResult}=require('../services/generation/bridge/execution-contract');
const {contentFixture,memoryStorage,automaticFixture}=require('../dev/execution-audit-fixture');
const source=fs.readFileSync('extensions/meta-muse-bridge/content-script.js','utf8');
const json=v=>JSON.parse(JSON.stringify(v));
const diagnostic=patch=>({version:1,eventType:'pointerdown',targetCategory:'unknown',observationStage:'post-acceptance',snapshotKind:'last-sampled',duringGenerationActive:true,composerChanged:null,structureChanged:null,ownedUserPresent:true,...patch});
function branch({type='pointerdown',trusted=true,target,composedPath,inserting=false,sendStartedAt=1,op={}}={}) {
 const editor={},slot={},container={},c={editor,slot},frames=[];
 const context={op:{invalid:false,...op},c,inserting,sendStartedAt,MuseReceiptV2:R,
   gateDFrame:(...args)=>frames.push(args),event:{type,isTrusted:trusted,target:target==='editor'?editor:target==='slot'?slot:target,composedPath}};
 context.op.projection={container};
 const start=source.indexOf('function captureManualInterference('),end=source.indexOf('function gateDFrame(',start);
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const begin=source.indexOf('const disturbed=e=>'),finish=source.indexOf('\n',begin);
 vm.runInContext(source.slice(begin,finish)+';globalThis.guard=disturbed;',context);
 const fire=e=>{context.event=e||context.event;vm.runInContext('guard(event)',context);};fire();
 return {context,fire,frames,editor,slot,container,get d(){return json(context.op.manualInterferenceDiagnostic??null);}};
}

for(const type of ['pointerdown','click','keydown','input'])test('first trusted '+type+' records only bounded evidence and still invalidates',()=>{
 const f=branch({type,target:'editor'});assert(f.context.op.invalid);assert.equal(f.frames[0][3],'MANUAL_INTERFERENCE');assert.equal(f.d.eventType,type);assert.equal(f.d.targetCategory,'composer-editor');assert(R.validManualInterferenceDiagnostic(f.d));
});
test('first pointerdown survives later click/input/keydown without overwriting',()=>{
 const f=branch({target:'editor'}),first=f.d;
 for(const type of ['click','input','keydown'])f.fire({isTrusted:true,type,target:f.slot});
 assert.deepEqual(f.d,first);assert(f.context.op.invalid);assert.equal(f.frames.length,4);
});
test('own synchronous editor input and untrusted automatic click retain the existing exemption',()=>{
 for(const options of [{type:'input',target:'editor',inserting:true},{type:'click',trusted:false}]){const f=branch(options);assert.equal(f.context.op.invalid,false);assert.equal(f.d,null);assert.equal(f.frames.length,0);}
 assert(branch({type:'input',target:'slot',inserting:true}).context.op.invalid);
});
for(const [name,target]of [
 ['composer-action','slot'],['video',{tagName:'VIDEO'}],['message-row',{getAttribute:k=>k==='data-message-item'?'':null}],
 ['other',{nodeType:1,isConnected:true}],['unknown',null]
])test('diagnostic target '+name+' never exempts the event',()=>{const f=branch({target});assert.equal(f.d.targetCategory,name);assert(f.context.op.invalid);});
test('bounded composed path classifies container/ancestors and prefers specific video over row',()=>{
 const f=branch({trusted:false});
 f.fire({type:'click',isTrusted:true,target:{},composedPath:()=>[{tagName:'VIDEO'},{getAttribute:k=>k==='data-message-item'?'':null},f.container]});assert.equal(f.d.targetCategory,'video');
 const g=branch({trusted:false});g.fire({type:'pointerdown',isTrusted:true,target:{},composedPath:()=>[{},g.container]});assert.equal(g.d.targetCategory,'conversation-container');assert(g.context.op.invalid);
});
test('realistic composed path includes Document and Window without unsafe containment calls',()=>{
 const f=branch({trusted:false}),video={nodeType:1,tagName:'VIDEO'},document={nodeType:9},window={};
 f.editor.contains=n=>{assert(n.nodeType);return false;};f.slot.contains=f.editor.contains;
 f.fire({isTrusted:true,type:'click',target:video,composedPath:()=>[video,{nodeType:1},document,window]});assert.equal(f.d.targetCategory,'video');assert(f.context.op.invalid);
});
test('classification exception, overflow or disconnected target becomes unknown and still invalidates',()=>{
 for(const composedPath of [()=>{throw Error('path failure');},()=>Array(33).fill({}),()=>null]){const f=branch({composedPath});assert(f.context.op.invalid);assert.equal(f.d.targetCategory,'unknown');}
 const f=branch({target:{nodeType:1,isConnected:false}});assert.equal(f.d.targetCategory,'unknown');
});
test('capture failure never changes invalidation or retries capture on later events',()=>{
 const f=branch({trusted:false});f.context.MuseReceiptV2={validManualInterferenceDiagnostic(){throw Error('diagnostic failure');}};
 f.fire({isTrusted:true,type:'click',target:f.editor});assert(f.context.op.invalid);assert.equal(f.d,null);
 f.context.MuseReceiptV2=R;f.fire({isTrusted:true,type:'keydown',target:f.editor});assert.equal(f.d,null);
});
for(const [name,state,started,stage]of [
 ['before invocation',{},null,'pre-send'],['after invocation',{},1,'acceptance'],['anchored user',{receipt:{userStableIdHash:'a'.repeat(64)}},1,'post-acceptance']
])test('stage uses existing state: '+name,()=>{assert.equal(branch({op:state,sendStartedAt:started}).d.observationStage,stage);});
test('cached facts are last-sampled; unavailable and unmeasured facts remain null',()=>{
 const missing=branch().d;assert.equal(missing.snapshotKind,'unavailable');for(const k of ['duringGenerationActive','composerChanged','structureChanged','ownedUserPresent'])assert.equal(missing[k],null);
 const cached=branch({op:{assistantState:{generationActive:false,ownedUserPresent:true,blockContiguous:false}}}).d;
 assert.equal(cached.snapshotKind,'last-sampled');assert.equal(cached.duringGenerationActive,false);assert.equal(cached.ownedUserPresent,true);assert.equal(cached.composerChanged,null);assert.equal(cached.structureChanged,null);
});
test('privacy: no key, text, prompt, URL, selector, capability, coordinates or identity is read/stored',()=>{
 const f=branch({trusted:false});const event={type:'keydown',isTrusted:true,target:f.editor,composedPath:()=>[f.editor]};
 for(const k of ['key','code','keyCode','data','clientX','clientY','pageX','pageY','textContent','innerText','url','observationToken','candidateId'])Object.defineProperty(event,k,{get(){throw Error('PRIVATE_READ');}});
 for(const k of ['textContent','innerText','id','className','value'])Object.defineProperty(f.editor,k,{get(){throw Error('PRIVATE_READ');}});
 f.fire(event);assert.equal(f.d.eventType,'keydown');assert(R.validManualInterferenceDiagnostic(f.d));assert.equal(Object.keys(f.d).length,9);
});
for(const patch of [{key:'SECRET'},{version:2},{eventType:'keyup'},{targetCategory:'private-selector'},{snapshotKind:'current'},{ownedUserPresent:0},{observationStage:'running'},{url:'https://private'}])test('strict optional schema rejects '+Object.keys(patch).join(','),()=>{assert.equal(R.validManualInterferenceDiagnostic(diagnostic(patch)),false);});

const operation={tabId:5,operationId:'diagnostic-op',sceneId:'scene',observationToken:'fixture-token'};
async function accept(f){const p=await f.send('prepareGeneration',operation);assert.equal(p.state,'prepared');const r=await f.send('submitGeneration',{...operation,prompt:'PRIVATE TEST PROMPT',receipt:p.receipt});assert.equal(r.state,'running');return r.receipt;}
async function failure(f){const receipt=await accept(f);f.foreign('pointerdown',{target:{tagName:'VIDEO'}});f.foreign('click');const r=await f.send('inspectGeneration',{...operation,receipt});return {receipt,r,d:r.assistantOwnershipFailure};}
test('synthetic document-listener fixture retains first evidence through cleanup and repeated inspect',async()=>{
 const f=contentFixture({storage:memoryStorage()}),{receipt,r,d}=await failure(f);
 assert.equal(r.state,'interrupted');assert.equal(d.terminalReason,'MANUAL_INTERFERENCE');assert.equal(d.manualInterferenceDiagnostic.eventType,'pointerdown');assert.equal(d.manualInterferenceDiagnostic.targetCategory,'video');assert.equal(d.manualInterferenceDiagnostic.observationStage,'post-acceptance');assert(R.validAssistantFailure(d));assert.equal(f.clicks,1);assert.equal(f.operationCount,0);assert.equal(f.documentListenerCount,0);
 const again=await f.send('inspectGeneration',{...operation,receipt});assert.deepEqual(json(again.assistantOwnershipFailure),json(d));
});
test('first interaction before durable user echo survives release and cached pending failure',async()=>{
 const f=contentFixture({storage:memoryStorage()}),receipt=await accept(f);
 f.foreign('pointerdown');f.mutate([]);assert.equal(f.operationCount,0);
 const r=await f.send('inspectGeneration',{...operation,receipt});assert.equal(r.assistantOwnershipFailure.terminalReason,'MANUAL_INTERFERENCE');assert.equal(r.assistantOwnershipFailure.manualInterferenceDiagnostic.eventType,'pointerdown');assert.equal(f.clicks,1);
});
test('historical failure remains valid; invalid optional data is discarded without accepting ownership',async()=>{
 const f=contentFixture({storage:memoryStorage()}),{receipt,r,d}=await failure(f),core=R.assistantFailureCore(d);
 assert(R.validAssistantFailure(core));assert(!Object.hasOwn(core,'manualInterferenceDiagnostic'));
 const bad={...core,manualInterferenceDiagnostic:{...diagnostic(),key:'SECRET'}};assert(!R.validAssistantFailure(bad));assert.deepEqual(R.assistantFailureEvidence(bad),core);
 assert(validResult('inspectGeneration',json({...r,assistantOwnershipFailure:bad}),json({...operation,receipt})));
 assert(!validResult('inspectGeneration',json({...r,state:'running',receipt,assistantOwnershipFailure:bad}),json({...operation,receipt})));
 assert(R.validAssistantSummary(R.assistantFailureSummary(d)));assert(R.validAssistantSummary(R.assistantFailureSummary(bad)));
});
test('source invariants: guard condition, decision order, listener lifetime and final guard-to-click unchanged',()=>{
 assert(source.includes("if(e.isTrusted && !(inserting && e.type==='input' && e.target===c.editor)){const lastSample=op.assistantState;gateDFrame(op,'sample_before_block',{},'MANUAL_INTERFERENCE',true);op.invalid=true;op.observerInvalidation||='MANUAL_INTERFERENCE';op.manualInterferenceObserved=true;captureManualInterference"));
 assert(source.includes("for(const type of ['input','click','keydown'])c.root.addEventListener(type,disturbed,true)"));
 assert(source.includes("for(const type of ['input','click','keydown','pointerdown'])document.addEventListener(type,disturbed,true)"));
 assert(source.includes("document.removeEventListener(type,disturbed,true)"));
 const begin=source.indexOf('const current=composer();',source.indexOf("invocation.reason='composer-changed'")),end=source.indexOf('button.click();',begin);assert(begin>0 && end>begin);assert(!/\bawait\b/.test(source.slice(begin,end)));
 const capture=source.slice(source.indexOf('function captureManualInterference('),source.indexOf('function gateDFrame(')).replace(/\/\/[^\n]*/g,'');assert(!/\bawait\b|op\.sample\(|responseBlock\(|structure\(|composer\(|editorLength\(/.test(capture));
});

async function automatic(t,configure=()=>{}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'muse-interaction-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]),f=await automaticFixture({root,bytes,verifyVideo:async()=>({duration:1,width:160,height:90})});t.after(()=>f.close());configure(f);const job=await f.admit();return {...f,job,file:path.join(root,'outputs',job.id,'muse-operation.json')};}
for(const stage of ['pre-send','acceptance'])test('first '+stage+' interaction persists even without a Gate-D user-anchored failure',async t=>{
 const f=await automatic(t,f=>{
   if(stage==='pre-send')vm.runInNewContext('composer()',f.content.context).editor.focus=()=>f.content.composerEvent('click');
   else{const send=f.wc.chrome.tabs.sendMessage;f.wc.chrome.tabs.sendMessage=async(id,m)=>{
     if(m.command==='submitGeneration'){
       // Fire after the actual click callback, while acceptance is still unresolved.
       const slot=vm.runInNewContext('composer()',f.content.context).slot,query=slot.querySelectorAll;
       slot.querySelectorAll=(...args)=>query(...args).map(button=>{if(!button.interactionWrapped){const click=button.click;button.click=()=>{click();f.content.foreign('pointerdown');};button.interactionWrapped=true;}return button;});
     }return send(id,m);
   };}
 });
 assert.equal(f.job.status,'interrupted');const record=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(record.manualInterferenceDiagnostic.observationStage,stage);assert.equal(record.manualInterferenceDiagnostic.eventType,stage==='pre-send'?'click':'pointerdown');assert(!record.receipt?.userStableIdHash);assert.equal(f.content.clicks,stage==='pre-send'?0:1);
 assert.equal(f.storage.data['generation-intent:'+f.job.id].invoked,true);
});
test('worker forwards bounded evidence; native operation persists it across restart without changing receipt',async t=>{
 const f=await automatic(t),before=JSON.parse(fs.readFileSync(f.file,'utf8'));
 f.content.foreign('pointerdown');f.content.foreign('click');const stopped=await f.service.recover(f.job.id);assert.equal(stopped.status,'interrupted');
 const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.deepEqual(saved.receipt,before.receipt);assert.equal(saved.assistantOwnershipFailure.manualInterferenceDiagnostic.eventType,'pointerdown');assert.equal(f.content.clicks,1);
 const worker=f.storage.data['generation-intent:'+f.job.id];assert(worker.invoked);assert(!worker.receipt.assistantStableIdHash);assert(!Object.hasOwn(worker.assistantOwnershipFailure,'manualInterferenceDiagnostic'),'optional evidence does not add a worker intent write');
 const {createMuseExecution}=require('../services/generation/providers/muse-execution');let seen;
 const reader=createMuseExecution({developmentDiagnostics:true,command:async()=>{throw Error('fixture offline');}},async()=>{});
 const context=f.service.context(stopped);const report=await reader.diagnoseOwnership(context);seen=report.historicalAssistantOwnershipFailure;
 assert.equal(seen.manualInterferenceDiagnostic.eventType,'pointerdown');assert.equal(seen.terminalReason,'MANUAL_INTERFERENCE');
 assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),saved);
});
test('optional native persistence failure preserves core invalidation, receipt and submit count',async t=>{
 const f=await automatic(t),before=JSON.parse(fs.readFileSync(f.file,'utf8')),rename=fs.renameSync;let rejected=0;
 try{fs.renameSync=(from,to)=>{if(to===f.file && JSON.parse(fs.readFileSync(from,'utf8')).assistantOwnershipFailure?.manualInterferenceDiagnostic){rejected++;throw Error('optional disk failure');}return rename(from,to);};
 f.content.foreign('pointerdown');assert.equal((await f.service.recover(f.job.id)).status,'interrupted');
 }finally{fs.renameSync=rename;}
 const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(rejected,1);assert.equal(saved.assistantOwnershipFailure.terminalReason,'MANUAL_INTERFERENCE');assert(!saved.assistantOwnershipFailure.manualInterferenceDiagnostic);assert.deepEqual(saved.receipt,before.receipt);assert.equal(f.content.clicks,1);assert.equal(f.calls.filter(x=>x==='submitGeneration').length,1);
});
test('malformed optional content evidence is stripped by worker without changing its failure/receipt',async t=>{
 const f=await automatic(t),send=f.content.send;
 f.content.send=async(type,p)=>{const result=await send(type,p);if(result.assistantOwnershipFailure)result.assistantOwnershipFailure.manualInterferenceDiagnostic={...diagnostic(),key:'SECRET'};return result;};
 f.content.foreign('keydown');assert.equal((await f.service.recover(f.job.id)).status,'interrupted');
 const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(saved.assistantOwnershipFailure.terminalReason,'MANUAL_INTERFERENCE');assert(!saved.assistantOwnershipFailure.manualInterferenceDiagnostic);assert(saved.receipt.userStableIdHash);assert(!saved.receipt.assistantStableIdHash);assert.equal(f.content.clicks,1);assert(!JSON.stringify(saved).includes('SECRET'));
});
test('malformed optional persisted evidence cannot invalidate the accepted receipt on native restart',async t=>{
 const f=await automatic(t);f.content.foreign('pointerdown');const stopped=await f.service.recover(f.job.id),record=JSON.parse(fs.readFileSync(f.file,'utf8'));
 record.assistantOwnershipFailure.manualInterferenceDiagnostic={...diagnostic(),url:'SECRET'};fs.writeFileSync(f.file,JSON.stringify(record));const bytes=fs.readFileSync(f.file);
 const {createMuseExecution}=require('../services/generation/providers/muse-execution'),reader=createMuseExecution({developmentDiagnostics:true,command:async()=>{throw Error('fixture offline');}},async()=>{});
 const report=await reader.diagnoseOwnership(f.service.context(stopped));assert.equal(report.historicalAssistantOwnershipFailure.terminalReason,'MANUAL_INTERFERENCE');assert(!report.historicalAssistantOwnershipFailure.manualInterferenceDiagnostic);assert.deepEqual(fs.readFileSync(f.file),bytes,'no backfill or repair during read');assert(R.valid(record.receipt,record.operationId));
});
