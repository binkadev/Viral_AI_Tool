"use strict";
// Heartbeats only. No browser commands, session selection, or job/service startup.
const path=require('node:path');
const {MetaMuseExtensionBridge}=require('../services/generation/bridge/meta-muse-extension-bridge');
const bridge=new MetaMuseExtensionBridge({userDataPath:path.join(process.env.APPDATA,'viral-ai-tool'),developmentDiagnostics:true});
bridge.command=async()=>{throw Error('READ_ONLY');};
(async()=>{
 await bridge.start();
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){bridge.snapshot();if([...bridge.sessions.values()].some(s=>s.heartbeatSeen))break;await new Promise(r=>setTimeout(r,1000));}
 console.log(JSON.stringify({sample:1,...bridge.receiverDiagnosis()}));
 await new Promise(r=>setTimeout(r,3000));
 const diagnosis=bridge.connectionDiagnosis();
 console.log(JSON.stringify({sample:2,...bridge.receiverDiagnosis(),bridgeError:diagnosis.lastBridgeErrorCode||'UNREPORTED',contentScriptError:diagnosis.lastContentScriptErrorCode||'UNREPORTED'}));
})().catch(()=>{console.log(JSON.stringify({unavailable:true}));process.exitCode=1;}).finally(()=>bridge.close());
