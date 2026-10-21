"use strict";
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createFixture}=require('./manual-recovery-fixture');
const {probeVideo}=require('../services/ffmpeg');
async function validate() {
  if(process.env.NODE_ENV==='production')throw Error('DEV validation unavailable in production');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viral-manual-native-')),sample=path.join(root,'sample.mp4');
  await require('./generated-handoff-harness').makeVideo(sample);
  const real=fs.readFileSync(sample),results=[];
  for(const mode of ['completed','candidate-remounted','candidate-expired','source-mutated','persistence-failure','invalid-mp4','too-many']) {
    const invalid=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]);
    let probes=0;
    const f=createFixture({root:path.join(root,mode),bytes:mode==='invalid-mp4'?invalid:real,verifyVideo:async file=>{
      probes++;const meta=await probeVideo(file);if(!(meta.duration>0 && meta.width>0 && meta.height>0))throw Error('Invalid native MP4');return meta;
    }});
    try {
      const job=await f.admit();
      if(mode==='too-many') {f.more();await assert.rejects(f.service.listRecoveryCandidates(job.id),{code:'RECOVERY_TOO_MANY'});}
      else {
        const session=await f.service.listRecoveryCandidates(job.id),id=session.candidates[1].candidateId;
        await f.service.revealRecoveryCandidate(job.id,id);
        if(mode==='candidate-remounted')f.remount();if(mode==='candidate-expired')f.expire();if(mode==='source-mutated')f.sourceChange();if(mode==='persistence-failure')f.failPersistence=true;
        if(mode==='completed') {
          const completed=await f.service.confirmRecoveryCandidate(job.id,id);
          assert.equal(completed.outputResolution.mode,'user-confirmed');assert.equal(completed.outputResolution.automaticOwnershipVerified,false);
          assert.equal(f.service.output(job.id).verified,true);assert.equal(probes,1);assert.equal(f.fetches,1);
        }else await assert.rejects(f.service.confirmRecoveryCandidate(job.id,id));
      }
      assert.equal(f.service.get(job.id).status,mode==='completed'?'completed':'interrupted');
      assert.equal(f.fetches,['completed','invalid-mp4'].includes(mode)?1:0);
      if(mode==='invalid-mp4')assert.equal(probes,1);
      results.push({mode,passed:true,fetches:f.fetches,nativeProbes:probes});
    }finally{f.close();}
  }
  console.log('DEV native matrix:',JSON.stringify({root,results,liveMuseRequests:0}));
  return {root,results};
}
module.exports={validate};
