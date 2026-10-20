"use strict";
const CONTENT_BUILD='muse-content-v0-3-0-contract3-receipt2';
const developmentDiagnostics=chrome.runtime.getManifest().version_name==='development-diagnostics';
const operations=new Map();
const ROOT='[data-hatch-composer-root]';
const EDITOR='[data-lexical-editor="true"], textarea, [data-hatch-composer-prehydration-input], [contenteditable="true"]';
const SLOT='[data-hatch-composer-action-slot]';
const MESSAGE='[data-message-item]';
const STOP='[data-testid="hatch-composer-stop-button"]';
const MAX_MESSAGES=128;
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
function structure() {
  const rows=[...document.querySelectorAll(MESSAGE)].filter(n=>['user','assistant'].includes(n.getAttribute('data-message-role')))
    .map(node=>({node,id:node.getAttribute('data-message-id'),role:node.getAttribute('data-message-role')}));
  const users=rows.filter(r=>r.role==='user'),assistants=rows.filter(r=>r.role==='assistant');
  if(users.length>MAX_MESSAGES || assistants.length>MAX_MESSAGES || rows.some(r=>!nativeId(r.id)) || new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('IDENTITY_UNAVAILABLE');
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
function afterBaseline(op) {
  const rows=structure();
  if(rows.length<op.baseline.length || op.baseline.some((r,i)=>r.id!==rows[i].id || r.role!==rows[i].role))throw Error('BASELINE_CHANGED');
  const fresh=rows.slice(op.baseline.length);
  if(fresh.length>2 || fresh.some((r,i)=>r.role!==(i===0?'user':'assistant')))throw Error('AMBIGUOUS_OPERATION');
  if(op.submittedUserId && fresh[0]?.id!==op.submittedUserId)throw Error('USER_CHANGED');
  if(op.assistantId && fresh[1]?.id!==op.assistantId)throw Error('RESPONSE_CHANGED');
  return fresh;
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
  return answer(p,'interrupted',{ownershipDiagnostic:{receiptAvailable:typeof p.ownedUserHash==='string',ownedUserMatches:report.filter(r=>r.ownedUser).length,rows:report}});
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
  if(prepared){op.submissionStarted=true;op.lastContact=Date.now();}
  operations.set(p.operationId,op); // Before composer writes; one attempt forever.
  let inserting=false;
  // insertText can synchronously emit a trusted input event. Only that exact
  // own insertion is exempt; trusted clicks/keys and later input still abort.
  const disturbed=e=>{if(e.isTrusted && !(inserting && e.type==='input' && e.target===c.editor))op.invalid=true;};
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
    invocation.send='uncertain';invocation.reason='invocation-uncertain';
    button.click(); // No await between fresh resolution/validation and invocation.
    invocation.send='invoked';invocation.reason='acceptance-unproven';
    for(let i=0;i<25;i++) {
      await new Promise(r=>setTimeout(r,200));
      if(op.invalid || composer()?.editor!==c.editor)throw Error('COMPOSER_CHANGED');
      const fresh=afterBaseline(op),cleared=editorLength(c.editor)===0;
      const transitioned=!actionable(button) || !composer()?.slot.contains(button),active=generationActive();
      if(fresh[0] && cleared && (transitioned || active)) {
        op.submittedUserId=fresh[0].id;op.assistantId=fresh[1]?.id || null;
        if(prepared) {
          op.receipt={...op.preparedReceipt,userStableIdHash:await hash(p.operationId,'user',op.submittedUserId),acceptance:{composerCleared:true,sendControlTransition:transitioned,generationControlObserved:active}};
          // Return user-only evidence first. The next inspect must echo a
          // durably stored acceptance receipt before an assistant can bind.
          return answer(p,'running',{receipt:op.receipt,invocation:{...invocation,reason:'accepted'}});
        }
        op.receipt={version:1,operationId:p.operationId,
          baselineUserMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='user').map(r=>hash(p.operationId,r.role,r.id))),
          baselineAssistantMessageIds:await Promise.all(op.baseline.filter(r=>r.role==='assistant').map(r=>hash(p.operationId,r.role,r.id))),
          submittedUserMessageId:await hash(p.operationId,'user',op.submittedUserId),
          acceptance:{composerCleared:true,sendControlTransition:transitioned,generationControlObserved:active}};
        return {...await inspect(p),invocation:{...invocation,reason:'accepted'}};
      }
    }
    throw Error('ACCEPTANCE_UNCERTAIN');
  } catch {op.invalid=true;releaseV2(p.operationId,op);return answer(p,'interrupted',{invocation});}
  finally {if(op.invalid)releaseV2(p.operationId,op);for(const type of ['input','click','keydown'])c.root.removeEventListener(type,disturbed,true);}
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
  const sample=(mutations=[])=>{
    try {
      const remember=row=>{if(!op.baseline.some(b=>b.id===row.id && b.role===row.role))(row.role==='user'?op.newUsers:op.newAssistants).add(row.id);};
      let visited=0;
      // Inspect bounded mutation additions/removals as well as mounted rows:
      // a manual turn appended and removed in one batch still invalidates.
      for(const mutation of mutations) {
        if(++visited>256)throw Error('OBSERVATION_LIMIT');
        if(mutation.type==='attributes' && ['data-message-id','data-message-role'].includes(mutation.attributeName) && mutation.oldValue!==null && mutation.oldValue!==mutation.target.getAttribute(mutation.attributeName))throw Error('IDENTITY_MUTATED');
        for(const node of [...(mutation.addedNodes||[]),...(mutation.removedNodes||[])]) {
          const nodes=[node,...(node.querySelectorAll?.(MESSAGE)||[])];
          for(const candidate of nodes) {
            if(++visited>256)throw Error('OBSERVATION_LIMIT');
            const role=candidate.getAttribute?.('data-message-role'),id=candidate.getAttribute?.('data-message-id');
            if(['user','assistant'].includes(role)){if(!nativeId(id))throw Error('IDENTITY_UNAVAILABLE');remember({id,role});}
          }
        }
      }
      const rows=structure();
      for(const row of rows)remember(row);
      if(op.newUsers.size>1 || op.newAssistants.size>1)op.invalid=true;
    }catch{op.invalid=true;}
    if(op.invalid)releaseV2(p.operationId,op);
  };
  op.sample=sample;
  const observer=new MutationObserver(sample);
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
  if(!receipt.userStableIdHash || !status().composerReady){releaseV2(p.operationId,operations.get(p.operationId));return answer(p,'interrupted');}
  let op=operations.get(p.operationId),next=receipt;
  if(!receipt.assistantStableIdHash) {
    if(!op || op.sceneId!==p.sceneId || op.invalid || !op.receipt || op.observationToken!==p.observationToken || Date.now()-op.lastContact>10000 || Date.now()-op.createdAt>20*60*1000 || !MuseReceiptV2.extendsReceipt(op.receipt,receipt)) {
      if(op)releaseV2(p.operationId,op);return answer(p,'interrupted');
    }
    op.lastContact=Date.now();op.sample();
    if(op.invalid || !structure().some(r=>r.role==='user' && r.id===op.submittedUserId) || op.newUsers.size!==1 || !op.newUsers.has(op.submittedUserId)){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    if(op.newAssistants.size===0)return answer(p,'running',{receipt});
    const id=[...op.newAssistants][0];
    if(!structure().some(r=>r.role==='assistant' && r.id===id)){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    next={...receipt,assistantStableIdHash:await hash(p.operationId,'assistant',id)};
    op.sample();
    if(op.invalid || !MuseReceiptV2.valid(next,p.operationId)){releaseV2(p.operationId,op);return answer(p,'interrupted');}
    op.receipt=next;releaseV2(p.operationId,op);
    // Persist the assistant before inspecting/persisting a result candidate.
    return answer(p,'running',{receipt:next});
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
  transfers.delete(t.id);
  closedTransfers.add(t.id);
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
  try {
    if(!t) {
      if(p.offset!==0 || p.sequence!==0 || transfers.size || closedTransfers.has(p.transferId) || closedTransfers.size>=64)return answer(p,'interrupted');
      t={id:p.transferId,operationId:p.operationId,sceneId:p.sceneId,receipt:p.receipt,offset:0,sequence:0,
        started:Date.now(),controller:new AbortController(),pending:new Uint8Array(0),ended:false};
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
    if(t.busy || t.controller.signal.aborted || Date.now()-t.started>300000 || t.offset!==p.offset || t.sequence!==p.sequence ||
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
  if(message?.type==='viral-ai:muse-handshake'){reply({contractVersion:3,buildMarker:CONTENT_BUILD});return false;}
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
