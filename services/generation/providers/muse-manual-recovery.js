"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../../../extensions/meta-muse-bridge/manual-recovery-contract');
const {failure}=require('../generation-job');
const {acquireBounded}=require('./bounded-acquisition');
function createManualRecovery({bridge,verifyVideo,busy}) {
  const sessions=new Map(),transfers=new Map(),cancelled=new Set();
  const fail=code=>{throw failure(code||'RECOVERY_CHANGED');};
  function record(c) {
    if(c.manualRecovery?.version!==1 || c.manualRecovery.eligible!==true || !C.id(c.jobId) || !C.id(c.projectId) || !C.id(c.sceneId) || !path.isAbsolute(c.outputDirectory) || fs.realpathSync(c.outputDirectory)!==path.resolve(c.outputDirectory))fail();
    const file=path.join(c.outputDirectory,'muse-operation.json'),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>262144)fail();
    const bytes=fs.readFileSync(file),r=JSON.parse(bytes);
    const digest=crypto.createHash('sha256').update(c.sceneId+'\0'+c.request.prompt).digest('hex');
    if(r.operationId!==c.jobId || r.sceneId!==c.sceneId || r.digest!==digest || typeof r.target?.instanceId!=='string' || !Number.isSafeInteger(r.target.tabId))fail();
    return {target:r.target,evidenceHash:crypto.createHash('sha256').update(bytes).digest('hex')};
  }
  async function send(type,c,r,extra={}) {
    const p={tabId:r.target.tabId,operationId:c.jobId,projectId:c.projectId,sceneId:c.sceneId,...extra};
    if(!C.request(type,p))fail();
    const result=await bridge.command(type,p,r.target);
    if(!C.result(type,result,p))fail();
    if(result.state==='unavailable')fail(result.reason==='TOO_MANY'?'RECOVERY_TOO_MANY':'RECOVERY_CHANGED');
    return result;
  }
  function session(c,candidateId) {
    const s=sessions.get(c.jobId),r=record(c);
    if(!s || s.busy || Date.now()>=s.expiresAt || r.evidenceHash!==s.evidenceHash || JSON.stringify(r.target)!==JSON.stringify(s.target) || s.projectId!==c.projectId || s.sceneId!==c.sceneId || busy(c.jobId))fail();
    const candidate=s.candidates.find(v=>v.candidateId===candidateId);
    if(!candidate)fail();
    return {s,candidate,token:{selectionSessionId:s.selectionSessionId,candidateId,documentEpoch:s.documentEpoch,revision:s.revision}};
  }
  return {
    async list(c) {
      if(sessions.get(c.jobId)?.expiresAt<=Date.now())sessions.delete(c.jobId);
      cancelled.delete(c.jobId);
      if(sessions.has(c.jobId) || sessions.size || transfers.size || busy(c.jobId))fail();
      const r=record(c),reservation={busy:true};sessions.set(c.jobId,reservation);
      try {
        const result=await send('listRecoveryCandidates',c,r);
        if(result.expiresAt<=Date.now() || result.expiresAt>Date.now()+C.TTL+1000)fail();
        const s={...result,...r,target:r.target,revealed:new Set(),busy:false};sessions.set(c.jobId,s);
        return {version:1,selectionSessionId:s.selectionSessionId,expiresAt:s.expiresAt,candidates:s.candidates.map(({candidateId,duration,width,height,available})=>({candidateId,duration,width,height,available}))};
      }catch(error){sessions.delete(c.jobId);throw error;}
    },
    async reveal(c,candidateId) {
      const {s,token}=session(c,candidateId);s.busy=true;
      try {await send('revealRecoveryCandidate',c,s,token);s.revealed.add(candidateId);return {candidateId,revealed:true};}
      catch(error){sessions.delete(c.jobId);throw error;}finally{s.busy=false;}
    },
    async confirm(c,candidateId,persist) {
      const {s,candidate,token}=session(c,candidateId);
      if(!s.revealed.has(candidateId))fail();
      s.busy=true;
      const resolution={version:1,resolutionId:crypto.randomUUID(),mode:'user-confirmed',automaticOwnershipVerified:false,jobId:c.jobId,operationId:c.jobId,projectId:c.projectId,sceneId:c.sceneId,
        automaticOutcome:'interrupted',automaticEvidenceHash:s.evidenceHash,candidateAuditId:candidateId,selectionSessionId:s.selectionSessionId,documentContextDigest:s.documentContextDigest,candidateDescriptorHash:candidate.descriptorHash,
        confirmedAt:new Date().toISOString(),phase:'confirmed',transferId:crypto.randomUUID(),publication:'pending'};
      let durable=false,current=resolution;
      try {
        await send('validateRecoveryCandidate',c,s,token);
        await persist(resolution);durable=true; // No transfer can precede this fsync-backed commit.
        await c.onVerifying?.();
        const r={target:s.target};

        await persist(current={...current,phase:'acquiring'});
        const result=await acquireBounded({...c,onVerifying:undefined},r,{
          verifyVideo,cancelled,transfers,bridge:{command:(type,p)=>send(type,c,s,{...token,resolutionId:resolution.resolutionId,transferId:p.transferId,sequence:p.sequence,offset:p.offset,mediaKind:'video',abort:true})},
          commandName:'acquireRecoveryCandidate',transferId:resolution.transferId,verifiedIdentity:()=>({}),
          command:(_type,_c,_r,p)=>send('acquireRecoveryCandidate',c,s,{...token,resolutionId:resolution.resolutionId,transferId:resolution.transferId,sequence:p.sequence,offset:p.offset,mediaKind:'video'}),
          verifyRecorded:async()=>fail(),
          persistRecord:(_c,_r,{verifiedOutput},probed)=>{
            if(!probed || !C.metadata({...probed,readyState:4}))fail();
            const media={duration:probed.duration,width:probed.width,height:probed.height};
            // Native verifier runs first; supplied callback publishes its probed metadata.
            current={...current,phase:'verified',verified:{...verifiedOutput,media}};
            persist(current); // GenerationService supplies a synchronous durable callback.
          }
        });
        await persist({...current,phase:'published',publication:'published'});
        return result;
      }catch(error){
        if(durable)try{await persist({...current,phase:'interrupted',publication:'pending'});}catch{}
        throw error;
      }finally{s.busy=false;sessions.delete(c.jobId);try{await send('dismissRecovery',c,s);}catch{}}
    },
    async dismiss(c) {const r=record(c);sessions.delete(c.jobId);await send('dismissRecovery',c,r);return {dismissed:true};},
    verifyLocal:async(c)=>{return await verifyVideo(path.join(c.outputDirectory,c.jobId+'.mp4'));},
    cancel(c) {cancelled.add(c.jobId);transfers.get(c.jobId)?.controller.abort();sessions.delete(c.jobId);},
    get active(){return sessions.size>0 || transfers.size>0;}
  };
}
module.exports={createManualRecovery};
