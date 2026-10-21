"use strict";
const {spawn}=require('node:child_process'),path=require('node:path');
async function run() {
  if(process.env.NODE_ENV==='production')throw Error('DEV manual recovery unavailable in production');
  // Deterministic negative matrix first, then the actual Electron Project/Studio
  // handoff and a second process using the same isolated temporary profile.
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','tests/muse-manual-recovery.test.js'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:'inherit'});
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('DEV negative matrix failed')));
  });
  await require('./validate-manual-recovery').validate();
  return require('./run-generated-handoff').run('manual-recovery',true);
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
