'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(locale='en'){
  const calls=[],listeners={},ctx={snapshot:{projectId:'p',projectName:'Film <one>',workflow:{jobs:[]}},projects:[{projectId:'p',projectName:'Film <one>'}],entries:[]};
  class Element{}
  const c={state:{locale,page:'library',jobs:[]},pages:{},window:{ViralCoreProjectPersistence:{snapshot:()=>ctx.snapshot,listProjects:()=>ctx.projects,generationOutputJobs:()=>ctx.entries},ViralCoreGeneratedMedia:{status:()=> 'attached'},ViralGenerationProgress:{open:id=>calls.push(['progress',id])}},
    document:{readyState:'complete',getElementById:()=>null,querySelector:()=>null,addEventListener:(name,fn)=>listeners[name]=fn},Element,
    jobFilePath:j=>j.isRenderOutput?j.outputPath:j.sourcePath,normalizeStatus:s=>s||'queued',formatDuration:n=>'00:'+String(Math.round(n)).padStart(2,'0'),formatBytes:n=>n+' B',t:k=>k,handleJobAction:(a,id)=>calls.push([a,id])};
  vm.createContext(c);vm.runInContext(fs.readFileSync('renderer/i18n.js','utf8'),c);vm.runInContext(fs.readFileSync('renderer/core-library-workspace.js','utf8'),c);
  return {c,ctx,calls,listeners,view:()=>c.pages.library(),api:c.window.ViralLibraryWorkspace};
}
const source=(extra={})=>({id:'source',name:'Film <one>.mp4',sourcePath:'C:/Film.mp4',fileState:'available',mediaState:'ready',status:'queued',meta:{duration:10,width:1920,height:1080},...extra});
for(const locale of ['vi','en']){
  test(locale+' purposeful empty library differs from empty search and invokes nothing',()=>{
    const h=fixture(locale),copy=h.c.window.I18N.messages[locale].libraryWorkspace;
    assert(h.view().includes(copy.emptyTitle));assert(h.view().includes('data-page="ai-create"'));assert(h.view().includes('data-page="download"'));assert(!h.view().includes('<table'));
    h.c.state.jobs=[source()];const filtered=h.api.items('nothing');assert(filtered.includes(copy.searchEmptyTitle));assert(!filtered.includes(copy.emptyTitle));assert(!filtered.includes('data-page='));assert.equal(h.calls.length,0);
  });
  test(locale+' search preserves case-insensitive filename-only substring behavior',()=>{
    const h=fixture(locale);h.c.state.jobs=[source(),source({id:'other',name:'Another.mp4'})];
    assert(h.api.items('FILM').includes('data-library-item="source"'));assert(!h.api.items('FILM').includes('data-library-item="other"'));
    assert(!h.api.items('1920').includes('data-library-item='));assert(!h.api.items(' Film ').includes('data-library-item='));
    assert.equal(h.calls.length,0);
  });
  test(locale+' canonical Project label, exact names, real duration and local thumbnail only',()=>{
    const h=fixture(locale);h.c.state.jobs=[source()];h.ctx.snapshot.workflow.jobs=h.c.state.jobs;
    const html=h.view();assert(html.includes('Film &lt;one&gt;.mp4'));assert(html.includes('Film &lt;one&gt;'));assert(html.includes('00:10'));assert(!html.includes('<img'));
    h.c.state.jobs[0].thumbnail='https://example.invalid/remote.jpg';assert(!h.view().includes('<img'));
    h.c.state.jobs[0].thumbnail='data:image/png;base64,AA==';assert(h.view().includes('data-library-preview'));assert(h.view().includes('alt=""'));
    delete h.c.state.jobs[0].meta;assert(!h.view().includes('library-duration'));assert.equal(h.calls.length,0);
  });
  test(locale+' generated media requires existing attachment authority and matching ownership',()=>{
    const h=fixture(locale),j=source({generationJobId:'gen',projectId:'p',sceneId:'scene',assetId:'generation:gen'});h.c.state.jobs=[j];
    assert.equal(h.api.presentation(j,h.ctx).status,'unverified');assert(h.view().includes('data-library-check="gen"'));assert(!h.view().includes('data-job-action="reveal" data-job-id="source">Show file location</button></div><details'));
    h.ctx.entries=[{jobId:'gen',projectId:'p',sceneId:'scene',assetId:'generation:gen'}];assert.equal(h.api.presentation(j,h.ctx).status,'ready');
    h.ctx.entries[0].projectId='foreign';assert.equal(h.api.presentation(j,h.ctx).status,'unverified');h.ctx.entries[0].projectId='p';
    h.c.window.ViralCoreGeneratedMedia.status=()=> 'pending';assert.equal(h.api.presentation(j,h.ctx).status,'unverified');assert.equal(h.calls.length,0);
  });
  for(const fileState of ['missing','trashed'])test(locale+' '+fileState+' retains entry and offers existing relink, not fabricated ready media',()=>{
    const h=fixture(locale),j=source({fileState});h.c.state.jobs=[j];const before=JSON.stringify(h.c.state.jobs),html=h.view();
    assert.equal(h.api.presentation(j,h.ctx).status,fileState);assert(html.includes('data-job-action="relink"'));assert(!html.includes('data-job-action="trash"'));assert(!html.includes('data-job-action="reveal"'));assert.equal(JSON.stringify(h.c.state.jobs),before);
  });
  test(locale+' item loading/error and export lifecycle are separate from empty Library',()=>{
    const h=fixture(locale);for(const [mediaState,expected]of [['reading','reading'],['error','readError']]){const j=source({mediaState});h.c.state.jobs=[j];assert.equal(h.api.presentation(j,h.ctx).status,expected);assert(!h.view().includes(h.c.window.I18N.messages[locale].libraryWorkspace.emptyTitle));}
    for(const status of ['processing','queued','cancelling','cancelled','failed'])assert.equal(h.api.presentation(source({isRenderOutput:true,outputPath:'C:/export.mp4',status}),h.ctx).status,status);
    const j=source({isRenderOutput:true,outputPath:'C:/export.mp4',status:'completed',fileState:'missing'});h.c.state.jobs=[j];assert(h.view().includes('data-job-action="retry-export"'));assert(!h.view().includes('data-job-action="relink"'));
  });
  test(locale+' storage/read error is truthful, contains no raw internals or invented retry',()=>{
    const h=fixture(locale);h.c.window.ViralCoreProjectPersistence.storageError=()=> 'SECRET_RAW_STORAGE_ERROR';const html=h.view();assert(html.includes('role="alert"'));assert(!html.includes('SECRET_RAW'));assert(!html.includes('data-page='));assert(!html.includes('data-job-action='));assert(html.includes('id="library-search"')&&html.includes(' disabled'));
  });
  test(locale+' 100-record render is read-only and does not fabricate freshness or progress',()=>{
    const h=fixture(locale);h.c.state.jobs=Array.from({length:100},(_,i)=>source({id:'source-'+i,name:'Film '+i+'.mp4'}));const before=JSON.stringify(h.c.state);const html=h.view();assert.equal((html.match(/data-library-item=/g)||[]).length,100);assert(!html.includes('%'));assert(!html.includes('common.now'));assert.equal(JSON.stringify(h.c.state),before);assert.equal(h.calls.length,0);
  });
}
test('delegated actions call the existing authority exactly once, including after search',()=>{
  const h=fixture(),n=new h.c.Element();n.dataset={jobAction:'remove',jobId:'source'};n.closest=()=>n;let prevented=0;
  h.listeners.click({target:n,preventDefault(){prevented++;},stopImmediatePropagation(){prevented++;}});assert.deepEqual(h.calls,[['remove','source']]);assert.equal(prevented,2);
  n.disabled=true;h.listeners.click({target:n});assert.equal(h.calls.length,1);
  n.disabled=false;n.dataset={libraryCheck:'gen',libraryJob:'source'};h.c.state.jobs=[source({generationJobId:'gen'})];h.listeners.click({target:n,preventDefault(){},stopImmediatePropagation(){}});assert.deepEqual(h.calls[1],['progress','gen']);
  n.dataset.libraryCheck='foreign';h.listeners.click({target:n,preventDefault(){},stopImmediatePropagation(){}});assert.equal(h.calls.length,2);
});
test('VI/EN key and nested-state parity; Library installation changes no other page',()=>{
  const h=fixture(),m=h.c.window.I18N.messages,shape=v=>v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,shape(v[k])])):typeof v;
  assert.deepEqual(shape(m.vi.libraryWorkspace),shape(m.en.libraryWorkspace));assert.deepEqual(Object.keys(h.c.pages),['library']);
});
