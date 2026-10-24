"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), output = path.join(root, "out/block-a");
if (!process.versions.electron) {
  const { spawnSync } = require("node:child_process"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "viral-block-a-"));
  fs.mkdirSync(output, { recursive: true });
  for (const phase of ["write", "restart"]) {
    const env = { ...process.env, BLOCK_A_PROFILE: profile, BLOCK_A_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require("electron"), [__filename], { cwd: root, env, encoding: "utf8", timeout: 90000, windowsHide: true });
    process.stdout.write(child.stdout || ""); process.stderr.write(child.stderr || "");
    if (child.error) throw child.error;
    assert.equal(child.status, 0, "Electron phase " + phase);
  }
  console.log("Block A real Electron process restart PASS (deterministic text adapter only in write phase).");
} else {
  const { app, BrowserWindow, session } = require("electron"), { pathToFileURL } = require("node:url");
  const profile = process.env.BLOCK_A_PROFILE, phase = process.env.BLOCK_A_PHASE;
  app.setPath("userData", profile); app.setPath("sessionData", profile); app.disableHardwareAcceleration();
  const script = require("./fixtures/content-plan").script();
  const fixture = `window.blockAFixture={calls:0,errors:[]};
    window.addEventListener('error',e=>blockAFixture.errors.push(e.message));
    window.addEventListener('unhandledrejection',e=>blockAFixture.errors.push(String(e.reason)));
    ${phase === "write" ? `window.ViralTextAuthoringAdapter={generate:async()=>{blockAFixture.calls++;if(blockAFixture.hold)return new Promise(resolve=>{blockAFixture.release=()=>resolve(${JSON.stringify(script)});});return ${JSON.stringify(script)};}};` : ""}
    window.desktopAPI={getGenerationStatus:async()=>({ok:true,value:{state:'not_configured',ready:false}}),
      getAccount:async()=>({ok:false}),getTranslationStatus:async()=>({ready:false}),getVoiceStatus:async()=>({ready:false}),
      minimize(){},toggleMaximize(){},close(){}};`;
  const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8").replace("<head>", '<head><base href="' + pathToFileURL(path.join(root, "renderer") + path.sep).href + '"><script>' + fixture + '</script>');
  const file = path.join(profile, "block-a.html"); fs.writeFileSync(file, html);
  app.whenReady().then(async () => {
    let win;
    try {
      const network = [];
      session.defaultSession.webRequest.onBeforeRequest((details, done) => { const allowed = /^(file|data|blob):/.test(details.url); if (!allowed) network.push(details.url); done({ cancel: !allowed }); });
      win = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      const run = source => win.webContents.executeJavaScript("{\n" + source + "\n}", true);
      const wait = async source => { const until = Date.now() + 10000; while (!await run(source)) { if (Date.now() > until) throw Error("Timeout: " + source); await new Promise(r => setTimeout(r, 40)); } };
      await win.loadFile(file); await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
      await run("state.page='ai-create';state.locale='vi';render();");
      await wait("!!document.querySelector('[data-ai-plan]')");
      assert.equal(await run("blockAFixture.calls"), 0);
      if (phase === "write") {
        assert.equal(await run("ViralCoreProjectPersistence.snapshot()"), null);
        await run("const t=document.querySelector('[data-ai-brief]');t.value='Nước hoa nam phong cách sang trọng';t.dispatchEvent(new Event('input',{bubbles:true}));");
        assert.equal(await run("blockAFixture.calls"), 0);
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await run("document.querySelector('[data-ai-customize]').open=true;document.querySelector('[data-ai-plan]').focus();");
        assert(await run("document.activeElement.matches('[data-ai-plan]')"));
        assert(await run("parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2"));
        assert.equal(await run("document.querySelector('[data-ai-plan]').disabled"), false);
        await run("blockAFixture.hold=true;document.querySelector('[data-ai-plan]').click();");
        await wait("!!blockAFixture.release && !document.querySelector('[data-ai-plan-cancel]').hidden");
        assert.equal(await run("(() => {const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})()"), true);
        await wait("!!document.querySelector('#confirmCancel')");
        assert(await run("document.activeElement.id==='confirmCancel'"));
        await run("document.querySelector('#confirmCancel').click();document.querySelector('[data-ai-plan-cancel]').click();");
        await wait("document.querySelector('[data-ai-plan-status]').textContent===I18N.messages.vi.aiCreate.planCancelled");
        await run("blockAFixture.release();blockAFixture.hold=false;");
        assert.equal(await run("ViralCoreProjectPersistence.snapshot()"), null);
        await run("document.querySelector('[data-ai-plan]').click();document.querySelector('[data-ai-plan]').click();");
        await wait("!!ViralCoreProjectPersistence.snapshot()?.scenePlan?.authoring");
        await wait("document.querySelector('[data-ai-plan-status]').textContent===I18N.messages.vi.aiCreate.planCompleted");
        assert.equal(await run("blockAFixture.calls"), 2);
        assert.equal(await run("ViralCoreProjectPersistence.snapshot().scenePlan.scenes.length"), 5);
        assert(await run("document.querySelector('[data-ai-script-review]').textContent.includes('Một mùi hương')"));
        await run("document.querySelector('[data-ai-scene-editor]').open=true;const f=document.querySelector('[data-ai-scene-edit]');f.elements.title.value='Cảnh mở đầu đã sửa';f.elements.sourceText.value='Lời dẫn mới cho nước hoa nam.';f.elements.title.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();");
        await wait("ViralCoreProjectPersistence.snapshot().scenePlan.scenes[0].title==='Cảnh mở đầu đã sửa'");
        assert.equal(await run("ViralCoreProjectPersistence.snapshot().scenePlan.scenes[0].sourceText"), "Lời dẫn mới cho nước hoa nam.");
        for (const language of ["vi", "en"]) {
          await run(`state.locale='${language}';render();document.querySelector('[data-ai-customize]').open=true;`);
          assert(await run("document.querySelector('[data-ai-plan]').textContent===I18N.messages[state.locale].aiCreate.planGenerate"));
          assert(await run("document.querySelector('[data-ai-plan]').disabled"));
          const fit = await run("(() => {const p=document.querySelector('#page');return p.scrollWidth<=p.clientWidth+1;})()"); assert(fit);
        }
        // 40% expansion and text spacing must not clip the added controls.
        await run("document.querySelector('[data-ai-plan]').textContent+=' additional expanded label text';document.querySelector('[data-ai-plan]').style.letterSpacing='0.12em';");
        assert(await run("document.querySelector('[data-ai-plan]').scrollHeight<=document.querySelector('[data-ai-plan]').clientHeight+2"));
        await run("const p=ViralCoreProjectPersistence,s=p.snapshot();p.selectProjectScene(s.scenePlan.scenes[2].id,{projectId:s.projectId});state.renderOptions.voiceEnabled=false;p.flush();");
        const before = await run("ViralCoreProjectPersistence.snapshot()");
        await run("state.page='settings';ViralCoreProjectPersistence.flush();state.page='ai-create';ViralCoreProjectPersistence.flush();render();");
        assert.equal((await run("ViralCoreProjectPersistence.snapshot()")).updatedAt, before.updatedAt);
        const saved = await run("ViralCoreProjectPersistence.snapshot()"); fs.writeFileSync(path.join(output, "desktop-snapshot.json"), JSON.stringify(saved, null, 2));
        await win.webContents.session.flushStorageData();
        await win.loadFile(file); await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
        const reloaded = await run("ViralCoreProjectPersistence.snapshot()");
        // The existing startup route may be Home. Every content field,
        // including updatedAt and selected Scene, must still match exactly.
        assert.deepEqual({ ...reloaded, editor: { ...reloaded.editor, page: saved.editor.page } }, saved);
        assert.equal(await run("blockAFixture.calls"), 0);
      } else {
        const expected = JSON.parse(fs.readFileSync(path.join(output, "desktop-snapshot.json"), "utf8"));
        const restarted = await run("ViralCoreProjectPersistence.snapshot()");
        assert.deepEqual({ ...restarted, editor: { ...restarted.editor, page: expected.editor.page } }, expected);
        assert.equal(await run("state.renderOptions.voiceEnabled"), false);
        assert(await run("document.querySelector('[data-ai-plan]').disabled"));
        assert.equal(await run("document.querySelector('[data-ai-plan-status]').textContent"), await run("I18N.messages.vi.aiCreate.planUnavailable"));
        await run("const p=ViralCoreProjectPersistence,s=p.snapshot(),o={projectId:s.projectId};p.moveProjectScene(s.scenePlan.selectedSceneId,0,o);p.addProjectScene({title:'Cảnh mới'},o);p.removeProjectScene(p.snapshot().scenePlan.scenes.at(-1).id,o);");
        assert.equal(await run("ViralCoreProjectPersistence.snapshot().scenePlan.scenes.length"), 5);
      }
      assert.deepEqual(await run("blockAFixture.errors"), []); assert.deepEqual(network, []);
      fs.writeFileSync(path.join(output, "desktop-" + phase + ".json"), JSON.stringify({ status: "PASS", phase, network, security: { contextIsolation: true, nodeIntegration: false, sandbox: true }, deterministicAdapter: phase === "write" }, null, 2));
      console.log("Electron Block A " + phase + " PASS"); win.destroy(); app.quit();
    } catch (error) { console.error(error.stack || error); win?.destroy(); app.exit(1); }
  });
}
