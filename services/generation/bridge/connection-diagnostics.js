"use strict";
// Private development-only scalar schema. Never returned through renderer IPC.
const booleans=['serviceWorkerAlive','museContentScriptHeartbeatSeen','museContentScriptHandshakeSeen','museTabEvidenceFresh','composerDetected','authenticatedEvidencePresent','generationActiveEvidencePresent','hostPatternMatched'];
const contentErrors=['NONE','NO_RECEIVER','RESPONSE_TIMEOUT','MESSAGE_FAILED','EMPTY_RESPONSE','STATUS_EXCEPTION'];
const bridgeErrors=['NONE','HTTP_400','HTTP_401','HTTP_403','HTTP_409','HTTP_OTHER','BRIDGE_TIMEOUT','BRIDGE_UNREACHABLE'];
function validDiagnostic(value) {
  if(value && ['workerBuild','contentBuild','generationActive'].some(k=>Object.prototype.hasOwnProperty.call(value,k))) {
    if(!/^muse-worker-[a-z0-9-]{1,64}$/.test(value.workerBuild||'') || !(value.contentBuild==='unreported' || /^muse-content-[a-z0-9-]{1,64}$/.test(value.contentBuild||'')) || typeof value.generationActive!=='boolean')return false;
    const {workerBuild,contentBuild,generationActive,...legacy}=value;
    return validDiagnostic(legacy);
  }
  const keys=[...booleans,'museContentScriptContractVersion','museTabEvidenceAgeBucket','lastContentScriptErrorCode','lastBridgeErrorCode'];
  return value && Object.getPrototypeOf(value)===Object.prototype && Object.keys(value).length===keys.length && Object.keys(value).every(k=>keys.includes(k)) && booleans.every(k=>typeof value[k]==='boolean') && Number.isInteger(value.museContentScriptContractVersion) && value.museContentScriptContractVersion>=0 && value.museContentScriptContractVersion<=100 && ['absent','fresh','stale'].includes(value.museTabEvidenceAgeBucket) && contentErrors.includes(value.lastContentScriptErrorCode) && bridgeErrors.includes(value.lastBridgeErrorCode);
}
function validRuntimeBuild(value) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===2 &&
    Object.keys(value).every(k=>['workerBuild','contentBuild'].includes(k)) &&
    /^muse-worker-[a-z0-9-]{1,64}$/.test(value.workerBuild||'') &&
    (value.contentBuild==='unreported' || /^muse-content-[a-z0-9-]{1,64}$/.test(value.contentBuild||''));
}
module.exports={validDiagnostic,validRuntimeBuild};
