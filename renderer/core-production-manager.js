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
  const reasonKey=reason=>({PROJECT_RENDER_VOICE_REQUIRED:"voiceRequired",PROJECT_RENDER_VOICE_STALE:"voiceStale",PROJECT_RENDER_BGM_UNAVAILABLE:"bgmUnavailable",PROJECT_RENDER_PROFILE_UNRESOLVED:"profileMissing",
    PROJECT_RENDER_TIMING_INVALID:"timingInvalid",PROJECT_RENDER_INPUT_CHANGED:"inputChanged",PROJECT_RENDER_MEDIA_MISSING:"mediaMissing",PROJECT_RENDER_INCOMPLETE:"incomplete"}[reason]||
    (["noScenes","materialsAttention","renderFailed","renderInterrupted","outputMissing"].includes(reason)?reason:"incomplete"));
  const date=value=>{const n=Date.parse(value);return Number.isFinite(n)?new Intl.DateTimeFormat(state.locale==="en"?"en-GB":"vi-VN",{dateStyle:"medium",timeStyle:"short"}).format(n):t("unknownTime");};
  const name=path=>String(path||"").split(/[\\/]/).at(-1)||t("output");
  const duration=n=>Number.isFinite(n)?window.ViralCorePlayerModel.formatClock(n):t("unknown");
  const meta=j=>[duration(j.metadata?.duration),j.metadata?.width&&j.metadata?.height?j.metadata.width+"×"+j.metadata.height:null,
    Number.isFinite(j.outputSizeBytes)?t("size",{value:(j.outputSizeBytes/1048576).toFixed(2)}):null].filter(Boolean).join(" · ");
  const button=(action,label,attrs="",disabled=false)=>'<button type="button" class="button ghost" data-manager-action="'+action+'" '+attrs+(disabled?' disabled':'')+'>'+esc(t(label))+'</button>';
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
    return '<aside class="pm-detail" aria-label="'+esc(t("detail"))+'"><div class="pm-detail-head"><h2>'+esc(s.name)+'</h2>'+button("open","openProject",'',v.protected||!!v.opening)+'</div>'+
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
      (s.history.length>history.length?button("more","moreHistory"):'')+'</section></aside>';
  }
  function page() {
    const v=runtime.observe(),selected=v.projects.find(p=>p.snapshot.projectId===v.selected);
    return '<div class="production-manager" data-production-manager><header><h2>'+esc(t("title"))+'</h2><p>'+esc(t("subtitle"))+'</p></header>'+
      (v.protected?'<p class="pm-warning" role="alert">'+esc(t("storageProtected"))+'</p>':'')+(v.error?'<p class="pm-warning" role="alert">'+esc(t(v.error))+'</p>':'')+
      '<dl class="pm-totals">'+Object.entries(v.totals).map(([key,n])=>'<div><dt>'+esc(t(key))+'</dt><dd>'+n+'</dd></div>').join('')+'</dl>'+
      '<div class="pm-toolbar"><label>'+esc(t("search"))+'<input type="search" data-manager-search value="'+esc(v.query)+'" maxlength="512"></label><label>'+esc(t("filter"))+'<select data-manager-filter>'+model.FILTERS.map(f=>'<option value="'+f+'"'+(v.filter===f?' selected':'')+'>'+esc(t(f))+'</option>').join('')+'</select></label></div>'+
      (!v.summaries.length?'<div class="pm-empty"><h3>'+esc(t("noProjects"))+'</h3>'+button("create","create")+'</div>':!v.filtered.length?'<p class="pm-empty">'+esc(t("noMatches"))+'</p>':'<div class="pm-layout"><div class="pm-list" aria-label="'+esc(t("projects"))+'">'+v.filtered.map(s=>
        '<button type="button" class="pm-project" data-manager-select="'+esc(s.projectId)+'" aria-current="'+(s.projectId===v.selected?'true':'false')+'"><span class="pm-project-title">'+esc(s.name)+'</span>'+
        (s.active?'<span class="pm-active">'+esc(t("currentlyOpen"))+'</span>':'')+'<span class="pm-status">'+esc(t(s.status))+'</span><span>'+esc(t("materialCounts",{ready:s.materials.ready,total:s.materials.total,review:s.materials.review,attention:s.materials.attention}))+'</span>'+
        '<span>'+esc(t("updated",{time:date(s.updatedAt)}))+'</span><span>'+esc(t(s.currentOutput?"videoReady":s.checkingOutput?"checkingOutput":"noCurrentOutput"))+' · '+esc(t("previousCount",{count:s.previousCount}))+'</span>'+
        (s.render?'<span>'+esc(t("phase_"+s.render.state))+(s.render.percent!==null?' · '+s.render.percent+'%':'')+'</span>':'')+'</button>').join('')+'</div>'+detail(selected,v)+'</div>')+'</div>';
  }
  function queue(){if(queued||state.page!=="productions")return;queued=true;requestAnimationFrame(()=>{
    queued=false;if(state.page!=="productions")return;
    const host=document.getElementById("page"),active=document.activeElement,search=active?.matches?.("[data-manager-search]"),filter=active?.matches?.("[data-manager-filter]"),position=search?active.selectionStart:null;
    const focused=active?.dataset?.managerSelect,action=active?.dataset?.managerAction,job=active?.dataset?.managerJob,scroll=window.scrollY;
    const markup=page();if(host.innerHTML!==markup)host.innerHTML=markup;
    const target=search?host.querySelector("[data-manager-search]"):filter?host.querySelector("[data-manager-filter]"):focused?[...host.querySelectorAll("[data-manager-select]")].find(n=>n.dataset.managerSelect===focused):action?[...host.querySelectorAll("[data-manager-action]")].find(n=>n.dataset.managerAction===action&&n.dataset.managerJob===job):null;
    if(target){target.focus({preventScroll:true});if(search&&position!==null)try{target.setSelectionRange(position,position);}catch{}}
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
      if(button.dataset.managerAction==="open")runtime.open(v.selected);
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
