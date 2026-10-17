(function installGenerationProgress() {
  'use strict';
  const model = window.ViralGenerationProgressModel;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy = () => window.I18N.messages[state.locale === 'en' ? 'en' : 'vi'].generationProgress;
  const identity = () => window.ViralCoreProjectPersistence?.snapshot?.()?.projectId || null;
  let jobs = [], projectId = null, selectedId = null, ready = false, loading = false, error = '', busy = false;
  let requestVersion = 0, outputPath = null, retryKey = null, retryJobId = null, unsubscribe;
  function selected() { return jobs.find(j=>j.id === selectedId) || jobs[0] || null; }
  function plan() { return window.ViralCoreScenePlanModel.normalizePlan(state.scenePlan || {}); }
  function paint() {
    if (state.page !== 'generation-progress') return;
    const viewport = document.getElementById('page'), top = viewport.scrollTop;
    const focus = document.activeElement?.getAttribute('data-generation-action');
    render();
    viewport.scrollTop = top;
    if (focus) viewport.querySelector('[data-generation-action="'+focus+'"]')?.focus({preventScroll:true});
  }
  async function refresh() {
    const id = identity(), version = ++requestVersion;
    if (id !== projectId) { jobs=[]; selectedId=null; outputPath=null; retryKey=null; projectId=id; }
    if (!id) { loading=false; paint(); return; }
    loading=true;
    try {
      const [list, status] = await Promise.all([window.desktopAPI.listGenerationJobs(id), window.desktopAPI.getGenerationStatus()]);
      if (version !== requestVersion || identity() !== id) return;
      if (!list?.ok || !Array.isArray(list.value)) throw new Error('unavailable');
      jobs=model.scoped(list.value,id);
      ready=status?.ok === true && status.value?.ready === true && status.value?.state === 'ready';
      selectedId=jobs.some(j=>j.id===selectedId) ? selectedId : jobs[0]?.id || null;
      outputPath=null;
      const candidate=model.outputCandidate(selected(),state);
      if (candidate) {
        const probe=await window.desktopAPI.probeVideo(candidate);
        if (version !== requestVersion || identity() !== id) return;
        if (Number(probe?.duration)>0 && Number(probe?.width)>0 && Number(probe?.height)>0) outputPath=candidate;
      }
      error='';
    } catch { if (version===requestVersion) { error='loadError'; ready=false; outputPath=null; } }
    finally { if (version===requestVersion) { loading=false; paint(); } }
  }
  function button(action,label) { return '<button type="button" class="button ghost" data-generation-action="'+action+'"'+(busy?' disabled':'')+'>'+esc(label)+'</button>'; }
  function page() {
    const c=copy(), job=projectId===identity()?selected():null, p=plan(), info=model.describe(job,ready,jobs.some(j=>j.id!==job?.id && [...model.active,'interrupted'].includes(j.status)));
    const stageStates=model.stages(job,p,state);
    const rows=model.scenes(p,projectId===identity()?jobs:[]);
    return '<div class="generation-workspace"><header class="generation-heading"><div><span class="generation-eyebrow">'+esc(c.eyebrow)+'</span><h2>'+esc(c.title)+'</h2><p>'+esc(c.body)+'</p></div>'+button('create',c.create)+'</header>'+
      '<section class="generation-summary" aria-labelledby="generation-status"><div><span class="generation-eyebrow">'+esc(c.currentStage)+'</span><h3>'+esc(c.stages[3])+'</h3><span id="generation-status" class="generation-status tone-'+info.tone+'" role="status">'+esc(loading&&!job?c.loading:job?(job.status==='completed'&&!info.complete?c.unverified:c.states[info.status]):c.empty)+'</span></div><div class="generation-meter"><div><strong>'+esc(info.percent===null?'—':Math.round(info.percent)+'%')+'</strong><span>'+esc(c.jobProgress)+'</span></div><progress max="100"'+(info.percent===null?'':' value="'+info.percent+'"')+' aria-label="'+esc(c.jobProgress)+'"></progress><p>'+esc(job?.status==='completed'?(info.complete?c.mediaComplete:c.unverified):c.progressNote)+'</p></div><div class="generation-actions">'+(job&&info.cancel?button('cancel',c.cancel):'')+(job&&info.retry?button('retry',c.retry):'')+(job&&info.recover?button('recover',c.recover):'')+button('refresh',c.refresh)+(outputPath&&model.outputCandidate(job,state)===outputPath?button('studio',c.studio):'')+'</div></section>'+
      (error?'<p class="generation-notice" role="alert">'+esc(c[error])+'</p>':'')+
      (job&&['failed','interrupted','cancelled','cancelling'].includes(job.status)?'<p class="generation-notice tone-'+info.tone+'">'+esc(c.help[job.status])+'</p>':'')+
      '<ol class="generation-stages" aria-label="'+esc(c.workflow)+'">'+c.stages.map((label,i)=>'<li data-stage-state="'+stageStates[i]+'"'+(i===3?' aria-current="step"':'')+'><span aria-hidden="true">'+(stageStates[i]==='done'?'✓':i+1)+'</span><strong>'+esc(label)+'</strong><small>'+esc(c.stageStates[stageStates[i]])+'</small></li>').join('')+'</ol>'+
      '<div class="generation-story-head"><div><h3>'+esc(c.storyboard)+'</h3><p>'+esc(c.sceneNote)+'</p></div><span class="generation-provider">'+esc(ready?c.providerReady:c.providerUnavailable)+'</span></div>'+
      (projectId===identity()&&jobs.length>1?'<label class="generation-job-select">'+esc(c.jobLabel)+'<select data-generation-select'+(busy?' disabled':'')+'>'+jobs.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===job?.id?' selected':'')+'>'+esc((j.request?.prompt||c.untitled).slice(0,80))+'</option>').join('')+'</select></label>':'')+
      (rows.length?'<div class="generation-scenes">'+rows.map(({scene,job:sceneJob,state:sceneState,media},i)=>'<article class="generation-scene"><div class="generation-scene-number">'+String(i+1).padStart(2,'0')+'</div><div class="generation-scene-copy"><h4>'+esc(scene.title||c.scene)+' '+(!scene.title?i+1:'')+'</h4><p>'+esc(scene.visualIntent||scene.sourceText||c.noSummary)+'</p><span>'+esc(scene.duration>0?scene.duration.toFixed(1)+' '+c.seconds:c.unknownDuration)+'</span></div><div class="generation-scene-state"><span class="generation-status tone-'+(sceneJob?model.describe(sceneJob).tone:'muted')+'">'+esc(c.states[sceneState])+'</span><small>'+esc(c[media])+'</small></div></article>').join('')+'</div>':'<section class="generation-empty"><span aria-hidden="true">▤</span><h3>'+esc(c.noScenes)+'</h3><p>'+esc(c.noScenesBody)+'</p></section>')+'</div>';
  }
  async function action(name) {
    if (name==='create') { state.page='ai-create';render();return; }
    if (name==='refresh') { if(!busy) await refresh();return; }
    if (name==='studio') {
      await refresh();
      if (outputPath && model.outputCandidate(selected(),state)===outputPath) {state.page='ai-video';render();}
      return;
    }
    const job=selected(), id=identity();
    if (busy || !job || job.projectId!==id || !['cancel','retry','recover'].includes(name)) return;
    busy=true; paint();
    try {
      const fresh=await window.desktopAPI.getGenerationJob(job.id);
      if (!fresh?.ok || fresh.value?.projectId!==identity() || identity()!==id) throw new Error('stale');
      const permissions=model.describe(fresh.value,ready,jobs.some(j=>j.id!==job.id && [...model.active,'interrupted'].includes(j.status)));
      if (!permissions[name]) throw new Error('not allowed');
      let result;
      if (name==='retry') {
        if (retryJobId!==job.id) {retryKey=window.crypto.randomUUID();retryJobId=job.id;}
        result=await window.desktopAPI.retryGeneration({id:job.id,idempotencyKey:retryKey});
      } else result=await window.desktopAPI[name==='cancel'?'cancelGeneration':'recoverGeneration'](job.id);
      if (!result?.ok) throw new Error('action');
      if (identity()===id) selectedId=result.value?.id||job.id;
      await refresh();
    } catch { error='actionError'; }
    finally {busy=false;paint();}
  }
  function install() {
    pages['generation-progress']=page;
    pageMeta['generation-progress']=['generationProgress.nav','generationProgress.breadcrumb'];
    window.ViralGenerationProgress={open:async id=>{selectedId=id;projectId=identity();state.page='generation-progress';render();document.getElementById('page').scrollTop=0;await refresh();}};
    document.addEventListener('click',e=>{
      const target=e.target instanceof Element?e.target:null;
      const control=target?.closest('[data-generation-action]');
      if(control&&!control.disabled) action(control.dataset.generationAction);
      if(target?.closest('[data-page="generation-progress"]')) refresh();
    });
    document.addEventListener('change',e=>{if(e.target?.matches('[data-generation-select]')){selectedId=e.target.value;outputPath=null;refresh();}});
    const changed=()=>{if(state.page==='generation-progress') refresh();};
    unsubscribe=window.desktopAPI?.onGenerationChanged?.(changed);
    window.addEventListener('focus',changed);
    for(const event of ['viral-ai:core-state-changed','viral-ai:project-snapshot-restored']) window.addEventListener(event,changed);
    window.addEventListener('beforeunload',()=>unsubscribe?.(),{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
