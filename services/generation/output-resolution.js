"use strict";
const C=require('../../extensions/meta-muse-bridge/manual-recovery-contract');
const {failure}=require('./generation-job');
function eligibility(v) {
  if(!C.exact(v,['version','eligible']) || v.version!==1 || v.eligible!==true)throw failure('STORE_UNAVAILABLE');
  return {version:1,eligible:true};
}
function validate(v,job) {
  const fields=['version','resolutionId','mode','automaticOwnershipVerified','jobId','operationId','projectId','sceneId','automaticOutcome','automaticEvidenceHash','candidateAuditId','selectionSessionId','documentContextDigest','candidateDescriptorHash','confirmedAt','phase','transferId','verified','publication'];
  if(!C.exact(v,fields) || fields.filter(k=>!['verified'].includes(k)).some(k=>!Object.hasOwn(v,k)) || v.version!==1 || v.mode!=='user-confirmed' || v.automaticOwnershipVerified!==false || v.automaticOutcome!=='interrupted' ||
    v.jobId!==job.id || v.operationId!==job.id || v.projectId!==job.projectId || v.sceneId!==job.sceneId ||
    !['resolutionId','candidateAuditId','selectionSessionId','transferId'].every(k=>C.opaque(v[k])) ||
    !['automaticEvidenceHash','documentContextDigest','candidateDescriptorHash'].every(k=>C.hash(v[k])) || !Number.isFinite(Date.parse(v.confirmedAt)) ||
    !['confirmed','acquiring','verified','published','interrupted'].includes(v.phase) || !['pending','published'].includes(v.publication))throw failure('STORE_UNAVAILABLE');
  if(v.verified!==undefined) {
    const b=v.verified,m=b?.media;
    if(!C.exact(b,['fileName','size','sha256','media']) || b.fileName!==job.id+'.mp4' || !Number.isSafeInteger(b.size) || b.size<12 || b.size>C.MAX_BYTES || !C.hash(b.sha256) ||
      !C.exact(m,['duration','width','height']) || !C.metadata({...m,readyState:4}))throw failure('STORE_UNAVAILABLE');
  }
  if(['verified','published'].includes(v.phase) && !v.verified || v.phase==='published' && v.publication!=='published' || v.publication==='published' && v.phase!=='published')throw failure('STORE_UNAVAILABLE');
  return JSON.parse(JSON.stringify(v));
}
module.exports={eligibility,validate};
