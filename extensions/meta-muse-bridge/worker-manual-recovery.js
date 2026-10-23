"use strict";
function createMuseManualWorker({C,epoch,send,focus}) {
  let retained=null,session=null;
  function reset(){retained=null;session=null;}
  function retain(p){reset();retained={operationId:p.operationId,sceneId:p.sceneId,tabId:p.tabId,epoch:epoch(),projectId:null};}
  const unavailable=p=>({operationId:p.operationId,projectId:p.projectId,sceneId:p.sceneId,state:'unavailable',reason:'CHANGED'});
  async function execute(type,p) {
    if(!C.request(type,p) || !retained || retained.epoch!==epoch() || ['operationId','sceneId','tabId'].some(k=>retained[k]!==p[k]) || retained.projectId && retained.projectId!==p.projectId)return unavailable(p);
    if(type==='listRecoveryCandidates') {
      if(session)return unavailable(p);
      retained.projectId=p.projectId;session={pending:true};
    }else if(type!=='dismissRecovery' && (!session || session.pending || Date.now()>=session.expiresAt || !C.tokenKeys.filter(k=>k!=='candidateId').every(k=>session[k]===p[k]) || !session.candidates.some(v=>v.candidateId===p.candidateId))) {session=null;return unavailable(p);}
    try {
      if(type==='revealRecoveryCandidate')await focus(p.tabId);
      const result=await send(p.tabId,{type:'viral-ai:muse-manual-recovery',command:type,payload:{...p,observationToken:retained.epoch}});
      if(!C.result(type,result,p))throw Error('INVALID');
      if(type==='listRecoveryCandidates' && result.state==='candidates')session=result;
      else if(type==='dismissRecovery' || result.state==='unavailable')session=null;
      return result;
    }catch{session=null;return unavailable(p);}
  }
  return {retain,reset,execute};
}
