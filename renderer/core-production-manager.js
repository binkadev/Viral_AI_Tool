(function installProductionManager() {
  "use strict";
  const persistence=window.ViralCoreProjectPersistence,model=window.ViralProductionManagerModel;
  if(!persistence||!model)return;
  const t=(key,vars)=>window.I18N.t(state.locale==="en"?"en":"vi","productionManager."+key,vars);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  let queued=false;
  const runtime=window.ViralProductionManagerRuntime.create({persistence,model,productionModel:window.ViralProductionModel,actionModel:window.ViralSceneActionModel,
    player:window.ViralCorePlayerModel,renderModel:window.ViralCoreProjectRenderModel,desktop:window.desktopAPI,
    productionView:()=>window.ViralProductionModes?.runtime.view(),renderView:id=>window.ViralCoreProjectRender?.runtime.view(id),
    route:page=>{state.page=page;render();},changed:queue});
  const rename=window.ViralProjectIdentity?.create({owner:"manager",persistence,locale:()=>state.locale,
    currentId:()=>state.page==="productions"?runtime.collect().selected:null,changed:queue,document,i18n:window.I18N});
  const projectType=kind=>window.I18N.t(state.locale,"aiCreate."+(kind==="ai"?"aiProject":"importedProject"));
  const reasonKey=reason=>({PROJECT_RENDER_VOICE_REQUIRED:"voiceRequired",PROJECT_RENDER_VOICE_STALE:"voiceStale",PROJECT_RENDER_BGM_UNAVAILABLE:"bgmUnavailable",PROJECT_RENDER_PROFILE_UNRESOLVED:"profileMissing",
    PROJECT_RENDER_TIMING_INVALID:"timingInvalid",PROJECT_RENDER_INPUT_CHANGED:"inputChanged",PROJECT_RENDER_MEDIA_MISSING:"mediaMissing",PROJECT_RENDER_INCOMPLETE:"incomplete"}[reason]||
    (["noScenes","materialsAttention","renderFailed","renderInterrupted","outputMissing"].includes(reason)?reason:"incomplete"));
  const date=value=>{const n=Date.parse(value);return Number.isFinite(n)?new Intl.DateTimeFormat(state.locale==="en"?"en-GB":"vi-VN",{dateStyle:"medium",timeStyle:"short"}).format(n):t("unknownTime");};
  const name=path=>String(path||"").split(/[\\/]/).at(-1)||t("output");
  const duration=n=>Number.isFinite(n)?window.ViralCorePlayerModel.formatClock(n):t("unknown");
  const meta=j=>[duration(j.metadata?.duration),j.metadata?.width&&j.metadata?.height?j.metadata.width+"×"+j.metadata.height:null,
    Number.isFinite(j.outputSizeBytes)?t("size",{value:(j.outputSizeBytes/1048576).toFixed(2)}):null].filter(Boolean).join(" · ");
  const button=(action,label,attrs="",disabled=false)=>'<button type="button" class="button ghost" data-manager-action="'+action+'" '+attrs+(disabled?' disabled':'')+'>'+esc(t(label))+'</button>';
  const w=(key,vars)=>window.I18N.t(state.locale==="en"?"en":"vi","productionWorkspace."+key,vars);
  // Local presentation priority only; the Manager model, Registry order and
  // runtime selection/execution authority remain unchanged.
  function priority(s) {
    return s.reasons.includes("renderInterrupted")?0:s.status==="review"?1:s.status==="needs_attention"?2:
      ["rendering","preparing"].includes(s.status)?3:["paused","ready_to_render"].includes(s.status)?4:s.status==="ready"?5:6;
  }
  const group=s=>priority(s)<=2?"attention":priority(s)===3?"working":priority(s)===4?"waiting":priority(s)===5?"completed":"drafts";
  function stage(s) {
    if(s.production&&["running","paused"].includes(s.production.state)&&!s.render)return w("stageMedia");
    if(s.render||["ready","ready_to_render"].includes(s.status)||s.reasons.some(r=>["renderFailed","renderInterrupted","outputMissing"].includes(r)))return w("stageExport");
    if(s.reasons.some(r=>/VOICE|BGM/.test(r)))return w("stageAudio");
    return w("stageMedia");
  }
  function card(p,v,index) {
    const s=p.summary,rank=priority(s),selected=s.projectId===v.selected;
    const opened=selected&&[...(document.querySelectorAll?.('[data-manager-details]')||[])].some(n=>n.dataset.managerDetails===s.projectId&&n.open);
    const live=window.ViralProductionModes?.runtime.view(),mode=s.production&&live?.run?.projectId===s.projectId&&["running","paused"].includes(live.state)?live.run.mode:null;
    const current=s.production?.current,scene=p.snapshot.scenePlan.scenes.find(row=>row.id===current);
    const reason=s.reasons.includes("renderInterrupted")?"renderInterrupted":s.reasons[0];
    const explanation=reason?w(reasonKey(reason)):w(s.checkingOutput?"checkingOutput":({review:"reviewHint",preparing:"activeHint",rendering:"activeHint",paused:"pausedHint",ready_to_render:"exportHint",ready:"completedHint"}[s.status]||"draftHint"));
    const status=s.reasons.includes("renderInterrupted")&&s.status==="needs_attention"?w("recovery"):t(s.status);
    const statusTone=rank<=2?"attention":rank===3?"active":s.status==="ready"?"ready":"quiet";
    return '<article class="pm-project-card'+(index===0?' is-lead':'')+'" data-manager-card="'+esc(s.projectId)+'" aria-labelledby="pm-name-'+index+'">'+
      '<div class="pm-card-main"><div class="pm-card-top"><span class="pm-stage">'+esc(stage(s))+'</span><span class="pm-state tone-'+statusTone+'">'+esc(status)+'</span></div>'+
      '<h3 id="pm-name-'+index+'" title="'+esc(s.name)+'">'+esc(s.name)+'</h3><p class="pm-card-explanation">'+esc(explanation)+'</p>'+
      (s.reasons.length>1?'<ul class="pm-card-issues">'+s.reasons.filter(r=>r!==reason).map(r=>'<li>'+esc(w(reasonKey(r)))+'</li>').join('')+'</ul>':'')+
      (scene?'<p class="pm-current-scene">'+esc(w("currentScene",{name:scene.title||t("sceneName",{number:p.snapshot.scenePlan.scenes.indexOf(scene)+1})}))+'</p>':'')+
      '<p class="pm-card-meta"><span>'+esc(w("sceneCount",{count:s.materials.total}))+'</span><span>'+esc(projectType(s.projectKind))+'</span>'+
      (mode==="assisted"||mode==="auto"?'<span>'+esc(window.I18N.t(state.locale,"productionModes."+mode))+'</span>':'')+
      (s.active?'<span>'+esc(t("currentlyOpen"))+'</span>':'')+'</p></div>'+
      '<div class="pm-card-action"><button type="button" class="button pm-open'+(index===0?' pm-primary':'')+'" data-manager-action="open" data-manager-project="'+esc(s.projectId)+'"'+(v.protected||v.opening?' disabled':'')+'>'+esc(w(rank<=2?"reviewProject":"openStudio"))+'<span aria-hidden="true">&#8599;</span></button></div>'+
      '<details class="pm-project-details" data-manager-details="'+esc(s.projectId)+'"'+(opened?' open':'')+'><summary data-manager-select="'+esc(s.projectId)+'" aria-current="'+(selected?'true':'false')+'">'+esc(w("details"))+'<span aria-hidden="true">&#8964;</span></summary>'+
      (selected?detail(p,v):'')+'</details></article>';
  }
  function output(j,current,health) {
    const available=health==="available"&&j.fileState==="available",label=j.status==="completed"?(current&&available?"current":current?health==="missing"?"outputMissing":"checkingOutput":"previousRender"):
      ({failed:"renderFailed",interrupted:"renderInterrupted",cancelled:"renderCancelled"}[j.status]||"rendering");
    return '<article class="pm-output"><div><strong>'+esc(t(label))+'</strong><p>'+esc(j.outputPath?name(j.outputPath):t("output"))+'</p><small>'+esc(meta(j))+'</small><small>'+esc(date(j.completedAt||j.startedAt))+'</small>'+
      (health==="missing"?'<p class="pm-warning">'+esc(t("outputMissing"))+'</p>':'')+'</div>'+
      button("show","showInFolder",'data-manager-job="'+esc(j.id)+'"',!available)+'</article>';
  }
  function detail(p,v) {
    if(!p)return '<aside class="pm-detail"><p>'+esc(t("selectProject"))+'</p></aside>';
    const s=p.summary,settings=p.snapshot.workflow.renderOptions,voice=window.ViralCoreProjectAudioModel.currentVoice(p.snapshot,window.ViralCoreProjectAudioModel.voicePlan(p.snapshot,p.plan.playback));
    const voiceLabel=!settings.voiceEnabled?"voiceDisabled":voice?"voiceReady":p.snapshot.workflow.voice.staleResult?"voiceStale":"voiceRequired";
    const bgmLabel=!settings.bgmAssetId?"bgmNone":window.ViralCoreProjectAudioModel.resolveBgm(p.snapshot)?"bgmSelected":"bgmUnavailable";
    const scenes=new Map(p.snapshot.scenePlan.scenes.map((s,i)=>[s.id,{title:s.title,index:i+1}]));
    const attention=s.materials.scenes.filter(s=>["review","attention"].includes(s.status));
    const phase=s.render?.state,percent=s.render?.percent;
    const history=s.history.slice(0,v.visibleHistory);
    return '<div class="pm-detail" aria-label="'+esc(t("detail"))+'"><div class="pm-detail-head">'+(rename?.markup(s.projectId,s.name)||'<h2 title="'+esc(s.name)+'">'+esc(s.name)+'</h2>')+'</div>'+
      '<p class="pm-project-kind">'+esc(projectType(s.projectKind))+'</p>'+
      '<p class="pm-status" role="status" aria-live="polite">'+esc(t(s.status))+'</p>'+s.reasons.map(r=>'<p class="pm-warning">'+esc(t(reasonKey(r)))+'</p>').join('')+
      '<section><h3>'+esc(t("materials"))+'</h3><p>'+esc(t("materialCounts",{ready:s.materials.ready,total:s.materials.total,review:s.materials.review,attention:s.materials.attention}))+'</p>'+
      attention.map(row=>'<p>'+esc(scenes.get(row.sceneId)?.title||t("sceneName",{number:scenes.get(row.sceneId)?.index||1}))+' · '+esc(t(row.status==="review"?"review":"needs_attention"))+'</p>').join('')+'</section>'+
      (s.production&&["running","paused"].includes(s.production.state)?'<section><h3>'+esc(t("preparing"))+'</h3><p>'+esc(t(s.production.state==="paused"?"paused":"preparing"))+'</p>'+
        (s.production.current?'<p>'+esc(scenes.get(s.production.current)?.title||t("sceneName",{number:scenes.get(s.production.current)?.index||1}))+'</p>':'')+
        (s.production.phase?'<p>'+esc(t("materialPhase_"+s.production.phase))+'</p>':'')+'</section>':'')+
      '<section><h3>'+esc(t("audio"))+'</h3><p>'+esc(t(voiceLabel))+'</p><p>'+esc(t(bgmLabel))+'</p><p>'+esc(t(settings.burnSubtitles?"subtitlesEnabled":"subtitlesDisabled"))+'</p></section>'+
      '<section><h3>'+esc(t("render"))+'</h3><p>'+esc(t(phase?"phase_"+phase:s.renderReady?"ready_to_render":"renderBlocked"))+'</p>'+
      (s.profile.width&&s.profile.height?'<p>'+esc(s.profile.width+'×'+s.profile.height+' · '+t("fps",{value:s.profile.fps}))+'</p>':'')+
      (percent!==null&&percent!==undefined?'<div class="pm-progress" role="progressbar" aria-label="'+esc(t("render"))+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'"><span style="inline-size:'+percent+'%"></span></div><p>'+percent+'%</p>':'')+
      (s.render?.sceneIndex?'<p>'+esc(t("sceneProgress",{index:s.render.sceneIndex,count:s.render.sceneCount}))+'</p>':'')+'</section>'+
      '<section><h3>'+esc(t("currentOutput"))+'</h3>'+(s.currentOutput?output(s.currentOutput,true,"available"):'<p>'+esc(t(s.checkingOutput?"checkingOutput":s.missingOutput?"outputMissing":"noCurrentOutput"))+'</p>')+'</section>'+
      '<section><h3>'+esc(t("history"))+'</h3>'+(history.length?history.map(row=>output(row.job,row.current,row.health)).join(''):'<p>'+esc(t("noHistory"))+'</p>')+
      (s.history.length>history.length?button("more","moreHistory"):'')+'</section></div>';
  }
  function page() {
    const heading='<header class="pm-heading"><span class="pm-eyebrow">'+esc(w("eyebrow"))+'</span><h2>'+esc(t("title"))+'</h2><p>'+esc(w("description"))+'</p></header>';
    let v;try{v=runtime.observe();}catch{return '<div class="production-manager" data-production-manager>'+heading+'<section class="pm-error" role="alert"><h3>'+esc(w("errorTitle"))+'</h3><p>'+esc(w("errorHint"))+'</p></section></div>';}
    if(v.protected)return '<div class="production-manager" data-production-manager>'+heading+'<section class="pm-error" role="alert"><h3>'+esc(w("errorTitle"))+'</h3><p>'+esc(t("storageProtected"))+'</p></section></div>';
    const ordered=v.filtered.map((s,index)=>({s,index})).sort((a,b)=>priority(a.s)-priority(b.s)||a.index-b.index).map(row=>row.s);
    let index=0;
    const sections=["attention","working","waiting","completed","drafts"].map(key=>{const rows=ordered.filter(s=>group(s)===key);return rows.length?'<section class="pm-group" aria-labelledby="pm-group-'+key+'"><div class="pm-group-heading"><h3 id="pm-group-'+key+'">'+esc(w("group_"+key))+'</h3><span>'+esc(w("projectCount",{count:rows.length}))+'</span></div><div class="pm-project-grid">'+rows.map(s=>card(v.projects.find(p=>p.summary.projectId===s.projectId),v,index++)).join('')+'</div></section>':'';}).join('');
    return '<div class="production-manager" data-production-manager>'+heading+
      (v.error?'<p class="pm-error" role="alert">'+esc(t(v.error))+'</p>':'')+
      '<div class="pm-toolbar"><label class="pm-search"><span>'+esc(t("search"))+'</span><input type="search" data-manager-search value="'+esc(v.query)+'" placeholder="'+esc(w("searchPlaceholder"))+'" maxlength="512"></label><label class="pm-filter"><span>'+esc(t("filter"))+'</span><select data-manager-filter>'+model.FILTERS.map(f=>'<option value="'+f+'"'+(v.filter===f?' selected':'')+'>'+esc(t(f))+'</option>').join('')+'</select></label><p class="pm-total" role="status" aria-live="polite">'+esc(w("resultCount",{count:v.filtered.length,total:v.summaries.length}))+'</p></div>'+
      (!v.summaries.length?'<section class="pm-empty"><div class="pm-empty-symbol" aria-hidden="true">&#9636;</div><div><h3>'+esc(w("emptyTitle"))+'</h3><p>'+esc(w("emptyHint"))+'</p>'+button("create","create")+'</div></section>':!v.filtered.length?'<section class="pm-search-empty"><h3>'+esc(w("searchEmptyTitle"))+'</h3><p>'+esc(w("searchEmptyHint"))+'</p></section>':sections)+'</div>';
  }
  function queue(){if(queued||state.page!=="productions")return;queued=true;requestAnimationFrame(()=>{
    queued=false;if(state.page!=="productions")return;
    const host=document.getElementById("page"),active=document.activeElement,search=active?.matches?.("[data-manager-search]"),filter=active?.matches?.("[data-manager-filter]"),position=search?active.selectionStart:null;
    const focused=active?.dataset?.managerSelect,action=active?.dataset?.managerAction,job=active?.dataset?.managerJob,project=active?.dataset?.managerProject,scroll=window.scrollY;
    const nameInput=active?.matches?.('[data-project-name]'),namePosition=nameInput?active.selectionStart:null;
    const markup=page();if(host.innerHTML!==markup)host.innerHTML=markup;
    const target=search?host.querySelector("[data-manager-search]"):filter?host.querySelector("[data-manager-filter]"):focused?[...host.querySelectorAll("[data-manager-select]")].find(n=>n.dataset.managerSelect===focused):action?[...host.querySelectorAll("[data-manager-action]")].find(n=>n.dataset.managerAction===action&&n.dataset.managerJob===job&&n.dataset.managerProject===project):null;
    if(target){target.focus({preventScroll:true});if(search&&position!==null)try{target.setSelectionRange(position,position);}catch{}}
    if(nameInput){const input=host.querySelector('[data-project-name]');if(input&&!input.disabled){input.focus({preventScroll:true});try{input.setSelectionRange(namePosition,namePosition);}catch{}}}
    rename?.restoreFocus(host);
    if(window.scrollY!==scroll)window.scrollTo(0,scroll);
  });}
  function install(){pages.productions=page;pageMeta.productions=["productionManager.title","productionManager.breadcrumb"];
    // Register the new product page with the shell's exported navigation set.
    // Release/update policy and the existing hidden pages remain unchanged.
    window.ViralPrivateBetaModel?.primary.add("productions");
    document.addEventListener("input",e=>{if(state.page==="productions"&&e.target.matches?.("[data-manager-search]"))runtime.search(e.target.value);});
    document.addEventListener("change",e=>{if(state.page==="productions"&&e.target.matches?.("[data-manager-filter]"))runtime.filter(e.target.value);});
    document.addEventListener("click",e=>{
      if(state.page!=="productions")return;
      const selected=e.target.closest?.("[data-manager-select]");if(selected){runtime.select(selected.dataset.managerSelect);return;}
      const button=e.target.closest?.("[data-manager-action]");if(!button||button.disabled)return;
      const v=runtime.collect();
      if(button.dataset.managerAction==="open")runtime.open(button.dataset.managerProject||v.selected);
      else if(button.dataset.managerAction==="show")runtime.show(v.selected,button.dataset.managerJob);
      else if(button.dataset.managerAction==="more")runtime.more();
      else if(button.dataset.managerAction==="create"){state.page="ai-create";render();}
    });
    for(const event of ["viral-ai:project-snapshot-saved","viral-ai:project-snapshot-restored","viral-ai:core-state-changed","viral-ai:generation-output-attached","viral-ai:production-view-changed","viral-ai:project-render-view-changed"])window.addEventListener(event,queue);
    window.addEventListener("focus",()=>runtime.invalidate());window.desktopAPI?.onRenderProgress?.(runtime.progress);
    if(state.page==="productions")render();
  }
  window.ViralProductionManager={runtime};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
