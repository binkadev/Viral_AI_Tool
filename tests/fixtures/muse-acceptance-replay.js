"use strict";
const baseline={count:2,container:1,tailIdentity:2};
const event=(action,node=10,identity=3,patch={})=>({mutation:['id_changed','id_hydrated'].includes(action)?'attribute':action==='mounted_sample'?'none':'childList',event:action,role:'user',node,identity,parent:1,container:1,position:2,predecessor:2,previous:'baseline_tail',next:'none',directChild:true,mountedAfter:action!=='removed',ancestors:[{node:1,category:'div'}],...patch});
const mount=(node=10,id=3)=>event('mounted_sample',node,id);
const wrapper=()=>event('wrapper',30,0,{role:'none',position:-1,parent:1,ancestors:[{node:1,category:'div'}]});
const frame=(elapsedMs,events,freshUsers=1,patch={})=>({kind:'observer',elapsedMs,baselineValid:true,structureValid:true,roleOrderValid:true,freshUsers,freshAssistants:0,composerReplaced:false,editorReplaced:false,generationActive:false,manualInterference:false,events,...patch});
const sample=(ms,node=10,id=3)=>frame(ms,[mount(node,id)],1,{kind:'sample'});
const trace=frames=>({version:1,baseline:{...baseline},frames:frames.map((f,i)=>({batch:i+1,...f})),overflow:false});
const initial=()=>frame(0,[event('added'),mount()]);
const removed=()=>frame(100,[event('removed')],0);
const canonical=()=>frame(200,[event('added',11,4),mount(11,4)]);
const finish=()=>[sample(300,11,4),sample(500,11,4)];
const cases=[
 ['1 stable single ID',[initial(),sample(200),sample(400)],'accepted'],
 ['2 pending same-node hydration',[frame(0,[event('added',10,0),mount(10,0)]),frame(100,[event('id_hydrated'),mount()]),sample(200),sample(400)],'accepted'],
 ['3 same-batch replacement',[frame(0,[event('added'),event('removed'),event('added',11,4),mount(11,4)]),...finish()],'accepted'],
 ['4 cross-batch replacement',[initial(),removed(),canonical(),...finish()],'accepted'],
 ['5 wrapper changes preserve slot',[initial(),removed(),frame(150,[wrapper()],0,{composerReplaced:true,generationActive:true}),canonical(),...finish()],'accepted'],
 ['6 concurrently mounted users',[initial(),frame(100,[event('added',11,4,{position:3}),mount(),mount(11,4)],2,{roleOrderValid:false})],'ambiguous'],
 ['7 assistant between candidates',[initial(),removed(),frame(150,[event('added',20,5,{role:'assistant',position:3})],0,{freshAssistants:1})],'ambiguous'],
 ['8 manual interference',[initial(),removed(),frame(150,[],0,{manualInterference:true})],'ambiguous'],
 ['9 unrelated user conversation activity',[initial(),removed(),frame(150,[event('added',12,5,{position:3})])],'ambiguous'],
 ['10 different logical slot',[initial(),removed(),frame(200,[event('added',11,4,{position:3})])],'ambiguous'],
 ['10b different container lineage',[initial(),removed(),frame(200,[event('added',11,4,{container:2})])],'ambiguous'],
 ['11 replacement window expiry',[initial(),removed(),frame(501,[event('added',11,4),mount(11,4)])],'ambiguous'],
 ['12 baseline changes',[initial(),frame(100,[mount()],1,{baselineValid:false})],'invalid'],
 ['13 canonical never stabilizes',[initial(),removed(),canonical(),sample(300,11,4)],'pending'],
 ['14 second real logical turn',[initial(),sample(200),sample(400),frame(450,[event('added',11,4,{position:3}),mount(),mount(11,4)],2,{roleOrderValid:false})],'ambiguous'],
 ['stable native ID changes in place',[initial(),frame(100,[event('id_changed',10,4),mount(10,4)])],'invalid']
].map(([name,frames,expected])=>({name,trace:trace(frames),expected}));
module.exports={baseline,event,mount,wrapper,frame,sample,trace,cases};
