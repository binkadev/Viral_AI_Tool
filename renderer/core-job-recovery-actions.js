(function installCoreJobRecoveryActions(){
  "use strict";
  let queued=false;
  function jobs(){try{return Array.isArray(state?.jobs)?state.jobs:[]}catch{return[]}}
  function locale(){try{return state?.locale==="en"?"en":"vi"}catch{return"vi"}}
  function recoverable(job){
    if(!job?.isRenderOutput)return false;
    const status=String(job.status||"").toLowerCase();
    const missing=job.fileState==="missing"||job.fileState==="trashed";
    return missing&&status==="completed";
  }
  function sync(){
    queued=false;
    const map=new Map(jobs().map(job=>[String(job.id||""),job]));
    document.querySelectorAll(".job-menu-button[data-job-menu]").forEach(menuButton=>{
      const id=String(menuButton.dataset.jobMenu||"");
      const job=map.get(id);
      const popover=document.querySelector('[data-job-menu-popover="'+CSS.escape(id)+'"]');
      if(!(popover instanceof HTMLElement))return;
      const existing=popover.querySelector('[data-job-action="retry-export"][data-job-id="'+CSS.escape(id)+'"]');
      if(!recoverable(job)){existing?.remove();return}
      if(existing)return;
      const button=document.createElement("button");
      button.type="button";
      button.dataset.jobAction="retry-export";
      button.dataset.jobId=id;
      button.innerHTML='↻ <span>'+(locale()==="en"?"Render again":"Render lại")+'</span>';
      popover.appendChild(button);
    });
  }
  function queue(){if(queued)return;queued=true;requestAnimationFrame(sync)}
  function start(){
    const page=document.getElementById("page");
    if(page)new MutationObserver(queue).observe(page,{childList:true,subtree:true});
    window.addEventListener("viral-ai:core-state-changed",queue);
    window.addEventListener("focus",queue);
    queue();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
