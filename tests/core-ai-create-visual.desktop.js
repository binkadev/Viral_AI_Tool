"use strict";
// UX-3.1 screenshot review: complete local renderer, canonical Project fixtures,
// in-memory desktop API only, blocked network, isolated temporary profile.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline");
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require("node:child_process").spawnSync(require("electron"), [__filename, ...(baseline ? ["--baseline"] : [])], { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 60000 });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); if (result.error) console.error(result.error);
  process.exitCode = result.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, session } = require("electron"), { pathToFileURL } = require("node:url");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-ux31-")), output = path.join(root, "out/ux31", baseline ? "before" : "after");
  fs.mkdirSync(output, { recursive: true }); app.setPath("userData", profile); app.setPath("sessionData", profile); app.disableHardwareAcceleration();
  let renderer = path.join(root, "renderer");
  if (baseline) {
    renderer = path.join(profile, "renderer"); fs.cpSync(path.join(root, "renderer"), renderer, { recursive: true });
    for (const name of ["core-ai-create.js", "core-ai-create.css", "core-production-modes.js", "i18n.js"]) {
      fs.writeFileSync(path.join(renderer, name), require("node:child_process").execFileSync("git", ["-c", "safe.directory=" + root.replaceAll("\\", "/"), "show", "c75ff35954081bb03c6116623b216f7cf68eec7b:renderer/" + name], { cwd: root }));
    }
  }
  const fixture = `
    window.fixture={status:'ready',submissions:[],errors:[],holdSubmit:false};
    window.addEventListener('error',e=>fixture.errors.push(e.message));
    window.addEventListener('unhandledrejection',e=>fixture.errors.push(String(e.reason)));
    window.desktopAPI={
      async getGenerationStatus(){if(fixture.status==='checking')await new Promise(r=>fixture.releaseReadiness=r);if(fixture.status==='error')throw Error('fixture connection failure');return {ok:true,value:{state:fixture.status,ready:fixture.status==='ready',providers:[],modelIds:['local:wan']}};},
      async submitGeneration(p){fixture.submissions.push(p);if(fixture.holdSubmit)return new Promise(r=>fixture.releaseSubmit=r);return {ok:false,errorCode:'UNAVAILABLE'};},
      getAccount:async()=>({ok:false}),getTranslationStatus:async()=>({ready:false}),getVoiceStatus:async()=>({ready:false}),minimize(){},toggleMaximize(){},close(){}
    };
  `;
  fs.writeFileSync(path.join(profile, "visual.html"), fs.readFileSync(path.join(renderer, "index.html"), "utf8").replace("<head>", '<head><base href="' + pathToFileURL(renderer + path.sep).href + '"><script>' + fixture + '</script>'));
  app.whenReady().then(async () => {
    let win;
    try {
      const network = [], screenshots = [], metrics = [];
      session.defaultSession.webRequest.onBeforeRequest((details, done) => { const allow = /^(file|data|blob):/.test(details.url); if (!allow) network.push(details.url); done({ cancel: !allow }); });
      win = new BrowserWindow({ show: false, width: 1366, height: 768, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      const wc = win.webContents, run = async source => { try { return await wc.executeJavaScript("{\n" + source + "\n}", true); } catch (e) { throw Error(source + "\n" + e.message); } };
      const wait = async source => { const until = Date.now() + 10000; while (!await run(source)) { if (Date.now() > until) throw Error("Condition failed: " + source); await new Promise(r => setTimeout(r, 30)); } };
      const paint = () => run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      const capture = async (name, initial = true) => {
        if (initial) await run("document.querySelector('#page').scrollTop=0"); await paint();
        const geometry = await run(`(() => {const p=document.querySelector('#page'),b=document.querySelector('[data-ai-generate]'),t=document.querySelector('[data-ai-brief]');const rgb=s=>{const n=s.match(/[0-9]*[.]?[0-9]+/g).slice(0,3).map(Number);return s.startsWith('color(srgb')?n:n.map(v=>v/255)};const lum=s=>rgb(s).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const style=getComputedStyle(b),fg=lum(style.color),bg=lum(style.backgroundColor);return {width:innerWidth,height:innerHeight,locale:state.locale,theme:state.appearance,overflow:p.scrollWidth>p.clientWidth+1,ctaBottom:b.getBoundingClientRect().bottom,pageBottom:p.getBoundingClientRect().bottom,promptHeight:t.getBoundingClientRect().height,disabled:b.disabled,busy:b.getAttribute('aria-busy'),status:document.querySelector('[data-ai-readiness]').textContent,ctaContrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};})()`);
        assert(!geometry.overflow, name); if (initial) assert(geometry.ctaBottom <= geometry.pageBottom + 1, name + ": CTA must be in first viewport " + JSON.stringify(geometry));
        if (!baseline && !geometry.disabled) assert(geometry.ctaContrast>=4.5, name + ": primary CTA needs readable text contrast");
        fs.writeFileSync(path.join(output, name), (await wc.capturePage()).toPNG()); screenshots.push(name); metrics.push({ name, ...geometry });
      };
      await win.loadFile(path.join(profile, "visual.html")); await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
      await run("state.locale='vi';state.appearance='midnight';state.page='ai-create';render()");
      assert.equal(await run("ViralCoreProjectPersistence.snapshot()"), null); await capture("1366-vi-midnight-no-project.png");
      await run("(async()=>{await ViralCoreProjectPersistence.createProject({kind:'ai',projectName:'Studio 01'});state.scenePlan.scenes[0].title=I18N.messages.vi.aiCreate.examples[0].title;ViralCoreProjectPersistence.flush();state.page='ai-create';render();const t=document.querySelector('[data-ai-brief]');t.value=I18N.messages.vi.aiCreate.examples[0].prompt;t.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await wait("document.querySelectorAll('[data-production-modes]').length===1");
      const identity = await run("({projectId:ViralCoreProjectPersistence.snapshot().projectId,sceneId:ViralCoreProjectPersistence.snapshot().scenePlan.selectedSceneId})");
      await capture("1366-vi-midnight-default.png");
      wc.debugger.attach("1.3"); await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await run("document.querySelector('[data-ai-brief]').focus()"); await capture("1366-vi-midnight-focused.png");
      await run("document.activeElement.blur();fixture.status='not_configured';window.dispatchEvent(new Event('focus'))");
      await wait("document.querySelector('[data-ai-readiness]').textContent===I18N.messages.vi.aiCreate.aiNotReady");
      assert(await run("document.querySelector('[data-ai-generate]').disabled && !document.querySelector('[data-ai-brief]').disabled")); await capture("1366-vi-midnight-unavailable.png");
      await run("fixture.status='checking';window.dispatchEvent(new Event('focus'))"); await wait("!!fixture.releaseReadiness"); await capture("1366-vi-midnight-checking.png");
      await run("fixture.status='error';fixture.releaseReadiness()"); await wait("document.querySelector('[data-ai-readiness]').textContent===I18N.messages.vi.aiCreate.aiStatusError"); await capture("1366-vi-midnight-error.png");
      await run("fixture.status='ready';window.dispatchEvent(new Event('focus'))"); await wait("!document.querySelector('[data-ai-generate]').disabled");
      await run("fixture.holdSubmit=true;document.querySelector('[data-ai-generate]').click()"); await wait("!!fixture.releaseSubmit");
      assert(await run("document.querySelector('[data-ai-generate]').getAttribute('aria-busy')==='true'")); await capture("1366-vi-midnight-submitting.png");
      assert.equal(await run("fixture.submissions.length"), 1); const request = await run("fixture.submissions[0]"); assert.equal(request.projectId, identity.projectId); assert.equal(request.sceneId, identity.sceneId);
      await run("fixture.releaseSubmit({ok:false,errorCode:'UNAVAILABLE'});fixture.holdSubmit=false"); await wait("document.querySelector('[data-ai-generate]').getAttribute('aria-busy')==='false'");
      await run("const d=document.querySelector('[data-production-details]');if(d)d.open=true;document.querySelector('.core-ai-project-plan').scrollIntoView({block:'start',behavior:'instant'})"); await capture("1366-vi-midnight-plan-expanded.png", false);
      await run("window.dispatchEvent(new CustomEvent('viral-ai:generation-new-request',{detail:{projectId:ViralCoreProjectPersistence.activeProjectId()}}));state.page='ai-create';render()"); await wait("document.querySelectorAll('[data-production-modes]').length===1");
      // Read-only layout changes do not rotate submission identity or submit.
      win.setContentSize(1920, 1080); await capture("1920-vi-midnight-default.png");
      win.setContentSize(1366, 768); await run("state.locale='en';render()"); await capture("1366-en-midnight-default.png");
      await run("state.locale='vi';state.appearance='aurora-light';render()"); await capture("1366-vi-aurora-default.png");
      await run("state.appearance='midnight';state.motion='reduced';render();document.querySelector('[data-ai-customize]').open=true"); await capture("1366-vi-midnight-customize-reduced.png", false);
      assert.equal(await run("fixture.submissions.length"), 1); assert.deepEqual(await run("fixture.errors"), []); assert.deepEqual(network, []);
      const report = { ok: true, baseline, base: "c75ff35954081bb03c6116623b216f7cf68eec7b", screenshots, metrics, networkRequests: 0, mockedExplicitSubmissions: 1, identity, request };
      fs.writeFileSync(path.join(output, "visual-report.json"), JSON.stringify(report, null, 2));
      console.log("UX-3.1 visual fixtures PASS:", output); win.destroy(); app.exit(0);
    } catch (error) { console.error(error); if (win) fs.writeFileSync(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG()); app.exit(1); }
  });
}
