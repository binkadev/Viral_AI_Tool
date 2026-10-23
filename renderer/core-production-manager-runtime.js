(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralProductionManagerRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function managerRuntime() {
  "use strict";
  // Observational only. Health: unknown -> checking -> available/missing.
  // Epoch invalidation discards late reads. Opening uses the existing authority.
  function create({persistence,model,productionModel,actionModel,player,renderModel,productionView=()=>null,renderView=()=>null,desktop,route,changed=()=>{}}) {
    const cache=new Map(),versions=new Map(),checking=new Map();
    const MAX_HEALTH=256;
    let epoch=0,selected=null,query="",filter="all",visibleHistory=5,opening=null,error=null;
    const key=(projectId,j)=>JSON.stringify([projectId,j.id,j.outputPath]);
    const protectedState=()=>!!persistence.storageError() || !!persistence.unsupportedSchemaVersion();
    const notify=()=>{try{changed();}catch{}};
    function collect() {
      const projects=[],active=persistence.activeProjectId(),live=productionView();
      const ids=new Set();
      for(const listed of persistence.listProjects()) {
        const p=persistence.projectAudioSnapshot(listed.projectId);if(!p || p.projectId!==listed.projectId)continue;ids.add(p.projectId);
        const projection=player.buildProjectPlayback(p),plan=renderModel.build(p,projection),outputs=renderModel.outputs(p,plan);
        const fingerprint=JSON.stringify([plan.renderInputSignature,outputs.map(o=>[o.job.id,o.job.status,o.job.fileState,o.job.outputPath,o.job.renderInputSignature])]);
        const previous=versions.get(p.projectId);
        if(previous?.fingerprint!==fingerprint) {
          versions.set(p.projectId,{fingerprint,generation:(previous?.generation||0)+1});
          for(const [k,v]of cache)if(v.projectId===p.projectId)cache.delete(k);
          checking.delete(p.projectId);
        }
        const health=j=>cache.get(key(p.projectId,j))?.state || "unknown";
        const materials=productionModel.summarize(p,actionModel);
        const liveRender=renderView(p.projectId);
        projects.push({snapshot:p,plan,outputs,summary:model.summarize({snapshot:p,materialSummary:materials,renderPlan:plan,renderOutputs:outputs,
          productionView:live,renderView:liveRender ? {...liveRender,projectId:liveRender.projectId||p.projectId} : null,activeProjectId:active,health})});
      }
      for(const id of versions.keys())if(!ids.has(id)){versions.delete(id);checking.delete(id);for(const [k,v]of cache)if(v.projectId===id)cache.delete(k);}
      const summaries=projects.map(p=>p.summary),filtered=model.filter(summaries,query,filter);
      selected=model.selection(filtered,selected,active);
      return {projects,summaries,filtered,selected,query,filter,visibleHistory,totals:model.totals(summaries),protected:protectedState(),error,opening};
    }
    function verify(projectId,job,force=false) {
      if(!job.outputPath || job.status!=="completed" || job.fileState!=="available")return Promise.resolve("missing");
      const k=key(projectId,job),old=cache.get(k);
      if(old?.state==="checking")return old.promise;
      if(old&&!force)return Promise.resolve(old.state);
      while(cache.size>=MAX_HEALTH){const evict=[...cache].find(([,v])=>v.state!=="checking");if(!evict)return Promise.resolve("unknown");cache.delete(evict[0]);}
      const token={projectId,jobId:job.id,outputPath:job.outputPath,epoch,generation:versions.get(projectId)?.generation,state:"checking"};
      cache.set(k,token);
      token.promise=Promise.resolve().then(()=>desktop.fileStatus(token.outputPath)).then(r=>{
        if(cache.get(k)!==token || token.epoch!==epoch || versions.get(projectId)?.generation!==token.generation)return "unknown";
        // Exact Project/output still needs to exist when an asynchronous read ends.
        const p=persistence.projectAudioSnapshot(projectId),same=p?.workflow.jobs.some(j=>j.id===token.jobId&&j.projectId===projectId&&j.outputPath===token.outputPath&&j.status==="completed"&&j.fileState==="available");
        if(!same){cache.delete(k);return "unknown";}
        token.state=r?.exists===true&&Number.isFinite(r.sizeBytes)&&r.sizeBytes>0?"available":"missing";return token.state;
      }).catch(()=>{if(cache.get(k)===token)token.state="missing";return "missing";}).finally(notify);
      return token.promise;
    }
    function observe(value=collect()) {
      for(const p of value.projects) {
        if(checking.has(p.snapshot.projectId))continue;
        const candidates=model.history(p.outputs).filter(o=>o.current);
        if(!candidates.length)continue;
        const projectId=p.snapshot.projectId,generation=versions.get(projectId)?.generation,observedEpoch=epoch;
        const task=Promise.resolve().then(async()=>{
          for(const o of candidates){if(epoch!==observedEpoch||versions.get(projectId)?.generation!==generation)break;
            const health=await verify(projectId,o.job);if(health==="available"||health==="unknown")break;}
        });
        checking.set(projectId,task);task.finally(()=>{if(checking.get(projectId)===task)checking.delete(projectId);});
      }
      const detail=value.projects.find(p=>p.snapshot.projectId===value.selected);
      for(const row of (detail?.summary.history||[]).slice(0,visibleHistory))if(row.health==="unknown")verify(value.selected,row.job);
      return value;
    }
    async function open(projectId) {
      if(opening)return false;
      if(protectedState()){error="storageProtected";notify();return false;}
      if(!persistence.listProjects().some(p=>p.projectId===projectId)){error="projectGone";notify();return false;}
      const active=persistence.activeProjectId(),view=productionView();
      if(active!==projectId && view?.run?.projectId===active && ["running","paused"].includes(view.state)){error="materialRunSwitchBlocked";notify();return false;}
      opening=projectId;error=null;notify();
      try {
        if(active!==projectId)await persistence.openProject(projectId);
        if(persistence.activeProjectId()!==projectId)throw Error("PROJECT_MISMATCH");
        route("ai-video");return true;
      } catch(e){error=e.message==="PROJECT_WORK_RUNNING"?"projectWorkRunning":"projectGone";return false;}
      finally{opening=null;notify();}
    }
    async function show(projectId,jobId) {
      error=null;
      const p=persistence.projectAudioSnapshot(projectId),j=p?.workflow.jobs.find(j=>renderModel.scoped(j)&&j.projectId===projectId&&j.id===jobId);
      if(!j || await verify(projectId,j,true)!=="available"){if(selected===projectId)error="outputMissing";notify();return false;}
      const latest=persistence.projectAudioSnapshot(projectId)?.workflow.jobs.find(v=>v.id===jobId&&v.projectId===projectId&&v.outputPath===j.outputPath&&v.fileState==="available"&&v.status==="completed");
      if(!latest){if(selected===projectId)error="outputMissing";notify();return false;}
      try{const result=await desktop.showFile(j.outputPath);if(result?.ok===false)throw Error();return true;}
      catch{if(selected===projectId)error="showFailed";notify();return false;}
    }
    function invalidate(){epoch++;cache.clear();checking.clear();notify();}
    function progress(p){const view=renderView(p?.projectId);if(view?.busy && view.projectId===p.projectId&&view.jobId===p.jobId)notify();}
    return {collect,observe,verify,open,show,invalidate,progress,
      select(id){selected=id;visibleHistory=5;error=null;notify();},search(text){query=String(text).slice(0,512);notify();},filter(value){if(model.FILTERS.includes(value))filter=value;notify();},more(){visibleHistory+=5;notify();},
      cacheSize:()=>cache.size};
  }
  return {create};
});
