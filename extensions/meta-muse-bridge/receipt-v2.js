"use strict";
// Shared pure schema; no DOM, storage, transport, or acquisition side effects.
(function(root){
 const hash=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
 const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function valid(r,id) {
   if(!exact(r,['version','operationId','baselineUserMessageIds','baselineAssistantMessageIds','userStableIdHash','assistantStableIdHash','acceptance','result']) || r.version!==2 || r.operationId!==id)return false;
   const arrays=[r.baselineUserMessageIds,r.baselineAssistantMessageIds];
   if(arrays.some(a=>!Array.isArray(a) || a.length>128 || a.some(v=>!hash(v))))return false;
   const ids=arrays.flat();if(!ids.length || new Set(ids).size!==ids.length)return false;
   if(r.userStableIdHash===undefined)return r.acceptance===undefined && r.assistantStableIdHash===undefined && r.result===undefined;
   if(!hash(r.userStableIdHash) || ids.includes(r.userStableIdHash))return false;
   const a=r.acceptance;
   if(!exact(a,['composerCleared','sendControlTransition','generationControlObserved','baselineIntact','uniqueUserTurn']) || ['composerCleared','sendControlTransition','generationControlObserved'].some(k=>typeof a[k]!=='boolean'))return false;
   // Older V2 receipts remain valid without reinterpretation. New receipts
   // explicitly attest structural user ownership; UI transitions corroborate it.
   if(a.baselineIntact!==undefined || a.uniqueUserTurn!==undefined) {
     if(a.baselineIntact!==true || a.uniqueUserTurn!==true)return false;
   } else if(!a.composerCleared || !(a.sendControlTransition || a.generationControlObserved))return false;
   if(r.assistantStableIdHash===undefined)return r.result===undefined;
   if(!hash(r.assistantStableIdHash) || ids.includes(r.assistantStableIdHash) || r.assistantStableIdHash===r.userStableIdHash)return false;
   return r.result===undefined || exact(r.result,['kind','ownerAssistantStableIdHash']) && r.result.kind==='video' && r.result.ownerAssistantStableIdHash===r.assistantStableIdHash;
 }
 function extendsReceipt(old,next) {
   if(!valid(old,old?.operationId) || !valid(next,old.operationId))return false;
   for(const k of ['baselineUserMessageIds','baselineAssistantMessageIds'])if(!same(old[k],next[k]))return false;
   for(const k of ['userStableIdHash','assistantStableIdHash'])if(old[k]!==undefined && old[k]!==next[k])return false;
   if(old.acceptance && (!next.acceptance || Object.keys(old.acceptance).some(k=>old.acceptance[k]!==next.acceptance[k])))return false;
   return !old.result || !!next.result && old.result.kind===next.result.kind && old.result.ownerAssistantStableIdHash===next.result.ownerAssistantStableIdHash;
 }
 const MAX_BYTES=268435456,CHUNK_BYTES=196608;
 const acceptanceFailureReasons=Object.freeze(['BASELINE_CHANGED','AMBIGUOUS_OPERATION','USER_CHANGED','RESPONSE_CHANGED','IDENTITY_MUTATED','IDENTITY_UNAVAILABLE','OBSERVATION_LIMIT','MANUAL_INTERFERENCE','ACCEPTANCE_UNCERTAIN','OBSERVATION_INVALID','COMPOSER_CHANGED','UNKNOWN']);
 function validAcceptanceDiagnostic(d) {
   const bools=['deadlineReached','baselinePrefixValid','stableUserIdentityObserved','manualInterferenceObserved','composerReplaced','editorReplaced','sendControlTransitionObserved','generationControlObserved'];
   return exact(d,['acceptanceBuild','workerBuild','failureReason','elapsedBucket','freshUserCount','freshAssistantCount',...bools]) &&
     /^muse-content-[a-z0-9-]{1,64}$/.test(d.acceptanceBuild||'') && (d.workerBuild===undefined || /^muse-worker-[a-z0-9-]{1,64}$/.test(d.workerBuild)) &&
     acceptanceFailureReasons.includes(d.failureReason) && ['under_1s','1_to_5s','over_5s'].includes(d.elapsedBucket) &&
     ['freshUserCount','freshAssistantCount'].every(k=>Number.isInteger(d[k]) && d[k]>=0 && d[k]<=128) && bools.every(k=>typeof d[k]==='boolean');
 }
 function transferRequest(p) {
   return valid(p.receipt,p.operationId) && !!p.receipt.result &&
     typeof p.transferId==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(p.transferId) && p.mediaKind==='video' &&
     Number.isSafeInteger(p.sequence) && p.sequence>=0 && p.sequence<=MAX_BYTES &&
     Number.isSafeInteger(p.offset) && p.offset>=0 && p.offset<=MAX_BYTES && (p.abort===undefined || p.abort===true);
 }
 function transferResult(r,p) {
   if(!transferRequest(p) || r.transferId!==p.transferId || r.sequence!==p.sequence || r.offset!==p.offset ||
     typeof r.done!=='boolean' || !hash(r.chunkHash) || typeof r.data!=='string' || r.data.length>262144 ||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.data))return false;
   const bytes=r.data.length/4*3-(r.data.endsWith('==')?2:r.data.endsWith('=')?1:0);
   return bytes<=CHUNK_BYTES && p.offset+bytes<=MAX_BYTES && (r.done ?
     Number.isSafeInteger(r.total) && r.total>=12 && r.total===p.offset+bytes : r.total===null && bytes>0);
 }
 function capabilityRequest(type,p) {
   return type==='inspectGeneration' && p.diagnoseAcquisition===true && exact(p,['tabId','operationId','sceneId','diagnoseAcquisition']);
 }
 function capabilityReport(d) {
   const bools=['containingAssistantPresent','containingAssistantStableHashPresent','srcAttributePresent','currentSrcPresent','srcObjectPresent','srcObjectMediaStream','durationFinite','videoDimensionsAvailable','paused'];
   return exact(d,['videos']) && Array.isArray(d.videos) && d.videos.length<=16 && d.videos.every(v=>
     exact(v,[...bools,'sourceKind','sourceChildCount','readyState','networkState']) && bools.every(k=>typeof v[k]==='boolean') &&
     ['blob','https','other','none'].includes(v.sourceKind) && Number.isInteger(v.sourceChildCount) && v.sourceChildCount>=0 && v.sourceChildCount<=8 &&
     Number.isInteger(v.readyState) && v.readyState>=0 && v.readyState<=4 && Number.isInteger(v.networkState) && v.networkState>=0 && v.networkState<=3);
 }
 const api=Object.freeze({valid,extendsReceipt,transferRequest,transferResult,capabilityRequest,capabilityReport,validAcceptanceDiagnostic,acceptanceFailureReasons,MAX_BYTES,CHUNK_BYTES});
 if(typeof module==='object' && module.exports)module.exports=api;else root.MuseReceiptV2=api;
})(globalThis);
