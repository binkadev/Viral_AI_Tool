"use strict";
// DEV-only isolated native/worker/content/Project boundaries. No live provider.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
async function run() {
  if(process.env.NODE_ENV==='production' || process.versions.electron)throw Error('Audit v2 DEV harness unavailable in production/Electron');
  const {automaticFixture,projectFixture}=require('./execution-audit-fixture');
  const {makeVideo}=require('./generated-handoff-harness'),{probeVideo}=require('../services/ffmpeg');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'execution-audit-v2-dev-')),fixtures=[],results=[];
  try {
    const sample=path.join(root,'fixture.mp4');await makeVideo(sample);const bytes=fs.readFileSync(sample);
    for(const scenario of ['automatic-complete','interrupted-after-acceptance']) {
      const f=await automaticFixture({root:path.join(root,scenario),bytes,verifyVideo:probeVideo});fixtures.push(f);let job=await f.admit();
      if(scenario==='interrupted-after-acceptance') {
        f.content.foreign('click');job=await f.service.recover(job.id);assert.equal(job.status,'interrupted');assert.equal(job.manualRecovery.eligible,true);assert.equal(f.fetches,0);
      } else {
        for(let i=0;i<6&&job.status!=='completed';i++)job=await f.service.recover(job.id);
        assert.equal(job.status,'completed');const output=f.service.output(job.id),media=await probeVideo(output.path),project=projectFixture(job,f.service);
        project.api.registerGenerationJob(job);project.api.attachGeneratedOutput(job,output,media);
        const stored=project.persisted();assert.equal(stored.media.assets.length,1);assert.equal(stored.workflow.jobs.length,1);assert.equal(stored.workflow.generationOutputs.length,1);assert.equal(stored.source.path,output.path);
      }
      await new Promise(resolve=>setImmediate(resolve));await f.drain();const report=f.service.executionAuditReport(job.id);
      assert.equal(report.coverage.state,scenario==='automatic-complete'?'complete':'partial');assert.equal(report.scopes.submission.state,'complete');
      for(const c of Object.values(report.scopes.submission.counters))assert.deepEqual(c,{recorded:1,total:1});
      assert.equal(f.content.clicks,1);assert.equal(f.calls.filter(c=>c==='submitGeneration').length,1);
      if(scenario==='automatic-complete')for(const type of ['manual.session_opened','manual.candidate_revealed','manual.candidate_confirmed'])assert.equal(report.counters[type].total,0);
      else {assert.equal(report.counters['ownership.completed'].total,null);assert.equal(report.counters['acquisition.started'].recorded,0);assert(!report.events.some(e=>e.type==='job.terminal'));assert(report.streams.every(s=>!s.closed));}
      results.push({scenario,jobStatus:job.status,overall:report.coverage,submission:report.scopes.submission,ownership:report.counters['ownership.completed'],manual:Object.fromEntries(Object.entries(report.counters).filter(([k])=>k.startsWith('manual.'))),automaticAcquisition:scenario==='automatic-complete'?'completed':'not-started',manualRecoveryEligible:job.manualRecovery.eligible,canonicalProjectCorroboration:scenario==='automatic-complete'?'PASS':'not-applicable'});
    }
    const result={executionAuditVersion:2,liveMuseRequests:0,results};process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  } finally {for(const f of fixtures)f.close();fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
