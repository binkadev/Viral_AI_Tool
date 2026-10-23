"use strict";
// Separate from automatic execution/receipts. No URL or selector is a command.
(function(root) {
  const VERSION=1,TTL=120000,MAX_CANDIDATES=8,MAX_BYTES=268435456,CHUNK_BYTES=196608;
  const opaque=v=>typeof v==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
  const id=v=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
  const hash=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
  const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
  const commands=['listRecoveryCandidates','revealRecoveryCandidate','validateRecoveryCandidate','acquireRecoveryCandidate','dismissRecovery'];
  const tokenKeys=['selectionSessionId','candidateId','documentEpoch','revision'];
  const token=p=>tokenKeys.every(k=>opaque(p?.[k]));
  const metadata=v=>Number.isFinite(v.duration) && v.duration>0 && v.duration<=86400 &&
    ['width','height'].every(k=>Number.isSafeInteger(v[k]) && v[k]>0 && v[k]<=32768) && Number.isInteger(v.readyState) && v.readyState>=2 && v.readyState<=4;
  function request(type,p,{content=false}={}) {
    const keys=['tabId','operationId','projectId','sceneId',...(content?['observationToken']:[])];
    if(!commands.includes(type) || !Number.isSafeInteger(p?.tabId) || p.tabId<1 || ![p.operationId,p.projectId,p.sceneId].every(id) || content && !id(p.observationToken))return false;
    if(['listRecoveryCandidates','dismissRecovery'].includes(type))return exact(p,keys);
    if(!token(p))return false;
    if(type!=='acquireRecoveryCandidate')return exact(p,[...keys,...tokenKeys]);
    return exact(p,[...keys,...tokenKeys,'resolutionId','transferId','sequence','offset','mediaKind','abort']) && opaque(p.resolutionId) && opaque(p.transferId) &&
      p.mediaKind==='video' && Number.isSafeInteger(p.sequence) && p.sequence>=0 && p.sequence<=MAX_BYTES &&
      Number.isSafeInteger(p.offset) && p.offset>=0 && p.offset<=MAX_BYTES && (p.abort===undefined || p.abort===true);
  }
  function chunk(r,p) {
    if(r.transferId!==p.transferId || r.sequence!==p.sequence || r.offset!==p.offset || typeof r.done!=='boolean' || !hash(r.chunkHash) ||
      typeof r.data!=='string' || r.data.length>262144 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.data))return false;
    const bytes=r.data.length/4*3-(r.data.endsWith('==')?2:r.data.endsWith('=')?1:0);
    return bytes<=CHUNK_BYTES && p.offset+bytes<=MAX_BYTES && (r.done?Number.isSafeInteger(r.total) && r.total>=12 && r.total===p.offset+bytes:r.total===null && bytes>0);
  }
  function result(type,r,p) {
    const base=['operationId','projectId','sceneId','state'];
    if(!r || r.operationId!==p.operationId || r.projectId!==p.projectId || r.sceneId!==p.sceneId)return false;
    if(r.state==='unavailable')return exact(r,[...base,'reason']) && ['CHANGED','TOO_MANY','UNAVAILABLE'].includes(r.reason);
    if(type==='dismissRecovery')return r.state==='dismissed' && exact(r,base);
    if(type==='listRecoveryCandidates')return r.state==='candidates' && exact(r,[...base,'version','selectionSessionId','documentEpoch','revision','expiresAt','documentContextDigest','candidates']) &&
      r.version===VERSION && ['selectionSessionId','documentEpoch','revision'].every(k=>opaque(r[k])) && Number.isSafeInteger(r.expiresAt) && hash(r.documentContextDigest) &&
      Array.isArray(r.candidates) && r.candidates.length<=MAX_CANDIDATES && new Set(r.candidates.map(c=>c?.candidateId)).size===r.candidates.length &&
      r.candidates.every(c=>exact(c,['candidateId','descriptorHash','duration','width','height','readyState','available']) && opaque(c.candidateId) && hash(c.descriptorHash) && metadata(c) && c.available===true);
    if(type==='acquireRecoveryCandidate')return r.state==='result' && exact(r,[...base,'transferId','sequence','offset','total','done','chunkHash','data']) && chunk(r,p);
    return r.state===(type==='revealRecoveryCandidate'?'revealed':'validated') && exact(r,[...base,...tokenKeys]) && tokenKeys.every(k=>r[k]===p[k]);
  }
  const api={VERSION,TTL,MAX_CANDIDATES,MAX_BYTES,CHUNK_BYTES,opaque,id,hash,exact,commands,tokenKeys,token,metadata,request,result,chunk};
  if(typeof module==='object' && module.exports)module.exports=api;else root.MuseManualRecoveryContract=Object.freeze(api);
})(globalThis);
