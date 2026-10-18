"use strict";
// Opt-in desktop verification: electron tests/muse-distribution.desktop.js
// Uses the existing Chrome session; never opens a debugging connection.
const {app, shell} = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
app.setAppPath(root);
app.setName(require("../package.json").name);
app.setPath("userData", path.join(app.getPath("appData"), app.getName()));
const modulePath = require.resolve("../services/generation/bridge/meta-muse-extension-bridge");
const bridgeModule = require(modulePath), Base = bridgeModule.MetaMuseExtensionBridge;
let live;
bridgeModule.MetaMuseExtensionBridge = class extends Base {constructor(options) {super(options);live=this;}};
require("../startup-main");
app.whenReady().then(async () => {
 try {
  const deadline = Date.now()+25000;
  while ((!live || live.snapshot().extensionState!=="extension_connected") && Date.now()<deadline) await new Promise(r=>setTimeout(r,500));
  const status = live?.snapshot();
  console.log("MUSE_RUNTIME_A",JSON.stringify({extensionState:status?.extensionState,sessionState:status?.state,connectedProfiles:status?.sessions.length}));
  const missing = new Base({userDataPath:app.getPath("userData"),extensionSourceDir:path.join(root,"extensions/meta-muse-bridge"),shell});
  assert.equal(missing.snapshot().extensionState,"extension_install_required");
  await assert.rejects(missing.openStore());
  assert.deepEqual(await missing.revealExtension(),{id:"muse",folderRevealed:true});
  assert.equal(missing.snapshot().extensionState,"extension_install_required");
  missing.close();
  console.log("MUSE_RUNTIME_B",JSON.stringify({extensionState:"extension_install_required",fakeInstall:false,manualFolderRevealed:true}));
  if(status?.extensionState!=="extension_connected") process.exitCode=2;
 } catch(error) {console.error("MUSE_RUNTIME_FAILED",error.code || error.name);process.exitCode=1;}
 finally {app.quit();}
});
