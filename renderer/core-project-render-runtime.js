(function attach(root,factory) {
  const api=factory(); if (typeof module !== "undefined" && module.exports) module.exports=api;
  if(root) root.ViralCoreProjectRenderRuntime=api;
})(typeof window !== "undefined" ? window : globalThis,function() {
  "use strict";
  // validating -> admitted/processing -> cancelling -> terminal. Ownership is
  // captured before await and survives editor disposal/Project switching.
  function create({model,persistence,desktop,id,playback,changed=()=>{}}) {
    const pending=new Map(),failures=new Map();
    const notify=()=>{try{changed();}catch{}};
    const snapshot=projectId=>persistence.projectAudioSnapshot(projectId);
    const plan=projectId=>{const p=snapshot(projectId);return model.build(p,playback?.(p));};
    function start(projectId,outputDir) {
      if(pending.has(projectId)) return pending.get(projectId).promise;
      let input,jobId;
      try {
        if(persistence.activeProjectId() !== projectId) throw Error("PROJECT_MISMATCH");
        persistence.flush(); input=plan(projectId);
        if(!input.ready) throw Error(input.reason);
        if(!outputDir) throw Error("OUTPUT_REQUIRED");
        if(model.outputs(snapshot(projectId),input).some(({job})=>job.renderInputSignature===input.renderInputSignature && model.ACTIVE.includes(job.status))) throw Error("PROJECT_RENDER_DUPLICATE");
        jobId=id();
      } catch(e) {failures.set(projectId,e.message);notify();return Promise.resolve({ok:false,reason:e.message});}
      const request=model.payload(input); request.jobId=jobId; request.outputDir=outputDir;
      const freeze=value=>{if(value && typeof value === "object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(request);
      const task={jobId,projectId,state:"validating",percent:0,admitted:false,terminalAttempted:false};
      pending.set(projectId,task); failures.delete(projectId);
      task.promise=Promise.resolve().then(async()=>{
        try {
          const checked=await desktop.preflightProjectRender(request);
          if(task.cancelRequested) return {ok:true,cancelled:true};
          if(!checked?.ok) throw Error(checked?.error?.code || "PROCESSING_FAILED");
          if(persistence.activeProjectId() !== projectId) throw Error("PROJECT_MISMATCH");
          persistence.flush();
          if(plan(projectId).renderInputSignature !== input.renderInputSignature) throw Error("PROJECT_RENDER_INPUT_CHANGED");
          persistence.updateProjectRender(projectId,{action:"admit",playback:input.playback,job:{id:jobId,isRenderOutput:true,renderKind:"project",projectId,renderInputSignature:input.renderInputSignature}});
          task.admitted=true;task.state="preparing";notify();
          const response=await desktop.renderProjectVideo(request);
          if(task.cancelPromise) await task.cancelPromise;
          if(!response?.ok) throw Error(response?.error?.code || "PROCESSING_FAILED");
          const result=response.data,status=result?.cancelled ? "cancelled" : "completed";
          task.terminalAttempted=true;
          persistence.updateProjectRender(projectId,{action:"terminal",jobId,status,...(status === "completed" ? {result} : {})});
          return {ok:true,cancelled:status === "cancelled"};
        } catch(e) {
          failures.set(projectId,e.message);
          if(task.admitted && !task.terminalAttempted) {
            task.terminalAttempted=true;
            try {persistence.updateProjectRender(projectId,{action:"terminal",jobId,status:"failed",failureCode:e.message});}
            catch(err) {failures.set(projectId,err.message || "PROJECT_SAVE_FAILED");}
          }
          return {ok:false,reason:failures.get(projectId)};
        } finally {pending.delete(projectId);notify();}
      });
      notify();return task.promise;
    }
    function cancel(projectId) {
      const task=pending.get(projectId);if(!task)return Promise.resolve(false);
      if(!task.admitted){task.cancelRequested=true;task.state="cancelling";notify();return Promise.resolve(true);}
      if(task.cancelPromise)return task.cancelPromise;
      task.state="cancelling";notify();
      task.cancelPromise=Promise.resolve().then(()=>desktop.cancelRender(task.jobId)).then(r=>{
        if(!r?.ok || !r.cancelled) {task.state="processing";failures.set(projectId,"PROJECT_RENDER_CANCEL_FAILED");return false;}return true;
      }).catch(()=>{task.state="processing";failures.set(projectId,"PROJECT_RENDER_CANCEL_FAILED");return false;}).finally(notify);
      return task.cancelPromise;
    }
    function progress(p) {
      const task=pending.get(p?.projectId);
      if(!task || task.jobId !== p.jobId || !task.admitted || task.state === "cancelling" || !["preparing","scenes","voice","audio","composing","finalizing","verifying"].includes(p.phase))return;
      task.state=p.phase;task.percent=Number.isFinite(p.percent) ? Math.max(task.percent,Math.min(99,p.percent)) : task.percent;
      task.sceneIndex=p.sceneIndex;task.sceneCount=p.sceneCount;notify();
    }
    return {start,cancel,progress,plan,view(projectId){const t=pending.get(projectId);return {...t,promise:undefined,cancelPromise:undefined,busy:!!t,error:failures.get(projectId)||null};}};
  }
  return {create};
});
