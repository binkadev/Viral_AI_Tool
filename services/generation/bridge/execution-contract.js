"use strict";
// This is a semantic protocol, never a browser/selector execution interface.
const receiptV2=require('../../../extensions/meta-muse-bridge/receipt-v2');
const COMMANDS = new Set(["submitGeneration", "inspectGeneration", "acquireGenerationResult", "cancelGeneration", "prepareGeneration"]);
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).every(k => keys.includes(k));
const hash = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
function validReceipt(r,operationId) {
  if(r?.version===2)return receiptV2.valid(r,operationId);
  if(!exact(r,['version','operationId','baselineUserMessageIds','baselineAssistantMessageIds','submittedUserMessageId','acceptance']) || r.version!==1 || r.operationId!==operationId || !hash(r.submittedUserMessageId))return false;
  const arrays=[r.baselineUserMessageIds,r.baselineAssistantMessageIds];
  if(arrays.some(a=>!Array.isArray(a) || a.length>128 || a.some(v=>!hash(v))))return false;
  const ids=arrays.flat();if(new Set(ids).size!==ids.length || ids.includes(r.submittedUserMessageId))return false;
  const a=r.acceptance;
  return exact(a,['composerCleared','sendControlTransition','generationControlObserved']) && a.composerCleared===true && typeof a.sendControlTransition==='boolean' && typeof a.generationControlObserved==='boolean' && (a.sendControlTransition || a.generationControlObserved);
}
function validPayload(type, p) {
  if (!COMMANDS.has(type) || !exact(p, ["tabId", "operationId", "sceneId", "prompt", "offset", "diagnoseOwnership", "ownedUserHash", "receipt", "transferId", "sequence", "mediaKind", "abort", "diagnoseAcquisition"]) || !Number.isSafeInteger(p.tabId) || p.tabId < 1 || !id(p.operationId) || !id(p.sceneId)) return false;
  if(p.ownedUserHash!==undefined && (p.diagnoseOwnership!==true || !hash(p.ownedUserHash)))return false;
  if(p.diagnoseAcquisition!==undefined)return receiptV2.capabilityRequest(type,p);
  if(p.receipt!==undefined && (!['submitGeneration','inspectGeneration','acquireGenerationResult'].includes(type) || p.diagnoseOwnership!==undefined || !receiptV2.valid(p.receipt,p.operationId)))return false;
  if(type==='acquireGenerationResult' && p.receipt)return p.prompt===undefined && receiptV2.transferRequest(p);
  if(type==='acquireGenerationResult')return false;
  if(['transferId','sequence','mediaKind','abort'].some(k=>p[k]!==undefined))return false;
  if(type==='submitGeneration' && p.receipt?.userStableIdHash)return false;
  if(type==='inspectGeneration' && p.receipt && !p.receipt.userStableIdHash)return false;
  if(p.diagnoseOwnership!==undefined && (type!=='inspectGeneration' || p.diagnoseOwnership!==true || p.offset!==undefined))return false;
  if (type === "submitGeneration") return typeof p.prompt === "string" && !!p.prompt.trim() && p.prompt.length <= 8000 && p.offset === undefined;
  if (p.prompt !== undefined) return false;
  return type === "acquireGenerationResult" ? Number.isSafeInteger(p.offset) && p.offset >= 0 && p.offset <= 268435456 : p.offset === undefined;
}
function validResult(type, r, p) {
  if (!exact(r, ["operationId", "sceneId", "state", "offset", "total", "data", "confirmed", "receipt", "assistantMessageId", "invocation", "ownershipDiagnostic", "ownershipFailure", "transferId", "sequence", "done", "chunkHash", "acquisitionDiagnostic", "acceptanceDiagnostic", "acceptanceTrace"]) || r.operationId !== p.operationId || r.sceneId !== p.sceneId) return false;
  if(r.ownershipFailure!==undefined)return type==='inspectGeneration' && p.diagnoseOwnership===true && r.state==='interrupted' && exact(r,['operationId','sceneId','state','ownershipFailure']) && receiptV2.validOwnershipFailure(r.ownershipFailure);
  if(r.acceptanceTrace!==undefined && (type!=='submitGeneration' || p.receipt?.version!==2 || p.receipt.userStableIdHash!==undefined || r.state!=='interrupted' || r.receipt!==undefined || r.invocation?.send!=='invoked' || !receiptV2.validAcceptanceTrace(r.acceptanceTrace)))return false;
  if(r.acceptanceDiagnostic!==undefined && (type!=='submitGeneration' || p.receipt?.version!==2 || r.state!=='interrupted' || r.invocation?.send!=='invoked' || !receiptV2.validAcceptanceDiagnostic(r.acceptanceDiagnostic)))return false;
  if(r.acquisitionDiagnostic!==undefined || p.diagnoseAcquisition!==undefined)return receiptV2.capabilityRequest(type,p) && r.state==='interrupted' && exact(r,['operationId','sceneId','state','acquisitionDiagnostic']) && receiptV2.capabilityReport(r.acquisitionDiagnostic);
  if(['transferId','sequence','done','chunkHash'].some(k=>r[k]!==undefined) && !(type==='acquireGenerationResult' && r.receipt?.version===2 && r.state==='result'))return false;
  if(r.ownershipDiagnostic!==undefined && (type!=='inspectGeneration' || p.diagnoseOwnership!==true || r.state!=='interrupted' || !validOwnershipDiagnostic(r.ownershipDiagnostic)))return false;
  if(r.invocation!==undefined) {
    const v=r.invocation;
    if(type!=='submitGeneration' || !exact(v,['delivery','send','reason']) || v.delivery!=='content-script' || !['not-invoked','invoked','uncertain'].includes(v.send))return false;
    const reasons={'not-invoked':['baseline-unready','composer-unready','composer-changed','baseline-changed','send-unready'],invoked:['acceptance-unproven','accepted'],uncertain:['invocation-uncertain']};
    if(!reasons[v.send].includes(v.reason) || (v.reason==='accepted' && !['running','result'].includes(r.state)))return false;
  }
  if(r.state==='prepared')return type==='prepareGeneration' && receiptV2.valid(r.receipt,p.operationId) && !r.receipt.userStableIdHash && Object.keys(r).every(k=>['operationId','sceneId','state','receipt'].includes(k));
  if (!["running", "result", "interrupted", "failed", "unsupported"].includes(r.state)) return false;
  if(type==='prepareGeneration' && (r.state!=='interrupted' || r.receipt!==undefined))return false;
  if (type === "cancelGeneration") return r.state === "unsupported" && r.confirmed === false && ['data','receipt','assistantMessageId','offset','total'].every(k=>r[k]===undefined);
  if (r.confirmed !== undefined) return false;
  if(p.receipt && ['running','result'].includes(r.state) && r.receipt?.version!==2)return false;
  if(r.receipt?.version===2) {
    if(!['submitGeneration','inspectGeneration','acquireGenerationResult'].includes(type) || !['running','result'].includes(r.state) || !receiptV2.valid(r.receipt,p.operationId) || !r.receipt.userStableIdHash)return false;
    if(type==='submitGeneration' && (r.state!=='running' || r.receipt.assistantStableIdHash!==undefined))return false;
    if(p.receipt && !receiptV2.extendsReceipt(p.receipt,r.receipt))return false;
    if(type==='acquireGenerationResult')return r.state==='result' && !!r.receipt.result && r.assistantMessageId===undefined && receiptV2.transferResult(r,p);
    return (r.state!=='result' || !!r.receipt.result) && ['data','offset','total','assistantMessageId'].every(k=>r[k]===undefined);
  }
  if(['running','result'].includes(r.state)) {
    if(!validReceipt(r.receipt,p.operationId))return false;
  } else if(r.receipt!==undefined)return false;
  if(r.state==='result') {
    if(!hash(r.assistantMessageId) || r.receipt.baselineAssistantMessageIds.includes(r.assistantMessageId) || r.receipt.baselineUserMessageIds.includes(r.assistantMessageId) || r.assistantMessageId===r.receipt.submittedUserMessageId)return false;
  } else if(r.assistantMessageId!==undefined)return false;
  if (type === "acquireGenerationResult" && r.state === "result") return r.offset === p.offset && Number.isSafeInteger(r.total) && r.total > 12 && r.total <= 268435456 && typeof r.data === "string" && r.data.length > 0 && r.data.length <= 262144 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.data);
  return r.data === undefined && r.offset === undefined && r.total === undefined;
}
function validOwnershipDiagnostic(d) {
  return exact(d,['receiptAvailable','ownedUserMatches','rows']) && typeof d.receiptAvailable==='boolean' && Number.isInteger(d.ownedUserMatches) && d.ownedUserMatches>=0 && d.ownedUserMatches<=128 && Array.isArray(d.rows) && d.rows.length<=256 && d.rows.every(r=>
    exact(r,['id','role','ownedUser','parentIndex','nextSiblingIndex','ancestors','candidates','linkage','videoCount','sourceTypes']) && hash(r.id) && ['user','assistant'].includes(r.role) && typeof r.ownedUser==='boolean' && Number.isInteger(r.parentIndex) && r.parentIndex>=0 && r.parentIndex<256 && Number.isInteger(r.nextSiblingIndex) && r.nextSiblingIndex>=-1 && r.nextSiblingIndex<d.rows.length && Array.isArray(r.ancestors) && r.ancestors.length<=4 && r.ancestors.every(a=>exact(a,['attribute','value']) && ['data-message-id','data-item-id','data-turn-id','data-response-id','data-thread-id','data-conversation-item-id','data-conversation-id','data-response-group-id','data-media-id','data-video-id','data-result-id'].includes(a.attribute) && hash(a.value)) && validCandidates(r.candidates) && validLinkage(r.linkage) && Number.isInteger(r.videoCount) && r.videoCount>=0 && r.videoCount<=16 && Array.isArray(r.sourceTypes) && r.sourceTypes.length<=16 && r.sourceTypes.every(v=>['https','blob','other','empty'].includes(v)));
}
function validAnchoredOwnershipDiagnostic(d,ownedUserHash) {
  return hash(ownedUserHash) && validOwnershipDiagnostic(d) && d.receiptAvailable===true &&
    d.rows.every(r=>r.ownedUser===(r.role==='user' && r.id===ownedUserHash)) &&
    d.ownedUserMatches===d.rows.filter(r=>r.ownedUser).length;
}
function validCandidates(c) {
  return c===undefined || Array.isArray(c) && c.length<=187 && c.every(a=>exact(a,['scope','attribute','value']) && ['message','media'].includes(a.scope) && ['data-message-id','data-item-id','data-turn-id','data-response-id','data-thread-id','data-conversation-item-id','data-conversation-id','data-response-group-id','data-media-id','data-video-id','data-result-id'].includes(a.attribute) && hash(a.value));
}
function validLinkage(entries) {
  return entries===undefined || Array.isArray(entries) && entries.length<=128 && entries.every(e=>
    exact(e,['scope','depth','mediaIndex','attribute','value']) && ['message','ancestor','video','source','media-ancestor'].includes(e.scope) &&
    Number.isInteger(e.depth) && e.depth>=0 && e.depth<=6 && Number.isInteger(e.mediaIndex) && e.mediaIndex>=-1 && e.mediaIndex<16 &&
    ['data-message-id','data-item-id','data-turn-id','data-response-id','data-thread-id','data-conversation-item-id','data-conversation-id','data-response-group-id','data-media-id','data-video-id','data-result-id','data-attachment-id','data-asset-id','data-generation-id','data-request-id','data-response-to','data-response-to-id','data-reply-to','data-reply-to-id','data-parent-id','data-parent-message-id','data-user-message-id'].includes(e.attribute) && hash(e.value));
}
module.exports = { COMMANDS, validPayload, validResult, validReceipt, validOwnershipDiagnostic, validAnchoredOwnershipDiagnostic };
