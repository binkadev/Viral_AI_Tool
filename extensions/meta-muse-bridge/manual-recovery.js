"use strict";
// All authority here is ephemeral exact DOM identity, never automatic ownership.
(function(root) {
  function create({contract:C,uuid,hash,now=Date.now,live,enumerate,describe,watch,reveal,close}) {
    let retained=null,session=null,stopWatch=null,timer=null;
    const documentEpoch=uuid();
    function revoke() {
      if(session)session.revoked=true;
      clearTimeout(timer);timer=null;stopWatch?.();stopWatch=null;
      if(session)close?.(session);
      session=null;
    }
    function retain(binding,container) {revoke();retained={...binding,container};}
    function reset() {revoke();retained=null;}
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function context(p) {
      if(!retained || retained.operationId!==p.operationId || retained.sceneId!==p.sceneId || retained.tabId!==p.tabId || retained.projectId && retained.projectId!==p.projectId || retained.observationToken!==p.observationToken || !live(retained))throw Error('CHANGED');
      return retained;
    }
    function validate(p,allowConsumed=false) {
      const r=context(p),s=session;
      if(!s || s.revoked || now()>=s.expiresAt || s.projectId!==p.projectId || !C.tokenKeys.filter(k=>k!=='candidateId').every(k=>s[k]===p[k]) || s.consumed && !allowConsumed)throw Error('CHANGED');
      const nodes=enumerate(r.container);
      if(nodes.length!==s.nodes.length || nodes.some((node,i)=>node!==s.nodes[i] || !same(describe(node),s.descriptors[i])))throw Error('CHANGED');
      const index=s.candidates.findIndex(c=>c.candidateId===p.candidateId);
      if(index<0 || s.consumed && s.consumed!==p.candidateId)throw Error('CHANGED');
      return {s,node:s.nodes[index],descriptor:s.descriptors[index],index};
    }
    async function list(p) {
      if(session)throw Error('UNAVAILABLE');
      const r=context(p),nodes=enumerate(r.container),descriptors=nodes.map(describe);
      r.projectId=p.projectId;
      const eligible=descriptors.map((d,i)=>C.metadata(d) && d.blob===true && !d.srcObject?i:-1).filter(i=>i>=0);
      if(eligible.length>C.MAX_CANDIDATES)throw Error('TOO_MANY');
      if(nodes.length>128)throw Error('UNAVAILABLE');
      const s={version:C.VERSION,operationId:p.operationId,projectId:p.projectId,sceneId:p.sceneId,selectionSessionId:uuid(),documentEpoch,revision:uuid(),expiresAt:now()+C.TTL,
        nodes,descriptors,candidates:[],revoked:false,consumed:null,revealed:new Set()};
      session=s;
      // Observe BEFORE asynchronous hashing; even transient removal is terminal.
      stopWatch=watch(()=>revoke(),r,s);
      timer=setTimeout(revoke,C.TTL);timer.unref?.();
      try {
        // A quiet mounted revision is required after generation controls stop.
        // Any mutation in this interval revokes rather than settling/adopting it.
        await new Promise(resolve=>setTimeout(resolve,250));
        s.documentContextDigest=await hash(JSON.stringify([documentEpoch,r.observationToken,p.tabId,p.operationId,p.projectId,p.sceneId]));
        for(const i of eligible)s.candidates.push({candidateId:uuid(),descriptorHash:await hash(JSON.stringify(descriptors[i])),duration:descriptors[i].duration,width:descriptors[i].width,height:descriptors[i].height,readyState:descriptors[i].readyState,available:true,nodeIndex:i});
        context(p);if(session!==s || now()>=s.expiresAt)throw Error('CHANGED');
        const current=enumerate(r.container);
        if(current.length!==nodes.length || current.some((n,i)=>n!==nodes[i] || !same(describe(n),descriptors[i])))throw Error('CHANGED');
        // Return audit/metadata only; source descriptors stay private.
        return {version:s.version,selectionSessionId:s.selectionSessionId,documentEpoch,revision:s.revision,expiresAt:s.expiresAt,documentContextDigest:s.documentContextDigest,
          candidates:s.candidates.map(({nodeIndex,...c})=>c)};
      }catch(error){revoke();throw error;}
    }
    function selected(p,allowConsumed=false) {
      try {
        const item=validate(p,allowConsumed),entry=item.s.candidates.find(c=>c.candidateId===p.candidateId);
        if(!entry)throw Error('CHANGED');
        return {...item,node:item.s.nodes[entry.nodeIndex],descriptor:item.s.descriptors[entry.nodeIndex],index:item.s.candidates.indexOf(entry)};
      }catch(error){revoke();throw error;}
    }
    async function view(p) {
      const item=selected(p);await reveal(item.node,item.index+1);
      const fresh=selected(p);if(fresh.node!==item.node)throw Error('CHANGED');
      fresh.s.revealed.add(p.candidateId);
    }
    function authorize(p,{consume=false,transfer=false}={}) {
      const item=selected(p,transfer);
      if(!item.s.revealed.has(p.candidateId))throw Error('CHANGED');
      if(consume){if(item.s.consumed)throw Error('CHANGED');item.s.consumed=p.candidateId;}
      return item;
    }
    function dismiss(p){context(p);revoke();}
    return {retain,reset,revoke,list,view,authorize,dismiss,get active(){return !!session;},get documentEpoch(){return documentEpoch;}};
  }
  if(typeof module==='object' && module.exports)module.exports={create};else root.MuseManualRecovery={create};
})(globalThis);
