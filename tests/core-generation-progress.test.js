'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const model=require('../renderer/core-generation-progress-model');
const sceneModel=require('../renderer/core-scene-plan-model');
const {TRANSITIONS}=require('../services/generation/generation-job');
assert.deepEqual([...model.states].sort(),Object.keys(TRANSITIONS).sort());
const job={id:'test-job',projectId:'p1',sceneId:'scene-a',status:'running',progress:35,request:{prompt:'A real user idea'}};
for(const status of model.states){
  const info=model.describe({...job,status},true);
  assert.equal(info.status,status);
  assert.equal(info.retry,['failed','cancelled'].includes(status));
  assert.equal(info.cancel,['queued','preparing','submitting','running','verifying','interrupted'].includes(status));
  assert.equal(info.recover,['queued','running','interrupted'].includes(status));
}
assert(!model.describe({...job,status:'failed'},false).retry);
assert(!model.describe({...job,status:'failed'},true,true).retry);
assert.equal(model.describe({...job,status:'interrupted'}).tone,'warning');
assert.equal(model.describe({...job,status:'failed'}).tone,'danger');
assert.equal(model.describe({...job,progress:100}).percent,99);
assert(!model.verified({...job,status:'completed',progress:100}));
const complete={...job,status:'completed',progress:100,asset:{fileName:'test-job.mp4'},output:{fileName:'test-job.mp4'}};
assert(model.verified(complete));
assert.equal(model.describe(complete).percent,100);
assert(!model.outputCandidate(complete,{jobs:[]}));
assert(!model.outputCandidate(complete,{jobs:[{sourcePath:'C:/test-job.mp4',fileState:'missing'}]}));
assert.equal(model.outputCandidate(complete,{jobs:[{sourcePath:'C:/test-job.mp4',fileState:'available'}]}),'C:/test-job.mp4');
assert.equal(model.scoped([job,{...job,projectId:'p2'}],'p1').length,1);
const plan=sceneModel.normalizePlan({sourceType:'script',scenes:[{id:'scene-a',start:0,end:3,title:'Scene A',sourceText:'Actual script'},{id:'scene-b',start:3,end:5,visualIntent:'Actual intent'}]});
const before=JSON.stringify(plan);
const rows=model.scenes(plan,[complete]);
assert.equal(rows[0].media,'verified');
assert.equal(rows[1].state,'notStarted');
assert.equal(model.scenes(plan,[{...complete,sceneId:null}])[0].state,'notStarted');
assert.equal(JSON.stringify(plan),before);
assert.deepEqual(model.stages(complete,plan,{}),['done','done','done','done','pending','pending','pending']);
assert.deepEqual(model.scenes(null,[]),[]);
const context={window:{}};
vm.runInNewContext(fs.readFileSync('renderer/i18n.js','utf8'),context);
for(const language of ['vi','en']){
  const c=context.window.I18N.messages[language].generationProgress;
  for(const state of model.states)assert(c.states[state]);
  assert.equal(c.stages.length,7);
}
const js=fs.readFileSync('renderer/core-generation-progress.js','utf8');
assert(!js.includes('setInterval'));
assert(js.includes("pages['generation-progress']=page"));
assert(js.includes('onGenerationChanged'));
assert(js.includes('listGenerationJobs(id)'));
assert(js.includes('identity() !== id'));
assert(js.includes('window.ViralCoreScenePlanModel.normalizePlan'));
assert(fs.readFileSync('renderer/core-ai-create.js','utf8').includes('window.ViralGenerationProgress?.open(result.value.id)'));
assert(fs.readFileSync('renderer/index.html','utf8').includes('src="core-generation-progress.js"'));
console.log('Generation progress: route, lifecycle, safe actions, no fake completion, project scoping, and Scene Plan contracts passed');

(async function rendererContract() {
  const listeners={};
  let runtimeJobs=[job], currentProject='p1', markup='', probeUsable=false;
  const viewport={scrollTop:0,querySelector:()=>null};
  const sandbox={
    window:{I18N:context.window.I18N,ViralGenerationProgressModel:model,ViralCoreScenePlanModel:sceneModel,ViralCoreProjectPersistence:{snapshot:()=>({projectId:currentProject})},addEventListener(){},crypto:{randomUUID:()=> 'new-attempt'},desktopAPI:{
      listGenerationJobs:async()=>({ok:true,value:runtimeJobs}),
      getGenerationStatus:async()=>({ok:true,value:{ready:true,state:'ready'}}),
      probeVideo:async()=>probeUsable?{duration:2,width:320,height:180}:{duration:0},
      onGenerationChanged:fn=>{listeners.changed=fn;return ()=>{};}
    }},
    state:{page:'home',locale:'en',scenePlan:plan,jobs:[]},pages:{},pageMeta:{},
    document:{readyState:'complete',getElementById:()=>viewport,querySelector:()=>null,activeElement:null,addEventListener:(name,fn)=>{listeners[name]=fn;}},
    render:()=>{markup=sandbox.pages[sandbox.state.page]?.() || '';},Element:class {}
  };
  vm.runInNewContext(js,sandbox);
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert.equal(sandbox.state.page,'generation-progress');
  assert(markup.includes('Generating media'));
  assert(markup.includes('Scene A'));
  assert(markup.includes('data-generation-action="cancel"'));
  assert(!markup.includes('data-generation-action="studio"'));
  runtimeJobs=[{...job,status:'interrupted'}];
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert(markup.includes('Interrupted'));
  assert(!markup.includes('data-generation-action="retry"'));
  assert(markup.includes('data-generation-action="recover"'));
  runtimeJobs=[{...job,status:'failed'}];
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert(markup.includes('data-generation-action="retry"'));
  runtimeJobs=[complete];
  sandbox.state.jobs=[{sourcePath:'C:/test-job.mp4',fileState:'available'}];
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert(!markup.includes('data-generation-action="studio"'),'Failed probe must not expose Studio');
  probeUsable=true;
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert(markup.includes('data-generation-action="studio"'));
  currentProject='p2';
  await sandbox.window.ViralGenerationProgress.open(job.id);
  assert(!markup.includes('Verified generated media'),'Previous project cannot leak scene status');
  assert(markup.includes('No generation requests yet'));
  console.log('Generation progress renderer: route, states, actions, probe-gated Studio and project isolation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
