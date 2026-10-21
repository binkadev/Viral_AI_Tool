"use strict";
// Shared pure schema; no DOM, storage, transport, or acquisition side effects.
(function(root){
 const replay=typeof module==='object' && module.exports?require('./acceptance-replay'):root.MuseAcceptanceReplay;
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
 const acceptanceFailureReasons=Object.freeze(['BASELINE_CHANGED','AMBIGUOUS_OPERATION','USER_CHANGED','RESPONSE_CHANGED','IDENTITY_MUTATED','IDENTITY_UNAVAILABLE','OBSERVATION_LIMIT','MANUAL_INTERFERENCE','ACCEPTANCE_UNCERTAIN','OBSERVATION_INVALID','COMPOSER_CHANGED','REPLACEMENT_AMBIGUOUS','REPLACEMENT_SLOT_UNPROVEN','REPLACEMENT_EXPIRED','REPLACEMENT_CONVERSATION_ACTIVITY','INVALID_TRACE','UNKNOWN']);
 function validAcceptanceDiagnostic(d) {
   const bools=['deadlineReached','baselinePrefixValid','stableUserIdentityObserved','manualInterferenceObserved','composerReplaced','editorReplaced','sendControlTransitionObserved','generationControlObserved'];
   const lineageCounts=['freshUserIdentityCount','logicalFreshUserTurnCount','maxConcurrentFreshUserRows','replacementCandidateCount'],lineageBools=['identityReplacementObserved','canonicalUserStable','replacementAmbiguous'];
   const lineage=[...lineageCounts,...lineageBools];
   // Existing forensic records keep their original diagnostic schema.
   if(d && lineage.some(k=>d[k]!==undefined) && (!lineageCounts.every(k=>Number.isInteger(d[k]) && d[k]>=0 && d[k]<=128) || !lineageBools.every(k=>typeof d[k]==='boolean')))return false;
   return exact(d,['acceptanceBuild','workerBuild','failureReason','elapsedBucket','freshUserCount','freshAssistantCount',...bools,...lineage]) &&
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
 const ownershipFailureReasons=Object.freeze(['JOB_NOT_FOUND','JOB_STATE_UNSUPPORTED','OPERATION_RECORD_UNAVAILABLE','RECEIPT_UNAVAILABLE','USER_ANCHOR_MISSING','ASSISTANT_ALREADY_ANCHORED','TARGET_INSTANCE_UNAVAILABLE','TARGET_TAB_UNAVAILABLE','WORKER_INTENT_UNAVAILABLE','WORKER_RECEIPT_MISMATCH','CONTENT_RECEIVER_UNAVAILABLE','CONTENT_DIAGNOSIS_REJECTED','DIAGNOSTIC_RESULT_INVALID','RUNTIME_BUILD_MISMATCH','EXTENSION_DIAGNOSTICS_DISABLED','UNAVAILABLE','UNKNOWN']);
 function validOwnershipFailure(d) {
   return exact(d,['reason','tabMatch','workerIntentPresent','workerUserAnchor','workerAssistantAnchor']) && ownershipFailureReasons.includes(d.reason) &&
     ['tabMatch','workerIntentPresent','workerUserAnchor','workerAssistantAnchor'].every(k=>[true,false,null].includes(d[k]));
 }
 const ASSISTANT_TRACE_MAX_FRAMES=16;
 const assistantPhases=Object.freeze(['precheck','sample_before_block','block_observed','sample_after_block','stabilization','precommit']);
 const assistantReasons=Object.freeze(['OPERATION_MISSING','OPERATION_INVALID','SCENE_MISMATCH','OBSERVATION_TOKEN_MISMATCH','CONTACT_STALE','OPERATION_EXPIRED','RECEIPT_MISMATCH',
   'OWNED_USER_MISSING','LOGICAL_USER_MISMATCH','USER_NATIVE_ID_MISMATCH','USER_HASH_MISMATCH','BLOCK_USER_INVALID','BLOCK_PARENT_MISMATCH','BLOCK_NONCONTIGUOUS','BLOCK_OUT_OF_BOUNDS','BLOCK_MULTIPLE_MEDIA_OWNERS',
   'OBSERVER_INVALIDATED','IDENTITY_MUTATED','MANUAL_INTERFERENCE','STABILIZATION_NOT_READY','STABILIZATION_RESET','PRECOMMIT_BLOCK_CHANGED','PRECOMMIT_GENERATION_ACTIVE','BASELINE_CHANGED','OBSERVATION_LIMIT','UNKNOWN_BOUNDED','PENDING_ROLE_SETTLING']);
 const assistantObservations=['STABILIZATION_NOT_READY','STABILIZATION_RESET','PRECOMMIT_BLOCK_CHANGED','PRECOMMIT_GENERATION_ACTIVE','PENDING_ROLE_SETTLING'];
 const assistantBools=['generationActive','ownedUserPresent','assistantBlockWithinBound','sameSequenceParent','blockContiguous','blockSignatureChanged'];
 const assistantFrameKeys=['phase','elapsedBucket',...assistantBools,'logicalUserCount','blockRowCount','mediaCandidateCount','mutationCount','stabilizationSamples','stabilizationReset','terminal','terminalReason'];
 const assistantSequenceCounts=Object.freeze(['recognizedFreshRowCount','recognizedAssistantRowCount','directSequenceTailCount','directMessageItemTailCount',
   'pendingDirectMessageItemCount','invalidIdentityDirectMessageCount','missingRoleDirectMessageCount','unsupportedRoleDirectMessageCount','expectedSequenceLength','sequenceTailLength']);
 const assistantSequenceBools=Object.freeze(['userSequenceIndexValid','recognizedRowsMatchDirectSequence']);
 const assistantMismatchCategories=Object.freeze(['NONE','EXTRA_DIRECT_MESSAGE_ITEM','PENDING_MESSAGE_ID','INVALID_MESSAGE_ID','MISSING_ROLE','UNSUPPORTED_ROLE',
   'RECOGNIZED_ROW_POSITION_MISMATCH','SEQUENCE_TAIL_LENGTH_MISMATCH','USER_NOT_IN_SEQUENCE','UNKNOWN_BOUNDED']);
 const assistantSequenceKeys=[...assistantSequenceCounts,...assistantSequenceBools,'firstMismatchCategory'];
 const emptyAssistantSequence=()=>Object.fromEntries(assistantSequenceKeys.map(k=>[k,null]));
 const count=(v,max)=>v===null || Number.isInteger(v) && v>=0 && v<=max;
 function validAssistantFrame(f) {
   // 0.3.8 frames are immutable legacy diagnostics. New fields are optional as
   // one complete group; absent evidence is never filled in during validation.
   const extended=f && assistantSequenceKeys.some(k=>Object.hasOwn(f,k));
   if(extended && (!assistantSequenceKeys.every(k=>Object.hasOwn(f,k)) || !assistantSequenceCounts.every(k=>count(f[k],257)) ||
     !assistantSequenceBools.every(k=>f[k]===null || typeof f[k]==='boolean') || !(f.firstMismatchCategory===null || assistantMismatchCategories.includes(f.firstMismatchCategory))))return false;
   return exact(f,[...assistantFrameKeys,...assistantSequenceKeys]) && Object.keys(f).length===assistantFrameKeys.length+(extended?assistantSequenceKeys.length:0) && assistantPhases.includes(f.phase) &&
     ['under_1s','1_to_10s','10_to_60s','over_60s'].includes(f.elapsedBucket) && assistantBools.every(k=>f[k]===null || typeof f[k]==='boolean') &&
     count(f.logicalUserCount,128) && count(f.blockRowCount,9) && count(f.mediaCandidateCount,9) &&
     ['zero','one_to_four','five_or_more'].includes(f.mutationCount) && Number.isInteger(f.stabilizationSamples) && f.stabilizationSamples>=0 && f.stabilizationSamples<=2 &&
     typeof f.stabilizationReset==='boolean' && typeof f.terminal==='boolean' &&
     (f.terminal?assistantReasons.includes(f.terminalReason) && !assistantObservations.includes(f.terminalReason):f.terminalReason===null || assistantObservations.includes(f.terminalReason));
 }
 function validAssistantFailure(d) {
   return exact(d,['version','build','terminalReason','terminalPhase','frames']) && Object.keys(d).length===5 && d.version===1 &&
     /^muse-content-[a-z0-9-]{1,64}$/.test(d.build||'') && Array.isArray(d.frames) && d.frames.length>0 && d.frames.length<=ASSISTANT_TRACE_MAX_FRAMES &&
     d.frames.every((f,i)=>validAssistantFrame(f) && f.terminal===(i===d.frames.length-1)) &&
     d.frames.at(-1).terminalReason===d.terminalReason && d.frames.at(-1).phase===d.terminalPhase;
 }
 function assistantFailureSummary(d) {
   return validAssistantFailure(d)?{version:d.version,build:d.build,terminalReason:d.terminalReason,terminalPhase:d.terminalPhase,frameCount:d.frames.length,lastFrame:{...d.frames.at(-1)}}:null;
 }
 function validAssistantSummary(d) {
   return d===null || exact(d,['version','build','terminalReason','terminalPhase','frameCount','lastFrame']) && Object.keys(d).length===6 &&
     d.version===1 && /^muse-content-[a-z0-9-]{1,64}$/.test(d.build||'') && Number.isInteger(d.frameCount) && d.frameCount>=1 && d.frameCount<=ASSISTANT_TRACE_MAX_FRAMES &&
     validAssistantFrame(d.lastFrame) && d.lastFrame.terminal && d.lastFrame.terminalReason===d.terminalReason && d.lastFrame.phase===d.terminalPhase;
 }
 const api=Object.freeze({valid,extendsReceipt,transferRequest,transferResult,capabilityRequest,capabilityReport,validAcceptanceDiagnostic,validAcceptanceTrace:replay.validTrace,acceptanceFailureReasons,ownershipFailureReasons,validOwnershipFailure,
   ASSISTANT_TRACE_MAX_FRAMES,assistantPhases,assistantReasons,assistantSequenceCounts,assistantSequenceBools,assistantMismatchCategories,emptyAssistantSequence,
   validAssistantFrame,validAssistantFailure,assistantFailureSummary,validAssistantSummary,MAX_BYTES,CHUNK_BYTES});
 if(typeof module==='object' && module.exports)module.exports=api;else root.MuseReceiptV2=api;
})(globalThis);
