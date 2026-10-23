(function installGenerationProgress() {
  'use strict';
  const model = window.ViralGenerationProgressModel;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy = () => window.I18N.messages[state.locale === 'en' ? 'en' : 'vi'].generationProgress;
  let visualFixture = null;
  const identity = () => visualFixture?.projectId || window.ViralCoreProjectPersistence?.snapshot?.()?.projectId || null;
  let jobs = [], projectId = null, selectedId = null, ready = false, loading = false, error = '', busy = false;
  let requestVersion = 0, outputPath = null, retryKey = null, retryJobId = null, unsubscribe;
  let recovery=null,recoveryError='',recoveryTimer=null,recoveryFocus=null,confirmingRecovery=false,cancelledRecovery=false;
  const recoveryCopy=()=>window.I18N.messages[state.locale==='en'?'en':'vi'].manualRecovery;
  const formatRecovery=(value,fields)=>value.replace(/\{(\w+)\}/g,(_,key)=>String(fields[key]??''));
  function selected() { return jobs.find(j=>j.id === selectedId) || jobs[0] || null; }
  function plan() {
    const input = visualFixture ? {sourceType:'script', scenes:copy().visualScenes.map((scene,i)=>({
      id:'dev-scene-'+i, start:i*6, end:(i+1)*6, title:scene[0], sourceText:scene[1], visualIntent:scene[1],
      generationPrompt:scene[1], orientation:'portrait', targetKinds:['video']
    }))} : state.scenePlan || {};
    return window.ViralCoreScenePlanModel.normalizePlan(input);
  }
  function paint() {
    if (state.page !== 'generation-progress') return;
    const viewport = document.getElementById('page'), top = viewport.scrollTop;
    const focus = document.activeElement?.getAttribute('data-generation-action');
    const focusedRecovery=document.activeElement?.getAttribute('data-recovery-action');
    if(focusedRecovery)recoveryFocus={action:focusedRecovery,candidate:document.activeElement.getAttribute('data-candidate')};
    render();
    viewport.scrollTop = top;
    if (focus) viewport.querySelector('[data-generation-action="'+focus+'"]')?.focus({preventScroll:true});
    if(recoveryFocus && !busy) {
      const selector='[data-recovery-action="'+recoveryFocus.action+'"]'+(recoveryFocus.candidate?'[data-candidate="'+recoveryFocus.candidate+'"]':'');
      (viewport.querySelector(selector)||viewport.querySelector('[data-recovery-action="list"]'))?.focus({preventScroll:true});
      recoveryFocus=null;
    }
  }
  async function refresh() {
    if (visualFixture) {
      jobs=visualFixture.jobs.map(j=>({...j,request:{...j.request,prompt:copy().visualPrompt}}));
      projectId=visualFixture.projectId; ready=false; loading=false; outputPath=null; paint(); return;
    }
    const id = identity(), version = ++requestVersion;
    if (id !== projectId) {
      if(recovery && !busy)window.desktopAPI.dismissRecovery(recovery.jobId).catch(()=>{});
      if(!busy){recovery=null;clearTimeout(recoveryTimer);recoveryError='';}
      jobs=[]; selectedId=null; outputPath=null; retryKey=null; projectId=id;
    }
    if (!id) { loading=false; paint(); return; }
    loading=true;
    try {
      const [list, status] = await Promise.all([window.desktopAPI.listGenerationJobs(id), window.desktopAPI.getGenerationStatus()]);
      if (version !== requestVersion || identity() !== id) return;
      if (!list?.ok || !Array.isArray(list.value)) throw new Error('unavailable');
      jobs=model.scoped(list.value,id);
      if (selectedId) await window.ViralCoreGeneratedMedia?.observe(selectedId);
      if (version !== requestVersion || identity() !== id) return;
      ready=status?.ok === true && status.value?.ready === true && status.value?.state === 'ready';
      selectedId=jobs.some(j=>j.id===selectedId) ? selectedId : jobs[0]?.id || null;
      outputPath=null;
      let candidate=model.outputCandidate(selected(),state);
      if(model.verified(selected()) && window.desktopAPI.getGenerationOutput) {
        const output=await window.desktopAPI.getGenerationOutput(selected().id);
        if(version!==requestVersion || identity()!==id)return;
        if(output?.ok && output.value?.projectId===id && output.value?.jobId===selected().id)candidate=output.value.path;
      }
      if (candidate) {
        const probe=await window.desktopAPI.probeVideo(candidate);
        if (version !== requestVersion || identity() !== id) return;
        if (Number(probe?.duration)>0 && Number(probe?.width)>0 && Number(probe?.height)>0) outputPath=candidate;
      }
      error=window.ViralCoreGeneratedMedia?.status(selected()?.id)==='error'?'attachmentError':'';
    } catch { if (version===requestVersion) { error='loadError'; ready=false; outputPath=null; } }
    finally { if (version===requestVersion) { loading=false; paint(); } }
  }
  function button(action,label) { return '<button type="button" class="button ghost" data-generation-action="'+action+'"'+((busy && !(confirmingRecovery && action==='cancel')) || (visualFixture && action!=='refresh' && action!=='create')?' disabled':'')+'>'+esc(label)+'</button>'; }
  function recoveryPanel(job) {
    if(job?.provider!=='muse' || job.status!=='interrupted' || job.manualRecovery?.version!==1 || job.manualRecovery.eligible!==true)return '';
    const c=recoveryCopy(),session=recovery?.jobId===job.id?recovery:null;
    return '<section class="generation-recovery" aria-labelledby="recovery-title"><h3 id="recovery-title">'+esc(c.status)+'</h3><p>'+esc(c.explanation)+'</p>'+
      (recoveryError?'<p role="alert">'+esc(c[recoveryError])+'</p>':'')+
      (session?'<p>'+esc(c.expires)+'</p><div class="generation-recovery-candidates">'+session.candidates.map((candidate,i)=>'<article><h4>'+esc(formatRecovery(c.candidate,{number:i+1}))+'</h4><p>'+esc(formatRecovery(c.details,{width:candidate.width,height:candidate.height,duration:candidate.duration.toFixed(1)}))+'</p><p>'+esc(candidate.available?c.available:c.unavailable)+'</p><div class="generation-actions"><button type="button" class="button ghost" data-recovery-action="view" data-candidate="'+esc(candidate.candidateId)+'"'+(busy || !candidate.available?' disabled':'')+'>'+esc(c.view)+'</button><button type="button" class="button primary" data-recovery-action="confirm" data-candidate="'+esc(candidate.candidateId)+'"'+(busy || !session.revealed.has(candidate.candidateId) || Date.now()>=session.expiresAt?' disabled':'')+'>'+esc(c.confirm)+'</button></div></article>').join('')+'</div>'+(session.candidates.length?'':'<p>'+esc(c.empty)+'</p>'):'')+
      '<div class="generation-actions">'+(!session?'<button type="button" class="button ghost" data-recovery-action="list"'+(busy?' disabled':'')+'>'+esc(c.review)+'</button>':'')+'<button type="button" class="button ghost" data-recovery-action="dismiss"'+(busy?' disabled':'')+'>'+esc(c.dismiss)+'</button><button type="button" class="button ghost" data-recovery-action="open"'+(busy?' disabled':'')+'>'+esc(c.open)+'</button></div></section>';
  }
  async function recoveryAction(name,candidateId) {
    const job=selected(),id=job?.id,originalProject=identity();
    if(busy || !job || job.projectId!==originalProject || job.status!=='interrupted' || job.manualRecovery?.version!==1)return;
    busy=true;recoveryError='';cancelledRecovery=false;paint();
    try {
      let response;
      if(name==='list') {
        response=await window.desktopAPI.listRecoveryCandidates(id);
        if(!response?.ok)throw response;
        if(identity()!==originalProject || selected()?.id!==id){await window.desktopAPI.dismissRecovery(id);return;}
        recovery={...response.value,jobId:id,revealed:new Set()};
        clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{if(recovery?.jobId===id){recovery=null;recoveryError='changed';window.desktopAPI.dismissRecovery(id).catch(()=>{});paint();}},Math.max(0,recovery.expiresAt-Date.now()));
      }else if(name==='view') {
        if(recovery?.jobId!==id)throw Error('stale');
        response=await window.desktopAPI.revealRecoveryCandidate(id,candidateId);
        if(!response?.ok || response.value?.candidateId!==candidateId || response.value.revealed!==true)throw response;
        if(recovery?.jobId===id)recovery.revealed.add(candidateId);
      }else if(name==='confirm') {
        if(recovery?.jobId!==id || !recovery.revealed.has(candidateId) || Date.now()>=recovery.expiresAt)throw Error('stale');
        clearTimeout(recoveryTimer);
        confirmingRecovery=true;cancelledRecovery=false;paint();
        response=await window.desktopAPI.confirmRecoveryCandidate(id,candidateId);
        if(!response?.ok)throw response;
        recovery=null;
        await window.ViralCoreGeneratedMedia?.observe(id);
        await refresh();
      }else if(name==='dismiss') {
        response=await window.desktopAPI.dismissRecovery(id);
        if(!response?.ok)throw response;
        recovery=null;clearTimeout(recoveryTimer);
      }else if(name==='open') {
        response=await window.desktopAPI.openGenerationProviderSession('muse');
        if(!response?.ok)throw response;
      }
    }catch(error) {
      recoveryError=cancelledRecovery?'':error?.errorCode==='RECOVERY_TOO_MANY'?'tooMany':error?.errorCode==='RECOVERY_CHANGED'?'changed':'error';
      recovery=null;clearTimeout(recoveryTimer);
      await window.desktopAPI.dismissRecovery(id).catch(()=>{});
    }finally{confirmingRecovery=false;busy=false;paint();}
  }
  function page() {
    const base=copy(), currentStage=visualFixture ? visualFixture.stage - 1 : 3;
    const stageCopy=base.workflowCopy[currentStage];
    // Only presentation changes: fixture completion never supplies an output or provider.
    const c=visualFixture ? {...base,...stageCopy, states:{...base.states,...stageCopy.states},
      help:{...base.help,...stageCopy.help}, verified:stageCopy.states.completed, noMedia:stageCopy.empty} : base;
    const job=projectId===identity()?selected():null, p=plan(), info=model.describe(job,ready,jobs.some(j=>j.id!==job?.id && [...model.active,'interrupted'].includes(j.status)));
    const stageStates=visualFixture ? visualFixture.stageStates : model.stages(job,p,state);
    const rows=model.scenes(p,projectId===identity()?jobs:[]);
    return '<div class="generation-workspace"><header class="generation-heading"><div><span class="generation-eyebrow">'+esc(c.eyebrow)+'</span><h2>'+esc(base.title)+'</h2><p>'+esc(c.body)+'</p></div>'+button(info.recoveryBlocked?'new-request':'create',info.recoveryBlocked?c.newRequest:c.create)+'</header>'+
      '<section class="generation-summary" aria-labelledby="generation-status"><div><span class="generation-eyebrow">'+esc(visualFixture?c.workflow:c.currentStage)+'</span><h3>'+esc(visualFixture?stageCopy.title:c.stages[currentStage])+'</h3><span id="generation-status" class="generation-status tone-'+info.tone+'" role="status">'+esc(loading&&!job?c.loading:job?(job.status==='completed'&&!info.complete?c.unverified:info.complete&&job.outputResolution?.mode==='user-confirmed'?recoveryCopy().completed:c.states[info.status]):c.empty)+'</span></div><div class="generation-meter"><div><strong>'+esc(info.percent===null?'—':Math.round(info.percent)+'%')+'</strong><span>'+esc(c.jobProgress)+'</span></div><progress max="100"'+(info.percent===null?'':' value="'+info.percent+'"')+' aria-label="'+esc(c.jobProgress)+'"></progress><p>'+esc(job?.status==='completed'?(info.complete?c.mediaComplete:c.unverified):(visualFixture?c.help[job?.status]:null)||c.progressNote)+'</p></div><div class="generation-actions">'+(job&&info.cancel?button('cancel',c.cancel):'')+(job&&info.retry?button('retry',c.retry):'')+(job&&info.recover?button('recover',c.recover):'')+button('refresh',c.refresh)+(outputPath&&model.verified(job)?button('studio',c.studio):'')+'</div></section>'+
      recoveryPanel(job)+
      (visualFixture?'<p class="generation-notice" role="status">'+esc(c.visualNotice)+'</p>':'')+
      (error?'<p class="generation-notice" role="alert">'+esc(c[error])+'</p>':'')+
      (job?.provider==='muse' && job.status==='interrupted'?'<p class="generation-notice" role="status">'+esc(info.recoveryBlocked?c.acceptanceUnproven:c.museInterrupted)+'</p>':'')+
      (job&&!info.recoveryBlocked&&['failed','interrupted','cancelled','cancelling'].includes(job.status)?'<p class="generation-notice tone-'+info.tone+'">'+esc(c.help[job.status])+'</p>':'')+
      '<ol class="generation-stages" aria-label="'+esc(c.workflow)+'">'+c.stages.map((label,i)=>'<li data-stage-state="'+stageStates[i]+'"'+(i===currentStage?' aria-current="step"':'')+'><span aria-hidden="true">'+(stageStates[i]==='done'?'✓':i+1)+'</span><strong>'+esc(visualFixture?base.workflowCopy[i].title:label)+'</strong><small>'+esc(c.stageStates[stageStates[i]])+'</small></li>').join('')+'</ol>'+
      '<div class="generation-story-head"><div><h3>'+esc(c.storyboard)+'</h3><p>'+esc(c.sceneNote)+'</p></div><span class="generation-provider">'+esc(ready?c.providerReady:c.providerUnavailable)+'</span></div>'+
      (projectId===identity()&&jobs.length>1?'<label class="generation-job-select">'+esc(c.jobLabel)+'<select data-generation-select'+(busy?' disabled':'')+'>'+jobs.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===job?.id?' selected':'')+'>'+esc((j.request?.prompt||c.untitled).slice(0,80))+'</option>').join('')+'</select></label>':'')+
      (rows.length?'<div class="generation-scenes">'+rows.map(({scene,job:sceneJob,state:sceneState,media},i)=>'<article class="generation-scene"><div class="generation-scene-number">'+String(i+1).padStart(2,'0')+'</div><div class="generation-scene-copy"><h4>'+esc(scene.title||c.scene)+' '+(!scene.title?i+1:'')+'</h4><p>'+esc(scene.visualIntent||scene.sourceText||c.noSummary)+'</p><span>'+esc(scene.duration>0?scene.duration.toFixed(1)+' '+c.seconds:c.unknownDuration)+'</span></div><div class="generation-scene-state"><span class="generation-status tone-'+(sceneJob?model.describe(sceneJob).tone:'muted')+'">'+esc(c.states[sceneState])+'</span><small>'+esc(c[media])+'</small></div></article>').join('')+'</div>':'<section class="generation-empty"><span aria-hidden="true">▤</span><h3>'+esc(c.noScenes)+'</h3><p>'+esc(c.noScenesBody)+'</p></section>')+'</div>';
  }
  async function action(name) {
    if(name==='new-request') {
      const job=selected();
      if(busy || !job || job.projectId!==identity() || !model.describe(job).recoveryBlocked)return;
      window.dispatchEvent(new CustomEvent('viral-ai:generation-new-request',{detail:{projectId:job.projectId}}));
      state.page='ai-create';render();return;
    }
    if (name==='create') { state.page='ai-create';render();return; }
    if (name==='refresh') { if(!busy) await refresh();return; }
    if (name==='studio') {
      await refresh();
      if (outputPath && model.verified(selected())) {
        const attachment=window.ViralCoreGeneratedMedia?.status(selected().id);
        if (attachment && attachment!=='untracked') {
          if (attachment!=='attached') { error='attachmentError';paint();return; }
          state.page='ai-video';render();return;
        }
        const existing=state.jobs.find(j=>j.sourcePath===outputPath);
        if(!existing && typeof addSourceFiles==='function')addSourceFiles([{name:selected().output.fileName,path:outputPath}]);
        else if(existing)state.jobs=[existing,...state.jobs.filter(j=>j!==existing)];
        save();state.page='ai-video';render();
      }
      return;
    }
    if (visualFixture) return;
    const job=selected(), id=identity();
    if ((busy && !(confirmingRecovery && name==='cancel')) || !job || job.projectId!==id || !['cancel','retry','recover'].includes(name)) return;
    busy=true; paint();
    try {
      const fresh=await window.desktopAPI.getGenerationJob(job.id);
      if (!fresh?.ok || fresh.value?.projectId!==identity() || identity()!==id) throw new Error('stale');
      const permissions=model.describe(fresh.value,ready,jobs.some(j=>j.id!==job.id && [...model.active,'interrupted'].includes(j.status)));
      if (!permissions[name]) throw new Error('not allowed');
      let result;
      if(name==='cancel' && confirmingRecovery)cancelledRecovery=true;
      if (name==='retry') {
        if (retryJobId!==job.id) {retryKey=window.crypto.randomUUID();retryJobId=job.id;}
        result=await window.desktopAPI.retryGeneration({id:job.id,idempotencyKey:retryKey});
      } else result=await window.desktopAPI[name==='cancel'?'cancelGeneration':'recoverGeneration'](job.id);
      if (!result?.ok) throw new Error('action');
      if (name==='retry' && result.value?.id) await window.ViralCoreGeneratedMedia?.track(result.value);
      if (identity()===id) selectedId=result.value?.id||job.id;
      await refresh();
    } catch { error='actionError'; }
    finally {busy=confirmingRecovery;paint();}
  }
  function install() {
    pages['generation-progress']=page;
    pageMeta['generation-progress']=['generationProgress.nav','generationProgress.breadcrumb'];
    window.ViralGenerationProgress={open:async id=>{selectedId=id;projectId=identity();state.page='generation-progress';render();document.getElementById('page').scrollTop=0;await refresh();}};
    document.addEventListener('click',e=>{
      const target=e.target instanceof Element?e.target:null;
      const recoveryControl=target?.closest('[data-recovery-action]');
      if(recoveryControl && !recoveryControl.disabled)recoveryAction(recoveryControl.dataset.recoveryAction,recoveryControl.dataset.candidate);
      const control=target?.closest('[data-generation-action]');
      if(control&&!control.disabled) action(control.dataset.generationAction);
      if(target?.closest('[data-page="generation-progress"]')) refresh();
    });
    document.addEventListener('change',e=>{if(e.target?.matches('[data-generation-select]')){selectedId=e.target.value;outputPath=null;refresh();}});
    const changed=()=>{if(state.page==='generation-progress') refresh();};
    unsubscribe=window.desktopAPI?.onGenerationChanged?.(changed);
    window.addEventListener('focus',changed);
    // Attachment notifications update presentation only. Starting another
    // observation here would turn a persistent write failure into a retry loop.
    window.addEventListener('viral-ai:generation-attachment-changed',event=>{
      if(selected()?.id!==event.detail?.jobId)return;
      error=window.ViralCoreGeneratedMedia?.status(event.detail.jobId)==='error'?'attachmentError':'';
      paint();
    });
    for(const event of ['viral-ai:core-state-changed','viral-ai:project-snapshot-restored']) window.addEventListener(event,changed);
    window.addEventListener('beforeunload',()=>unsubscribe?.(),{once:true});
    window.desktopAPI?.getDevGenerationFixture?.().then(fixture=>{
      if (!fixture) return;
      visualFixture=fixture;
      // Open after the shell's queued first-paint Home route has settled.
      requestAnimationFrame(()=>window.ViralGenerationProgress.open(fixture.selectedId));
    }).catch(()=>{});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
