(function installProjectRender() {
  "use strict";
  const model=window.ViralCoreProjectRenderModel,persistence=window.ViralCoreProjectPersistence;
  if(!model || !persistence)return;
  let queued=false,feedback=null;
  const integrity=new Map(),picking=new Map();
  const active=()=>state.page === "ai-video" && !!window.ViralCorePlayer?.projectPreview?.hasProject();
  const t=(key,vars)=>window.I18N.t(state.locale === "en" ? "en" : "vi","projectRender."+key,vars);
  function projection(project) {
    const canonical=window.ViralCorePlayerModel.buildProjectPlayback(project),live=window.ViralCorePlayer?.projectPreview?.runtime.projection();
    return !canonical.complete && live?.projectId===project.projectId && live.entries.length===canonical.entries.length && live.entries.every((e,i)=>e.sceneId===canonical.entries[i].sceneId&&e.assetId===canonical.entries[i].assetId) ? live : canonical;
  }
  const runtime=window.ViralCoreProjectRenderRuntime.create({model,persistence,desktop:window.desktopAPI,playback:projection,id:()=>"project-render-"+crypto.randomUUID(),changed:queue});
  const errorKey=code=>({PROJECT_RENDER_HISTORY_FULL:"historyFull",PROJECT_RENDER_MEDIA_MISSING:"mediaMissing",PROJECT_RENDER_INCOMPLETE:"incomplete",PROJECT_RENDER_PROFILE_UNRESOLVED:"profileMissing",PROJECT_RENDER_TIMING_INVALID:"timingInvalid",PROJECT_RENDER_INPUT_CHANGED:"inputChanged",PROJECT_RENDER_VOICE_REQUIRED:"voiceRequired",PROJECT_RENDER_VOICE_STALE:"voiceStale",PROJECT_RENDER_BGM_UNAVAILABLE:"bgmUnavailable",PROJECT_RENDER_DUPLICATE:"duplicate",OUTPUT_REQUIRED:"outputRequired",LOW_DISK_SPACE:"lowDisk",PROJECT_NOT_FOUND:"ownerMissing",PROJECT_MISMATCH:"ownerMissing",PROJECT_RENDER_CANCEL_FAILED:"cancelFailed"}[code] || "failed");
  async function start(projectId=persistence.activeProjectId()) {
    if(projectId !== persistence.activeProjectId() || !active()){feedback="ownerMissing";queue();return {ok:false};}
    feedback=null;
    if(!state.output) {
      if(!picking.has(projectId)) {
        const selection=Promise.resolve().then(()=>window.desktopAPI.selectOutputFolder()).finally(()=>picking.delete(projectId));
        picking.set(projectId,selection);
      }
      const output=await picking.get(projectId);
      if(!output)return {ok:false};
      if(projectId !== persistence.activeProjectId()){feedback="ownerMissing";queue();return {ok:false};}
      state.output=output;save();persistence.flush();
    }
    return runtime.start(projectId,state.output);
  }
  function presentation() {
    const p=persistence.snapshot();if(!p)return null;
    const plan=model.build(p,projection(p)),view=runtime.view(p.projectId),all=model.outputs(p,plan),last=all.at(-1)?.job;
    const current=all.some(o=>o.current&&integrity.get(o.job.outputPath)==="available");
    const status=view.busy ? "processing" : ["failed","interrupted"].includes(last?.status) ? "failed" : last?.status === "cancelled" ? "cancelled" : current ? "completed" : plan.ready ? "active" : "blocked";
    return {status,reason:t(view.busy ? view.state : current ? "ready" : plan.reason ? errorKey(plan.reason) : "canRender")};
  }
  window.ViralCoreProjectRender={active,start,runtime,presentation};
  window.desktopAPI?.onRenderProgress?.(runtime.progress);
  const text=(node,value)=>{if(node.textContent !== value)node.textContent=value;};
  function queue(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
  function refresh(){
    queued=false;
    const pane=document.querySelector('[data-inspector-pane="output"]');
    if(!active()){document.querySelectorAll("[data-project-render]").forEach(n=>n.remove());return;}
    const project=persistence.snapshot();if(!project)return;
    const plan=model.build(project,projection(project)),view=runtime.view(project.projectId),outputs=model.outputs(project,plan),latest=outputs.at(-1);
    for(const o of outputs) {
      const j=o.job;
      if(j.status !== "completed" || j.fileState !== "available" || !j.outputPath)continue;
      if(!integrity.has(j.outputPath)) {
        const file=j.outputPath;integrity.set(file,"checking");
        Promise.resolve(window.desktopAPI.fileStatus(file)).then(r=>{integrity.set(file,r?.exists===true && r.sizeBytes>0 ? "available" : "missing");}).catch(()=>{integrity.set(file,"missing");}).finally(queue);
      }
      if(integrity.get(j.outputPath)!=="available")o.current=false;
    }
    const current=outputs.findLast(o=>o.current);
    for(const button of document.querySelectorAll("#render, #export")) {
      text(button,t("render"));button.disabled=view.busy || !plan.ready;button.setAttribute("aria-disabled",String(button.disabled));
      button.dataset.coreCapability=button.disabled ? "disabled" : "functional";delete button.dataset.coreDisabledReason;
      button.title=plan.reason ? t(errorKey(plan.reason)) : t("render");
    }
    if(!pane)return;
    // Project status replaces the legacy source-output card in this inspector.
    pane.querySelectorAll(".core-output-state-card,.core-output-state-hint").forEach(n=>{n.hidden=true;});
    let host=pane.querySelector("[data-project-render]");
    if(!host){host=document.createElement("section");host.dataset.projectRender="true";host.className="core-project-render";
      const title=document.createElement("h3"),status=document.createElement("p"),details=document.createElement("p"),cancel=document.createElement("button"),show=document.createElement("button"),retry=document.createElement("button");
      title.dataset.renderTitle="";status.dataset.renderStatus="";status.setAttribute("role","status");status.setAttribute("aria-live","polite");details.dataset.renderDetails="";
      cancel.dataset.renderCancel="";show.dataset.renderShow="";retry.dataset.renderAgain="";
      for(const b of [cancel,show,retry]){b.type="button";b.className="button ghost";}
      host.append(title,status,details,cancel,show,retry);pane.prepend(host);}
    const lastJob=latest?.job,shown=current?.job || lastJob;
    const fileState=shown?.outputPath ? integrity.get(shown.outputPath) : null;
    const status=feedback || (view.error ? errorKey(view.error) : view.busy ? view.state : ["failed","cancelled","interrupted"].includes(lastJob?.status) ? lastJob.status : fileState === "checking" ? "checkingOutput" : fileState === "missing" ? "outputMissing" : current ? "ready" : lastJob?.status === "completed" ? "previous" : plan.reason ? errorKey(plan.reason) : "canRender");
    text(host.querySelector("[data-render-title]"),t("render"));
    text(host.querySelector("[data-render-status]"),t(status)+(view.busy ? " · "+Math.floor(view.percent||0)+"%" : ""));
    text(host.querySelector("[data-render-details]"),view.state === "scenes" ? t("sceneCount",{index:view.sceneIndex||0,count:view.sceneCount||plan.scenes.length}) : shown?.status === "completed" ? (shown.renderInputSignature === plan.renderInputSignature ? shown.name : t("changed"))+" · "+shown.outputPath.split(/[\\/]/).at(-1) : "");
    const cancel=host.querySelector("[data-render-cancel]");text(cancel,t("cancel"));cancel.hidden=!view.busy;cancel.disabled=view.state === "cancelling";cancel.onclick=()=>runtime.cancel(project.projectId);
    const show=host.querySelector("[data-render-show]");text(show,t("show"));show.hidden=shown?.status !== "completed" || shown?.fileState !== "available" || fileState !== "available";show.onclick=()=>revealJobFile(state.jobs.find(j=>j.id === shown.id));
    const retry=host.querySelector("[data-render-again]");text(retry,t(lastJob ? "again" : "render"));retry.disabled=view.busy || !plan.ready;retry.onclick=()=>start(project.projectId);
  }
  window.addEventListener("focus",()=>{integrity.clear();queue();});
  window.addEventListener("viral-ai:project-snapshot-restored",()=>{feedback=null;integrity.clear();queue();});
  for(const event of ["viral-ai:core-state-changed","viral-ai:project-snapshot-saved","viral-ai:project-timeline-rendered"])window.addEventListener(event,queue);
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.("#render,#export,[data-inspector-pane]") || n.querySelector?.("#render,#export,[data-inspector-pane]")))))queue();}).observe(document.getElementById("page"),{childList:true,subtree:true});
  queue();
})();
