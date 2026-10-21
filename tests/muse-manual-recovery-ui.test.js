"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const progress=require('../renderer/core-generation-progress-model'),scenes=require('../renderer/core-scene-plan-model');
function fixture(locale) {
  const calls=[],events={},candidate=crypto.randomUUID();let markup='',job={id:crypto.randomUUID(),projectId:'project',sceneId:'scene',provider:'muse',status:'interrupted',manualRecovery:{version:1,eligible:true},request:{prompt:'Fixture'}};
  const viewport={scrollTop:0,querySelector:()=>null};
  const c={window:{ViralGenerationProgressModel:progress,ViralCoreScenePlanModel:scenes,ViralCoreProjectPersistence:{snapshot:()=>({projectId:'project'})},addEventListener(){},desktopAPI:{
    listGenerationJobs:async()=>({ok:true,value:[job]}),getGenerationStatus:async()=>({ok:true,value:{ready:false}}),onGenerationChanged:()=>()=>{},
    listRecoveryCandidates:async()=>{calls.push('list');return {ok:true,value:{version:1,expiresAt:Date.now()+120000,candidates:[{candidateId:candidate,width:160,height:90,duration:1,available:true}]}};},
    revealRecoveryCandidate:async(id,value)=>{calls.push(['reveal',id,value]);return {ok:true,value:{candidateId:value,revealed:true}};},
    confirmRecoveryCandidate:async(id,value)=>{calls.push(['confirm',id,value]);job={...job,status:'completed',asset:{fileName:job.id+'.mp4'},output:{fileName:job.id+'.mp4'},outputResolution:{mode:'user-confirmed',automaticOwnershipVerified:false}};return {ok:true,value:job};},
    dismissRecovery:async()=>({ok:true}),probeVideo:async()=>({duration:0})
  }},document:{readyState:'complete',activeElement:null,getElementById:()=>viewport,addEventListener:(k,fn)=>events[k]=fn},state:{locale,page:'home',jobs:[]},pages:{},pageMeta:{},Element:class{},setTimeout,clearTimeout,Date,
    render:()=>{markup=c.pages[c.state.page]?.()||'';}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);
  const source=fs.readFileSync('renderer/core-generation-progress.js','utf8').replace('  function install() {','  window.__manualTest={action:recoveryAction,cancel:()=>action("cancel"),expire:()=>{recovery.expiresAt=0;}};\n  function install() {');
  vm.runInContext(source,c);
  return {c,calls,candidate,open:()=>c.window.ViralGenerationProgress.open(job.id),get markup(){return markup;},job:()=>job};
}
for(const locale of ['vi','en'])test(locale+' exact reveal gates confirmation, all copy externalized and completion truthful',async()=>{
  const f=fixture(locale),copy=f.c.window.I18N.messages[locale].manualRecovery;
  await f.open();assert(f.markup.includes(copy.status));assert(f.markup.includes(copy.explanation));assert.equal(f.calls.length,0);
  await f.c.window.__manualTest.action('list');
  assert(f.markup.includes('data-recovery-action="confirm" data-candidate="'+f.candidate+'" disabled'));
  await f.c.window.__manualTest.action('confirm',f.candidate);assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='confirm'));
  await f.c.window.__manualTest.action('list');await f.c.window.__manualTest.action('view',f.candidate);
  assert(f.markup.includes('data-recovery-action="confirm" data-candidate="'+f.candidate+'">'));
  await f.c.window.__manualTest.action('confirm',f.candidate);assert.equal(f.job().status,'completed');assert(f.markup.includes(copy.completed));
  for(const forbidden of ['Gate D','Receipt V2','LOGICAL_USER_MISMATCH','blob:'])assert(!f.markup.includes(forbidden));
  for(const [key,value] of Object.entries(copy))assert(value && typeof value==='string',key);
});
test('expired presentation never confirms and historical jobs expose no recovery panel',async()=>{
  const f=fixture('en');await f.open();await f.c.window.__manualTest.action('list');await f.c.window.__manualTest.action('view',f.candidate);f.c.window.__manualTest.expire();
  await f.c.window.__manualTest.action('confirm',f.candidate);assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='confirm'));
  delete f.job().manualRecovery;await f.open();assert(!f.markup.includes('data-recovery-action='));
});
test('recovery layout allows text expansion, visible keyboard focus and comfortable controls',()=>{
  const css=fs.readFileSync('renderer/core-generation-progress.css','utf8'),js=fs.readFileSync('renderer/core-generation-progress.js','utf8');
  assert(css.includes('.generation-recovery button:focus-visible'));assert(css.includes('min-block-size: 40px'));assert(css.includes('white-space: normal'));assert(css.includes('flex-wrap: wrap'));assert(css.includes('font-size: 13px'));
  const rules=[...css.matchAll(/\.generation-recovery[^{}]*\{([^}]*)\}/g)].map(m=>m[1]).join(';');
  assert(js.includes('recoveryFocus'));assert(!/(?:^|;)\s*(?:height|block-size)\s*:/m.test(rules));
});

test('cancellation stays available while confirmed bytes are being acquired',async()=>{
  const f=fixture('en');await f.open();await f.c.window.__manualTest.action('list');await f.c.window.__manualTest.action('view',f.candidate);
  let finish;
  f.c.window.desktopAPI.confirmRecoveryCandidate=()=>{f.job().status='verifying';return new Promise(resolve=>{finish=resolve;});};
  f.c.window.desktopAPI.getGenerationJob=async()=>({ok:true,value:f.job()});
  f.c.window.desktopAPI.cancelGeneration=async()=>{f.calls.push('cancel');f.job().status='interrupted';finish({ok:false,errorCode:'UNAVAILABLE'});return {ok:true,value:f.job()};};
  const pending=f.c.window.__manualTest.action('confirm',f.candidate);await f.open();
  assert(f.markup.includes('data-generation-action="cancel">'));
  await f.c.window.__manualTest.cancel();await pending;assert(f.calls.includes('cancel'));assert.equal(f.job().status,'interrupted');
});
