"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../renderer/core-generation-progress-model'),scenes=require('../renderer/core-scene-plan-model');
function harness(locale='en'){
  let markup='',jobs=[],probe=true;const events={},calls=[];
  const viewport={scrollTop:0,querySelector:()=>null},snapshot={projectId:'project',projectName:'My film <one>'};
  const plan=scenes.normalizePlan({sourceType:'script',scenes:[{id:'scene-a',title:'Purple submarine',sourceText:'A real script'},{id:'scene-b',title:'User title <two>'}]});
  class Element{}
  const c={window:{ViralGenerationProgressModel:model,ViralCoreScenePlanModel:scenes,ViralCoreProjectPersistence:{snapshot:()=>snapshot},
    addEventListener(){},desktopAPI:{listGenerationJobs:async()=>({ok:true,value:jobs}),getGenerationStatus:async()=>({ok:true,value:{ready:true,state:'ready'}}),
      getGenerationOutput:async id=>({ok:true,value:{jobId:id,projectId:'project',path:'C:/fixture/'+id+'.mp4'}}),probeVideo:async()=>probe?{duration:6,width:1920,height:1080}:{duration:0},onGenerationChanged:()=>()=>{}},
    dispatchEvent:e=>calls.push(e),crypto:{randomUUID:()=> 'fixture-id'}},
    document:{readyState:'complete',activeElement:null,getElementById:()=>viewport,addEventListener:(k,f)=>events[k]=f},state:{page:'home',locale,scenePlan:plan,jobs:[]},pages:{},pageMeta:{},Element,
    render(){markup=c.pages[c.state.page]?.()||'';}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);vm.runInContext(fs.readFileSync('renderer/core-generation-progress.js','utf8'),c);
  return {c,events,calls,get html(){return markup;},setProbe:v=>probe=v,open:async(list,id)=>{jobs=list;await c.window.ViralGenerationProgress.open(id||list[0]?.id);}};
}
const job=(status,extra={})=>({id:'job-a',projectId:'project',sceneId:'scene-a',provider:'fixture',status,request:{prompt:'Original prompt'},...extra});
const verified=()=>job('completed',{asset:{fileName:'job-a.mp4'},output:{fileName:'job-a.mp4'}});
for(const locale of ['vi','en']){
  for(const status of model.states)test(locale+' '+status+' uses truthful state and one recommended action',async()=>{
    const h=harness(locale);await h.open([job(status)]);const c=h.c.window.I18N.messages[locale].generationProgress;
    assert(h.html.includes('My film &lt;one&gt;'));assert(h.html.includes('Purple submarine'));assert.equal((h.html.match(/aria-current="step"/g)||[]).length,1);
    assert(h.html.includes('id="generation-headline" role="status" aria-live="polite" aria-atomic="true"'));
    assert.equal((h.html.match(/class="button generation-primary-action"/g)||[]).length,1);
    assert(!h.html.includes('<progress'));assert(!/\d+%/.test(h.html));assert(h.html.includes(c.stateOnly));
    assert(h.html.indexOf('generation-stages')<h.html.indexOf('generation-summary'));
    if(status==='interrupted'){assert(h.html.includes(c.help.interrupted));assert(!h.html.includes('data-generation-action="retry"'));}
    if(status==='completed'){assert(h.html.includes(c.unverified));assert(!h.html.includes('data-generation-action="studio"'));}
    assert.equal(h.calls.length,0);
  });
  test(locale+' numerical progress only displays supplied facts, completion requires own evidence',async()=>{
    const h=harness(locale);await h.open([job('running',{progress:37})]);assert(h.html.includes('value="37"'));assert(h.html.includes('37%'));
    await h.open([verified()]);assert(!h.html.includes(h.c.window.I18N.messages[locale].generationProgress.projectComplete));
    // One verified Scene alone cannot complete a two-Scene project, even with export evidence.
    h.c.state.voice={job:{status:'completed'},result:{outputPath:'C:/voice.wav'}};
    h.c.state.jobs=[{isRenderOutput:true,status:'completed',outputPath:'C:/export.mp4',fileState:'available'}];
    await h.open([verified()]);assert(!h.html.includes(h.c.window.I18N.messages[locale].generationProgress.projectComplete));
    await h.open([verified(),job('completed',{id:'job-b',sceneId:'scene-b',asset:{fileName:'job-b.mp4'},output:{fileName:'job-b.mp4'}})],'job-a');
    assert(h.html.includes(h.c.window.I18N.messages[locale].generationProgress.projectComplete));
    h.setProbe(false);await h.open([verified()]);assert(!h.html.includes('data-generation-action="studio"'));
  });
  test(locale+' manual/uncertain recovery stays visible and never becomes an implicit resend',async()=>{
    const h=harness(locale);await h.open([job('interrupted',{provider:'muse',recoveryState:'acceptance_unproven'})]);
    assert(!h.html.includes('data-generation-action="retry"'));assert(!h.html.includes('data-generation-action="recover"'));
    assert(h.html.includes('data-generation-action="new-request"'));assert(h.html.includes(h.c.window.I18N.messages[locale].generationProgress.acceptanceUnproven));
    await h.open([job('interrupted',{provider:'muse',manualRecovery:{version:1,eligible:true}})]);
    assert.equal((h.html.match(/class="button generation-primary-action"/g)||[]).length,1);
    assert(h.html.includes('data-recovery-action="list"'));assert(h.html.includes(h.c.window.I18N.messages[locale].manualRecovery.explanation));
    assert(h.html.indexOf('generation-recovery')<h.html.indexOf('<details class="generation-details"'));assert.equal(h.calls.length,0);
  });
  test(locale+' row review follows the exact request without changing Project or Scene selection',async()=>{
    const h=harness(locale),second=job('queued',{id:'job-b',sceneId:'scene-b'});await h.open([job('running'),second]);
    const plan=JSON.stringify(h.c.state.scenePlan),n=new h.c.Element();n.dataset={generationJob:'job-b'};n.closest=s=>s==='[data-generation-job]'?n:null;
    h.events.click({target:n});await new Promise(r=>setImmediate(r));
    assert(h.html.includes('Following: User title &lt;two&gt;')||h.html.includes('Đang theo dõi: User title &lt;two&gt;'));
    assert.equal(JSON.stringify(h.c.state.scenePlan),plan);assert.equal(h.calls.length,0);
    n.dataset.generationJob='foreign-job';h.events.click({target:n});await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(h.c.state.scenePlan),plan);
  });
  test(locale+' another Scene issue stays above active work without changing the followed job',async()=>{
    const h=harness(locale);await h.open([job('running'),job('interrupted',{id:'job-b',sceneId:'scene-b'})]);
    assert(h.html.includes('class="generation-project-attention"'));
    assert(h.html.indexOf('class="generation-project-attention"')<h.html.indexOf('class="generation-current-copy"'));
    assert(h.html.includes('data-generation-job="job-b"'));
    assert.equal((h.html.match(/class="button generation-primary-action"/g)||[]).length,1);
    assert(h.html.includes(h.c.window.I18N.messages[locale].generationProgress.otherIssue));
    assert.equal(h.calls.length,0);
  });
}
test('VI/EN Progress key parity, including stage arrays and commercial copy',()=>{
  const h=harness(),m=h.c.window.I18N.messages;
  const shape=v=>Array.isArray(v)?v.map(shape):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,shape(v[k])])):typeof v;
  assert.deepEqual(shape(m.vi.generationProgress),shape(m.en.generationProgress));
});
