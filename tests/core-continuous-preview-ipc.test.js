"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const {localPreviewUrl,registerPreviewIpc}=require("../services/media/preview-url");
test("preview resolver validates local canonical visual type and rejects remote/provider URLs and arbitrary payload",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"project-preview-ipc-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const video=path.join(dir,"video #1.mp4"),image=path.join(dir,"image.png");fs.writeFileSync(video,"fixture");fs.writeFileSync(image,"fixture");
 assert(localPreviewUrl({kind:"video",localPath:video}).startsWith("file:"));assert(localPreviewUrl({kind:"image",localPath:image}).endsWith("image.png"));
 for(const payload of [null,[],{}, {kind:"audio",localPath:video},{kind:"image",localPath:video},{kind:"video",localPath:"https://example.com/v.mp4"},
  {kind:"video",localPath:"relative.mp4"},{kind:"image",localPath:image,command:"anything"},{kind:"image",localPath:dir}])assert.throws(()=>localPreviewUrl(payload));
});
test("preview IPC rejects untrusted frames, extra args and unavailable files without raw errors",()=>{
 let handler;registerPreviewIpc({ipcMain:{handle:(name,fn)=>{assert.equal(name,"media:preview-url");handler=fn}},trusted:e=>e.trusted===true});
 assert.deepEqual(handler({trusted:false},{kind:"video",localPath:"C:/secret.mp4"}),{ok:false,code:"unavailable"});
 assert.deepEqual(handler({trusted:true},{kind:"video",localPath:"C:/missing.mp4"},"extra"),{ok:false,code:"unavailable"});
 assert.equal(handler({trusted:true},{kind:"video",localPath:path.join(os.tmpdir(),"absent-project-preview-7398.mp4")}).code,"missing-file");
 assert(!JSON.stringify(handler({trusted:true},{raw:"secret"})).includes("secret"));
});
test("project player guards legacy clocks, never persists preview time, and has complete VI/EN copy",()=>{
 const c={window:{}};vm.runInNewContext(fs.readFileSync("renderer/i18n.js","utf8"),c);const {vi,en}=c.window.I18N.messages;
 assert.deepEqual(Object.keys(vi.projectPreview),Object.keys(en.projectPreview));for(const locale of [vi,en])for(const value of Object.values(locale.projectPreview))assert(!/FFmpeg|GitHub|electron|\ufffd/.test(value));
 const ui=fs.readFileSync("renderer/core-player-project.js","utf8"),runtime=fs.readFileSync("renderer/core-player-project-runtime.js","utf8");
 for(const forbidden of ["localStorage.setItem","selectProjectScene(","submitGeneration","setInterval("])assert(!ui.includes(forbidden)&&!runtime.includes(forbidden),forbidden);
 for(const file of ["core-player.js","core-player-rebind.js","core-player-sync.js","core-player-interactions.js"])assert(fs.readFileSync("renderer/"+file,"utf8").includes("projectPreview"));
 assert(fs.readFileSync("renderer/core-project-persistence.js","utf8").includes('video.dataset?.coreProjectPreview !== "true"'));
});
