"use strict";
const CONTENT_BUILD='muse-content-v0-3-6-contract3-receipt2-assistantblock1';
const developmentDiagnostics=chrome.runtime.getManifest().version_name==='development-diagnostics';
const operations=new Map();
const ROOT='[data-hatch-composer-root]';
const EDITOR='[data-lexical-editor="true"], textarea, [data-hatch-composer-prehydration-input], [contenteditable="true"]';
const SLOT='[data-hatch-composer-action-slot]';
const MESSAGE='[data-message-item]';
const STOP='[data-testid="hatch-composer-stop-button"]';
const MAX_MESSAGES=128;
const MAX_OWNED_ASSISTANT_ROWS=MuseAcceptanceReplay.MAX_OWNED_ASSISTANT_ROWS;
let stableKey=null,readinessProbe=null;
const structureKey=rows=>JSON.stringify(rows.map(({id,role})=>[id,role]));
// No verified empty-conversation marker exists yet. Zero rows fail closed.
function conversationSnapshot() {
  const rows=structure();
  if(document.readyState!=='complete' || !rows.length)throw Error('CONVERSATION_UNREADY');
  return {rows,key:structureKey(rows)};
}
function waitForStableConversation() {
  return new Promise(resolve=>{
    let previous=null,consecutive=0,finished=false,sampleTimer,deadline;
    const finish=value=>{if(finished)return;finished=true;observer.disconnect();clearTimeout(sampleTimer);clearTimeout(deadline);resolve(value);};
    const sample=()=>{
      if(finished)return;
      let snapshot=null;try{snapshot=conversationSnapshot();}catch{}
      const key=snapshot?.key;
      consecutive=key && key===previous?consecutive+1:key?1:0;previous=key;
      if(consecutive>=3)return finish(snapshot);
      sampleTimer=setTimeout(sample,250);
    };
    const observer=new MutationObserver(()=>{
      let key=null;try{key=conversationSnapshot().key;}catch{}
      if(key!==previous){previous=null;consecutive=0;stableKey=null;}
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-message-id','data-message-role','data-message-item']});
    deadline=setTimeout(()=>finish(null),5000);sample();
  });
}
function conversationReady() {
  let key=null;try{key=conversationSnapshot().key;}catch{}
  if(key!==stableKey)stableKey=null;
  if(!stableKey && !readinessProbe)readinessProbe=waitForStableConversation().then(s=>{stableKey=s?.key||null;readinessProbe=null;});
  return !!key && key===stableKey;
}
const validId=v=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const nativeId=v=>typeof v==='string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(v);
function visible(node) {
  if(!node || !node.isConnected || node.closest('[hidden], [inert], [aria-hidden="true"]'))return false;
  const s=getComputedStyle(node);
  return s.display!=='none' && s.visibility!=='hidden' && s.visibility!=='collapse' && s.opacity!=='0' && node.getClientRects().length>0;
}
const actionable=node=>visible(node) && !node.disabled && !node.matches(':disabled') && !node.closest('[aria-disabled="true"]') && getComputedStyle(node).pointerEvents!=='none';
function composer() {
  const roots=[...document.querySelectorAll(ROOT)];
  if(roots.length!==1)return null;
  const root=roots[0],editors=[...root.querySelectorAll(EDITOR)],slots=[...root.querySelectorAll(SLOT)];
  if(editors.length!==1 || slots.length!==1)return null;
  return {root,editor:editors[0],slot:slots[0]};
}
// Structural character counts only; never obtain draft or message strings.
function editorLength(editor) {
  if(editor.tagName==='TEXTAREA')return Number.isSafeInteger(editor.textLength)?editor.textLength:-1;
  const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
  let total=0,count=0,node;
  while((node=walker.nextNode())) {
    if(++count>256 || !Number.isSafeInteger(node.length))return -1;
    total+=node.length;if(total>8000)return -1;
  }
  return total;
}
function sendButtons(c) {return c?[...c.slot.querySelectorAll('button')].filter(actionable):[];}
function generationActive() {return [...document.querySelectorAll(STOP)].some(visible);}
function structure(allowPending=false) {
  const rows=[...document.querySelectorAll(MESSAGE)].filter(n=>['user','assistant'].includes(n.getAttribute('data-message-role')))
    .map(node=>({node,id:node.getAttribute('data-message-id'),role:node.getAttribute('data-message-role')}));
  const users=rows.filter(r=>r.role==='user'),assistants=rows.filter(r=>r.role==='assistant');
  const ids=rows.filter(r=>nativeId(r.id)).map(r=>r.id);
  if(users.length>MAX_MESSAGES || assistants.length>MAX_MESSAGES || rows.some(r=>!nativeId(r.id) && !(allowPending && (r.id===null || r.id===''))) || new Set(ids).size!==ids.length)throw Error('IDENTITY_UNAVAILABLE');
  return rows;
}
function status() {
  if(location.origin!=='https://muse.ai' || window.top!==window)return {composerReady:false,inspectionComplete:false};
  const c=composer(),ready=!!c && visible(c.root) && visible(c.editor) && !c.editor.readOnly && c.editor.getAttribute('aria-readonly')!=='true' &&
    (c.editor.tagName==='TEXTAREA' || c.editor.isContentEditable);
  let rows=null;try{rows=structure();}catch{}
  const active=generationActive(),empty=c?editorLength(c.editor)===0:false;
  // Live Muse has no send button while empty. Revalidate the actual button
  // after inserting the authorized prompt, before the sole click.
  return {sampledAt:Date.now(),composerReady:ready,inspectionComplete:document.readyState!=='loading',
    executionContract:ready && rows?3:null,ownershipReceiptVersion:2,
    canSubmit:ready && !!rows && conversationReady() && empty && !active && sendButtons(c).length<=1 && !c.editor.disabled,
    devEvidence:{root:!!c,editor:!!c?.editor,actionSlot:!!c?.slot,
      actionableButtons:Math.min(10,sendButtons(c).length),composerEmpty:empty,generationActive:active,
      userMessageCount:Math.min(MAX_MESSAGES,rows?.filter(r=>r.role==='user').length||0),
      assistantMessageCount:Math.min(MAX_MESSAGES,rows?.filter(r=>r.role==='assistant').length||0),
      messageIdentityValid:!!rows,assistantVideoPresent:!!rows?.some(r=>r.role==='assistant' && r.node.querySelector('video'))}
  };
}
function answer(p,state,extra={}) {return {operationId:p.operationId,sceneId:p.sceneId,state,...extra};}
async function hash(operationId,role,id) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(operationId+'\0'+role+'\0'+id));
  return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function afterBaseline(op,allowPending=false) {
  const rows=structure(allowPending);
  if(rows.length<op.baseline.length || op.baseline.some((r,i)=>r.id!==rows[i].id || r.role!==rows[i].role))throw Error('BASELINE_CHANGED');
  const fresh=rows.slice(op.baseline.length);
  const limit=op.v2Reserved!==undefined?MAX_OWNED_ASSISTANT_ROWS:1;
  if(fresh.length>limit+1 || fresh.some((r,i)=>r.role!==(i===0?'user':'assistant')))throw Error('AMBIGUOUS_OPERATION');
  if(op.submittedUserId && fresh[0]?.id!==op.submittedUserId)throw Error('USER_CHANGED');
  if(op.assistantId && fresh[1]?.id!==op.assistantId)throw Error('RESPONSE_CHANGED');
  return fresh;
}
const directVideos=row=>{
  const videos=[];
  for(const video of row.node.querySelectorAll('video'))if(video.closest(MESSAGE)===row.node){if(videos.length===16)throw Error('OBSERVATION_LIMIT');videos.push(video);}
  return videos;
};
function responseBlock(op) {
  const fresh=afterBaseline(op,true),user=fresh[0],container=op.projection?.container;
  if(!user || !nativeId(user.id) || user.id!==op.submittedUserId || !container ||
    !container.contains(user.node) || !user.node.parentNode || user.node.parentNode!==op.userSequenceParent ||
    structure(true).slice(0,op.baseline.length).some(r=>!container.contains(r.node)))throw Error('USER_CHANGED');
  const rows=fresh.slice(1);
  // Direct sequence membership is structural evidence, not page-wide adjacency.
  // Rows outside the prepared conversation or under another list cannot bind.
  if(rows.some(r=>r.node.parentNode!==user.node.parentNode || !container.contains(r.node)))throw Error('AMBIGUOUS_OPERATION');
  const sequence=[...user.node.parentNode.querySelectorAll(MESSAGE)].filter(node=>node.parentNode===user.node.parentNode),index=sequence.indexOf(user.node);
  if(index<0 || sequence.length-index-1!==rows.length || rows.some((r,i)=>sequence[index+i+1]!==r.node))throw Error('AMBIGUOUS_OPERATION');
  const counts=rows.map(r=>directVideos(r).length);
  if(counts.some(n=>n>16))throw Error('OBSERVATION_LIMIT');
  const mediaRows=rows.filter((r,i)=>counts[i]>0);
  if(mediaRows.length>1 || mediaRows.some(r=>directVideos(r).length!==1))throw Error('AMBIGUOUS_OPERATION');
  return {user,rows,mediaRows,signature:JSON.stringify(rows.map((r,i)=>[r.id,counts[i]]))};
}
function sameBlock(sample,block) {
  return sample?.signature===block.signature && sample.nodes.length===block.rows.length && sample.nodes.every((node,i)=>node===block.rows[i].node);
}
// The DOM adapter projects only bounded structural ordinals into the pure model.
const acceptanceNow=()=>typeof performance!=='undefined' && typeof performance.now==='function'?performance.now():Date.now();
function acceptanceProjection(op,mutations,rows,kind,structureValid=true) {
  const projection=op.projection;
  const ordinal=node=>{
    if(!node || typeof node!=='object')return 0;
    if(!projection.nodes.has(node)){if(projection.nextNode>=512)throw Error('OBSERVATION_LIMIT');projection.nodes.set(node,++projection.nextNode);}
    return projection.nodes.get(node);
  };
  const identity=id=>{
    if(!nativeId(id))return 0;
    if(!projection.ids.has(id)){if(projection.ids.size>=512)throw Error('OBSERVATION_LIMIT');projection.ids.set(id,projection.ids.size+1);}
    return projection.ids.get(id);
  };
  const isBaseline=(role,id)=>op.baseline.some(r=>r.role===role && r.id===id);
  const cat=node=>!node?'none':node===op.baselineTail || node.contains?.(op.baselineTail)?'baseline_tail':
    node.getAttribute?.('data-message-role')==='user'?'fresh_user':node.getAttribute?.('data-message-role')==='assistant'?'fresh_assistant':'other';
  const path=node=>{const list=[];for(let n=node?.parentNode;n && list.length<6;n=n.parentNode){list.push({node:ordinal(n),category:['div','section','article','li','ul','main'].includes(n.tagName?.toLowerCase())?n.tagName.toLowerCase():'other'});if(n===projection.container)break;}return list;};
  const within=node=>{for(let n=node,i=0;n && i<=6;n=n.parentNode,i++)if(n===projection.container)return true;return false;};
  const slot=(node,mutation,removed)=>{
    const index=rows.findIndex(r=>r.node===node);
    if(!removed && index>=0 && (within(node) || !projection.container))return {container:ordinal(projection.container),position:index};
    const observed=removed && projection.lastAssistantRows?.find(r=>r.node===node);
    if(observed && observed.parents.includes(mutation?.target))return {container:ordinal(projection.container),position:observed.position};
    const cached=projection.last;
    if(removed && cached?.node===node && (cached.parents.includes(mutation?.target) || mutation?.target===projection.container)){
      // Direct-list anchors cannot contradict the previously observed suffix.
      if(mutation?.target!==projection.container || cat(mutation.previousSibling)==='baseline_tail' && cat(mutation.nextSibling)==='none')return {container:ordinal(projection.container),position:op.baseline.length};
    }
    if(mutation?.target===projection.container && cat(mutation.previousSibling)==='baseline_tail' && cat(mutation.nextSibling)==='none')return {container:ordinal(projection.container),position:op.baseline.length};
    // Internal wrapper mutation: its standing branch must follow the baseline
    // tail branch in the same prepared container. Empty/replaced wrappers are OK.
    let branch=mutation?.target;
    for(let i=0;branch && i<6 && branch.parentNode!==projection.container;i++)branch=branch.parentNode;
    if(branch?.parentNode===projection.container && cat(branch.previousSibling)==='baseline_tail' && cat(branch.nextSibling)==='none')return {container:ordinal(projection.container),position:op.baseline.length};
    return {container:0,position:-1};
  };
  let baselineValid=rows.length>=op.baseline.length && op.baseline.every((r,i)=>r.id===rows[i].id && r.role===rows[i].role);
  const suffix=rows.slice(op.baseline.length),events=[];let visited=0;
  const event=(node,mutation,action)=>{
    if(++visited>256)throw Error('OBSERVATION_LIMIT');
    const role=node?.getAttribute?.('data-message-role'),id=node?.getAttribute?.('data-message-id');
    const message=['user','assistant'].includes(role),location=message?slot(node,mutation,action==='removed'):{container:ordinal(projection.container),position:-1};
    if(message && isBaseline(role,id))location.position=op.baseline.findIndex(r=>r.role===role && r.id===id);
    const result={mutation:mutation?.type==='attributes'?'attribute':mutation?.type==='childList'?'childList':'none',event:message?action:'wrapper',role:message?role:'none',
      node:ordinal(node),identity:message?identity(id):0,parent:ordinal(mutation?.target||node?.parentNode),...location,
      predecessor:projection.tailIdentity,previous:cat(mutation?mutation.previousSibling:node?.previousSibling),next:cat(mutation?mutation.nextSibling:node?.nextSibling),
      directChild:!!node && node.parentNode===(mutation?.target||node.parentNode),mountedAfter:rows.some(r=>r.node===node),ancestors:path(node)};
    events.push(result);
  };
  for(const mutation of mutations){
    if(++visited>256)throw Error('OBSERVATION_LIMIT');
    if(mutation.type==='attributes'){
      if(['data-message-id','data-message-role'].includes(mutation.attributeName)){
        const current=mutation.target.getAttribute(mutation.attributeName),old=mutation.oldValue;
        if(old!==null && old!=='' && old!==current)event(mutation.target,mutation,'id_changed');
        else if(old!==current)event(mutation.target,mutation,'id_hydrated');
      }
    }else {
      let found=false;
      // Mutation-record order is preserved; an atomic replace removes A then adds B.
      for(const [nodes,action] of [[mutation.removedNodes,'removed'],[mutation.addedNodes,'added']])for(const node of nodes||[]){
        for(const candidate of [node,...(node.querySelectorAll?.(MESSAGE)||[])]){
          if(++visited>256)throw Error('OBSERVATION_LIMIT');
          if(['user','assistant'].includes(candidate.getAttribute?.('data-message-role'))){event(candidate,mutation,action);found=true;}
        }
      }
      if(!found)event(mutation.target,mutation,'wrapper');
    }
  }
  for(const row of suffix)event(row.node,null,'mounted_sample');
  const c=composer();
  const frame={batch:op.acceptanceTrace.frames.length+1,kind,elapsedMs:Math.floor(Math.min(5000,Math.max(0,acceptanceNow()-projection.started))),baselineValid,structureValid,
    roleOrderValid:suffix.length<=MAX_OWNED_ASSISTANT_ROWS+1 && suffix.every((r,i)=>r.role===(i===0?'user':'assistant')),
    freshUsers:Math.min(128,suffix.filter(r=>r.role==='user').length),freshAssistants:Math.min(128,suffix.filter(r=>r.role==='assistant').length),
    composerReplaced:c?.root!==projection.composer.root,editorReplaced:c?.editor!==projection.composer.editor,
    generationActive:generationActive(),manualInterference:op.manualInterferenceObserved===true,events};
  if(!MuseAcceptanceReplay.validFrame(frame) || op.acceptanceTrace.frames.length>=MuseAcceptanceReplay.MAX_FRAMES ||
    op.acceptanceTrace.frames.reduce((n,f)=>n+f.events.length,0)+events.length>MuseAcceptanceReplay.MAX_EVENTS){op.acceptanceTrace.overflow=true;throw Error('OBSERVATION_LIMIT');}
  op.acceptanceTrace.frames.push(frame);
  if(JSON.stringify(op.acceptanceTrace).length>MuseAcceptanceReplay.MAX_BYTES){op.acceptanceTrace.frames.pop();op.acceptanceTrace.overflow=true;throw Error('OBSERVATION_LIMIT');}
  const result=op.acceptanceModel.step(frame);op.acceptanceResult=result;
  op.logicalFreshUserTurnCount=result.logicalCount;op.maxConcurrentFreshUserRows=result.maxConcurrent;op.replacementCandidateCount=result.replacementCount;
  op.identityReplacementObserved=result.replacementObserved;op.replacementAmbiguous=result.replacementAmbiguous || result.pendingReplacement;
  op.stableUserIdentityObserved=result.canonicalStable;
  const user=suffix[0];
  if(user){op.userTurn={node:user.node,currentNativeId:user.id,mounted:true,stabilizedSamples:result.canonicalStable?2:0};
    const parents=[];for(let n=user.node.parentNode,i=0;n && i<6;n=n.parentNode,i++){parents.push(n);if(n===projection.container)break;}
    projection.last={node:user.node,parents};
  }else if(op.userTurn){op.userTurn.mounted=false;op.userTurn.stabilizedSamples=0;}
  // Only previously observed rows inside the prepared container can retain an
  // assistant-tail slot through removal. This never proves user replacement.
  projection.lastAssistantRows=suffix.flatMap((row,i)=>{
    if(row.role!=='assistant' || !within(row.node))return [];
    const parents=[];for(let node=row.node.parentNode,depth=0;node && depth<6;node=node.parentNode,depth++){parents.push(node);if(node===projection.container)break;}
    return [{node:row.node,position:op.baseline.length+i,parents}];
  }).slice(0,MAX_OWNED_ASSISTANT_ROWS);
  if(['ambiguous','invalid'].includes(result.status))throw Error(result.reason);
}
function startAcceptanceProjection(op,original) {
  const nodes=new WeakMap(),ids=new Map();
  op.projection={nodes,ids,nextNode:0,container:null,started:acceptanceNow(),composer:original,last:null};
  for(const row of op.baseline)ids.set(row.id,ids.size+1);
  let container=op.baselineTail?.parentNode;
  for(let depth=0;container && depth<6;depth++,container=container.parentNode){
    if(container===document.documentElement || container===document.body)break;
    if(op.baselineNodes.every(node=>container.contains?.(node))){op.projection.container=container;break;}
  }
  if(op.projection.container)nodes.set(op.projection.container,++op.projection.nextNode);
  const baseline={count:op.baseline.length,container:nodes.get(op.projection.container)||0,tailIdentity:ids.get(op.baseline.at(-1).id)};
  op.projection.tailIdentity=baseline.tailIdentity;
  // Version 1 traces retain their original single-assistant replay semantics.
  op.acceptanceTrace={version:2,baseline,frames:[],overflow:false};
  op.acceptanceModel=MuseAcceptanceReplay.create(baseline,{assistantBlock:true});
}

async function inspect(p) {
  if(p.diagnoseAcquisition===true)return diagnoseAcquisition(p);
  if(p.diagnoseOwnership===true)return diagnoseOwnership(p);
  if(p.receipt?.version===2)return inspectV2(p);
  const op=operations.get(p.operationId);
  if(!op || op.sceneId!==p.sceneId || op.invalid || !op.receipt || !status().composerReady)return answer(p,'interrupted');
  const fresh=afterBaseline(op),response=fresh[1];
  if(response)op.assistantId ||= response.id;
  if(!response || generationActive())return answer(p,'running',{receipt:op.receipt});
  if(response.node.querySelector('[data-testid="assistant-response-error-notice"]'))return answer(p,'failed');
  const videos=[...response.node.querySelectorAll('video')];
  if(videos.length!==1)return answer(p,'running',{receipt:op.receipt});
  const video=videos[0],source=video.currentSrc;
  if(op.baselineVideos.has(video) || op.baselineSources.has(source) || (op.source && op.source!==source) || (op.video && op.video!==video))return answer(p,'interrupted');
  if(!source || !Number.isFinite(video.duration) || video.duration<=0 || video.videoWidth<=0 || video.videoHeight<=0 || video.readyState<2 || video.error)return answer(p,'running',{receipt:op.receipt});
  op.video=video;op.source=source;
  return answer(p,'result',{receipt:op.receipt,assistantMessageId:await hash(p.operationId,'assistant',response.id)});
}
async function diagnoseAcquisition(p) {
  // Capability census only. No operation lookup, persistence, fetch, playback,
  // source mutation or transfer. Global enumeration is never acquisition authority.
  const nodes=[...document.querySelectorAll('video')];
  if(nodes.length>16)throw Error('CAPABILITY_LIMIT');
  const videos=[];
  for(const v of nodes) {
    const message=v.closest(MESSAGE),assistant=message?.getAttribute('data-message-role')==='assistant';
    const id=assistant?message.getAttribute('data-message-id'):null;
    const current=v.currentSrc,object=v.srcObject,children=v.querySelectorAll('source').length;
    if(children>8)throw Error('CAPABILITY_LIMIT');
    videos.push({containingAssistantPresent:assistant,containingAssistantStableHashPresent:nativeId(id)?!!await hash(p.operationId,'assistant',id):false,
      sourceKind:!current?'none':current.startsWith('blob:')?'blob':current.startsWith('https:')?'https':'other',
      srcAttributePresent:v.hasAttribute('src'),currentSrcPresent:!!current,sourceChildCount:children,srcObjectPresent:object!=null,
      srcObjectMediaStream:typeof MediaStream==='function' && object instanceof MediaStream,
      readyState:v.readyState,networkState:v.networkState,durationFinite:Number.isFinite(v.duration),
      videoDimensionsAvailable:v.videoWidth>0 && v.videoHeight>0,paused:v.paused});
  }
  const acquisitionDiagnostic={videos};
  if(!MuseReceiptV2.capabilityReport(acquisitionDiagnostic))throw Error('CAPABILITY_INVALID');
  return answer(p,'interrupted',{acquisitionDiagnostic});
}
// Diagnostic only: adjacency is reported, never promoted into ownership proof.
// No DOM writes, scrolling, source URLs, text, or operation-map changes.
async function diagnoseOwnership(p) {
  const rows=structure(),parents=[],report=[];
  const attributes=['data-message-id','data-item-id','data-turn-id','data-response-id','data-thread-id','data-conversation-item-id','data-conversation-id','data-response-group-id','data-media-id','data-video-id','data-result-id'];
  for(const row of rows) {
    const id=await hash(p.operationId,row.role,row.id),parent=row.node.parentElement;
    if(!parents.includes(parent))parents.push(parent);
    const ancestors=[];
    for(let node=parent,depth=0;node && depth<4;node=node.parentElement,depth++) {
      for(const attribute of attributes) {
        const value=node.getAttribute(attribute);
        if(nativeId(value) && ancestors.length<4)ancestors.push({attribute,value:await hash(p.operationId,attribute,value)});
      }
    }
    const videos=[...row.node.querySelectorAll('video')];
    if(videos.length>16)throw Error('MEDIA_LIMIT');
    const candidates=[];
    for(const [index,node] of [row.node,...videos].entries())for(const attribute of attributes) {
      const value=node.getAttribute?.(attribute);
      if(nativeId(value))candidates.push({scope:index===0?'message':'media',attribute,value:await hash(p.operationId,attribute,value)});
    }
    const linkage=await linkageMetadata(p.operationId,row.node,videos);
    report.push({id,role:row.role,ownedUser:row.role==='user' && id===p.ownedUserHash,parentIndex:parents.indexOf(parent),nextSiblingIndex:rows.findIndex(r=>r.node===row.node.nextElementSibling),ancestors,candidates,linkage,videoCount:videos.length,sourceTypes:videos.map(v=>!v.currentSrc?'empty':v.currentSrc.startsWith('blob:')?'blob':v.currentSrc.startsWith('https:')?'https':'other')});
  }
  const owned=report.flatMap((r,i)=>r.ownedUser?[i]:[]),index=owned.length===1?owned[0]:-1;
  const tail=index<0?[]:rows.slice(index+1),end=tail.findIndex(r=>r.role==='user');
  const block=(end<0?tail:tail.slice(0,end)),within=block.length<=MAX_OWNED_ASSISTANT_ROWS && block.every(r=>r.node.parentNode===rows[index]?.node.parentNode && !!r.node.parentNode);
  const userNode=rows[index]?.node,parent=userNode?.parentNode,sequence=parent?[...parent.querySelectorAll(MESSAGE)].filter(node=>node.parentNode===parent):[],start=sequence.indexOf(userNode);
  const contiguous=start>=0 && block.every((r,i)=>sequence[start+i+1]===r.node);
  const summary={ownedResponseBlockCount:index>=0 && block.length>0 && within && contiguous?1:0,assistantBlockRowCount:Math.min(MAX_OWNED_ASSISTANT_ROWS+1,block.length),
    mediaAssistantCandidateCount:Math.min(MAX_OWNED_ASSISTANT_ROWS+1,block.filter(r=>directVideos(r).length>0).length),
    mediaAssistantStable:false,generationActive:generationActive(),nextUserObserved:end>=0,assistantBlockWithinBound:within};
  // A current census never advances stabilization or retrofits a receipt.
  return answer(p,'interrupted',{ownershipDiagnostic:{receiptAvailable:typeof p.ownedUserHash==='string',ownedUserMatches:owned.length,rows:report,responseBlock:summary}});
}
async function linkageMetadata(operationId,message,videos) {
  const attributes=['data-message-id','data-item-id','data-turn-id','data-response-id','data-thread-id','data-conversation-item-id','data-conversation-id','data-response-group-id','data-media-id','data-video-id','data-result-id','data-attachment-id','data-asset-id','data-generation-id','data-request-id','data-response-to','data-response-to-id','data-reply-to','data-reply-to-id','data-parent-id','data-parent-message-id','data-user-message-id'];
  const entries=[];
  async function sample(node,scope,depth,mediaIndex) {
    for(const attribute of attributes) {
      const value=node.getAttribute?.(attribute);
      if(!nativeId(value))continue;
      if(entries.length>=128)throw Error('LINKAGE_LIMIT');
      // Common namespace permits comparison of an explicit reply-to ID with
      // a message ID. Values never leave this boundary unhashed.
      entries.push({scope,depth,mediaIndex,attribute,value:await hash(operationId,'native-link',value)});
    }
  }
  await sample(message,'message',0,-1);
  for(let node=message.parentElement,depth=1;node && depth<=6;node=node.parentElement,depth++)await sample(node,'ancestor',depth,-1);
  for(const [mediaIndex,video] of videos.entries()) {
    // Never attribute a nested message's video to an outer message.
    if(video.closest?.(MESSAGE)!==message)continue;
    await sample(video,'video',0,mediaIndex);
    const sources=[...video.querySelectorAll('source')];
    if(sources.length>8)throw Error('SOURCE_LIMIT');
    for(const source of sources)await sample(source,'source',0,mediaIndex);
    for(let node=video.parentElement,depth=1;node && node!==message && depth<=6;node=node.parentElement,depth++)await sample(node,'media-ancestor',depth,mediaIndex);
  }
  return entries;
}
async function submit(p) {
  const prepared=p.receipt?.version===2?operations.get(p.operationId):null;
  if(prepared && prepared.submissionStarted)return answer(p,'interrupted');
  if(operations.has(p.operationId) && !prepared)return inspect(p);
  const invocation={delivery:'content-script',send:'not-invoked',reason:'baseline-unready'};
  if(p.receipt?.version===2 && (!prepared || prepared.sceneId!==p.sceneId || prepared.invalid || prepared.observationToken!==p.observationToken || !MuseReceiptV2.extendsReceipt(prepared.preparedReceipt,p.receipt) || p.receipt.userStableIdHash))return answer(p,'interrupted',{invocation});
  // Claim synchronously, before stabilization awaits. A duplicate cannot race
  // the first command into a second click; worker storage is the durable guard.
  if(prepared)prepared.submissionStarted=true;
  // Reserve before waiting: duplicate commands must never start another attempt.
  if(operations.size>=32)return answer(p,'interrupted',{invocation});
  const reservation={sceneId:p.sceneId,invalid:true};if(!prepared)operations.set(p.operationId,reservation);
  const stable=await waitForStableConversation();
  if(!stable || prepared?.invalid){releaseV2(p.operationId,prepared);return answer(p,'interrupted',{invocation});}
  stableKey=stable.key;
  if(!status().canSubmit){releaseV2(p.operationId,prepared);return answer(p,'interrupted',{invocation:{...invocation,reason:'composer-unready'}});}
  const c=composer(),baseline=structure();
  if(structureKey(baseline)!==stable.key){releaseV2(p.operationId,prepared);return answer(p,'interrupted',{invocation});}
  if(prepared && structureKey(baseline)!==structureKey(prepared.baseline)){releaseV2(p.operationId,prepared);return answer(p,'interrupted',{invocation});}
  const videos=baseline.flatMap(r=>[...r.node.querySelectorAll('video')]);
  const op=prepared || {sceneId:p.sceneId,baseline:baseline.map(({id,role})=>({id,role})),baselineVideos:new Set(videos),baselineSources:new Set(videos.map(v=>v.currentSrc).filter(Boolean))};
  if(prepared)op.lastContact=Date.now();
  operations.set(p.operationId,op); // Before composer writes; one attempt forever.
  let inserting=false,sendButton=null,sendStartedAt=null;
  // insertText can synchronously emit a trusted input event. Only that exact
  // own insertion is exempt; trusted clicks/keys and later input still abort.
  const disturbed=e=>{if(e.isTrusted && !(inserting && e.type==='input' && e.target===c.editor)){op.invalid=true;op.observerInvalidation||='MANUAL_INTERFERENCE';op.manualInterferenceObserved=true;}};
  for(const type of ['input','click','keydown'])c.root.addEventListener(type,disturbed,true);
  try {
    invocation.reason='composer-changed';
    c.editor.focus();
    inserting=true;
    try {
    if(c.editor.tagName==='TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(c.editor,p.prompt);
      c.editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    } else {
      const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(c.editor);
      selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,p.prompt))throw Error('INSERT_FAILED');
    }
    } finally {inserting=false;}
    await new Promise(r=>setTimeout(r,100));
    const current=composer();
    if(op.invalid || current?.editor!==c.editor || current?.root!==c.root || editorLength(c.editor)!==p.prompt.length)throw Error('NOT_READY');
    invocation.reason='baseline-changed';
    if(afterBaseline(op).length || generationActive())throw Error('NOT_READY');
    invocation.reason='send-unready';
    const candidates=[...current.slot.querySelectorAll('button')];
    if(candidates.length!==1 || !actionable(candidates[0]) || !current.slot.contains(candidates[0]))throw Error('NOT_READY');
    const button=candidates[0];
    sendButton=button;
    if(prepared) {
      // Survive normal composer remounts, but retain document-wide protection
      // against manual input until causal assistant ownership is released.
      for(const type of ['input','click','keydown','pointerdown'])document.addEventListener(type,disturbed,true);
      const cleanup=op.cleanup;
      op.cleanup=()=>{cleanup?.();for(const type of ['input','click','keydown','pointerdown'])document.removeEventListener(type,disturbed,true);};
      op.sendAttempted=true;
      startAcceptanceProjection(op,c);
    }
    invocation.send='uncertain';invocation.reason='invocation-uncertain';
    sendStartedAt=Date.now();
    button.click(); // No await between fresh resolution/validation and invocation.
    invocation.send='invoked';invocation.reason='acceptance-unproven';
    for(let i=0;i<25;i++) {
      await new Promise(r=>setTimeout(r,200));
      if(prepared) {
        op.sample('sample');
        if(op.invalid)throw Error('OBSERVATION_INVALID');
        const fresh=afterBaseline(op,true),user=fresh[0];
        if(!user || !nativeId(user.id))continue;
        if(op.logicalFreshUserTurnCount!==1 || op.userTurn?.node!==user.node || !op.userTurn.mounted)throw Error('AMBIGUOUS_OPERATION');
        if(op.acceptanceResult?.status!=='accepted')continue;
        if(op.acceptanceResult.canonicalNode!==op.projection.nodes.get(user.node) || op.acceptanceResult.canonicalIdentity!==op.projection.ids.get(user.id))throw Error('USER_CHANGED');
        op.stableUserIdentityObserved=true;
        const userStableIdHash=await hash(p.operationId,'user',user.id);
        op.sample();
        if(op.invalid || op.acceptanceResult?.status!=='accepted' || afterBaseline(op,true)[0]?.id!==user.id || op.userTurn?.node!==user.node ||
          op.acceptanceResult.canonicalNode!==op.projection.nodes.get(user.node) || op.acceptanceResult.canonicalIdentity!==op.projection.ids.get(user.id))throw Error('USER_CHANGED');
        op.submittedUserId=user.id;
        op.userSequenceParent=user.node.parentNode;
        const currentComposer=composer();
        op.receipt={...op.preparedReceipt,userStableIdHash,acceptance:{baselineIntact:true,uniqueUserTurn:true,
          composerCleared:!!currentComposer && editorLength(currentComposer.editor)===0,
          sendControlTransition:!actionable(button) || !currentComposer?.slot.contains(button),generationControlObserved:generationActive()}};
        // User only: main/worker must durably echo this before assistant binding.
        return answer(p,'running',{receipt:op.receipt,invocation:{...invocation,reason:'accepted'}});
      }
      if(op.invalid || composer()?.editor!==c.editor)throw Error('COMPOSER_CHANGED');
      const fresh=afterBaseline(op),cleared=editorLength(c.editor)===0;
      const transitioned=!actionable(button) || !composer()?.slot.contains(button),active=generationActive();
      if(fresh[0] && cleared && (transitioned || active)) {
        op.submittedUserId=fresh[0].id;op.assistantId=fresh[1]?.id || null;
        op.receipt={version:1,operationId:p.operationId,
          baselineUserMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='user').map(r=>hash(p.operationId,r.role,r.id))),
          baselineAssistantMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='assistant').map(r=>hash(p.operationId,r.role,r.id))),
          submittedUserMessageId:await hash(p.operationId,'user',op.submittedUserId),
          acceptance:{composerCleared:true,sendControlTransition:transitioned,generationControlObserved:active}};
        return {...await inspect(p),invocation:{...invocation,reason:'accepted'}};
      }
    }
    throw Error('ACCEPTANCE_UNCERTAIN');
  } catch(error) {
    let acceptanceDiagnostic;
    if(prepared && invocation.send==='invoked')acceptanceDiagnostic=acceptanceFailureDiagnostic(op,c,sendButton,sendStartedAt,error);
    op.invalid=true;releaseV2(p.operationId,op);
    const acceptanceTrace=op.acceptanceTrace;
    return answer(p,'interrupted',{invocation,...(acceptanceDiagnostic?{acceptanceDiagnostic}:{}),
      ...(prepared && invocation.send==='invoked' && !op.receipt?.userStableIdHash && MuseAcceptanceReplay.validTrace(acceptanceTrace)?{acceptanceTrace}:{})});
  }
  finally {if(op.invalid)releaseV2(p.operationId,op);for(const type of ['input','click','keydown'])c.root.removeEventListener(type,disturbed,true);}
}
function acceptanceFailureDiagnostic(op,original,button,started,error) {
  // Evidence only. Never used by receipt validation, ownership or reconciliation.
  try {
    let baselinePrefixValid=false;
    try{const rows=structure(true);baselinePrefixValid=rows.length>=op.baseline.length && op.baseline.every((r,i)=>r.id===rows[i].id && r.role===rows[i].role);}catch{}
    const c=composer(),elapsed=Math.max(0,Date.now()-started),reason=op.observerInvalidation||error?.message;
    const d={acceptanceBuild:CONTENT_BUILD,failureReason:MuseReceiptV2.acceptanceFailureReasons.includes(reason)?reason:'UNKNOWN',
      elapsedBucket:elapsed<1000?'under_1s':elapsed<=5000?'1_to_5s':'over_5s',deadlineReached:error?.message==='ACCEPTANCE_UNCERTAIN',
      freshUserCount:Math.min(128,op.newUsers?.size||0),freshAssistantCount:Math.min(128,op.newAssistants?.size||0),baselinePrefixValid,
      freshUserIdentityCount:Math.min(128,op.newUsers?.size||0),logicalFreshUserTurnCount:Math.min(128,op.logicalFreshUserTurnCount||0),
      maxConcurrentFreshUserRows:Math.min(128,op.maxConcurrentFreshUserRows||0),identityReplacementObserved:op.identityReplacementObserved===true,
      replacementCandidateCount:Math.min(128,op.replacementCandidateCount||0),canonicalUserStable:(op.userTurn?.stabilizedSamples||0)>=2,
      replacementAmbiguous:op.replacementAmbiguous===true,
      stableUserIdentityObserved:op.stableUserIdentityObserved===true,manualInterferenceObserved:op.manualInterferenceObserved===true,
      composerReplaced:c?.root!==original.root,editorReplaced:c?.editor!==original.editor,
      sendControlTransitionObserved:!actionable(button) || !c?.slot.contains(button),generationControlObserved:generationActive()};
    return MuseReceiptV2.validAcceptanceDiagnostic(d)?d:null;
  }catch{return null;}
}
// The worker owns durable history. This map owns only live causal observation.
// Invalidate retained references before deletion so pending awaits fail closed.
function releaseV2(id,op) {
  if(!op || op.v2Reserved===undefined)return;
  op.invalid=true;op.v2Reserved=false;op.cleanup?.();op.cleanup=null;
  if(operations.get(id)===op)operations.delete(id);
}
async function prepareV2(p) {
  if(operations.has(p.operationId) || operations.size>=32 || transfers.size || [...operations.values()].some(op=>op.v2Reserved && !op.invalid && !op.receipt?.result))return answer(p,'interrupted');
  const op={sceneId:p.sceneId,invalid:false,v2Reserved:true,observationToken:p.observationToken};
  operations.set(p.operationId,op);
  try {
  const stable=await waitForStableConversation();
  if(stable)stableKey=stable.key;
  if(op.invalid || !stable || !status().canSubmit){releaseV2(p.operationId,op);return answer(p,'interrupted');}
  op.baseline=stable.rows.map(({id,role})=>({id,role}));op.createdAt=Date.now();op.lastContact=Date.now();
  op.newUsers=new Set();op.newAssistants=new Set();
  op.baselineTail=stable.rows.at(-1).node;op.baselineNodes=stable.rows.map(r=>r.node);op.logicalFreshUserTurnCount=0;op.maxConcurrentFreshUserRows=0;op.replacementCandidateCount=0;
  const sample=(mutations=[],kind='observer')=>{
    if(op.invalid && ['ambiguous','invalid'].includes(op.acceptanceResult?.status))return;
    try {
      const accepting=op.sendAttempted && !op.receipt?.userStableIdHash;
      const remember=row=>{if(!op.baseline.some(b=>b.id===row.id && b.role===row.role))(row.role==='user'?op.newUsers:op.newAssistants).add(row.id);};
      let visited=0;const events=[];
      // Inspect bounded mutation additions/removals as well as mounted rows:
      // a manual turn appended and removed in one batch still invalidates.
      for(const mutation of mutations) {
        if(++visited>256)throw Error('OBSERVATION_LIMIT');
        if(!accepting && mutation.type==='attributes' && ['data-message-id','data-message-role'].includes(mutation.attributeName) && mutation.oldValue!==null && mutation.oldValue!=='' && mutation.oldValue!==mutation.target.getAttribute(mutation.attributeName) &&
          !(mutation.attributeName==='data-message-id' && mutation.target.getAttribute('data-message-role')==='assistant' && !op.baseline.some(r=>r.id===mutation.oldValue)))throw Error('IDENTITY_MUTATED');
        const event={mutation,added:[],removed:[]};events.push(event);
        const changes=[...[...(mutation.addedNodes||[])].map(node=>({node,removed:false})),
          ...[...(mutation.removedNodes||[])].map(node=>({node,removed:true}))];
        for(const {node,removed} of changes) {
          const nodes=[node,...(node.querySelectorAll?.(MESSAGE)||[])];
          for(const candidate of nodes) {
            if(++visited>256)throw Error('OBSERVATION_LIMIT');
            const role=candidate.getAttribute?.('data-message-role'),id=candidate.getAttribute?.('data-message-id');
            if(['user','assistant'].includes(role)){
              (removed?event.removed:event.added).push({node:candidate,id,role});
              // An initially unassigned ID may hydrate on its mounted row.
              // A transient unidentified turn cannot disappear from evidence.
              if(!nativeId(id)){if(accepting || op.sendAttempted && !removed && (id===null || id===''))continue;throw Error('IDENTITY_UNAVAILABLE');}
              remember({id,role});
            }
          }
        }
      }
      let rows,structureValid=true;
      try{rows=structure(!!op.sendAttempted);}catch(error){
        if(!accepting)throw error;structureValid=false;
        rows=[...document.querySelectorAll(MESSAGE)].slice(0,257).filter(node=>['user','assistant'].includes(node.getAttribute('data-message-role'))).map(node=>({node,id:node.getAttribute('data-message-id'),role:node.getAttribute('data-message-role')}));
      }
      for(const row of rows)if(nativeId(row.id))remember(row);
      const concurrent=rows.slice(op.baseline.length).filter(r=>r.role==='user').length;
      op.maxConcurrentFreshUserRows=Math.max(op.maxConcurrentFreshUserRows,concurrent);
      if(concurrent>1)op.logicalFreshUserTurnCount=concurrent;
      // Prefix and fresh role/order must stay intact until acceptance. Pending
      // native IDs may hydrate after send, but cannot grant ownership yet.
      if(!op.receipt?.userStableIdHash){
        if(accepting)acceptanceProjection(op,mutations,rows,kind,structureValid);
        else afterBaseline(op,!!op.sendAttempted);
      }else {
        // Once anchored, aliases grant no authority. Even a temporary alias
        // reappearing as a separate row is another/unproven turn.
        const unownedUser=r=>r.role==='user' && !op.baseline.some(b=>b.role==='user' && b.id===r.id) && r.id!==op.submittedUserId;
        if(rows.some(unownedUser) || events.some(e=>[...e.added,...e.removed].some(unownedUser)))throw Error('AMBIGUOUS_OPERATION');
        // Any observed churn requires fresh poll stabilization. This includes
        // transient video/row replacement restored before the next poll.
        if(mutations.length)op.mediaStabilization=null;
        const block=responseBlock(op);
        if(op.mediaStabilization && !sameBlock(op.mediaStabilization,block))op.mediaStabilization=null;
      }
      if(op.newUsers.size>MAX_MESSAGES || op.newAssistants.size>MAX_MESSAGES)throw Error('OBSERVATION_LIMIT');
    }catch(error){if(error?.message==='OBSERVATION_LIMIT' && op.acceptanceTrace)op.acceptanceTrace.overflow=true;op.invalid=true;op.observerInvalidation||=MuseReceiptV2.acceptanceFailureReasons.includes(error?.message)?error.message:'UNKNOWN';}
    if(op.invalid)releaseV2(p.operationId,op);
  };
  const observer=new MutationObserver(records=>sample(records,'observer'));
  op.sample=(kind='observer')=>sample(observer.takeRecords?.() || [],kind);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['data-message-id','data-message-role','data-message-item']});
  const deadline=setTimeout(()=>releaseV2(p.operationId,op),20*60*1000);
  op.cleanup=()=>{observer.disconnect();clearTimeout(deadline);};
  op.preparedReceipt={version:2,operationId:p.operationId,
    baselineUserMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='user').map(r=>hash(p.operationId,r.role,r.id))),
    baselineAssistantMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='assistant').map(r=>hash(p.operationId,r.role,r.id)))};
  if(op.invalid || structureKey(structure())!==stable.key){releaseV2(p.operationId,op);return answer(p,'interrupted');}
  return answer(p,'prepared',{receipt:op.preparedReceipt});
  } catch {releaseV2(p.operationId,op);return answer(p,'interrupted');}
}
async function inspectV2(p) {
  const receipt=p.receipt;
  if(!receipt.userStableIdHash){releaseV2(p.operationId,operations.get(p.operationId));return answer(p,'interrupted');}
  let op=operations.get(p.operationId),next=receipt;
  if(!receipt.assistantStableIdHash) {
    if(!op || op.sceneId!==p.sceneId || op.invalid || !op.receipt || op.observationToken!==p.observationToken || Date.now()-op.lastContact>10000 || Date.now()-op.createdAt>20*60*1000 || !MuseReceiptV2.extendsReceipt(op.receipt,receipt)) {
      if(op)releaseV2(p.operationId,op);return answer(p,'interrupted');
    }
    try {
    op.lastContact=Date.now();op.sample();
    if(op.invalid || !structure(true).some(r=>r.role==='user' && r.id===op.submittedUserId) || op.logicalFreshUserTurnCount!==1 || op.userTurn?.currentNativeId!==op.submittedUserId){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    const block=responseBlock(op);
    if(await hash(p.operationId,'user',block.user.id)!==receipt.userStableIdHash){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    op.sample();
    if(op.invalid){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    if(generationActive() || block.mediaRows.length!==1 || !nativeId(block.mediaRows[0].id)) {
      op.mediaStabilization=null;return answer(p,'running',{receipt});
    }
    const owner=block.mediaRows[0];
    if(!sameBlock(op.mediaStabilization,block))op.mediaStabilization={signature:block.signature,nodes:block.rows.map(r=>r.node),samples:1};
    else op.mediaStabilization.samples=Math.min(2,op.mediaStabilization.samples+1);
    if(op.mediaStabilization.samples<2)return answer(p,'running',{receipt});
    const stable=op.mediaStabilization;
    next={...receipt,assistantStableIdHash:await hash(p.operationId,'assistant',owner.id)};
    op.sample();
    if(op.invalid || !MuseReceiptV2.valid(next,p.operationId)){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    if(op.mediaStabilization!==stable || generationActive() || !sameBlock(stable,responseBlock(op)))return answer(p,'running',{receipt});
    op.receipt=next;releaseV2(p.operationId,op);
    // Persist the assistant before inspecting/persisting a result candidate.
    return answer(p,'running',{receipt:next});
    } catch {releaseV2(p.operationId,op);return answer(p,'interrupted');}
  }
  // Refresh/restart recovery needs no operation-map entry or global baseline.
  const candidates=[];
  for(const row of structure())if(row.role==='assistant' && await hash(p.operationId,'assistant',row.id)===receipt.assistantStableIdHash)candidates.push(row);
  if(candidates.length!==1)return answer(p,'interrupted');
  const response=candidates[0].node;
  const videos=[...response.querySelectorAll('video')].filter(v=>v.closest(MESSAGE)===response);
  if(videos.length>1)return answer(p,'interrupted');
  if(!videos.length || generationActive())return answer(p,'running',{receipt});
  const v=videos[0];
  if(!v.currentSrc || !Number.isFinite(v.duration) || v.duration<=0 || v.videoWidth<=0 || v.videoHeight<=0 || v.readyState<2 || v.error)return answer(p,'running',{receipt});
  if(!allowedVideoSource(v.currentSrc))return answer(p,'interrupted');
  next={...receipt,result:{kind:'video',ownerAssistantStableIdHash:receipt.assistantStableIdHash}};
  if(op)op.receipt=next;
  return answer(p,'result',{receipt:next});
}
function allowedVideoSource(value) {
  try {const u=new URL(value);
    return !u.username && !u.password && !u.port && ((u.protocol==='blob:' && u.origin==='https://muse.ai') ||
      (u.protocol==='https:' && (u.hostname==='muse.ai' || u.hostname.endsWith('.fbcdn.net'))));
  } catch {return false;}
}
async function acquire(p) {
  if(p.receipt?.version===2)return acquireV2(p);
  return answer(p,'interrupted'); // Legacy receipts never acquire or migrate.
}
// One bounded browser stream. Only the receipt-owned element can supply a URL;
// neither the worker nor desktop can inject one. No whole-video buffering.
const transfers=new Map(),closedTransfers=new Set();
const MAX_CLOSED_TRANSFERS=64;
function cancelLocal(p) {
  const op=operations.get(p.operationId);
  if(op?.sceneId===p.sceneId && op.v2Reserved!==undefined) {
    releaseV2(p.operationId,op);
  }
  for(const t of transfers.values())if(t.operationId===p.operationId && t.sceneId===p.sceneId)closeTransfer(t);
  return answer(p,'unsupported',{confirmed:false});
}
function closeTransfer(t) {
  clearTimeout(t.timer);t.controller.abort();
  try{Promise.resolve(t.reader?.cancel()).catch(()=>{});}catch{}
  // Clean late-arriving resources, but never delete a successor with this ID.
  if(transfers.get(t.id)!==t)return;
  transfers.delete(t.id);
  closedTransfers.add(t.id);
  // FIFO replay window, independent of active capacity. Ownership is checked
  // afresh even after eviction; durable worker/main evidence remains required.
  if(closedTransfers.size>MAX_CLOSED_TRANSFERS)closedTransfers.delete(closedTransfers.values().next().value);
}
async function ownedVideo(p) {
  const evidence=await inspectV2(p);
  if(evidence.state!=='result')throw Error('OWNED_RESULT_UNAVAILABLE');
  const rows=structure();
  for(const row of rows)if(row.role==='assistant' && await hash(p.operationId,'assistant',row.id)===p.receipt.assistantStableIdHash) {
    const videos=[...row.node.querySelectorAll('video')].filter(v=>v.closest(MESSAGE)===row.node);
    if(videos.length===1 && allowedVideoSource(videos[0].currentSrc))return videos[0];
  }
  throw Error('OWNED_RESULT_UNAVAILABLE');
}
async function acquireV2(p) {
  if(!MuseReceiptV2.transferRequest(p))return answer(p,'interrupted');
  let t=transfers.get(p.transferId);
  if(t && (t.operationId!==p.operationId || t.sceneId!==p.sceneId))return answer(p,'interrupted');
  if(p.abort){if(t)closeTransfer(t);return answer(p,'interrupted');}
  if(t?.busy)return answer(p,'interrupted');
  if(t)t.busy=true;
  try {
    if(!t) {
      if(p.offset!==0 || p.sequence!==0 || transfers.size || closedTransfers.has(p.transferId))return answer(p,'interrupted');
      t={id:p.transferId,operationId:p.operationId,sceneId:p.sceneId,receipt:p.receipt,offset:0,sequence:0,
        started:Date.now(),controller:new AbortController(),pending:new Uint8Array(0),ended:false,busy:true};
      transfers.set(t.id,t);
      t.timer=setTimeout(()=>closeTransfer(t),15000);
      const video=await ownedVideo(p),source=video.currentSrc;
      if(t.controller.signal.aborted)throw Error('TRANSFER_CANCELLED');
      t.video=video;t.source=source;
      const response=await fetch(source,{credentials:'same-origin',redirect:'error',signal:t.controller.signal});
      if(!response.ok || response.redirected || (response.url && response.url!==source) ||
        !['video/mp4','application/octet-stream'].includes((response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()))throw Error('TYPE');
      const length=response.headers.get('content-length');
      t.expected=length===null?null:Number(length);
      if(t.expected!==null && (!Number.isSafeInteger(t.expected) || t.expected<12 || t.expected>MuseReceiptV2.MAX_BYTES))throw Error('LIMIT');
      t.reader=response.body.getReader();
    }
    if(t.controller.signal.aborted || Date.now()-t.started>300000 || t.offset!==p.offset || t.sequence!==p.sequence ||
      !MuseReceiptV2.extendsReceipt(t.receipt,p.receipt) || await ownedVideo(p)!==t.video || t.video.currentSrc!==t.source)throw Error('TRANSFER_CHANGED');
    t.busy=true;clearTimeout(t.timer);t.timer=setTimeout(()=>closeTransfer(t),15000);
    const bytes=new Uint8Array(MuseReceiptV2.CHUNK_BYTES);let size=0;
    while(size<bytes.length && !t.ended) {
      if(!t.pending.length) {
        const part=await t.reader.read();
        if(part.done){t.ended=true;break;}
        // Bound even a single browser stream allocation retained between calls.
        if(!part.value?.length || part.value.length>8*1024*1024 || t.offset+size+part.value.length>MuseReceiptV2.MAX_BYTES)throw Error('LIMIT');
        t.pending=part.value;
      }
      const take=Math.min(bytes.length-size,t.pending.length);
      bytes.set(t.pending.subarray(0,take),size);size+=take;t.pending=t.pending.subarray(take);
    }
    if(t.controller.signal.aborted || Date.now()-t.started>300000 || await ownedVideo(p)!==t.video || t.video.currentSrc!==t.source)throw Error('TRANSFER_CHANGED');
    const total=t.offset+size;
    if(total>MuseReceiptV2.MAX_BYTES || t.expected!==null && (total>t.expected || t.ended && total!==t.expected))throw Error('LIMIT');
    const chunk=bytes.subarray(0,size);
    const chunkHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',chunk))].map(v=>v.toString(16).padStart(2,'0')).join('');
    let binary='';for(let i=0;i<size;i+=8192)binary+=String.fromCharCode(...chunk.subarray(i,i+8192));
    const result=answer(p,'result',{receipt:p.receipt,transferId:t.id,sequence:p.sequence,offset:p.offset,total:t.ended?total:null,done:t.ended,chunkHash,data:btoa(binary)});
    t.offset=total;t.sequence++;t.busy=false;
    if(t.ended)closeTransfer(t);
    return result;
  } catch {if(t)closeTransfer(t);return answer(p,'interrupted');}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || location.origin!=='https://muse.ai' || window.top!==window)return false;
  if(message?.type==='viral-ai:muse-handshake'){reply({contractVersion:3,buildMarker:CONTENT_BUILD,diagnosticsEnabled:developmentDiagnostics});return false;}
  if(message?.type==='viral-ai:muse-status'){
    try{reply(status());}catch{reply({sampledAt:Date.now(),composerReady:false,inspectionComplete:false,contentError:'STATUS_EXCEPTION'});}
    return false;
  }
  const p=message?.payload,type=message?.command;
  if(message?.type!=='viral-ai:muse-execution' || !p || !validId(p.operationId) || !validId(p.sceneId) || !['submitGeneration','inspectGeneration','acquireGenerationResult','cancelGeneration','prepareGeneration'].includes(type))return false;
  if(Object.keys(p).some(k=>!['tabId','operationId','sceneId','prompt','offset','diagnoseOwnership','ownedUserHash','receipt','observationToken','transferId','sequence','mediaKind','abort','diagnoseAcquisition'].includes(k)))return false;
  if((p.diagnoseAcquisition!==undefined || p.diagnoseOwnership!==undefined) && !developmentDiagnostics)return false;
  if(p.diagnoseAcquisition!==undefined && !MuseReceiptV2.capabilityRequest(type,p))return false;
  if(p.receipt!==undefined && (!['submitGeneration','inspectGeneration','acquireGenerationResult'].includes(type) || !MuseReceiptV2.valid(p.receipt,p.operationId) || p.diagnoseOwnership!==undefined))return false;
  if(type==='acquireGenerationResult' && p.receipt && !MuseReceiptV2.transferRequest(p))return false;
  if(!(type==='acquireGenerationResult' && p.receipt) && ['transferId','sequence','mediaKind','abort'].some(k=>p[k]!==undefined))return false;
  if((p.receipt || type==='prepareGeneration') && (typeof p.observationToken!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.observationToken)))return false;
  if(p.diagnoseOwnership!==undefined && (type!=='inspectGeneration' || p.diagnoseOwnership!==true || p.offset!==undefined || !(p.ownedUserHash===null || /^[a-f0-9]{64}$/.test(p.ownedUserHash||''))))return false;
  if(p.diagnoseOwnership!==true && p.ownedUserHash!==undefined)return false;
  if(type==='submitGeneration' && (typeof p.prompt!=='string' || !p.prompt.trim() || p.prompt.length>8000 || p.offset!==undefined))return false;
  if(type==='submitGeneration' && !developmentDiagnostics && p.receipt?.version!==2)return false;
  if(type!=='submitGeneration' && p.prompt!==undefined)return false;
  if(type==='acquireGenerationResult' && (!Number.isSafeInteger(p.offset) || p.offset<0 || p.offset>268435456))return false;
  Promise.resolve().then(()=>type==='prepareGeneration'?prepareV2(p):type==='submitGeneration'?submit(p):type==='inspectGeneration'?inspect(p):type==='acquireGenerationResult'?acquire(p):cancelLocal(p))
    .then(reply,()=>reply(answer(p,'interrupted')));return true;
});
let reconnectAttempts=0,reconnectTimer=null,activePort=null;
function connect() {
  if(activePort || reconnectAttempts>=4)return;
  reconnectAttempts++;
  try {
    if(!chrome.runtime.id)return;
    const port=chrome.runtime.connect({name:'viral-ai-muse-tab'});activePort=port;
    port.onDisconnect.addListener(()=>{
      for(const t of transfers.values())closeTransfer(t);
      for(const [id,op] of operations)releaseV2(id,op);
      activePort=null;
      try{if(chrome.runtime.id && reconnectAttempts<4)reconnectTimer=setTimeout(connect,1500*reconnectAttempts);}catch{}
    });
  }catch{activePort=null;}
}
function reconnectOnVisible() {
  if(document.visibilityState==='visible' && !activePort){reconnectAttempts=0;clearTimeout(reconnectTimer);connect();}
}
document.addEventListener?.('visibilitychange',reconnectOnVisible);
window.addEventListener?.('pageshow',reconnectOnVisible);
window.addEventListener?.('pagehide',()=>{clearTimeout(reconnectTimer);const port=activePort;activePort=null;reconnectAttempts=4;port?.disconnect();});
connect();
