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
test('manual recovery preserves UTF-8 Vietnamese copy, placeholders and existing English copy',()=>{
  assert(require('node:buffer').isUtf8(fs.readFileSync('renderer/i18n.js')));
  const {messages,t}=fixture('vi').c.window.I18N;
  const expectedVi={
    status:'Tạo video cần xác nhận',
    explanation:'Ứng dụng chưa xác nhận được video nào thuộc yêu cầu này. Bạn có thể xem và chọn video muốn dùng.',
    review:'Xem và chọn video',
    view:'Xem trong Muse',
    confirm:'Dùng video này cho cảnh này',
    dismiss:'Không dùng video nào',
    open:'Mở Muse',
    changed:'Video đã thay đổi hoặc không còn khả dụng. Hãy xem và chọn lại.',
    completed:'Đã xong · Bạn đã xác nhận',
    candidate:'Video {number}',
    available:'Có thể dùng',
    unavailable:'Không còn khả dụng',
    empty:'Chưa có video có thể dùng. Hãy kiểm tra Muse rồi xem và chọn lại.',
    tooMany:'Có quá nhiều video để chọn an toàn. Hãy thu gọn các video đang hiển thị trong Muse rồi thử lại.',
    expires:'Lựa chọn có hiệu lực trong 2 phút. Hãy xem video trong Muse trước khi xác nhận.',
    error:'Chưa lưu hoặc lấy được video đã chọn. Cảnh này chưa có video mới. Hãy kiểm tra kết nối và dung lượng trống rồi chọn lại.',
    details:'{width} × {height} · {duration} giây'
  };
  const expectedEn={
    status:'Video needs confirmation',
    explanation:'The app could not confirm which video belongs to this request. Review and choose the video you want to use.',
    review:'Review candidates',
    view:'View in Muse',
    confirm:'Use this video for this scene',
    dismiss:'Use none',
    open:'Open Muse',
    changed:'This video changed or is unavailable. Review and select it again.',
    completed:'Done ? Confirmed by you',
    candidate:'Candidate {number}',
    available:'Available',
    unavailable:'Unavailable',
    empty:'No available videos. Check Muse, then review and select again.',
    tooMany:'Too many candidates to review safely. Reduce the videos currently displayed in Muse and try again.',
    expires:'Selection expires in 2 minutes. View the video in Muse before confirming.',
    error:'The selected video could not be saved or acquired. This scene has no new video. Check the connection and free space, then select again.',
    details:'{width} ? {height} ? {duration} seconds'
  };
  assert.deepEqual(Object.keys(messages.vi.manualRecovery),Object.keys(expectedVi));
  assert.deepEqual(JSON.parse(JSON.stringify(messages.vi.manualRecovery)),expectedVi);
  for(const [key,value] of Object.entries(messages.vi.manualRecovery))assert(!/[?\uFFFD]/u.test(value),key);
  assert.equal(t('vi','manualRecovery.candidate',{number:2}),'Video 2');
  assert.equal(t('vi','manualRecovery.details',{width:160,height:90,duration:1}),'160 × 90 · 1 giây');
  assert.deepEqual(JSON.parse(JSON.stringify(messages.en.manualRecovery)),expectedEn);
});
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
