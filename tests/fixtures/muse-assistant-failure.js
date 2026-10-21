"use strict";
const build=require('../../services/generation/bridge/extension-distribution.json').expectedContentBuild;
function frame(patch={}) {
 return {phase:'sample_before_block',elapsedBucket:'under_1s',generationActive:false,ownedUserPresent:true,logicalUserCount:1,
   blockRowCount:2,mediaCandidateCount:1,assistantBlockWithinBound:true,sameSequenceParent:false,blockContiguous:null,blockSignatureChanged:null,
   mutationCount:'one_to_four',stabilizationSamples:0,stabilizationReset:false,terminal:true,terminalReason:'BLOCK_PARENT_MISMATCH',...patch};
}
function failure(reason='BLOCK_PARENT_MISMATCH') {
 return {version:1,build,terminalReason:reason,terminalPhase:'sample_before_block',frames:[frame({terminalReason:reason})]};
}
module.exports={frame,failure};
