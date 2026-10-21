"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createFixture}=require('./manual-recovery-fixture');
const {probeVideo}=require('../services/ffmpeg');
function runtime(app,env,current,makeVideo) {
  if(app.isPackaged!==false || env.NODE_ENV==='production' || current.mode!=='manual-recovery' || app.getPath('userData')!==current.root)throw Error('DEV manual recovery unavailable');
  const sample=path.join(current.root,'candidate-two.mp4');
  const fixture=createFixture({root:path.join(current.root,'generation'),bytes:fs.existsSync(sample)?fs.readFileSync(sample):Buffer.alloc(76),verifyVideo:async file=>{
    const media=await probeVideo(file);if(!(media.duration>0 && media.width>0 && media.height>0))throw Error('Bad DEV MP4');return media;
  }});
  current.service=fixture.service;
  const identityFile=path.join(current.root,'identity.json');
  let identity=fs.existsSync(identityFile)?JSON.parse(fs.readFileSync(identityFile,'utf8')):null;
  current.command=async(action,payload)=>{
    if(app.isPackaged!==false || env.NODE_ENV==='production')return null;
    if(action==='state' && payload===undefined)return {mode:'manual-recovery',identity,restarted:fs.existsSync(path.join(current.root,'first-pass.json'))};
    if(action==='enroll' && !identity && payload && Object.keys(payload).sort().join()==='projectId,sceneId' && [payload.projectId,payload.sceneId].every(v=>/^[a-f0-9-]{36}$/.test(v))) {
      if(!fs.existsSync(sample))await makeVideo(sample);
      fixture.setBytes(fs.readFileSync(sample));
      const job=await fixture.admit(payload.projectId,payload.sceneId);
      identity={jobId:job.id,projectId:job.projectId,sceneId:job.sceneId};fs.writeFileSync(identityFile,JSON.stringify(identity),{flag:'wx'});return fixture.service.publicJob(job);
    }
    if(action==='complete' && payload===undefined && identity) {
      const service=fixture.service,job=service.get(identity.jobId);
      const session=await service.listRecoveryCandidates(job.id);
      if(session.candidates.length!==2)throw Error('DEV candidate count');
      const id=session.candidates[1].candidateId;
      await service.revealRecoveryCandidate(job.id,id);
      const completed=await service.confirmRecoveryCandidate(job.id,id);
      if(completed.status!=='completed' || completed.outputResolution?.mode!=='user-confirmed' || completed.outputResolution.automaticOwnershipVerified!==false || fixture.fetches!==1 || completed.outputVerification.sha256!==crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex'))throw Error('DEV manual completion invalid');
      return completed;
    }
    if(action==='duplicates' && payload===undefined && identity) {for(let i=0;i<4;i++)fixture.service.emit('changed',{id:identity.jobId,status:fixture.service.get(identity.jobId).status});return true;}
    if(action==='report' && payload && typeof payload==='object' && JSON.stringify(payload).length<16000) {
      const file=path.join(current.root,fs.existsSync(path.join(current.root,'first-pass.json'))?'restart-pass.json':'first-pass.json');
      const job=fixture.service.get(identity.jobId);
      fs.writeFileSync(file,JSON.stringify({...payload,mode:'manual-recovery',identity,native:{outputResolution:job.outputResolution,outputVerification:job.outputVerification,fetches:fixture.fetches,
        realMuseRequests:0,attempts:job.attempts}},null,2),{flag:'wx'});
      await require('electron').session.defaultSession.flushStorageData();
      if(!payload.ok || env.VIRAL_AI_DEV_HANDOFF_AUTOCLOSE==='1')setTimeout(()=>app.quit(),300);
      return true;
    }
    throw Error('Invalid DEV manual recovery command');
  };
  app.on('will-quit',()=>fixture.close());
  return current;
}
module.exports={runtime};
