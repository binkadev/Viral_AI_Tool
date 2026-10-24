"use strict";
const fs=require("node:fs"),path=require("node:path"),model=require("./model"),{atomic}=require("../telegram/storage");
function create({userDataPath,io=fs,now=()=>new Date().toISOString()}) {
  if(!path.isAbsolute(userDataPath))throw model.fail("INVALID_REQUEST");
  const file=path.join(userDataPath,"publish-queue-v1.json");let value={schemaVersion:1,items:[]},error=null;
  // Reuse native atomic persistence. Sync the private temp file before rename,
  // so the operation barrier is durable before any adapter can be invoked.
  const durable={...io,writeFileSync(target,body,options){const fd=io.openSync(target,"wx",0o600);try{io.writeFileSync(fd,body,options);io.fsyncSync(fd);}finally{io.closeSync(fd);}}};
  function write(input) {
    if(error)throw model.fail(error);
    const next=model.normalize(input);
    // Append only. Existing captures and operation ownership cannot be repaired,
    // removed, reordered or rewound by a later writer.
    for(let index=0;index<value.items.length;index++) {
      const old=value.items[index],item=next.items[index];
      if(!item||item.itemId!==old.itemId||JSON.stringify(item.source)!==JSON.stringify(old.source)||item.createdAt!==old.createdAt)throw model.fail("INVALID_REQUEST");
      if(JSON.stringify(item)!==JSON.stringify(old)) {
        const legal=model.transition(old,item.state,{now:item.updatedAt,operation:item.operationId,reason:item.reason});
        if(JSON.stringify(item)!==JSON.stringify(legal))throw model.fail("INVALID_REQUEST");
      }
    }
    if(next.items.slice(value.items.length).some(item=>item.state!=="queued"))throw model.fail("INVALID_REQUEST");
    try{const body=JSON.stringify(next);if(Buffer.byteLength(body)>8000000)throw 0;atomic(file,next,durable);}catch{error="STORAGE_FAILED";throw model.fail(error);}
    value=next;return model.clone(value);
  }
  try {
    if(io.existsSync(file)) {
      if(io.statSync(file).size>8000000)throw 0;
      const original=model.normalize(JSON.parse(io.readFileSync(file,"utf8")));value=original;
      const restored=model.restart(original,now());if(JSON.stringify(original)!==JSON.stringify(restored))write(restored);
    }
  } catch {error=error||"STORAGE_PROTECTED";}
  return {read:()=>model.clone(value),write,error:()=>error,protected:()=>!!error};
}
module.exports={create};
