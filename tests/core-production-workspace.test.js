'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const f=require('./helpers/production-manager-fixtures'),model=require('../renderer/core-production-manager-model'),runtime=require('../renderer/core-production-manager-runtime');
function ui(locale='en',options={}){
  const projects=options.projects||f.six(),recovery=f.project('recovery');recovery.workflow.jobs.push(f.job(recovery,'interrupted','interrupted',{outputPath:null,fileState:'pending'}));if(!options.projects)projects.push(recovery);
  let active='P3',protectedState=false,throws=false;const calls=[],events={},frames=[],node={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
  const persistence={listProjects:()=>{if(throws)throw Error('PRIVATE_STORAGE_EXCEPTION');return projects.map(p=>({projectId:p.projectId,projectName:p.projectName}))},projectAudioSnapshot:id=>f.clone(projects.find(p=>p.projectId===id)||null),activeProjectId:()=>active,storageError:()=>protectedState,unsupportedSchemaVersion:()=>false,openProject:async id=>{calls.push(['open',id]);active=id}};
  const window={ViralCoreProjectPersistence:persistence,ViralProductionManagerModel:model,ViralProductionManagerRuntime:runtime,ViralProductionModel:f.productionModel,ViralSceneActionModel:f.actionModel,ViralCorePlayerModel:f.player,ViralCoreProjectRenderModel:f.renderModel,ViralCoreProjectAudioModel:require('../renderer/core-project-audio-model'),
    ViralCoreProjectRender:{runtime:{view:id=>id==='P4'?{projectId:id,jobId:'active',busy:true,state:'scenes',percent:options.percent??null}:null}},ViralProductionModes:{runtime:{view:()=>options.production||null}},ViralPrivateBetaModel:{primary:new Set()},desktopAPI:{fileStatus:async()=>({exists:true,sizeBytes:1024}),showFile:async p=>{calls.push(['show',p]);return {ok:true}}},addEventListener(){},scrollY:0,scrollTo(){}};
  const c={window,state:{locale,page:'productions'},pages:{},pageMeta:{},document:{readyState:'complete',getElementById:()=>node,querySelectorAll:()=>options.details||[],addEventListener:(n,fn)=>events[n]=fn},requestAnimationFrame:fn=>frames.push(fn),render:()=>{if(c.pages.productions)node.innerHTML=c.pages.productions()}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);vm.runInContext(fs.readFileSync('renderer/core-production-manager.js','utf8'),c);
  const drain=async()=>{let n=30;await new Promise(r=>setImmediate(r));while(frames.length&&n--){frames.shift()();await new Promise(r=>setImmediate(r))}assert(n>0,'no frame loop');};
  const click=(action,id,job)=>events.click({target:{closest:s=>s==='[data-manager-action]'?{dataset:{managerAction:action,...(id?{managerProject:id}:{}),managerJob:job},disabled:false}:null}});
  return {c,projects,node,calls,events,drain,click,persistence,api:window.ViralProductionManager.runtime,get active(){return active},protect(){protectedState=true},throwRead(){throws=true}};
}
const order=html=>[...html.matchAll(/data-manager-card="([^"]+)"/g)].map(m=>m[1]);
for(const locale of ['vi','en']){
  test(locale+' canonical recovery/review/failure precede active/waiting/ready/draft without mutation',async()=>{
    const h=ui(locale),before=JSON.stringify(h.projects);await h.drain();assert.deepEqual(order(h.node.innerHTML),['recovery','P2','P6','P4','P3','P5','P1']);assert.equal(JSON.stringify(h.projects),before);assert.equal(h.active,'P3');assert.deepEqual(h.calls,[]);
  });
  test(locale+' purposeful empty Registry differs from search/filter empty',async()=>{
    const h=ui(locale,{projects:[]});await h.drain();const c=h.c.window.I18N.messages[locale].productionWorkspace;assert(h.node.innerHTML.includes(c.emptyTitle));assert(h.node.innerHTML.includes('data-manager-action="create"'));assert(!h.node.innerHTML.includes('<table'));
    const full=ui(locale);await full.drain();full.api.search('NOT A PROJECT');await full.drain();assert(full.node.innerHTML.includes(c.searchEmptyTitle));assert(!full.node.innerHTML.includes('data-manager-action="create"'));assert(full.node.innerHTML.includes(c.searchEmptyHint));assert.deepEqual(full.calls,[]);
  });
  test(locale+' original trimmed/case-insensitive name search and exact filters remain',async()=>{
    const h=ui(locale);await h.drain();h.api.search('  rEvIeW  ');await h.drain();assert.deepEqual(order(h.node.innerHTML),['P2']);h.api.search('');h.api.filter('ready');await h.drain();assert.deepEqual(order(h.node.innerHTML),['P5']);assert.equal(h.active,'P3');assert.deepEqual(h.calls,[]);
  });
  test(locale+' one contextual action per Project, one primary workspace action, native details',async()=>{
    const h=ui(locale);await h.drain();const html=h.node.innerHTML;assert.equal((html.match(/class="button pm-open/g)||[]).length,7);assert.equal((html.match(/pm-primary/g)||[]).length,1);assert.equal((html.match(/<details class="pm-project-details"/g)||[]).length,7);assert(html.includes('aria-labelledby="pm-name-0"'));assert(!html.includes('<img'));assert(!html.includes('role="progressbar"'));assert(!html.includes('%'));
    for(const action of ['start','pause','resume','stop','render','cancel','retry'])assert(!html.includes('data-manager-action="'+action+'"'));
  });
  test(locale+' no Project completion inferred from a successful generation or unchecked export',async()=>{
    const p=f.project('generation-only');p.workflow.jobs.push({id:'g',projectId:p.projectId,generationJobId:'g',status:'completed',fileState:'available',sourcePath:'C:/generated.mp4'});
    const h=ui(locale,{projects:[p]});await h.drain();assert(!h.node.innerHTML.includes('id="pm-group-completed"'));assert(!h.node.innerHTML.includes(h.c.window.I18N.messages[locale].productionWorkspace.completedHint));assert.equal(h.api.collect().summaries[0].status,'ready_to_render');
  });
  test(locale+' protected/throwing data is an error, not empty or raw diagnostic',async()=>{
    const h=ui(locale);await h.drain();h.protect();const html=h.c.pages.productions();assert(html.includes('role="alert"'));assert(!html.includes('data-manager-action="open"'));assert(!html.includes('data-manager-action="create"'));
    const error=ui(locale);await error.drain();error.throwRead();const failed=error.c.pages.productions();assert(failed.includes('role="alert"'));assert(failed.includes(error.c.window.I18N.messages[locale].productionWorkspace.errorTitle));assert(!failed.includes('PRIVATE_STORAGE_EXCEPTION'));
  });
  test(locale+' exact names are escaped, canonical scene counts retained, no fabricated preview/time',async()=>{
    const p=f.project('long');p.projectName='<Film & title> '.repeat(100);const h=ui(locale,{projects:[p]});await h.drain();assert(h.node.innerHTML.includes('&lt;Film &amp; title&gt;'));assert(!h.node.innerHTML.includes('<Film'));assert(h.node.innerHTML.includes(h.c.window.I18N.t(locale,'productionWorkspace.sceneCount',{count:3})));assert(!h.node.innerHTML.includes('<img'));assert(!h.node.innerHTML.includes('ETA'));assert(!h.node.innerHTML.includes('common.now'));
  });
  test(locale+' 25 canonical Projects render bounded articles and do not activate or write',async()=>{
    const projects=Array.from({length:25},(_,i)=>f.project('project-'+i)),before=JSON.stringify(projects),h=ui(locale,{projects});await h.drain();assert.equal(order(h.node.innerHTML).length,25);assert.equal(JSON.stringify(projects),before);assert.deepEqual(h.calls,[]);
  });
}
test('per-card Open uses the exact existing runtime, while legacy selected Open still works',async()=>{
  const h=ui();await h.drain();h.click('open','P2');await h.drain();assert.deepEqual(h.calls,[['open','P2']]);assert.equal(h.c.state.page,'ai-video');
  const original=ui();await original.drain();original.api.select('P6');original.click('open');await original.drain();assert.deepEqual(original.calls,[['open','P6']]);
});
test('per-card Open keeps protection and current material-run guard, no optimistic activation',async()=>{
  const h=ui('en',{production:{state:'paused',run:{projectId:'P3',mode:'auto'}}});await h.drain();h.click('open','P2');await h.drain();assert.equal(h.active,'P3');assert.deepEqual(h.calls,[]);assert.equal(h.api.collect().error,'materialRunSwitchBlocked');assert(h.node.innerHTML.includes('role="alert"'));
  const p=ui();await p.drain();p.protect();p.click('open','P2');await p.drain();assert.deepEqual(p.calls,[]);
});
test('mode/current Scene are shown only for the canonically owned active run',async()=>{
  const h=ui('en',{production:{state:'running',run:{projectId:'P3',mode:'auto'},current:'P3-scene-1',phase:'waiting'}});await h.drain();assert(h.node.innerHTML.includes('Current scene:'));assert(h.node.innerHTML.includes('Auto'));assert.equal((h.node.innerHTML.match(/Current scene:/g)||[]).length,1);assert.deepEqual(h.calls,[]);
});
test('real finite progress stays secondary in existing detail, never synthesized on cards',async()=>{
  const h=ui('en',{percent:42});await h.drain();h.api.select('P4');await h.drain();assert(h.node.innerHTML.includes('aria-valuenow="42"'));assert(h.node.innerHTML.includes('42%'));const beforeDetails=h.node.innerHTML.slice(0,h.node.innerHTML.indexOf('<details'));assert(!beforeDetails.includes('%'));
});
test('new copy has VI/EN parity and no engine/provider/authority jargon',()=>{
  const h=ui(),m=h.c.window.I18N.messages;assert.deepEqual(Object.keys(m.vi.productionWorkspace).sort(),Object.keys(m.en.productionWorkspace).sort());for(const lang of ['vi','en'])assert(!/FFmpeg|sherpa|Muse|receipt|admission|owner mismatch|canonical/i.test(JSON.stringify(m[lang].productionWorkspace)));
});
test('all canonical blockers stay visible before Details',async()=>{
  const p=f.project('blockers');p.workflow.renderOptions.voiceEnabled=true;p.workflow.jobs.push(f.job(p,'failed','failed',{outputPath:null,fileState:'pending'}));const h=ui('en',{projects:[p]});await h.drain();const visible=h.node.innerHTML.slice(0,h.node.innerHTML.indexOf('<details'));
  assert(visible.includes(h.c.window.I18N.messages.en.productionWorkspace.voiceRequired));assert(visible.includes(h.c.window.I18N.messages.en.productionWorkspace.renderFailed));assert.deepEqual(h.calls,[]);
});
test('active preparation is not relabeled recovery because of an older interrupted export',async()=>{
  const p=f.project('P3');p.workflow.jobs.push(f.job(p,'old','interrupted',{outputPath:null,fileState:'pending'}));const h=ui('en',{projects:[p],production:{state:'running',run:{projectId:'P3',mode:'assisted'}}});await h.drain();const visible=h.node.innerHTML.slice(0,h.node.innerHTML.indexOf('<details'));
  assert(visible.includes('Preparing materials'));assert(visible.includes('Video export was interrupted'));assert(!visible.includes('Review to continue'));assert(visible.includes('>Media</span>'));
});
