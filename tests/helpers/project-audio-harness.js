"use strict";
const model=require("../../renderer/core-project-audio-model"),player=require("../../renderer/core-player-model");
const {harness,asset,clone}=require("./project-media-harness");
function setup(options={}) {
  const h=harness(options.data);h.window.ViralCoreProjectAudioModel=model;
  if(!options.data){
    for(const scene of h.state.scenePlan.scenes)Object.assign(scene,{sourceText:"Narration "+scene.id,start:0,end:2});h.api.flush();
    h.api.addProjectMediaAssets([asset("visual"),asset("music","audio"),asset("music2","audio")],{projectId:"A"});
    for(const id of ["A0","A1"]){h.api.addSceneMaterialCandidate(id,"visual",{projectId:"A"});h.api.selectSceneMaterial(id,"visual",{projectId:"A"});}
    h.api.updateProjectVoice("A",{action:"assign",speaker:"speaker-1",voiceId:"fixture-voice"});
  }
  const project=()=>h.api.projectAudioSnapshot("A"),plan=()=>model.voicePlan(project(),player.buildProjectPlayback(project()));
  return {h,project,plan,model,player,clone};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setImmediate(r));
function result(request){return {segments:request.segments.map(s=>({...s,audioPath:"C:/voice/"+request.jobId+"/"+encodeURIComponent(s.id)+".wav",audioUrl:"file:///C:/voice/"+request.jobId+"/"+encodeURIComponent(s.id)+".wav",audioDuration:1.5,timingRisk:false}))};}
module.exports={setup,deferred,tick,result,model,player,asset,clone};
