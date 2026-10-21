"use strict";
// Installed in the same isolated content world; no page API is exposed.
function installMuseManualRecovery(env) {
  const C=MuseManualRecoveryContract;
  globalThis.__viralMuseRecovery?.reset();
  let marker=null,highlight=null,oldOutline='';
  let prepared=null;
  const positionMarker=()=>{
    if(!marker || !highlight)return;
    const rect=highlight.getBoundingClientRect();
    marker.style.left=Math.max(0,rect.left)+'px';marker.style.top=Math.max(0,rect.top)+'px';
    marker.style.display=rect.bottom<0 || rect.right<0 || rect.top>window.innerHeight || rect.left>window.innerWidth?'none':'block';
  };
  const unhighlight=()=>{document.removeEventListener('scroll',positionMarker,true);window.removeEventListener('resize',positionMarker);marker?.remove();marker=null;if(highlight){highlight.style.outline=oldOutline;highlight=null;}};
  const descriptor=video=>({source:video.currentSrc,attribute:video.getAttribute('src'),sources:[...video.querySelectorAll('source')].map(n=>[n,n.getAttribute('src'),n.getAttribute('type')]).map(([,src,type])=>({src,type})),
    blob:(()=>{try{return new URL(video.currentSrc).protocol==='blob:' && new URL(video.currentSrc).origin==='https://muse.ai';}catch{return false;}})(),
    srcObject:!!video.srcObject,duration:video.duration,width:video.videoWidth,height:video.videoHeight,readyState:video.readyState});
  const live=r=>{
    const current=env.composer();
    return r.container?.isConnected===true && r.href===location.href && location.origin==='https://muse.ai' && document.readyState==='complete' &&
      current?.root?.isConnected && env.visible(current.root) && env.visible(current.editor) && !current.editor.disabled && !current.editor.readOnly &&
      current.editor.getAttribute('aria-readonly')!=='true' && (current.editor.tagName==='TEXTAREA' || current.editor.isContentEditable) && !env.generationActive() && !env.autoBusy();
  };
  const controller=MuseManualRecovery.create({contract:C,uuid:()=>crypto.randomUUID(),hash:async value=>{
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
  },observe:(type,p,privateIds)=>{
    try{
      const audit=typeof contentAudit==='undefined'?null:contentAudit;
      if(!audit)return;
      const detail={sessionAlias:audit.alias(p.operationId,privateIds.session)};
      if(privateIds.candidate)detail.candidateAlias=audit.alias(p.operationId,privateIds.candidate);
      audit.observe(p.operationId,type,detail);
    }catch{try{contentAudit?.gap(p.operationId);}catch{}}
  },live,enumerate:container=>[...container.querySelectorAll('video')],describe:descriptor,
    close:()=>{unhighlight();for(const t of env.transfers.values())if(t.manual)env.closeTransfer(t);},
    reveal:(node,index)=>{
      unhighlight();node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      highlight=node;oldOutline=node.style.outline;node.style.outline='4px solid #67e8f9';
      const rect=node.getBoundingClientRect();
      if(!node.isConnected || rect.width<=0 || rect.height<=0 || getComputedStyle(node).visibility==='hidden' || getComputedStyle(node).display==='none')throw Error('CHANGED');
      marker=document.createElement('div');marker.textContent=String(index);marker.setAttribute('aria-hidden','true');
      Object.assign(marker.style,{position:'fixed',left:Math.max(0,rect.left)+'px',top:Math.max(0,rect.top)+'px',padding:'8px 12px',background:'#083344',color:'#cffafe',fontSize:'20px',zIndex:'2147483647',pointerEvents:'none'});
      document.documentElement.appendChild(marker);
      positionMarker();document.addEventListener('scroll',positionMarker,true);window.addEventListener('resize',positionMarker);
    },
    watch:(invalidate,r,s)=>{
      const root=env.composer()?.root;
      const check=records=>{
        if(!live(r) || env.composer()?.root!==root || records.some(m=>r.container.contains(m.target) || [...(m.removedNodes||[])].some(n=>n===r.container || n.contains?.(r.container)) ||
          m.type==='childList' && [...(m.addedNodes||[]),...(m.removedNodes||[])].some(n=>n.matches?.(env.STOP) || n.querySelector?.(env.STOP))))invalidate();
      };
      const observer=new MutationObserver(check);
      observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','type','data-message-id','data-message-role','data-message-item','data-testid']});
      const activity=e=>{if(e.isTrusted && root?.contains(e.target))invalidate();};
      const media=()=>invalidate(),navigate=()=>invalidate();
      for(const type of ['input','click','keydown','pointerdown'])document.addEventListener(type,activity,true);
      for(const node of s.nodes)for(const type of ['emptied','loadedmetadata','durationchange','error'])node.addEventListener(type,media);
      for(const type of ['pagehide','popstate','hashchange'])window.addEventListener(type,navigate);
      const tick=setInterval(()=>check([]),100);
      return ()=>{observer.disconnect();clearInterval(tick);for(const type of ['input','click','keydown','pointerdown'])document.removeEventListener(type,activity,true);
        for(const node of s.nodes)for(const type of ['emptied','loadedmetadata','durationchange','error'])node.removeEventListener(type,media);
        for(const type of ['pagehide','popstate','hashchange'])window.removeEventListener(type,navigate);};
    }
  });
  globalThis.__viralMuseRecovery=controller;
  const reply=(p,state,extra={})=>({operationId:p.operationId,projectId:p.projectId,sceneId:p.sceneId,state,...extra});
  const token=p=>Object.fromEntries(C.tokenKeys.map(k=>[k,p[k]]));
  async function acquire(p) {
    let t=env.transfers.get(p.transferId);
    if(t && (!t.manual || t.operationId!==p.operationId || t.projectId!==p.projectId || t.sceneId!==p.sceneId))throw Error('CHANGED');
    if(p.abort){if(t)env.closeTransfer(t);controller.revoke();return reply(p,'unavailable',{reason:'CHANGED'});}
    if(t?.busy)throw Error('CHANGED');
    if(t)t.busy=true;
    try {
      if(!t) {
        if(p.offset!==0 || p.sequence!==0 || env.transfers.size || env.closedTransfers.has(p.transferId))throw Error('CHANGED');
        const {node,descriptor}=controller.authorize(p,{consume:true});
        t={id:p.transferId,manual:true,operationId:p.operationId,projectId:p.projectId,sceneId:p.sceneId,resolutionId:p.resolutionId,token:token(p),video:node,source:descriptor.source,
          offset:0,sequence:0,started:Date.now(),controller:new AbortController(),pending:new Uint8Array(0),ended:false,busy:true};
        env.transfers.set(t.id,t);t.timer=setTimeout(()=>env.closeTransfer(t),15000);
        const response=await fetch(t.source,{credentials:'same-origin',redirect:'error',signal:t.controller.signal});
        if(!response.ok || response.redirected || response.url && response.url!==t.source || !['video/mp4','application/octet-stream'].includes((response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()))throw Error('CHANGED');
        const length=response.headers.get('content-length');t.expected=length===null?null:Number(length);
        if(t.expected!==null && (!Number.isSafeInteger(t.expected) || t.expected<12 || t.expected>C.MAX_BYTES))throw Error('CHANGED');
        t.reader=response.body.getReader();
      }
      const validate=()=>{const item=controller.authorize(p,{transfer:true});return item.node===t.video && item.descriptor.source===t.source;};
      if(t.controller.signal.aborted || Date.now()-t.started>300000 || t.offset!==p.offset || t.sequence!==p.sequence || t.resolutionId!==p.resolutionId || !C.tokenKeys.every(k=>t.token[k]===p[k]) || !validate())throw Error('CHANGED');
      clearTimeout(t.timer);t.timer=setTimeout(()=>env.closeTransfer(t),15000);
      const result=await env.readChunk(t,p,validate,{projectId:p.projectId});
      if(!validate())throw Error('CHANGED'); // Includes mutation during chunk hashing.
      return result;
    }catch(error){if(t)env.closeTransfer(t);controller.revoke();throw error;}
  }
  return {controller,prepare:p=>{controller.reset();prepared={operationId:p.operationId,sceneId:p.sceneId,tabId:p.tabId,observationToken:p.observationToken};},
    retain:(id,op)=>{if(op.projection?.container && prepared?.operationId===id && prepared.sceneId===op.sceneId && prepared.observationToken===op.observationToken)controller.retain({...prepared,href:location.href},op.projection.container);},
    async execute(type,p) {
      if(!C.request(type,p,{content:true}))return reply(p,'unavailable',{reason:'UNAVAILABLE'});
      try {
        if(type==='listRecoveryCandidates')return reply(p,'candidates',await controller.list(p));
        if(type==='dismissRecovery'){controller.dismiss(p);return reply(p,'dismissed');}
        if(type==='revealRecoveryCandidate'){await controller.view(p);return reply(p,'revealed',token(p));}
        if(type==='validateRecoveryCandidate'){controller.authorize(p);return reply(p,'validated',token(p));}
        return await acquire(p);
      }catch(error){if(error.message!=='TOO_MANY')controller.revoke();return reply(p,'unavailable',{reason:error.message==='TOO_MANY'?'TOO_MANY':'CHANGED'});}
    }
  };
}
