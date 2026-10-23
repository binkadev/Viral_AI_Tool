"use strict";
// Real Chromium layout/keyboard checks against the complete local renderer.
// No preload/native services; every desktop API below is an in-memory fixture.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require("node:child_process").spawnSync(require("electron"), [__filename], { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 60000 });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
  if (result.error) console.error(result.error);
  process.exitCode = result.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, session } = require("electron"), { pathToFileURL } = require("node:url");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-ux3-"));
  const output = path.join(root, "out", "ux31", "integration"); fs.mkdirSync(output, { recursive: true });
  app.setPath("userData", profile); app.setPath("sessionData", profile);
  app.disableHardwareAcceleration();
  const fixture = `
    window.fixture = { submissions: [], ready: true, muse: false, errors: [] };
    window.addEventListener('error', e => fixture.errors.push(e.message));
    window.addEventListener('unhandledrejection', e => fixture.errors.push(String(e.reason)));
    window.desktopAPI = {
      getGenerationStatus: async () => ({ok:true,value:{state:fixture.ready?'ready':'not_configured',ready:fixture.ready,providers:fixture.muse?[{id:'muse',ready:true}]:[],modelIds:fixture.muse?[]:['local:wan']}}),
      submitGeneration: async p => {fixture.submissions.push(p); return {ok:false,errorCode:'UNAVAILABLE'};},
      getAccount: async () => ({ok:false}), getTranslationStatus: async () => ({ready:false}), getVoiceStatus: async () => ({ready:false}),
      minimize(){}, toggleMaximize(){}, close(){}
    };
  `;
  const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8").replace("<head>", '<head><base href="' + pathToFileURL(path.join(root, "renderer") + path.sep).href + '"><script>' + fixture + '</script>');
  const fixtureFile = path.join(profile, "create.html"); fs.writeFileSync(fixtureFile, html);
  app.whenReady().then(async () => {
    let win;
    try {
      const network = [];
      session.defaultSession.webRequest.onBeforeRequest((details, done) => {
        const allowed = /^(file|data|blob):/.test(details.url);
        if (!allowed) network.push(details.url);
        done({ cancel: !allowed });
      });
      win = new BrowserWindow({ show: false, width: 1366, height: 768, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      const wc = win.webContents;
      const run = async source => {
        try { return await wc.executeJavaScript("{\n" + source + "\n}", true); }
        catch (error) { throw Error("Renderer check failed: " + source + "\n" + error.message); }
      };
      const wait = async source => {
        const until = Date.now() + 10000;
        while (!await run(source)) { if (Date.now() > until) throw Error("Desktop condition timed out: " + source); await new Promise(resolve => setTimeout(resolve, 30)); }
      };
      await win.loadFile(fixtureFile);
      await wait("document.documentElement.dataset.coreFirstPaint === 'ready'");
      await run("state.page='ai-create'; state.locale='en'; render();");
      await wait("!!document.querySelector('[data-ai-generate]')");
      assert.equal(await run("ViralCoreProjectPersistence.snapshot()"), null);
      assert.equal(await run("document.querySelector('[data-ai-brief]').readOnly"), false);
      assert.equal(await run("document.querySelector('[data-ai-scene-context]').textContent"), "The first scene will be created automatically");
      await run("ViralCoreProjectPersistence.createProject({kind:'ai',projectName:'A cinematic product film'}); state.page='ai-create'; render();");
      await wait("document.querySelectorAll('[data-production-modes]').length === 1");
      const hierarchy = await run(`(() => {const p=document.querySelector('.core-ai-project-plan'),c=document.querySelector('.core-ai-composer'),m=document.querySelector('[data-production-modes]'),s=document.querySelector('[data-project-scenes]');return {composerBeforePlan:!!(c.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING),sharedPlan:p.contains(m)&&p.contains(s),injection:m.nextElementSibling===s};})()`);
      assert.deepEqual(hierarchy, { composerBeforePlan: true, sharedPlan: true, injection: true });
      const layouts = [];
      for (const [width, height] of [[1366, 768], [1920, 1080]]) {
        win.setContentSize(width, height);
        for (const locale of ["en", "vi"]) for (const theme of ["midnight", "aurora-light"]) {
          await run(`state.locale=${JSON.stringify(locale)};state.appearance=${JSON.stringify(theme)};document.documentElement.dataset.theme=${JSON.stringify(theme)};render();`);
          await wait("document.querySelectorAll('[data-production-modes]').length === 1");
          await run("const t=document.querySelector('[data-ai-brief]');t.value=I18N.messages[state.locale].aiCreate.examples[0].prompt;t.dispatchEvent(new Event('input',{bubbles:true}));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          const metrics = await run(`(() => {const p=document.querySelector('#page'),c=document.querySelector('.core-ai-composer'),b=document.querySelector('[data-ai-generate]'),t=document.querySelector('[data-ai-brief]');p.scrollTop=0;const cs=getComputedStyle(t);return {width:innerWidth,height:innerHeight,actualLocale:state.locale,actualTheme:document.documentElement.dataset.theme,ctaBottom:b.getBoundingClientRect().bottom,pageBottom:p.getBoundingClientRect().bottom,overflow:p.scrollWidth>p.clientWidth+1,textColor:cs.color,composerBackground:getComputedStyle(c).backgroundImage,textareaBackground:cs.backgroundColor,composerWidth:c.getBoundingClientRect().width,promptSize:cs.fontSize};})()`);
          assert.equal(metrics.actualLocale, locale); assert.equal(metrics.actualTheme, theme);
          assert(!metrics.overflow, JSON.stringify(metrics)); assert(metrics.ctaBottom <= metrics.pageBottom + 1, "CTA must be in the initial workspace: " + JSON.stringify(metrics));
          assert(metrics.composerWidth <= 1000); assert.equal(metrics.promptSize, "17px");
          assert(await run("document.querySelector('[data-ai-brief]').getBoundingClientRect().height>=132"), "The working input must be larger than UX-3");
          layouts.push({ locale, theme, ...metrics });
          fs.writeFileSync(path.join(output, `${width}-${locale}-${theme}.png`), (await wc.capturePage()).toPNG());
        }
      }
      win.setContentSize(1366, 768);
      await run("state.locale='en';state.appearance='midnight';render();");
      await wait("document.querySelectorAll('[data-production-modes]').length === 1");
      // Native disclosure keyboard behavior, with no generated preference write.
      wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      const key = async (key, code = key, windowsVirtualKeyCode = 13) => {
        await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, text: key === "Enter" ? "\r" : undefined });
        await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
      };
      const before = await run("JSON.stringify({...localStorage})");
      await run("document.querySelector('[data-ai-customize-trigger]').focus()"); await key("Enter");
      assert(await run("document.querySelector('[data-ai-customize]').open"));
      assert.equal(await run("JSON.stringify({...localStorage})"), before);
      for (const [name, value] of [["aspect", "16:9"], ["duration", "10"], ["goal", "quality"]]) {
        await run(`(() => {const s=document.querySelector('[data-ai-setting="${name}"]');s.value='${value}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.equal(await run(`localStorage.getItem('viral-ai-generation-${name}')`), value);
      }
      await run("document.querySelector('[data-ai-customize-trigger]').focus()"); await key("Enter");
      assert(!await run("document.querySelector('[data-ai-customize]').open"));
      assert(await run("document.querySelector('[data-ai-settings-summary]').textContent.includes('16:9')"));
      // Readiness repaint retains textarea selection and disclosure state.
      await run("document.querySelector('[data-ai-customize]').open=true;const t=document.querySelector('[data-ai-brief]');t.value='Preserve my draft';t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();t.setSelectionRange(3,7);window.dispatchEvent(new Event('focus'));");
      await wait("document.querySelector('[data-ai-readiness]').textContent === 'AI ready'");
      assert(await run("document.activeElement.matches('[data-ai-brief]') && document.activeElement.selectionStart===3 && document.activeElement.selectionEnd===7 && document.querySelector('[data-ai-customize]').open"));
      // Canonical scene actions, context sync, no prompt reset or submit.
      await run("document.querySelector('[data-project-scene-action=add]').click()");
      await wait("ViralCoreProjectPersistence.snapshot().scenePlan.scenes.length===2");
      const selected = await run("ViralCoreProjectPersistence.snapshot().scenePlan.selectedSceneId");
      assert(await run("document.querySelector('[data-ai-scene-context]').textContent.includes('02')"));
      await run("document.querySelector('[data-project-scene-action=up]').click()");
      assert.equal(await run("ViralCoreProjectPersistence.snapshot().scenePlan.scenes[0].id"), selected);
      await run("document.querySelector('[data-project-scene-action=delete]').click()");
      await wait("ViralCoreProjectPersistence.snapshot().scenePlan.scenes.length===1");
      assert(await run("document.querySelector('[data-project-scene-action=delete]').disabled"));
      assert.equal(await run("document.querySelector('[data-ai-brief]').value"), "Preserve my draft");
      // UX-2 rename through real integration, Enter and Escape, focus restoration.
      await run("document.querySelector('[data-project-name-rename]').click()");
      await run("const n=document.querySelector('[data-project-name]');n.value='Renamed film';n.dispatchEvent(new Event('input',{bubbles:true}));n.focus()"); await key("Enter");
      await wait("ViralCoreProjectPersistence.snapshot().projectName==='Renamed film'");
      assert(await run("document.activeElement.matches('[data-project-name-rename]')"));
      await run("document.querySelector('[data-project-name-rename]').click();document.querySelector('[data-project-name]').value='Discard'"); await key("Escape", "Escape", 27);
      assert.equal(await run("ViralCoreProjectPersistence.snapshot().projectName"), "Renamed film");
      assert(await run("document.activeElement.matches('[data-project-name-rename]')"));
      await wait("document.querySelectorAll('[data-production-modes]').length===1");
      await run("const s=document.querySelector('[data-production-mode]');s.focus();s.value='auto';s.dispatchEvent(new Event('change',{bubbles:true}));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert(await run("document.activeElement.matches('[data-production-mode]') && document.activeElement.value==='auto'"));
      assert(await run("!document.querySelector('[data-production-details]').open && !document.querySelector('[data-production-modes] [role=status]').closest('details') && !document.querySelector('[data-production-action=review]').closest('details') && !document.querySelector('[data-production-action=stop]').closest('details')"));
      const beforeWorkflowDisclosure = await run("JSON.stringify({...localStorage})");
      await run("document.querySelector('[data-production-details-trigger]').focus()"); await key("Enter");
      assert(await run("document.querySelector('[data-production-details]').open"));
      assert.equal(await run("JSON.stringify({...localStorage})"), beforeWorkflowDisclosure);
      await run("window.dispatchEvent(new Event('focus'));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
      assert(await run("document.querySelector('[data-production-details]').open && document.activeElement.matches('[data-production-details-trigger]')"));
      await run("document.querySelector('[data-production-mode]').focus()");
      await run("window.dispatchEvent(new Event('focus'));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
      assert(await run("document.activeElement.matches('[data-production-mode]') && document.activeElement.value==='auto'"));
      // Muse UI suppresses controls; unavailable AI permits drafting and Settings.
      await run("fixture.muse=true;window.dispatchEvent(new Event('focus'))");
      await wait("!document.querySelector('[data-ai-setting]')");
      assert(await run("document.querySelector('[data-ai-settings-summary]').textContent.includes('Using the current Muse settings')"));
      await run("fixture.ready=false;window.dispatchEvent(new Event('focus'))");
      await wait("document.querySelector('[data-ai-readiness]').textContent === `AI isn't ready`");
      assert(await run("document.querySelector('[data-ai-generate]').disabled && !document.querySelector('[data-ai-brief]').disabled && !!document.querySelector('[data-ai-action=settings]')"));
      // Long content, text expansion, reduced motion, bounded scene scrolling.
      await run("ViralCoreProjectPersistence.renameProject(ViralCoreProjectPersistence.activeProjectId(),'Long project name '.repeat(100));state.scenePlan.scenes[0].title='Long scene title '.repeat(100);ViralCoreProjectPersistence.flush();const t=document.querySelector('[data-ai-brief]');t.value='x'.repeat(8000);t.dispatchEvent(new Event('input',{bubbles:true}));state.motion='reduced';render();");
      await wait("document.querySelectorAll('[data-production-modes]').length === 1");
      const longContent = await run("({length:document.querySelector('[data-ai-brief]').value.length,scroll:document.querySelector('#page').scrollWidth,width:document.querySelector('#page').clientWidth,overflow:Array.from(document.querySelectorAll('.core-ai-create-workspace *')).filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(n=>[n.tagName,n.className,n.getBoundingClientRect().width])})");
      assert(longContent.length===8000 && longContent.scroll<=longContent.width+1, JSON.stringify(longContent));
      const expanded = await run(`(() => {for(const n of document.querySelectorAll('.core-ai-create-workspace button,.core-ai-create-workspace summary,.core-ai-prompt-label'))n.style.letterSpacing='.12em';const p=document.querySelector('#page');return p.scrollWidth<=p.clientWidth+1;})()`);
      assert(expanded);
      assert.equal(await run("getComputedStyle(document.querySelector('.core-ai-input-canvas')).transitionDuration"), "0s");
      await run("state.motion='balanced';render()");
      await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      assert.equal(await run("getComputedStyle(document.querySelector('.core-ai-input-canvas')).transitionDuration"), "0s");
      await run("for(const [k,v] of Object.entries(I18N.messages.en.aiCreate))if(typeof v==='string')I18N.messages.en.aiCreate[k]=v+' '+v.slice(0,Math.ceil(v.length*.4));render()");
      assert(await run("document.querySelector('#page').scrollWidth<=document.querySelector('#page').clientWidth+1"), "40% text expansion must fit");
      await run("for(let i=0;i<20;i++)ViralCoreProjectPersistence.addProjectScene({}, {projectId:ViralCoreProjectPersistence.activeProjectId()})");
      assert(await run("document.querySelector('.core-project-scene-list').scrollHeight>document.querySelector('.core-project-scene-list').clientHeight && document.querySelector('.core-project-scene-list').clientHeight<=340"));
      assert.equal(await run("fixture.submissions.length"), 0);
      assert.deepEqual(await run("fixture.errors"), []);
      assert.deepEqual(network, []);
      // Same isolated profile, actual renderer reload: existing preferences and
      // draft survive; presentation disclosure is closed without a saved key.
      const loaded = new Promise(resolve => wc.once("did-finish-load", resolve)); wc.reload(); await loaded;
      await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
      await run("state.page='ai-create';state.locale='en';render()");
      await wait("document.querySelectorAll('[data-production-modes]').length === 1");
      await wait("getComputedStyle(document.querySelector('#page')).visibility==='visible'");
      assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-ai-setting]'),n=>[n.dataset.aiSetting,n.value])"), [["aspect", "16:9"], ["duration", "10"], ["goal", "quality"]]);
      assert(await run("!document.querySelector('[data-ai-customize]').open && document.querySelector('[data-ai-brief]').value.length===8000"));
      assert.equal(await run("document.querySelector('[data-production-mode]').value"), "auto");
      assert.equal(await run("fixture.submissions.length"), 0);
      assert.deepEqual(await run("fixture.errors"), []);
      wc.debugger.detach();
      const report = { ok: true, fullRenderer: true, nativeServices: false, networkRequests: network.length, submissions: 0, hierarchy, layouts, checks: ["no-project", "native Customize keyboard", "existing settings keys", "preferences and draft after reload", "focus and selection across readiness", "scene add/select/move/delete/final guard", "rename Enter/Escape/focus", "Muse presentation", "provider blocked", "8000 characters", "long names", "40% text expansion", "text spacing", "app and OS reduced motion", "bounded Scene list scrolling", "no duplicate Production Modes", "Production Mode focus and preference"] };
      fs.writeFileSync(path.join(output, "desktop-report.json"), JSON.stringify(report, null, 2));
      console.log("UX-3 desktop acceptance PASS:", path.join(output, "desktop-report.json"));
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error); if (win) fs.writeFileSync(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG()); app.exit(1); }
  });
}
