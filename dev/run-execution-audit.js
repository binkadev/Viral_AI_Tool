"use strict";
// DEV-only: no production startup flag, IPC fixture or provider endpoint.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
async function run() {
  if(process.env.NODE_ENV==='production' || process.versions.electron)throw Error('Execution audit DEV validation unavailable in production/Electron');
  const repo=path.resolve(__dirname,'..');
  if(!fs.existsSync(path.join(repo,'tests/execution-audit.test.js')))throw Error('Repository DEV tests required');
  const tests=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/execution-audit.test.js'],{cwd:repo,stdio:'inherit',env:{...process.env}});
  if(tests.status!==0)throw Error('Execution audit deterministic tests failed');
  const {automaticFixture,projectFixture}=require('./execution-audit-fixture');
  const {createFixture}=require('./manual-recovery-fixture');
  const {makeVideo}=require('./generated-handoff-harness'),{probeVideo}=require('../services/ffmpeg');
  const {TYPES}=require('../services/generation/execution-audit');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viral-ai-execution-audit-dev-')),fixtures=[];
  try {
    const sample=path.join(root,'fixture.mp4');await makeVideo(sample);const bytes=fs.readFileSync(sample);
    const results=[];
    for(const mode of ['automatic','user-confirmed']) {
      const f=mode==='automatic'?await automaticFixture({root:path.join(root,mode),bytes,verifyVideo:probeVideo}):createFixture({root:path.join(root,mode),bytes,verifyVideo:probeVideo,executionAudit:true});
      fixtures.push(f);let job=await f.admit();
      if(mode==='automatic') { for(let i=0;i<6 && job.status!=='completed';i++)job=await f.service.recover(job.id); }
      else { const s=await f.service.listRecoveryCandidates(job.id);await f.service.revealRecoveryCandidate(job.id,s.candidates[1].candidateId);job=await f.service.confirmRecoveryCandidate(job.id,s.candidates[1].candidateId); }
      assert.equal(job.status,'completed');const output=f.service.output(job.id),media=await probeVideo(output.path);
      assert(media.duration>0 && media.width===160 && media.height===90);
      const project=projectFixture(job,f.service);project.api.registerGenerationJob(job);project.api.attachGeneratedOutput(job,output,media);
      await (mode==='automatic'?f.drain():f.drainAudit());
      const report=f.service.executionAuditReport(job.id);assert.equal(report.coverage.state,mode==='automatic'?'complete':'partial',JSON.stringify(report.coverage));
      const zero=mode==='automatic'?TYPES.filter(t=>t.startsWith('manual.')):['submit.invocation_observed','submit.acceptance_proven','ownership.completed'];
      for(const type of TYPES){assert.equal(report.counters[type].recorded,zero.includes(type)?0:1,type);assert.equal(report.counters[type].total,mode==='automatic'?(zero.includes(type)?0:1):null,type);}
      const stored=project.persisted();assert.equal(stored.media.assets.length,1);assert.equal(stored.workflow.jobs.length,1);assert.equal(stored.workflow.generationOutputs.length,1);assert.equal(stored.source.path,output.path);
      assert.equal(fs.readdirSync(path.dirname(output.path)).filter(n=>n.endsWith('.mp4')).length,1);
      results.push({mode,coverage:report.coverage.state,scopes:report.scopes,counters:report.counters,canonicalRegistryCorroboration:'PASS',nativeVideo:{duration:media.duration,width:media.width,height:media.height,size:fs.statSync(output.path).size}});
    }
    process.stdout.write(JSON.stringify({executionAuditVersion:2,liveMuseRequests:0,results},null,2)+'\n');
    return results;
  } finally {for(const f of fixtures)f.close();fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
