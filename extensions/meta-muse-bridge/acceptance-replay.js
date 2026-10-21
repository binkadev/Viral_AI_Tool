"use strict";
// Pure structural model shared by the live adapter and offline diagnostics.
// An exported trace is NEVER a receipt or a command to the live adapter.
(function(root){
 const MAX_FRAMES=64,MAX_EVENTS=256,MAX_BYTES=196608,REPLACEMENT_MS=400;
 const exact=(o,keys)=>o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).length===keys.length && Object.keys(o).every(k=>keys.includes(k));
 const int=(n,max)=>Number.isInteger(n) && n>=0 && n<=max;
 const category=['baseline_tail','fresh_user','fresh_assistant','other','none'];
 const baseKeys=['count','container','tailIdentity'];
 const frameKeys=['batch','kind','elapsedMs','baselineValid','structureValid','roleOrderValid','freshUsers','freshAssistants','composerReplaced','editorReplaced','generationActive','manualInterference','events'];
 const eventKeys=['mutation','event','role','node','identity','parent','container','position','predecessor','previous','next','directChild','mountedAfter','ancestors'];
 function validBaseline(b){return exact(b,baseKeys) && int(b.count,256) && b.count>0 && int(b.container,512) && int(b.tailIdentity,512) && b.tailIdentity>0;}
 function validEvent(e){return exact(e,eventKeys) && ['childList','attribute','none'].includes(e.mutation) &&
   ['added','removed','id_hydrated','id_changed','mounted_sample','wrapper'].includes(e.event) && ['user','assistant','none'].includes(e.role) &&
   ['node','identity','parent','container','predecessor'].every(k=>int(e[k],512)) && Number.isInteger(e.position) && e.position>=-1 && e.position<=257 &&
   category.includes(e.previous) && category.includes(e.next) && typeof e.directChild==='boolean' && typeof e.mountedAfter==='boolean' &&
   Array.isArray(e.ancestors) && e.ancestors.length<=6 && e.ancestors.every(a=>exact(a,['node','category']) && int(a.node,512) && ['div','section','article','li','ul','main','other'].includes(a.category));}
 function validFrame(f){return exact(f,frameKeys) && int(f.batch,MAX_FRAMES) && f.batch>0 && ['observer','sample','manual'].includes(f.kind) && int(f.elapsedMs,5000) &&
   ['baselineValid','structureValid','roleOrderValid','composerReplaced','editorReplaced','generationActive','manualInterference'].every(k=>typeof f[k]==='boolean') &&
   int(f.freshUsers,128) && int(f.freshAssistants,128) && Array.isArray(f.events) && f.events.length<=MAX_EVENTS && f.events.every(validEvent);}
 function validTrace(t){return exact(t,['version','baseline','frames','overflow']) && t.version===1 && validBaseline(t.baseline) && typeof t.overflow==='boolean' &&
   Array.isArray(t.frames) && t.frames.length<=MAX_FRAMES && t.frames.every((f,i)=>validFrame(f) && f.batch===i+1 && (!i || f.elapsedMs>=t.frames[i-1].elapsedMs)) &&
   t.frames.reduce((n,f)=>n+f.events.length,0)<=MAX_EVENTS && JSON.stringify(t).length<=MAX_BYTES;}
 function create(baseline){
   if(!validBaseline(baseline))throw Error('INVALID_TRACE');
   const state={status:'pending',reason:null,turn:null,pendingReplacement:null,assistantSeen:false,assistantIds:new Set(),identities:new Set(),
     logicalCount:0,maxConcurrent:0,replacementCount:0,replacementObserved:false,replacementAmbiguous:false,batch:0,eventCount:0,elapsedMs:0};
   const fail=(reason,ambiguous=true)=>{state.status=ambiguous?'ambiguous':'invalid';state.reason=reason;if(reason.startsWith('REPLACEMENT'))state.replacementAmbiguous=true;};
   const sameSlot=e=>e.position===baseline.count && e.predecessor===baseline.tailIdentity && e.container===baseline.container;
   const provenSlot=e=>baseline.container>0 && sameSlot(e);
   const begin=e=>{state.turn={node:e.node,identity:e.identity,container:e.container,position:e.position,predecessor:e.predecessor,mounted:true,samples:0};state.logicalCount=1;state.maxConcurrent=Math.max(state.maxConcurrent,1);};
   function step(frame){
     if(['ambiguous','invalid'].includes(state.status))return result();
     state.status='pending';
     if(!validFrame(frame) || frame.batch!==state.batch+1 || frame.elapsedMs<state.elapsedMs){fail('INVALID_TRACE',false);return result();}
     state.batch=frame.batch;state.elapsedMs=frame.elapsedMs;state.eventCount+=frame.events.length;
     if(state.eventCount>MAX_EVENTS){fail('OBSERVATION_LIMIT',false);return result();}
     if(!frame.structureValid){fail('IDENTITY_UNAVAILABLE',false);return result();}
     state.maxConcurrent=Math.max(state.maxConcurrent,frame.freshUsers);
     if(!frame.baselineValid){fail('BASELINE_CHANGED',false);return result();}
     if(frame.manualInterference){fail('MANUAL_INTERFERENCE');return result();}
     if(!frame.roleOrderValid || frame.freshUsers>1){state.logicalCount=Math.max(2,frame.freshUsers);fail('AMBIGUOUS_OPERATION');return result();}
     if(state.pendingReplacement && frame.elapsedMs-state.pendingReplacement.since>REPLACEMENT_MS){fail('REPLACEMENT_EXPIRED');return result();}
     let mounted=null;
     for(const e of frame.events){
       if(e.role==='none')continue;
       if(e.event==='id_changed'){fail('IDENTITY_MUTATED',false);break;}
       if(e.position>=0 && e.position<baseline.count && e.event!=='mounted_sample'){fail('BASELINE_CHANGED',false);break;}
       if(e.role==='assistant'){
         if(e.identity)state.assistantIds.add(e.identity);
         if(state.assistantIds.size>1){fail('AMBIGUOUS_OPERATION');break;}
         if(state.pendingReplacement || !state.turn || e.position!==baseline.count+1){fail('REPLACEMENT_CONVERSATION_ACTIVITY');break;}
         state.assistantSeen=true;continue;
       }
       if(e.identity)state.identities.add(e.identity);
       if(e.position!==baseline.count || e.predecessor!==baseline.tailIdentity){fail('REPLACEMENT_SLOT_UNPROVEN');break;}
       if(e.event==='removed'){
         if(!state.turn || state.pendingReplacement || !state.turn.mounted || e.node!==state.turn.node || !provenSlot(e) || !state.turn.identity || state.assistantSeen){fail('REPLACEMENT_SLOT_UNPROVEN');break;}
         state.turn.mounted=false;state.turn.samples=0;state.pendingReplacement={since:frame.elapsedMs,oldNode:e.node};continue;
       }
       if(e.event==='added' || e.event==='mounted_sample' || e.event==='id_hydrated'){
         if(state.pendingReplacement){
           // A mounted sample alone cannot prove a replacement addition.
           if(e.event!=='added' || !provenSlot(e) || e.node===state.pendingReplacement.oldNode || state.assistantSeen){fail('REPLACEMENT_SLOT_UNPROVEN');break;}
           state.pendingReplacement=null;state.replacementObserved=true;state.replacementCount++;begin(e);
         }else if(!state.turn){
           if(state.assistantSeen || !e.node || (baseline.container>0 && !sameSlot(e))){fail('REPLACEMENT_SLOT_UNPROVEN');break;}begin(e);
         }else if(e.node!==state.turn.node){fail('REPLACEMENT_SLOT_UNPROVEN');break;}
         else if(state.turn.identity && state.turn.identity!==e.identity){fail('IDENTITY_MUTATED',false);break;}
         else if(!state.turn.identity && e.identity){state.turn.identity=e.identity;state.turn.samples=0;}
         if(e.event==='mounted_sample')mounted=e;
       }
     }
     if(state.status!=='pending')return result();
     if(state.pendingReplacement && frame.freshAssistants){fail('REPLACEMENT_CONVERSATION_ACTIVITY');return result();}
     if(state.turn && !state.pendingReplacement && (!mounted || !mounted.mountedAfter) && frame.freshUsers===0){fail('REPLACEMENT_SLOT_UNPROVEN');return result();}
     if(frame.kind==='sample' && mounted && mounted.mountedAfter && mounted.identity && !state.pendingReplacement){
       state.turn.samples++;
     }
     if(mounted?.mountedAfter && state.turn?.samples>=2 && !state.pendingReplacement)state.status='accepted';
     if(frame.elapsedMs>=5000 && state.status==='pending')fail(state.pendingReplacement?'REPLACEMENT_EXPIRED':'ACCEPTANCE_UNCERTAIN',false);
     return result();
   }
   function result(){return {status:state.status,reason:state.reason,canonicalNode:state.status==='accepted'?state.turn.node:null,
     canonicalIdentity:state.status==='accepted'?state.turn.identity:null,identityCount:state.identities.size,logicalCount:state.logicalCount,
     maxConcurrent:state.maxConcurrent,replacementCount:state.replacementCount,replacementObserved:state.replacementObserved,
     canonicalStable:(state.turn?.samples||0)>=2,replacementAmbiguous:state.replacementAmbiguous,
     pendingReplacement:!!state.pendingReplacement};}
   return {step,result};
 }
 function replay(trace){
   if(!validTrace(trace))throw Error('INVALID_TRACE');
   const model=create(trace.baseline);let result=model.result();
   for(const frame of trace.frames)result=model.step(frame);
   if(trace.overflow)return {...result,status:'invalid',reason:'OBSERVATION_LIMIT',canonicalNode:null,canonicalIdentity:null};
   return result;
 }
 const api=Object.freeze({create,replay,validTrace,validFrame,MAX_FRAMES,MAX_EVENTS,MAX_BYTES,REPLACEMENT_MS});
 if(typeof module==='object' && module.exports)module.exports=api;else root.MuseAcceptanceReplay=api;
})(globalThis);
