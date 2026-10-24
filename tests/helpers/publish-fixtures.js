"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto"),f=require("./production-manager-fixtures"),model=require("../../services/publish/model"),storeModel=require("../../services/publish/store"),runtime=require("../../services/publish/runtime");
function project(id="P",jobId="render-one") {
  const p=f.project(id,1),plan=f.renderModel.build(p),job=f.job(p,jobId);
  Object.assign(job,{renderProfile:plan.profile,metadata:{...job.metadata,videoCodec:"h264",audioCodec:"aac",sizeBytes:job.outputSizeBytes},pipeline:{duration:plan.duration,sceneCount:1,profile:plan.profile,originalAudioMixed:true,voiceMixed:false,bgmMixed:false,bgmLoop:false,burnSubtitles:false,subtitleCount:0,timingWarningCount:0}});p.workflow.jobs=[job];return p;
}
function file(p) {const j=p.workflow.jobs.at(-1);return {outputPath:j.outputPath,sizeBytes:j.outputSizeBytes,modifiedAt:1234,fileId:"1:2:3",sha256:"a".repeat(64),metadata:model.clone(j.metadata)};}
function source(p=project()){const j=p.workflow.jobs.at(-1),v=file(p);return {projectId:p.projectId,projectName:p.projectName,renderJobId:j.id,renderInputSignature:j.renderInputSignature,outputPath:v.outputPath,sizeBytes:v.sizeBytes,modifiedAt:v.modifiedAt,fileId:v.fileId,sha256:v.sha256};}
const item=(p=project())=>({itemId:"publish-item-"+crypto.randomUUID(),source:source(p),state:"queued",operationId:null,reason:null,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"});
function harness(t,{adapter,projects=[project()],inspect,readProject,io}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"viral-publish-test-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const map=new Map(projects.map(p=>[p.projectId,p])),calls=[],store=storeModel.create({userDataPath:root,...(io?{io}:{})});
  const inputs={store,readProject:readProject|| (async id=>map.has(id)?model.clone(map.get(id)):null),inspect:inspect|| (async outputPath=>{calls.push(outputPath);const p=[...map.values()].find(p=>p.workflow.jobs.some(j=>j.outputPath===outputPath));if(!p)throw model.fail("SOURCE_UNAVAILABLE");return file(p);}),adapter};
  return {root,map,calls,store,inputs,runtime:runtime.create(inputs)};
}
function publisher({hold,throwAfter=false,reject=false,wrong=false,duplicate=false}={}) {const calls=[];return {calls,async execute(context){calls.push(context);const emit=(state,reason=null)=>context.report({itemId:wrong?"publish-item-"+crypto.randomUUID():context.itemId,operationId:context.operationId,state,reason});if(hold)await hold;emit("uploading");if(throwAfter)throw Error("FAKE_PRIVATE_PROVIDER_EXCEPTION");if(reject){emit("needs_attention","REJECTED");return;}emit("processing");emit("published");if(duplicate)emit("published");}};}
module.exports={project,file,source,item,harness,publisher,clone:model.clone};
