"use strict";
const crypto=require("node:crypto"),model=require("./model"),render=require("../../renderer/core-project-render-model"),manager=require("../../renderer/core-production-manager-model");
function create({store,readProject,inspect,adapter,uuid=crypto.randomUUID,now=()=>new Date().toISOString()}) {
  let record=store.read(),task=null,admission=null,closed=false;
  const writable=()=>{if(closed)throw model.fail("UNAVAILABLE");if(store.protected())throw model.fail(store.error());};
  const get=id=>{if(!model.itemId(id))throw model.fail("INVALID_REQUEST");const i=record.items.find(i=>i.itemId===id);if(!i)throw model.fail("NOT_FOUND");return i;};
  function save(next){writable();record=store.write(next);}
  function change(id,state,options={}) {const next=model.clone(record),index=next.items.findIndex(i=>i.itemId===id);next.items[index]=model.transition(next.items[index],state,{now:now(),...options});save(next);return model.clone(next.items[index]);}
  async function canonical(projectId) {
    writable();let p;try{p=await readProject(projectId);}catch{throw model.fail("RENDER_NOT_CURRENT");}writable();
    if(!p||p.projectId!==projectId)throw model.fail("PROJECT_NOT_FOUND");
    const plan=render.build(p),latest=manager.history(render.outputs(p,plan))[0],j=latest?.job,m=j?.metadata,summary=j?.pipeline;
    if(!plan.ready||!latest?.current||j.projectId!==projectId||!m||m.videoCodec!=="h264"||m.audioCodec!=="aac"||m.fps!==30||!(m.duration>0)||m.width!==plan.profile.width||m.height!==plan.profile.height||
       !Number.isSafeInteger(j.outputSizeBytes)||j.outputSizeBytes<=0||m.sizeBytes!==j.outputSizeBytes||!summary||summary.sceneCount!==plan.scenes.length||
       !Number.isFinite(summary.duration)||Math.abs(summary.duration-m.duration)>.08||[summary.profile,j.renderProfile].some(profile=>!model.exact(profile,["width","height","fps"])||["width","height","fps"].some(k=>profile[k]!==plan.profile[k]))||
       ["originalAudioMixed","voiceMixed","bgmMixed","bgmLoop","burnSubtitles"].some(k=>typeof summary[k]!=="boolean")||
       !Number.isInteger(summary.subtitleCount)||summary.subtitleCount<0||summary.subtitleCount>10000||!Number.isInteger(summary.timingWarningCount)||summary.timingWarningCount<0||summary.timingWarningCount>300)throw model.fail("RENDER_NOT_CURRENT");
    return {project:p,job:j,signature:plan.renderInputSignature};
  }
  const sameRender=(a,b)=>a.project.projectId===b.project.projectId&&a.job.id===b.job.id&&a.job.outputPath===b.job.outputPath&&a.signature===b.signature&&a.job.outputSizeBytes===b.job.outputSizeBytes;
  async function capture(projectId) {
    const original=await canonical(projectId),file=await inspect(original.job.outputPath);writable();
    const latest=await canonical(projectId);if(!sameRender(original,latest))throw model.fail("RENDER_NOT_CURRENT");
    if(file.outputPath!==original.job.outputPath||file.sizeBytes!==original.job.outputSizeBytes||file.metadata.width!==original.job.metadata.width||file.metadata.height!==original.job.metadata.height||Math.abs(file.metadata.duration-original.job.metadata.duration)>.08)throw model.fail("INVALID_SOURCE");
    return model.source({projectId,projectName:original.project.projectName,renderJobId:original.job.id,renderInputSignature:original.signature,outputPath:file.outputPath,sizeBytes:file.sizeBytes,modifiedAt:file.modifiedAt,sha256:file.sha256,fileId:file.fileId});
  }
  function enqueue(projectId) {
    try{writable();if(!model.identifier(projectId))throw model.fail("INVALID_REQUEST");if(admission)return admission.projectId===projectId?admission.promise:Promise.reject(model.fail("BUSY"));}catch(e){return Promise.reject(e);}
    const pending={projectId};admission=pending;
    pending.promise=Promise.resolve().then(async()=>{const source=await capture(projectId);writable();const existing=record.items.find(i=>model.sourceKey(i.source)===model.sourceKey(source));if(existing)return model.clone(existing);
      if(record.items.length>=model.MAX_ITEMS)throw model.fail("CAPACITY");const stamp=now(),item={itemId:"publish-item-"+uuid(),source,state:"queued",operationId:null,reason:null,createdAt:stamp,updatedAt:stamp};save({...record,items:[...record.items,item]});return model.clone(item);
    }).finally(()=>{if(admission===pending)admission=null;});return pending.promise;
  }
  function start(id) {
    let item,owner;
    try{writable();item=get(id);if(task)return task.itemId===id?task.promise:Promise.resolve({ok:false,code:"BUSY"});if(item.state!=="queued")throw model.fail("START_UNSAFE");
      owner={itemId:id,operationId:"publish-operation-"+uuid()};task=owner;change(id,"preparing",{operation:owner.operationId});
    }catch(e){if(task===owner)task=null;return Promise.resolve({ok:false,code:model.code(e)});}
    owner.promise=Promise.resolve().then(async()=>{
      try{
        let checked;try{checked=await capture(item.source.projectId);}catch(e){if(closed)throw e;change(id,"needs_attention",{reason:model.ATTENTION.includes(e.code)?e.code:"SOURCE_UNAVAILABLE"});return;}
        writable();if(model.sourceKey(checked)!==model.sourceKey(item.source)){change(id,"needs_attention",{reason:"SOURCE_CHANGED"});return;}
        if(!adapter){change(id,"needs_attention",{reason:"PUBLISHER_UNCONFIGURED"});return;}
        // Adapter injection is private composition for deterministic tests only.
        // Main never supplies one. Every report owns this exact durable operation.
        const report=event=>{if(closed||store.protected()||task!==owner||!model.exact(event,["itemId","operationId","state","reason"])||event.itemId!==id||event.operationId!==owner.operationId)return false;
          const current=get(id);if(!model.ACTIVE.includes(current.state))return false;
          try{change(id,event.state,{reason:event.reason});return true;}catch{return false;}};
        const context=Object.freeze({itemId:id,operationId:owner.operationId,source:Object.freeze(model.clone(item.source)),report});
        await adapter.execute(context);
        if(!closed&&!store.protected()&&model.ACTIVE.includes(get(id).state))change(id,"uncertain",{reason:"OUTCOME_UNCERTAIN"});
      }catch{
        if(!closed&&!store.protected()&&model.ACTIVE.includes(get(id).state))try{change(id,"uncertain",{reason:"OUTCOME_UNCERTAIN"});}catch{}
      }finally{if(task===owner)task=null;}
      return undefined;
    }).then(()=>{const current=get(id);return {ok:!store.protected(),itemId:id,operationId:owner.operationId,state:current.state,...(store.protected()?{code:store.error()}:{})};});return owner.promise;
  }
  function cancel(id){writable();if(get(id).state!=="queued")throw model.fail("CANCEL_UNSAFE");return change(id,"cancelled");}
  function interrupt(){if(closed)return;try{if(task&&model.ACTIVE.includes(get(task.itemId).state))change(task.itemId,"uncertain",{reason:"INTERRUPTED"});}catch{}finally{closed=true;}}
  return {enqueue,start,cancel,interrupt,view:()=>({items:model.clone(record.items),counts:model.counts(record),busy:!!task&&!closed,protected:store.protected(),code:store.error()})};
}
module.exports={create};
