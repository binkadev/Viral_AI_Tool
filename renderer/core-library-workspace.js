(function installLibraryWorkspace() {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=()=>window.I18N.messages[state.locale==='en'?'en':'vi'].libraryWorkspace;
  const format=(value,fields)=>String(value).replace(/\{(\w+)\}/g,(_,key)=>String(fields[key]??''));
  function context() {
    const persistence=window.ViralCoreProjectPersistence;
    if(persistence?.storageError?.() || persistence?.unsupportedSchemaVersion?.() || !Array.isArray(state.jobs))throw Error('library unavailable');
    return {snapshot:persistence?.snapshot?.(),projects:persistence?.listProjects?.()||[],entries:persistence?.generationOutputJobs?.()||[]};
  }
  function presentation(job,ctx) {
    const path=jobFilePath(job),generated=!!job.generationJobId;
    const ownerId=job.projectId || (ctx.snapshot?.workflow?.jobs?.some(item=>item.id===job.id && jobFilePath(item)===path)?ctx.snapshot.projectId:null);
    const project=ctx.projects.find(item=>item.projectId===ownerId);
    const linked=generated && ctx.entries.some(entry=>entry.jobId===job.generationJobId && entry.projectId===ownerId && entry.sceneId===job.sceneId && entry.assetId && entry.assetId===job.assetId);
    const confirmed=linked && window.ViralCoreGeneratedMedia?.status?.(job.generationJobId)==='attached';
    const unavailable=['missing','trashed'].includes(job.fileState) || job.mediaState==='missing';
    const code=normalizeStatus(job.status);
    let status='unknown',tone='muted';
    if(unavailable){status=job.fileState==='trashed'?'trashed':'missing';tone='warning';}
    else if(generated&&!confirmed){status='unverified';tone='warning';}
    else if(job.mediaState==='error'){status='readError';tone='warning';}
    else if(job.isRenderOutput){
      status=code==='completed'?(job.fileState==='available'&&path?'ready':'unknown'):['processing','queued','cancelling','cancelled','failed'].includes(code)?code:'unknown';
      tone=status==='ready'?'success':status==='failed'?'warning':['processing','queued','cancelling'].includes(status)?'active':'muted';
    }else if(job.mediaState==='reading'){status='reading';tone='active';}
    else if(job.fileState==='available'&&path&&(job.mediaState==='ready'||Number(job.meta?.duration)>0)){status='ready';tone='success';}
    return {path,generated,projectName:project?.projectName||null,status,tone,unavailable,code,origin:job.isRenderOutput?'exported':generated?'generated':job.sourcePath?'imported':'video'};
  }
  function action(job,action,label,primary=false) {
    return '<button type="button" class="button '+(primary?'library-context-action':'ghost')+'" data-job-action="'+action+'" data-job-id="'+esc(job.id)+'">'+esc(label)+'</button>';
  }
  function card(job,ctx,index) {
    const c=copy(),view=presentation(job,ctx),name=String(job.name||c.unnamed),id='library-item-'+index;
    const primary=view.generated&&view.status==='unverified'?null:view.path&&job.fileState==='available'?'reveal':view.unavailable&&!job.isRenderOutput?'relink':job.isRenderOutput&&view.code==='processing'?'cancel-export':job.isRenderOutput&&view.code==='failed'?'retry-export':null;
    const labels={reveal:c.locate,relink:c.relink,'cancel-export':c.cancelExport,'retry-export':c.retryExport};
    // Only the existing local thumbnail evidence is used. Never fetch a remote
    // preview or start a thumbnail/probe job just to decorate the Library.
    const thumbnail=typeof job.thumbnail==='string'&&/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(job.thumbnail)?job.thumbnail:null;
    const placeholder='<div class="library-preview-fallback"'+(thumbnail?' hidden':'')+'><span aria-hidden="true">&#9655;</span><span>'+esc(c.video)+'</span><small>'+esc(c.noPreview)+'</small></div>';
    const duration=Number(job.meta?.duration),meta=job.meta||{};
    return '<article class="library-media-item" data-library-item="'+esc(job.id)+'" aria-labelledby="'+id+'"><div class="library-preview">'+
      (thumbnail?'<img data-library-preview src="'+esc(thumbnail)+'" alt="">':'')+placeholder+
      (Number.isFinite(duration)&&duration>0?'<span class="library-duration">'+esc(formatDuration(duration))+'</span>':'')+'</div>'+
      '<div class="library-item-copy"><span class="library-origin">'+esc(c[view.origin])+'</span><h3 id="'+id+'" title="'+esc(name)+'">'+esc(name)+'</h3><p class="library-project" title="'+esc(view.projectName||c.unassigned)+'">'+esc(view.projectName||c.unassigned)+'</p>'+
      '<span class="library-status tone-'+view.tone+'">'+esc(c.states[view.status])+'</span>'+
      (['unverified','missing','trashed','readError'].includes(view.status)?'<p class="library-item-warning">'+esc(c.help[view.status])+'</p>':'')+
      '<div class="library-item-actions">'+(view.generated&&view.status==='unverified'?'<button type="button" class="button library-context-action" data-library-check="'+esc(job.generationJobId)+'" data-library-job="'+esc(job.id)+'">'+esc(c.checkResult)+'</button>':primary?action(job,primary,labels[primary],true):'')+'</div>'+
      '<details class="library-item-details"><summary>'+esc(c.details)+'<span aria-hidden="true">&#8964;</span></summary><dl>'+
      (view.path?'<div><dt>'+esc(c.filePath)+'</dt><dd>'+esc(view.path)+'</dd></div>':'')+
      (Number(meta.width)>0&&Number(meta.height)>0?'<div><dt>'+esc(c.dimensions)+'</dt><dd>'+esc(meta.width+' × '+meta.height)+'</dd></div>':'')+
      (Number(meta.sizeBytes)>0?'<div><dt>'+esc(c.fileSize)+'</dt><dd>'+esc(formatBytes(meta.sizeBytes))+'</dd></div>':'')+
      (job.time?'<div><dt>'+esc(c.recordedTime)+'</dt><dd>'+esc(job.time)+'</dd></div>':'')+'</dl><div class="library-secondary-actions">'+
      (primary!=='reveal'&&view.path&&job.fileState==='available'?action(job,'reveal',c.locate):'')+
      (!job.isRenderOutput&&primary!=='relink'?action(job,'relink',c.relink):'')+
      (job.isRenderOutput&&view.code==='processing'&&primary!=='cancel-export'?action(job,'cancel-export',c.cancelExport):'')+
      (job.isRenderOutput&&(view.code==='failed'||view.unavailable&&view.code==='completed')&&primary!=='retry-export'?action(job,'retry-export',c.retryExport):'')+
      action(job,'remove',t(job.isRenderOutput?'file.removeHistory':'file.removeLibrary'))+
      (view.path&&job.fileState==='available'?action(job,'trash',t('file.moveToTrash')):'')+'</div></details></div></article>';
  }
  function empty(query=false) {
    const c=copy();
    return '<section class="library-empty" aria-labelledby="library-empty-title"><div class="library-empty-mark" aria-hidden="true">&#9638;</div><div class="library-empty-copy"><span class="library-eyebrow">'+esc(c.eyebrow)+'</span><h2 id="library-empty-title">'+esc(query?c.searchEmptyTitle:c.emptyTitle)+'</h2><p>'+esc(query?c.searchEmptyBody:c.emptyBody)+'</p>'+
      (!query?'<div class="library-empty-actions"><button class="button library-primary" type="button" data-page="ai-create">'+esc(c.create)+'</button><button class="button ghost" type="button" data-page="download">'+esc(c.import)+'</button></div>':'')+'</div></section>';
  }
  function items(query='',ctx=context()) {
    // Preserve the existing name-only, case-insensitive substring search.
    const rows=state.jobs.filter(job=>String(job.name||'').toLowerCase().includes(query.toLowerCase()));
    if(!state.jobs.length)return empty(false);
    if(!rows.length)return empty(true);
    return '<div class="library-results-heading"><h2>'+esc(copy().media)+'</h2><span role="status" aria-live="polite">'+esc(format(copy().results,{count:rows.length,total:state.jobs.length}))+'</span></div><div class="library-media-grid">'+rows.map((job,index)=>card(job,ctx,index)).join('')+'</div>';
  }
  function error() {
    const c=copy();return '<section class="library-error" role="alert"><span aria-hidden="true">!</span><div><h2>'+esc(c.errorTitle)+'</h2><p>'+esc(c.errorBody)+'</p></div></section>';
  }
  function page() {
    const c=copy(),query=document.getElementById('library-search')?.value||'';
    let content,failed=false;
    try{content=items(query);}catch{content=error();failed=true;}
    return '<div class="library-workspace"><header class="library-heading"><div><span class="library-eyebrow">'+esc(c.eyebrow)+'</span><h2>'+esc(c.title)+'</h2><p>'+esc(c.body)+'</p></div>'+
      (!failed&&state.jobs.length?'<button type="button" class="button ghost" data-page="download">'+esc(c.import)+'</button>':'')+'</header><div class="library-toolbar"><label class="library-search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span class="library-accessible-label">'+esc(c.searchLabel)+'</span><input type="search" id="library-search" value="'+esc(query)+'" placeholder="'+esc(c.searchPlaceholder)+'"'+(failed?' disabled':'')+'></label><p>'+esc(c.scope)+'</p></div><div data-library-results>'+content+'</div></div>';
  }
  function install() {
    pages.library=page;
    window.ViralLibraryWorkspace={page,items,presentation};
    document.addEventListener('input',event=>{
      if(state.page!=='library'||event.target?.id!=='library-search')return;
      const host=document.querySelector('[data-library-results]');
      if(host){try{host.innerHTML=items(event.target.value);}catch{host.innerHTML=error();}}
    });
    // Delegate to the same existing action authority, including after search
    // replaces item markup. Capture prevents a second legacy click invocation.
    document.addEventListener('click',event=>{
      const target=event.target instanceof Element?event.target:null;
      const button=target?.closest('.library-workspace [data-job-action], .library-workspace [data-library-check]');
      if(!button||button.disabled||state.page!=='library')return;
      event.preventDefault();event.stopImmediatePropagation();
      if(button.dataset.libraryCheck){
        const job=state.jobs.find(item=>item.id===button.dataset.libraryJob);
        if(job?.generationJobId===button.dataset.libraryCheck)window.ViralGenerationProgress?.open(job.generationJobId);
      }else handleJobAction(button.dataset.jobAction,button.dataset.jobId);
    },true);
    document.addEventListener('error',event=>{
      const img=event.target;
      if(!img?.matches?.('.library-workspace [data-library-preview]'))return;
      img.hidden=true;const fallback=img.parentElement.querySelector('.library-preview-fallback');if(fallback)fallback.hidden=false;
    },true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
