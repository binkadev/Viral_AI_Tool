"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {fixture, setup} = require("../dev/generation-visual-harness");
const model = require("../renderer/core-generation-progress-model");
const sceneModel = require("../renderer/core-scene-plan-model");
const states = ["running", "failed", "interrupted", "completed"];
const locale = {window:{}};
vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), locale);

test("production and packaged startup cannot load or return a fixture for any requested state", () => {
  for (const status of states) for (const [isPackaged, mode] of [[true,undefined],[true,"development"],[true,"production"],[false,"production"],[undefined,"development"]]) {
    const env = {NODE_ENV:mode, VIRAL_AI_DEV_GENERATION_STATE:status};
    const app = {isPackaged, requestSingleInstanceLock:()=>false, quit(){}, setPath(){assert.fail("profile changed");}};
    assert.equal(setup(app,env),null);
    let handler;
    vm.runInNewContext(fs.readFileSync("startup-main.js","utf8"), {
      require(name) {
        if (name === "electron") return {app, BrowserWindow:{}, ipcMain:{handle(channel,fn){assert.equal(channel,"dev:generation-fixture");handler=fn;}}};
        if (["path","url"].includes(name)) return require(name);
        assert.fail("Production loaded " + name);
      }, process:{env}, console:{warn(){}}
    });
    assert.equal(handler({}),null);
  }
});

test("development uses a fresh temporary profile and rejects invalid state", () => {
  for (const status of [undefined,"", "unknown", "RUNNING"]) assert.equal(setup({isPackaged:false,setPath(){assert.fail();}}, {VIRAL_AI_DEV_GENERATION_STATE:status}),null);
  const paths = {};
  const data = setup({isPackaged:false,setPath(key,value){paths[key]=value;}}, {VIRAL_AI_DEV_GENERATION_STATE:"running"});
  try {
    assert.equal(data.jobs[1].status,"running");
    assert.equal(paths.userData,paths.sessionData);
    assert.equal(path.dirname(paths.userData),require("os").tmpdir());
    assert.deepEqual(fs.readdirSync(paths.userData),[]);
  } finally {fs.rmdirSync(paths.userData);}
  const files = require("../package.json").build.files;
  assert(!files.some(pattern=>pattern.startsWith("dev/") || pattern === "**/*"));
});

test("all four visual states render in VI/EN without runtime reads, writes, probes, or timers", async () => {
  for (const status of states) for (const language of ["vi","en"]) {
    const data=fixture(status), listeners={};
    let markup="";
    const forbidden=()=>assert.fail("Visual fixture reached real runtime");
    class Element {closest(){return this;} constructor(action){this.dataset={generationAction:action};}}
    const sandbox={
      window:{I18N:locale.window.I18N,ViralGenerationProgressModel:model,ViralCoreScenePlanModel:sceneModel,
        ViralCoreProjectPersistence:{snapshot:forbidden},addEventListener(){},desktopAPI:{
          getDevGenerationFixture:async()=>data,onGenerationChanged:()=>()=>{},
          listGenerationJobs:forbidden,getGenerationStatus:forbidden,getGenerationJob:forbidden,
          cancelGeneration:forbidden,retryGeneration:forbidden,recoverGeneration:forbidden,probeVideo:forbidden
        }},
      state:{page:"home",locale:language,scenePlan:{scenes:[]},jobs:[]},pages:{},pageMeta:{},Element,
      document:{readyState:"complete",activeElement:null,getElementById:()=>({scrollTop:0,querySelector:()=>null}),
        addEventListener:(name,fn)=>{listeners[name]=fn;}},
      render(){markup=sandbox.pages[sandbox.state.page]?.()||"";},setTimeout:forbidden,setInterval:forbidden
    };
    const original=JSON.stringify(sandbox.state);
    vm.runInNewContext(fs.readFileSync("renderer/core-generation-progress.js","utf8"),sandbox);
    await new Promise(resolve=>setImmediate(resolve));
    const c=locale.window.I18N.messages[language].generationProgress;
    assert.equal(sandbox.state.page,"generation-progress");
    assert(markup.includes(c.states[status]));
    assert(markup.includes(c.visualNotice));
    assert(!JSON.stringify([c.visualNotice,c.visualPrompt,c.visualScenes]).includes("?"), "fixture copy must preserve diacritics");
    for (const scene of c.visualScenes) assert(markup.includes(scene[0]));
    assert(markup.includes(c.providerUnavailable));
    assert(!markup.includes('data-generation-action="studio"'));
    assert(!markup.includes('data-generation-action="retry"'));
    for (const action of ["cancel","retry","recover","studio","refresh"]) listeners.click({target:new Element(action)});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(JSON.stringify({...sandbox.state,page:"home"}),original,"fixture must not enter persisted project state");
    assert.equal(model.describe(data.jobs[1]).percent,status === "completed" ? 100 : 46);
    assert.equal(model.scenes(sceneModel.normalizePlan({scenes:c.visualScenes.map((s,i)=>({id:"dev-scene-"+i,start:i*6,end:i*6+6,title:s[0]}))}),data.jobs).length,4);
  }
});
