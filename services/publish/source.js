"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),model=require("./model");
// Native read-only inspection, composed with the existing Main file-health and
// video probe authorities. No path supplied to the queue IPC is ever accepted.
function create({fileStatus,probe,io=fs}) {
  return async function inspect(outputPath) {
    let fd;
    try {
      if(typeof outputPath!=="string"||outputPath.length>32767||!path.isAbsolute(outputPath)||!/^.*\.mp4$/i.test(outputPath)||/[\x00-\x1f]/.test(outputPath))throw 0;
      const first=await fileStatus(outputPath);
      if(first?.exists!==true||first.sizeBytes<=0||first.path!==path.resolve(outputPath)||io.lstatSync(outputPath).isSymbolicLink())throw 0;
      fd=io.openSync(outputPath,"r");const a=io.fstatSync(fd);
      if(!a.isFile()||a.size!==first.sizeBytes||a.mtimeMs!==first.modifiedAt)throw 0;
      const metadata=await probe(outputPath),hash=crypto.createHash("sha256"),buffer=Buffer.alloc(1024*1024);
      // Fixed memory; yield between chunks so shutdown and IPC remain usable.
      let offset=0;while(offset<a.size){const n=io.readSync(fd,buffer,0,Math.min(buffer.length,a.size-offset),offset);if(!n)throw 0;hash.update(buffer.subarray(0,n));offset+=n;await new Promise(resolve=>setImmediate(resolve));}
      const b=io.fstatSync(fd),c=io.statSync(outputPath),last=await fileStatus(outputPath);
      if([b,c].some(s=>!s.isFile()||s.dev!==a.dev||s.ino!==a.ino||s.size!==a.size||s.mtimeMs!==a.mtimeMs||s.ctimeMs!==a.ctimeMs)||last?.exists!==true||last.sizeBytes!==a.size||last.modifiedAt!==a.mtimeMs)throw 0;
      if(!(metadata?.duration>0)||metadata.videoCodec!=="h264"||metadata.audioCodec!=="aac"||metadata.fps!==30||!(metadata.width>0&&metadata.height>0))throw 0;
      return {outputPath,sizeBytes:a.size,modifiedAt:a.mtimeMs,fileId:[a.dev,a.ino,a.birthtimeMs].join(":"),sha256:hash.digest("hex"),metadata};
    }catch{throw model.fail("SOURCE_UNAVAILABLE");}finally{if(fd!==undefined)io.closeSync(fd);}
  };
}
module.exports={create};
