"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {failure}=require('../generation-job');
const {identifier}=require('../generation-request');
const {validResult,validReceipt,validAnchoredOwnershipDiagnostic}=require('../bridge/execution-contract');
const receiptV2=require('../../../extensions/meta-muse-bridge/receipt-v2');
const ownershipDiagnosis=require('../bridge/ownership-diagnosis');
const {safeObserve,digest: auditDigest}=require('../execution-audit');
function createMuseExecution(bridge,verifyVideo) {
  const locks=new Map(),cancelled=new Set(),transfers=new Map();
  const manual=require('./muse-manual-recovery').createManualRecovery({bridge,verifyVideo,busy:id=>locks.size>0 || transfers.size>0});
  const guard=c=>{if(!bridge || !identifier(c?.jobId) || !identifier(c?.sceneId) || typeof c.request?.prompt!=='string' || !path.isAbsolute(c.outputDirectory) || fs.realpathSync(c.outputDirectory)!==path.resolve(c.outputDirectory))throw failure('PROVIDER_UNAVAILABLE');};
  const recordPath=c=>path.join(c.outputDirectory,'muse-operation.json');
  const digest=c=>crypto.createHash('sha256').update(c.sceneId+'\0'+c.request.prompt).digest('hex');
  function read(c,{validateReceipt=true}={}) {
    const file=recordPath(c),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>262144)throw failure('RECOVERY_REQUIRED');
    const r=JSON.parse(fs.readFileSync(file,'utf8'));
    if(r.operationId!==c.jobId || r.sceneId!==c.sceneId || r.digest!==digest(c) || !Number.isFinite(r.createdAt) || typeof r.target?.instanceId!=='string' || !Number.isSafeInteger(r.target.tabId))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.receipt && !validReceipt(r.receipt,c.jobId))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.acceptanceTrace && !receiptV2.validAcceptanceTrace(r.acceptanceTrace))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.assistantOwnershipFailure!==undefined && !receiptV2.validAssistantFailure(r.assistantOwnershipFailure))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.userAnchorChurn!==undefined && !receiptV2.validUserAnchorChurn(r.userAnchorChurn))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.baselineDrift!==undefined && !receiptV2.validBaselineDrift(r.baselineDrift))throw failure('RECOVERY_REQUIRED');
    if(validateReceipt && r.baselineWindow!==undefined && !receiptV2.validBaselineWindow(r.baselineWindow))throw failure('RECOVERY_REQUIRED');
    return r;
  }
  function saveEvidence(c,r,result) {
    if(r.receipt && !(r.receipt.version===2?receiptV2.extendsReceipt(r.receipt,result.receipt):JSON.stringify(r.receipt)===JSON.stringify(result.receipt)))throw failure('RECOVERY_REQUIRED');
    if(r.assistantMessageId && result.assistantMessageId && r.assistantMessageId!==result.assistantMessageId)throw failure('RECOVERY_REQUIRED');
    if(r.receipt?.version===2 ? JSON.stringify(r.receipt)===JSON.stringify(result.receipt) : r.receipt && (!result.assistantMessageId || r.assistantMessageId===result.assistantMessageId))return;
    const acceptedBefore=!!r.receipt?.userStableIdHash, ownedBefore=!!r.receipt?.result;
    const next={...r,receipt:result.receipt,...(result.assistantMessageId?{assistantMessageId:result.assistantMessageId}:{})};
    const temp=recordPath(c)+'.'+crypto.randomUUID()+'.tmp';let fd;
    try {fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,recordPath(c));Object.assign(r,next);}
    finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
    try {
      const evidence={evidenceKind:'receipt-v2',evidenceVersion:2,evidenceDigest:auditDigest(result.receipt)};
      if(result.receipt.version===2 && result.receipt.userStableIdHash && !acceptedBefore)safeObserve(c,'submit.acceptance_proven',evidence);
      if(result.receipt.version===2 && result.receipt.result && !ownedBefore)safeObserve(c,'ownership.completed',evidence);
    } catch {try{c.auditGap?.();}catch{}}
  }
  async function command(type,c,r,extra={}) {
    const payload={tabId:r.target.tabId,operationId:c.jobId,sceneId:c.sceneId,...extra};
    try{bridge.observeExecutionAudit?.(c,r.target);}catch{}
    const pending=bridge.command(type,payload,r.target);
    if(type==='submitGeneration')safeObserve(c,'submit.requested');
    const result=await pending;
    if(!validResult(type,result,payload))throw failure('RECOVERY_REQUIRED');
    const diagnosticPatch={};
    for(const field of ['assistantOwnershipFailure','userAnchorChurn','baselineDrift','baselineWindow'])if(result[field] && !r[field])diagnosticPatch[field]=result[field];
    if(Object.keys(diagnosticPatch).length)persistRecord(c,r,diagnosticPatch);
    if(result.invocation) {
      // Private evidence only. Transport errors leave invocation unknown.
      const temp=recordPath(c)+'.'+crypto.randomUUID()+'.tmp';let fd;
      try {const evidence={invocation:result.invocation,...(result.acceptanceDiagnostic?{acceptanceDiagnostic:result.acceptanceDiagnostic}:{}),...(result.acceptanceTrace?{acceptanceTrace:result.acceptanceTrace}:{})};fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({...r,...evidence}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,recordPath(c));Object.assign(r,evidence);}
      finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
    }
    if(['prepared','running','result'].includes(result.state))saveEvidence(c,r,result);
    return result;
  }
  async function acquire(c,r) {
    if(typeof verifyVideo!=='function')throw failure('ASSET_UNAVAILABLE');
    if(r.receipt?.version!==2 || !r.receipt.result)throw failure('RECOVERY_REQUIRED');
    const result=await require('./bounded-acquisition').acquireBounded(c,r,{
      verifyVideo,cancelled,transfers,command,persistRecord,verifyRecorded,bridge,
      commandName:'acquireGenerationResult',
      verifiedIdentity:r=>({userStableIdHash:r.receipt.userStableIdHash,assistantStableIdHash:r.receipt.assistantStableIdHash})
    });
    return {status:result.status,fileName:result.fileName};
  }
  function persistRecord(c,r,patch) {
    const temp=recordPath(c)+'.'+crypto.randomUUID()+'.tmp';let fd;
    try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({...r,...patch}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,recordPath(c));Object.assign(r,patch);}
    finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
  }
  async function verifyRecorded(c,r,file) {
    const v=r.verifiedOutput,s=fs.lstatSync(file);
    if(!r.receipt?.result || !v || v.fileName!==c.jobId+'.mp4' || !s.isFile() || s.isSymbolicLink() || s.size!==v.size || s.size>receiptV2.MAX_BYTES ||
      v.userStableIdHash!==r.receipt.userStableIdHash || v.assistantStableIdHash!==r.receipt.assistantStableIdHash || !/^[a-f0-9]{64}$/.test(v.sha256))throw failure('ASSET_UNAVAILABLE');
    const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);
    if(h.digest('hex')!==v.sha256)throw failure('ASSET_UNAVAILABLE');
  }
  async function reconcile(c) {
    guard(c);const r=read(c);
    if(r.receipt?.version===2 && !r.receipt.userStableIdHash)throw failure('RECOVERY_REQUIRED');
    if(r.receipt?.version===2 && fs.existsSync(path.join(c.outputDirectory,c.jobId+'.mp4')))return acquire(c,r);
    const result=await command('inspectGeneration',c,r,r.receipt?.version===2?{receipt:r.receipt}:{});
    if(r.receipt?.version===2) {
      if(result.state==='result')return acquire(c,r);
      if(result.state==='running' && Date.now()-r.createdAt<=20*60*1000)return {status:'running'};
      throw failure('RECOVERY_REQUIRED');
    }
    if(!Number.isFinite(r.createdAt) || Date.now()-r.createdAt>20*60*1000)throw failure('RECOVERY_REQUIRED');
    // Legacy evidence cannot enter receipt-v2 acquisition or be migrated.
    if(result.state==='result')throw failure('RECOVERY_REQUIRED');
    if(result.state==='running')return {status:'running'};
    // Even an error notice does not prove a remote operation is safe to retry.
    throw failure('RECOVERY_REQUIRED');
  }
  function exclusive(c,fn) {
    guard(c);if(locks.has(c.jobId))return locks.get(c.jobId);
    const task=Promise.resolve().then(fn).finally(()=>locks.delete(c.jobId));locks.set(c.jobId,task);return task;
  }
  return {
    listRecoveryCandidates:c=>manual.list(c),
    revealRecoveryCandidate:(c,id)=>manual.reveal(c,id),
    confirmRecoveryCandidate:(c,id,persist)=>manual.confirm(c,id,persist),
    dismissRecovery:c=>manual.dismiss(c),
    cancelRecovery:c=>manual.cancel(c),
    verifyRecoveryOutput:c=>manual.verifyLocal(c),
    diagnoseOwnership:async c=>{
      if(!bridge?.developmentDiagnostics)throw failure('UNAVAILABLE');
      let record;
      try{guard(c);record=read(c,{validateReceipt:false});}catch{return ownershipDiagnosis.report('OPERATION_RECORD_UNAVAILABLE');}
      const historicalAssistantOwnershipFailure=receiptV2.assistantFailureSummary(record.assistantOwnershipFailure);
      const historicalUserAnchorChurn=receiptV2.validUserAnchorChurn(record.userAnchorChurn)?record.userAnchorChurn:null;
      const historicalBaselineDrift=receiptV2.validBaselineDrift(record.baselineDrift)?record.baselineDrift:null;
      const historicalBaselineWindow=receiptV2.validBaselineWindow(record.baselineWindow)?record.baselineWindow:null;
      const report=(reason,evidence)=>({...ownershipDiagnosis.report(reason,evidence),historicalAssistantOwnershipFailure,historicalUserAnchorChurn,historicalBaselineDrift,historicalBaselineWindow});
      const receipt=record.receipt,evidence={nativeUserAnchor:!!receipt?.userStableIdHash,nativeAssistantAnchor:!!receipt?.assistantStableIdHash};
      if(receipt?.version!==2 || !receiptV2.valid(receipt,c.jobId))return report('RECEIPT_UNAVAILABLE',evidence);
      if(!receipt.userStableIdHash)return report('USER_ANCHOR_MISSING',evidence);
      if(receipt.assistantStableIdHash)return report('ASSISTANT_ALREADY_ANCHORED',evidence);
      // Deliberately bypass command()/saveEvidence()/reconcile(): this response
      // describes the current document and can never extend an ownership receipt.
      const payload={tabId:record.target.tabId,operationId:c.jobId,sceneId:c.sceneId,diagnoseOwnership:true,ownedUserHash:receipt.userStableIdHash};
      let result;
      try{result=await bridge.command('inspectGeneration',payload,record.target);}catch(error){return {...ownershipDiagnosis.fromError(error,evidence),historicalAssistantOwnershipFailure,historicalUserAnchorChurn,historicalBaselineDrift,historicalBaselineWindow};}
      const targetEvidence={...evidence,instanceMatch:true,tabMatch:true};
      if(validResult('inspectGeneration',result,payload) && result.ownershipFailure)return report(result.ownershipFailure.reason,{...targetEvidence,...Object.fromEntries(Object.entries(result.ownershipFailure).filter(([,v])=>typeof v==='boolean'))});
      if(!validResult('inspectGeneration',result,payload) || Object.keys(result).some(k=>!['operationId','sceneId','state','ownershipDiagnostic'].includes(k)) ||
        !validAnchoredOwnershipDiagnostic(result.ownershipDiagnostic,receipt.userStableIdHash))return report('DIAGNOSTIC_RESULT_INVALID',targetEvidence);
      return {...report(null,{...targetEvidence,workerIntentPresent:true,workerUserAnchor:true,workerAssistantAnchor:false}),operationId:c.jobId,userStableIdHash:receipt.userStableIdHash,diagnostic:result.ownershipDiagnostic};
    },
    acceptanceTrace:c=>{
      if(!bridge?.developmentDiagnostics)throw failure('UNAVAILABLE');
      guard(c);const record=read(c);
      if(record.receipt?.userStableIdHash || !receiptV2.validAcceptanceTrace(record.acceptanceTrace) || record.acceptanceDiagnostic!==undefined && !receiptV2.validAcceptanceDiagnostic(record.acceptanceDiagnostic))throw failure('UNAVAILABLE');
      return {operationId:c.jobId,diagnostic:record.acceptanceDiagnostic||null,trace:record.acceptanceTrace};
    },
    // Read-only presentation classification. Never migrate, infer anchors, or
    // rewrite historical evidence just to explain why reconciliation is blocked.
    recoveryState:c=>{
      try {
        guard(c);const r=read(c);
        return r.receipt?.version===2 && !r.receipt.userStableIdHash && r.invocation?.send==='invoked' ? 'acceptance_unproven' : null;
      } catch {return null;}
    },
    start:c=>exclusive(c,async()=>{
      if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
      if(fs.existsSync(recordPath(c)))return reconcile(c);
      const v2=typeof bridge.receiptV2Ready==='function';
      if(v2 && !await bridge.receiptV2Ready())throw failure('PROVIDER_UNAVAILABLE');
      const target=await bridge.executionTarget();
      if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
      const record={operationId:c.jobId,sceneId:c.sceneId,digest:digest(c),target,createdAt:Date.now()};
      const fd=fs.openSync(recordPath(c),'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(v2) {
        const prepared=await command('prepareGeneration',c,record);
        if(prepared.state!=='prepared')throw failure('RECOVERY_REQUIRED');
      }
      if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
      const result=await command('submitGeneration',c,record,{prompt:c.request.prompt,...(v2?{receipt:record.receipt}:{})});
      if(!['running','result'].includes(result.state))throw failure('RECOVERY_REQUIRED');
      return {status:'running'};
    }),
    reconcile:c=>exclusive(c,()=>{cancelled.delete(c.jobId);return reconcile(c);}),
    cancel:async c=>{guard(c);cancelled.add(c.jobId);transfers.get(c.jobId)?.controller.abort();const r=read(c);await command('cancelGeneration',c,r);return {confirmed:false};}
  };
}
module.exports={createMuseExecution};
