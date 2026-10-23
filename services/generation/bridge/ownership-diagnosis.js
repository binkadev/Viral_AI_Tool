"use strict";
// Support-only data, never receipt evidence or an execution/recovery input.
const {ownershipFailureReasons,validAssistantSummary,validUserAnchorChurn,validBaselineDrift,validBaselineWindow}=require('../../../extensions/meta-muse-bridge/receipt-v2');
const {validAnchoredOwnershipDiagnostic}=require('./execution-contract');
const fields=Object.freeze(['instanceMatch','tabMatch','nativeUserAnchor','nativeAssistantAnchor','workerIntentPresent','workerUserAnchor','workerAssistantAnchor']);
const layers={JOB_NOT_FOUND:'native_validation',JOB_STATE_UNSUPPORTED:'native_validation',OPERATION_RECORD_UNAVAILABLE:'native_validation',RECEIPT_UNAVAILABLE:'native_validation',USER_ANCHOR_MISSING:'native_validation',ASSISTANT_ALREADY_ANCHORED:'native_validation',TARGET_INSTANCE_UNAVAILABLE:'target_instance',TARGET_TAB_UNAVAILABLE:'target_tab',WORKER_INTENT_UNAVAILABLE:'worker_intent',WORKER_RECEIPT_MISMATCH:'worker_receipt',CONTENT_RECEIVER_UNAVAILABLE:'content_receiver',CONTENT_DIAGNOSIS_REJECTED:'content_diagnostic',DIAGNOSTIC_RESULT_INVALID:'native_result_validation',RUNTIME_BUILD_MISMATCH:'runtime_build',EXTENSION_DIAGNOSTICS_DISABLED:'extension_diagnostics',UNAVAILABLE:'transport',UNKNOWN:'unknown'};
function report(reason,evidence={}) {
 const safe=reason===null?null:ownershipFailureReasons.includes(reason)?reason:'UNKNOWN';
 return {ok:safe===null,reason:safe,layer:safe?layers[safe]:null,...Object.fromEntries(fields.map(k=>[k,typeof evidence[k]==='boolean'?evidence[k]:null]))};
}
function diagnosticFailure(reason,evidence={}) {
 return Object.assign(Error('Ownership diagnosis unavailable'),{code:'UNAVAILABLE',ownershipDiagnosis:report(reason,evidence)});
}
function fromError(error,evidence={}) {
 const details=error?.ownershipDiagnosis;
 return report(details?.reason||'UNKNOWN',{...evidence,...Object.fromEntries(fields.filter(k=>typeof details?.[k]==='boolean').map(k=>[k,details[k]]))});
}
function sanitize(input,id) {
 const safe=report(input?.ok===true?null:input?.reason,input);
 if(input && Object.hasOwn(input,'historicalAssistantOwnershipFailure')) {
   if(!validAssistantSummary(input.historicalAssistantOwnershipFailure))return report('DIAGNOSTIC_RESULT_INVALID',safe);
   safe.historicalAssistantOwnershipFailure=JSON.parse(JSON.stringify(input.historicalAssistantOwnershipFailure));
 }
 if(input && Object.hasOwn(input,'historicalUserAnchorChurn')) {
   if(input.historicalUserAnchorChurn!==null && !validUserAnchorChurn(input.historicalUserAnchorChurn))return report('DIAGNOSTIC_RESULT_INVALID',safe);
   safe.historicalUserAnchorChurn=JSON.parse(JSON.stringify(input.historicalUserAnchorChurn));
 }
 if(input && Object.hasOwn(input,'historicalBaselineDrift')) {
   if(input.historicalBaselineDrift!==null && !validBaselineDrift(input.historicalBaselineDrift))return report('DIAGNOSTIC_RESULT_INVALID',safe);
   safe.historicalBaselineDrift=JSON.parse(JSON.stringify(input.historicalBaselineDrift));
 }
 if(input && Object.hasOwn(input,'historicalBaselineWindow')) {
   if(input.historicalBaselineWindow!==null && !validBaselineWindow(input.historicalBaselineWindow))return report('DIAGNOSTIC_RESULT_INVALID',safe);
   safe.historicalBaselineWindow=JSON.parse(JSON.stringify(input.historicalBaselineWindow));
 }
 if(input?.ok===true) {
   if(input.operationId!==id || !validAnchoredOwnershipDiagnostic(input.diagnostic,input.userStableIdHash))return report('DIAGNOSTIC_RESULT_INVALID',safe);
   return {...safe,operationId:id,userStableIdHash:input.userStableIdHash,diagnostic:JSON.parse(JSON.stringify(input.diagnostic))};
 }
 return safe;
}
module.exports={report,diagnosticFailure,fromError,sanitize};
