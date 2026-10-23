"use strict";
const snapshot=require("../../renderer/core-project-media-assembly"),sceneModel=require("../../renderer/core-scene-plan-model"),library=require("../../renderer/core-media-library-model");
const player=require("../../renderer/core-player-model"),renderModel=require("../../renderer/core-project-render-model"),productionModel=require("../../renderer/core-production-mode-model"),actionModel=require("../../renderer/core-scene-orchestration-model");
const clone=v=>JSON.parse(JSON.stringify(v));
function project(id,count=3){
  const p=snapshot.createDraftProject({projectId:id,projectName:id}, {}, {}, 0);
  p.scenePlan=sceneModel.normalizePlan({scenes:Array.from({length:count},(_,i)=>({id:id+"-scene-"+i,order:i,start:i,end:i+1,orientation:"landscape",targetKinds:["video"],searchQueries:["fixture"],sourceText:"Local scene "+i})),selectedSceneId:id+"-scene-0"},{now:0});
  p.media.assets=[library.normalizeAsset({id:id+"-visual",name:"Local visual",kind:"image",origin:"local",provider:"local",status:"ready",fileState:"available",localPath:"C:/fixtures/"+id+".png",meta:{width:320,height:180}},0,0)];
  p.workflow.renderOptions={...p.workflow.renderOptions,voiceEnabled:false,burnSubtitles:false};
  p.mediaAssembly={schemaVersion:1,slots:p.scenePlan.scenes.map(s=>({sceneId:s.id,role:"primary",candidateAssetIds:[id+"-visual"],selectedAssetId:id+"-visual",selectionSource:"manual"}))};
  return snapshot.migrateSnapshot(p).snapshot;
}
function job(p,id,status="completed",extra={}){const plan=renderModel.build(p);return {id,isRenderOutput:true,renderKind:"project",projectId:p.projectId,renderInputSignature:plan.renderInputSignature,name:p.projectName,status,fileState:"available",outputPath:"C:/outputs/"+id+".mp4",outputSizeBytes:1024,metadata:{duration:plan.duration,width:1920,height:1080,fps:30},startedAt:"2026-01-01T00:00:00Z",completedAt:"2026-01-01T00:00:01Z",...extra};}
function six(){const projects=Array.from({length:6},(_,i)=>project("P"+(i+1)));
  projects[0].mediaAssembly.slots.forEach(s=>{s.candidateAssetIds=[];s.selectedAssetId=null;});
  projects[1].mediaAssembly.slots[2].selectedAssetId=null;
  const rendering=job(projects[3],"render-active","processing",{outputPath:null,completedAt:null,fileState:"pending"});projects[3].workflow.jobs.push(rendering);
  projects[4].workflow.jobs.push(job(projects[4],"ready"));
  projects[5].workflow.jobs.push(job(projects[5],"previous"));projects[5].scenePlan.scenes[0].sourceText="Changed current text";projects[5].workflow.jobs.push(job(projects[5],"failed","failed",{outputPath:null,fileState:"pending",completedAt:"2026-01-02T00:00:01Z"}));
  const labels=["Draft Project","Review Project","Ready Project","Rendering Project","Video Project","Attention Project"];
  projects.forEach((p,i)=>{p.projectName=labels[i];p.updatedAt="2026-01-0"+(i+1)+"T00:00:00Z";});
  return projects;
}
module.exports={project,job,six,clone,snapshot,player,renderModel,productionModel,actionModel};
