"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {failure}=require("../generation-job");
const receiptV2=require("../../../extensions/meta-muse-bridge/receipt-v2");
// Shared byte transport and native verification; authorization belongs to each resolver.
async function acquireBounded(c,r,env) {
    const {verifyVideo,cancelled,transfers,command,persistRecord,verifyRecorded,bridge,commandName,verifiedIdentity,transferId}=env;
    if(typeof verifyVideo!=='function')throw failure('ASSET_UNAVAILABLE');
    const fileName=c.jobId+'.mp4',output=path.join(c.outputDirectory,fileName),partial=path.join(c.outputDirectory,c.jobId+'.partial.mp4');
    let fd,created=false,transfer,transferDone=false;
  async function verify(file) {
    const stat=fs.lstatSync(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size<12)throw failure('ASSET_UNAVAILABLE');
    const header=Buffer.alloc(12),fd=fs.openSync(file,'r');
    try{fs.readSync(fd,header,0,12,0);}finally{fs.closeSync(fd);}
    if(header.toString('ascii',4,8)!=='ftyp')throw failure('ASSET_UNAVAILABLE');
    return await verifyVideo(file);
  }

    const clearPartial=()=>{if(fs.existsSync(partial)){const s=fs.lstatSync(partial);if(!s.isFile() || s.isSymbolicLink())throw failure('ASSET_UNAVAILABLE');fs.unlinkSync(partial);}};
    try {
      if(fs.existsSync(output)) {
        if(fs.lstatSync(output).isSymbolicLink())throw failure('ASSET_UNAVAILABLE');
        await verifyRecorded(c,r,output);await verify(output);
        if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
        clearPartial();return {status:'completed',fileName};
      }
      await c.onVerifying?.();
      const disk=fs.statfsSync(c.outputDirectory);
      if(disk.bavail*disk.bsize<receiptV2.MAX_BYTES+64*1024*1024)throw failure('RESOURCE_UNAVAILABLE');
      transfer={transferId:transferId||crypto.randomUUID(),sequence:0,offset:0,mediaKind:'video',receipt:r.receipt,controller:new AbortController()};
      transfers.set(c.jobId,transfer);
      // A partial from an interrupted acquisition is owned by this same operation.
      clearPartial();
      fd=fs.openSync(partial,'wx',0o600);created=true;
      let offset=0;const checksum=crypto.createHash('sha256'),started=Date.now();
      do {
        if(cancelled.has(c.jobId) || Date.now()-started>300000)throw failure('RECOVERY_REQUIRED');
        const extra={transferId:transfer.transferId,sequence:transfer.sequence,mediaKind:'video',receipt:r.receipt,offset};
        let timer,onAbort;
        const result=await Promise.race([command(commandName,c,r,extra),new Promise((_,reject)=>{
          onAbort=()=>reject(failure('RECOVERY_REQUIRED'));transfer.controller.signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>reject(failure('PROVIDER_TIMEOUT')),20000);
        })]).finally(()=>{clearTimeout(timer);transfer.controller.signal.removeEventListener('abort',onAbort);});
        if(cancelled.has(c.jobId) || Date.now()-started>300000)throw failure('RECOVERY_REQUIRED');
        if(result.state!=='result')throw failure('ASSET_UNAVAILABLE');
        const bytes=Buffer.from(result.data,'base64');
        if(bytes.toString('base64')!==result.data || crypto.createHash('sha256').update(bytes).digest('hex')!==result.chunkHash)throw failure('ASSET_UNAVAILABLE');
        checksum.update(bytes);transferDone=result.done;transfer.sequence++;transfer.offset=offset+bytes.length;
        let written=0;while(written<bytes.length)written+=fs.writeSync(fd,bytes,written,bytes.length-written);
        offset+=bytes.length;
      } while(!transferDone);
      fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      const media=await verify(partial);
      if(cancelled.has(c.jobId))throw failure('RECOVERY_REQUIRED');
      const verifiedOutput={fileName,size:offset,sha256:checksum.digest('hex'),...verifiedIdentity(r)};
      // Record before exclusive publication: a crash after linking can reuse
      // only these exact verified bytes, never an arbitrary preexisting file.
      persistRecord(c,r,{verifiedOutput},media);
      fs.linkSync(partial,output); // Exclusive publication; never overwrite.
      return {status:'completed',fileName,verifiedOutput,...(media?{media}:{})};
    } finally {
      if(fd!==undefined)fs.closeSync(fd);if(created)try{fs.unlinkSync(partial);}catch{}
      if(transfer) {
        transfers.delete(c.jobId);const {controller,...payload}=transfer;
        // Best effort; content also aborts on disconnect/15-second idle expiry.
        if(!transferDone)try{await bridge.command(commandName,{tabId:r.target.tabId,operationId:c.jobId,sceneId:c.sceneId,...payload,abort:true},r.target);}catch{}
      }
    }
  }

module.exports={acquireBounded};
