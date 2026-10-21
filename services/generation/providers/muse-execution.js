"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {failure}=require('../generation-job');
const {identifier}=require('../generation-request');
const {validResult,validReceipt,validAnchoredOwnershipDiagnostic}=require('../bridge/execution-contract');
const receiptV2=require('../../../extensions/meta-muse-bridge/receipt-v2');
function createMuseExecution(bridge,verifyVideo) {
  const locks=new Map(),cancelled=new Set(),transfers=new Map();
  const guard=c=>{if(!bridge || !identifier(c?.jobId) || !identifier(c?.sceneId) || typeof c.request?.prompt!=='string' || !path.isAbsolute(c.outputDirectory) || fs.realpathSync(c.outputDirectory)!==path.resolve(c.outputDirectory))throw failure('PROVIDER_UNAVAILABLE');};
  const recordPath=c=>path.join(c.outputDirectory,'muse-operation.json');
  const digest=c=>crypto.createHash('sha256').update(c.sceneId+'\0'+c.request.prompt).digest('hex');
  function read(c) {
    const file=recordPath(c),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>262144)throw failure('RECOVERY_REQUIRED');
    const r=JSON.parse(fs.readFileSync(file,'utf8'));
    if(r.operationId!==c.jobId || r.sceneId!==c.sceneId || r.digest!==digest(c) || !Number.isFinite(r.createdAt) || typeof r.target?.instanceId!=='string' || !Number.isSafeInteger(r.target.tabId))throw failure('RECOVERY_REQUIRED');
    if(r.receipt && !validReceipt(r.receipt,c.jobId))throw failure('RECOVERY_REQUIRED');
    if(r.acceptanceTrace && !receiptV2.validAcceptanceTrace(r.acceptanceTrace))throw failure('RECOVERY_REQUIRED');
    return r;
  }
  function saveEvidence(c,r,result) {
    if(r.receipt && !(r.receipt.version===2?receiptV2.extendsReceipt(r.receipt,result.receipt):JSON.stringify(r.receipt)===JSON.stringify(result.receipt)))throw failure('RECOVERY_REQUIRED');
    if(r.assistantMessageId && result.assistantMessageId && r.assistantMessageId!==result.assistantMessageId)throw failure('RECOVERY_REQUIRED');
    if(r.receipt?.version===2 ? JSON.stringify(r.receipt)===JSON.stringify(result.receipt) : r.receipt && (!result.assistantMessageId || r.assistantMessageId===result.assistantMessageId))return;
    const next={...r,receipt:result.receipt,...(result.assistantMessageId?{assistantMessageId:result.assistantMessageId}:{})};
    const temp=recordPath(c)+'.'+crypto.randomUUID()+'.tmp';let fd;
    try {fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,recordPath(c));Object.assign(r,next);}
    finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
  }
  async function command(type,c,r,extra={}) {
    const payload={tabId:r.target.tabId,operationId:c.jobId,sceneId:c.sceneId,...extra};
    const result=await bridge.command(type,payload,r.target);
    if(!validResult(type,result,payload))throw failure('RECOVERY_REQUIRED');
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
    const fileName=c.jobId+'.mp4',output=path.join(c.outputDirectory,fileName),partial=path.join(c.outputDirectory,c.jobId+'.partial.mp4');
    let fd,created=false,transfer,transferDone=false;
    const clearPartial=()=>{if(fs.existsSync(partial)){const s=fs.lstatSync(partial);if(!s.isFile() || s.isSymbolicLink())throw failure('ASSET_UNAVAILABLE');fs.unlinkSync(partial);}};
    try {
      if(fs.existsSync(output)) {
        if(fs.lstatSync(output).isSymbolicLink())throw failure('ASSET_UNAVAILABLE');
        await verifyRecorded(c,r,output);await verify(output);
        if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
        clearPartial();return {status:'completed',fileName};
      }
      await c.onVerifying?.();
      const disk=fs.statfsSync(c.outputDirectory);
      if(disk.bavail*disk.bsize<receiptV2.MAX_BYTES+64*1024*1024)throw failure('RESOURCE_UNAVAILABLE');
      transfer={transferId:crypto.randomUUID(),sequence:0,offset:0,mediaKind:'video',receipt:r.receipt,controller:new AbortController()};
      transfers.set(c.jobId,transfer);
      // A partial from an interrupted acquisition is owned by this same operation.
      clearPartial();
      fd=fs.openSync(partial,'wx',0o600);created=true;
      let offset=0;const checksum=crypto.createHash('sha256'),started=Date.now();
      do {
        if(cancelled.has(c.jobId) || Date.now()-started>300000)throw failure('RECOVERY_REQUIRED');
        const extra={transferId:transfer.transferId,sequence:transfer.sequence,mediaKind:'video',receipt:r.receipt,offset};
        let timer,onAbort;
        const result=await Promise.race([command('acquireGenerationResult',c,r,extra),new Promise((_,reject)=>{
          onAbort=()=>reject(failure('RECOVERY_REQUIRED'));transfer.controller.signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>reject(failure('PROVIDER_TIMEOUT')),20000);
        })]).finally(()=>{clearTimeout(timer);transfer.controller.signal.removeEventListener('abort',onAbort);});
        if(cancelled.has(c.jobId) || Date.now()-started>300000)throw failure('RECOVERY_REQUIRED');
        if(result.state!=='result')throw failure('ASSET_UNAVAILABLE');
        const bytes=Buffer.from(result.data,'base64');
        if(bytes.toString('base64')!==result.data || crypto.createHash('sha256').update(bytes).digest('hex')!==result.chunkHash)throw failure('ASSET_UNAVAILABLE');
        checksum.update(bytes);transferDone=result.done;transfer.sequence++;transfer.offset=offset+bytes.length;
        let written=0;while(written<bytes.length)written+=fs.writeSync(fd,bytes,written,bytes.length-written);
        offset+=bytes.length;
      } while(!transferDone);
      fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      await verify(partial);
      if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
      const verifiedOutput={fileName,size:offset,sha256:checksum.digest('hex'),userStableIdHash:r.receipt.userStableIdHash,assistantStableIdHash:r.receipt.assistantStableIdHash};
      // Record before exclusive publication: a crash after linking can reuse
      // only these exact verified bytes, never an arbitrary preexisting file.
      persistRecord(c,r,{verifiedOutput});
      fs.linkSync(partial,output); // Exclusive publication; never overwrite.
      return {status:'completed',fileName};
    } finally {
      if(fd!==undefined)fs.closeSync(fd);if(created)try{fs.unlinkSync(partial);}catch{}
      if(transfer) {
        transfers.delete(c.jobId);const {controller,...payload}=transfer;
        // Best effort; content also aborts on disconnect/15-second idle expiry.
        if(!transferDone)try{await bridge.command('acquireGenerationResult',{tabId:r.target.tabId,operationId:c.jobId,sceneId:c.sceneId,...payload,abort:true},r.target);}catch{}
      }
    }
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
  async function verify(file) {
    const stat=fs.lstatSync(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size<12)throw failure('ASSET_UNAVAILABLE');
    const header=Buffer.alloc(12),fd=fs.openSync(file,'r');
    try{fs.readSync(fd,header,0,12,0);}finally{fs.closeSync(fd);}
    if(header.toString('ascii',4,8)!=='ftyp')throw failure('ASSET_UNAVAILABLE');
    await verifyVideo(file);
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
    diagnoseOwnership:async c=>{
      if(!bridge?.developmentDiagnostics)throw failure('UNAVAILABLE');
      guard(c);const record=read(c),receipt=record.receipt;
      if(receipt?.version!==2 || !receipt.userStableIdHash || receipt.assistantStableIdHash)throw failure('UNAVAILABLE');
      // Deliberately bypass command()/saveEvidence()/reconcile(): this response
      // describes the current document and can never extend an ownership receipt.
      const payload={tabId:record.target.tabId,operationId:c.jobId,sceneId:c.sceneId,diagnoseOwnership:true};
      const result=await bridge.command('inspectGeneration',payload,record.target);
      if(!validResult('inspectGeneration',result,payload) || Object.keys(result).some(k=>!['operationId','sceneId','state','ownershipDiagnostic'].includes(k)) ||
        !validAnchoredOwnershipDiagnostic(result.ownershipDiagnostic,receipt.userStableIdHash))throw failure('UNAVAILABLE');
      return {operationId:c.jobId,userStableIdHash:receipt.userStableIdHash,diagnostic:result.ownershipDiagnostic};
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
