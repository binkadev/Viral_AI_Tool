"use strict";
const {failure}=require('../generation-job');
const defaults=require('./extension-distribution.json');
const REASONS=Object.freeze(['PROVIDER_UNREADY','INSTANCE_MISSING','RECEIVER_MISSING','WORKER_BUILD_MISMATCH','CONTENT_BUILD_MISMATCH','HEARTBEAT_UNPROVEN','CONTRACT_MISMATCH','RECEIPT_MISMATCH','AUTHENTICATION_UNPROVEN','COMPOSER_UNPROVEN','GENERATION_ACTIVE_OR_UNKNOWN','BUILD_PREFLIGHT_FAILED','EXTENSION_DIAGNOSTICS_DISABLED']);
const expected=()=>({extensionVersion:defaults.expectedExtensionVersion,workerBuild:defaults.expectedWorkerBuild,contentBuild:defaults.expectedContentBuild,executionContract:3,receiptVersion:2});
function mismatchesFor(r,buildReady){
  return REASONS.filter((_,i)=>[
    !r.providerReady,!r.instanceExists,!r.receiverExists,r.workerBuild!==defaults.expectedWorkerBuild,r.contentBuild!==defaults.expectedContentBuild,
    !r.heartbeatFresh,r.executionContract!==3,r.receiptVersion!==2,!r.authenticated,!r.composerReady,r.generationActive!==false,!buildReady,!r.extensionDiagnostics
  ][i]);
}
function createReport({connection,build,receiver,providerReady}) {
  const runtime={providerReady:providerReady===true,instanceExists:connection.extensionInstanceRegistered===true,
    extensionDiagnostics:receiver?.diagnosticsEnabled===true,receiverExists:!!receiver,workerBuild:receiver?.workerBuild==='unreported'?null:receiver?.workerBuild??null,
    contentBuild:receiver?.contentBuild==='unreported'?null:receiver?.contentBuild??null,
    heartbeatFresh:connection.localhostBridgeConnected===true && receiver?.freshness==='fresh' && receiver?.reachable===true,
    executionContract:receiver?.contract===3?3:null,receiptVersion:receiver?.receiptVersion===2?2:null,
    authenticated:receiver?.authenticated===true,composerReady:receiver?.composerDetected===true,
    generationActive:typeof receiver?.generationActive==='boolean'?receiver.generationActive:null};
  const buildVerified=build.ready===true,mismatches=mismatchesFor(runtime,buildVerified);
  return {readyForControlledE2E:mismatches.length===0,expected:expected(),runtime,buildVerified,mismatches};
}
function sanitizeReport(input) {
  // Rebuild the complete allowlisted result at the service boundary. Never relay
  // session identifiers, paths, ports, URLs, raw errors or arbitrary adapter keys.
  const r=input?.runtime;
  if(!r || !['providerReady','instanceExists','receiverExists','heartbeatFresh','authenticated','composerReady','extensionDiagnostics'].every(k=>typeof r[k]==='boolean') ||
    ![true,false,null].includes(r.generationActive) || ![3,null].includes(r.executionContract) || ![2,null].includes(r.receiptVersion) ||
    !(r.workerBuild===null || typeof r.workerBuild==='string' && /^muse-worker-[a-z0-9-]{1,64}$/.test(r.workerBuild)) ||
    !(r.contentBuild===null || typeof r.contentBuild==='string' && /^muse-content-[a-z0-9-]{1,64}$/.test(r.contentBuild)) || typeof input.buildVerified!=='boolean')throw failure('UNAVAILABLE');
  const runtime=Object.fromEntries(['providerReady','instanceExists','receiverExists','workerBuild','contentBuild','heartbeatFresh','executionContract','receiptVersion','authenticated','composerReady','generationActive','extensionDiagnostics'].map(k=>[k,r[k]]));
  const mismatches=mismatchesFor(runtime,input.buildVerified);
  return {readyForControlledE2E:mismatches.length===0,expected:expected(),runtime,buildVerified:input.buildVerified,mismatches};
}
module.exports={createReport,sanitizeReport};
