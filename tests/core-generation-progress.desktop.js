"use strict";
// Full renderer, real canonical Project/Scene fixtures, mocked jobs and output
// evidence. No service/provider execution. The baseline is frozen UX-3.2.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='6ac836d38f0a49514d2da3f8165613d56d4e59c5',baseline=process.argv.includes('--baseline');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const r=require('node:child_process').spawnSync(require('electron'),[__filename,...(baseline?['--baseline']:[])],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:240000});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1;
}else{
  const {app,BrowserWindow,session}=require('electron'),{pathToFileURL}=require('node:url');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'viral-ai-ux4-')),output=path.join(root,'out/ux4',baseline?'before':'after');
  fs.mkdirSync(output,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);app.disableHardwareAcceleration();
  let renderer=path.join(root,'renderer');
  if(baseline){
    renderer=path.join(profile,'renderer');fs.cpSync(path.join(root,'renderer'),renderer,{recursive:true});
    for(const name of ['core-generation-progress.js','core-generation-progress.css','i18n.js'])fs.writeFileSync(path.join(renderer,name),require('node:child_process').execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'show',base+':renderer/'+name],{cwd:root}));
  }
  const fixture=`
    window.fixture={jobs:[],calls:[],errors:[],ready:true,probe:true,mode:'active'};
    window.addEventListener('error',e=>fixture.errors.push(e.message));window.addEventListener('unhandledrejection',e=>fixture.errors.push(String(e.reason)));
    const find=id=>fixture.jobs.find(j=>j.id===id);
    window.desktopAPI={
      async listGenerationJobs(id){fixture.calls.push(['list',id]);if(fixture.loadError)return {ok:false};return {ok:true,value:fixture.jobs};},
      async getGenerationStatus(){return {ok:true,value:{ready:fixture.ready,state:fixture.ready?'ready':'not_configured',modelIds:['fixture'],providers:[]}};},
      async getGenerationJob(id){return {ok:true,value:find(id)};},onGenerationChanged(fn){(fixture.listeners||=[]).push(fn);fixture.changed=()=>fixture.listeners.forEach(f=>f());return ()=>{};},
      async submitGeneration(){fixture.calls.push(['submit']);throw Error('forbidden live submit');},
      async retryGeneration(p){fixture.calls.push(['retry',p]);return {ok:false};},
      async cancelGeneration(id){fixture.calls.push(['cancel',id]);find(id).status='cancelled';return {ok:true,value:find(id)};},
      async recoverGeneration(id){fixture.calls.push(['recover',id]);return {ok:true,value:find(id)};},
      async getGenerationOutput(id){return {ok:true,value:{jobId:id,projectId:find(id).projectId,sceneId:find(id).sceneId,path:'C:/fixture/'+id+'.mp4',fileName:id+'.mp4',verified:true}};},
      async probeVideo(){return fixture.probe?{duration:6,width:1920,height:1080}:{duration:0};},
      async listRecoveryCandidates(id){fixture.calls.push(['candidates',id]);return {ok:true,value:{version:1,expiresAt:Date.now()+120000,candidates:[{candidateId:'candidate-a',width:1920,height:1080,duration:6,available:true}]}};},
      async revealRecoveryCandidate(id,candidateId){fixture.calls.push(['reveal',id,candidateId]);return {ok:true,value:{candidateId,revealed:true}};},
      async confirmRecoveryCandidate(id,candidateId){fixture.calls.push(['confirm',id,candidateId]);return {ok:false,errorCode:'RECOVERY_CHANGED'};},
      async dismissRecovery(id){fixture.calls.push(['dismiss',id]);return {ok:true};},
      async openGenerationProviderSession(id){fixture.calls.push(['open',id]);return {ok:true};},
      getAccount:async()=>({ok:false}),getTranslationStatus:async()=>({ready:false}),getVoiceStatus:async()=>({ready:false}),minimize(){},toggleMaximize(){},close(){}
    };
  `;
  const html=fs.readFileSync(path.join(renderer,'index.html'),'utf8').replace('<head>','<head><base href="'+pathToFileURL(renderer+path.sep).href+'"><script>'+fixture+'</script>');
  const fixtureFile=path.join(profile,'progress.html');fs.writeFileSync(fixtureFile,html);
  app.whenReady().then(async()=>{
    let win;
    try{
      const network=[],screenshots=[],metrics=[],checks=[];
      session.defaultSession.webRequest.onBeforeRequest((d,done)=>{const allow=/^(file|data|blob):/.test(d.url);if(!allow)network.push(d.url);done({cancel:!allow});});
      win=new BrowserWindow({show:false,width:1366,height:768,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      const wc=win.webContents,run=async s=>{try{return await wc.executeJavaScript('{\n'+s+'\n}',true);}catch(e){throw Error(s+'\n'+e.message);}};
      const wait=async s=>{const end=Date.now()+10000;while(!await run(s)){if(Date.now()>end)throw Error('Timed out: '+s);await new Promise(r=>setTimeout(r,30));}};
      const settle=async()=>{await wait("getComputedStyle(document.querySelector('#page')).visibility==='visible' && document.documentElement.dataset.theme===state.appearance");await run('new Promise(r=>setTimeout(r,500))');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
      const capture=async (name,initial=true)=>{
        if(initial)await run("document.querySelector('#page').scrollTop=0");await settle();
        const m=await run(`(()=>{const p=document.querySelector('#page'),w=document.querySelector('.generation-workspace'),b=w?.querySelector('.generation-primary-action'),s=w?.querySelector('.generation-summary');return {width:innerWidth,height:innerHeight,locale:state.locale,theme:state.appearance,overflow:p.scrollWidth>p.clientWidth+1,headline:s?.querySelector('h2')?.textContent,stageCount:w?.querySelectorAll('.generation-stages li').length,primaryCount:w?.querySelectorAll('.generation-primary-action:not(:disabled)').length,primaryBottom:b?.getBoundingClientRect().bottom,summaryBottom:s?.getBoundingClientRect().bottom,pageBottom:p.getBoundingClientRect().bottom,progress:!!w?.querySelector('progress'),sceneCount:w?.querySelectorAll('.generation-scene').length};})()`);
        if(!baseline&&m.primaryCount){
          m.ctaContrast=await run(`(()=>{const s=getComputedStyle(document.querySelector('.generation-primary-action:not(:disabled)'));const lum=value=>{const n=value.match(/[0-9]*[.]?[0-9]+/g).slice(0,3).map(Number),rgb=value.startsWith('color(srgb')?n:n.map(v=>v/255);return rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)};const a=lum(s.color),b=lum(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`);
          assert(m.ctaContrast>=4.5,name+': readable primary action');
        }
        assert(!m.overflow,name+JSON.stringify(m));if(!baseline&&m.stageCount){assert.equal(m.stageCount,7);assert(m.primaryCount<=1,name);if(initial&&m.primaryBottom)assert(m.primaryBottom<=m.pageBottom,name+JSON.stringify(m));}
        // Keep capture from changing native focus and wait for the hidden
        // compositor to present the new DOM before recording its pixels.
        await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});
        await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        fs.writeFileSync(path.join(output,name),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());screenshots.push(name);metrics.push({name,...m});
      };
      await win.loadFile(fixtureFile);await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
      await run("state.locale='vi';state.appearance='midnight';state.page='ai-create';render()");
      await run("(async()=>{await ViralCoreProjectPersistence.createProject({kind:'ai',projectName:'Studio 01'});state.scenePlan.scenes[0].title=I18N.messages.vi.aiCreate.examples[0].title;ViralCoreProjectPersistence.flush();state.page='ai-create';render();const t=document.querySelector('[data-ai-brief]');t.value=I18N.messages.vi.aiCreate.examples[0].prompt;t.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await wait("document.querySelectorAll('[data-production-modes]').length===1");await capture('create-1366-vi-midnight-regression.png');
      // Each state rebuilds a canonical persisted Scene plan; all job facts below
      // are explicitly mocked presentation evidence, including completed export.
      const configure=async(mode,count=1)=>{
        await run(`(async()=>{
          fixture.mode=${JSON.stringify(mode)};fixture.loadError=false;fixture.ready=true;fixture.probe=true;
          const id=ViralCoreProjectPersistence.activeProjectId();
          const first=state.scenePlan.scenes[0];state.scenePlan.scenes=[first];state.scenePlan.selectedSceneId=first.id;
          first.title=I18N.messages.vi.generationProgress.visualScenes[0][0];first.sourceText='Actual fixture script';first.visualIntent=I18N.messages.vi.generationProgress.visualScenes[0][1];
          state.scenePlan.sourceType='script';
          for(let i=1;i<${count};i++)ViralCoreProjectPersistence.addProjectScene({title:I18N.messages.vi.generationProgress.visualScenes[i%4][0]}, {projectId:id});
          state.scenePlan.selectedSceneId=first.id;ViralCoreProjectPersistence.flush();
          fixture.jobs=state.scenePlan.scenes.map((s,i)=>{const status=${JSON.stringify(mode)}==='multiscene'?(i===0?'completed':i===1?'running':i===2?'interrupted':'queued'):${JSON.stringify(mode)}==='completed'?'completed':${JSON.stringify(mode)}==='attention'?'failed':['uncertain','recovery','unverified'].includes(${JSON.stringify(mode)})?'interrupted':'running';const j={id:'fixture-job-'+i,projectId:id,sceneId:s.id,status,provider:['uncertain','recovery'].includes(${JSON.stringify(mode)})?'muse':'fixture',createdAt:'2026-10-24T00:00:'+String(i).padStart(2,'0')+'Z',request:{prompt:s.title,kind:'video',mode:'text-to-video'}};
          if(status==='completed'){j.asset={fileName:j.id+'.mp4'};j.output={fileName:j.id+'.mp4'};}
          if(${JSON.stringify(mode)}==='recovery')j.manualRecovery={version:1,eligible:true};
          if(${JSON.stringify(mode)}==='uncertain')j.recoveryState='acceptance_unproven';return j;});
          if(${JSON.stringify(mode)}==='initial')fixture.jobs=[];
          if(${JSON.stringify(mode)}==='unverified'){fixture.jobs[0].status='completed';delete fixture.jobs[0].asset;}
          state.voice={job:${JSON.stringify(mode)}==='completed'?{status:'completed'}:null,result:${JSON.stringify(mode)}==='completed'?{outputPath:'C:/fixture/voice.wav'}:null};
          state.jobs=${JSON.stringify(mode)}==='completed'?[{id:'fixture-render',isRenderOutput:true,status:'completed',outputPath:'C:/fixture/export.mp4',fileState:'available'},{id:'fixture-source',sourcePath:'C:/fixture/fixture-job-0.mp4',fileState:'available'}]:[];
          await ViralGenerationProgress.open(fixture.jobs[${JSON.stringify(mode)}==='multiscene'?1:0]?.id);
        })()`);await settle();
      };
      await configure('active');await capture('1366-vi-midnight-active.png');
      if(!baseline){assert(await run("!document.querySelector('.generation-summary progress')"));checks.push('unknown progress has no meter or percentage');}
      for(const mode of ['attention','uncertain','recovery','completed']){await configure(mode);await capture('1366-vi-midnight-'+mode+'.png');}
      await configure('multiscene',8);await capture('1366-vi-midnight-multiscene.png');
      await run("document.querySelector('.generation-story').scrollIntoView({block:'start',behavior:'instant'})");await capture('1366-vi-midnight-multiscene-overview.png',false);
      await configure('active');win.setContentSize(1920,1080);await capture('1920-vi-midnight-active.png');
      win.setContentSize(1366,768);await run("state.locale='en';render()");await capture('1366-en-midnight-active.png');
      await run("state.locale='vi';state.appearance='aurora-light';render()");await capture('1366-vi-aurora-active.png');
      await run("state.appearance='midnight';state.motion='reduced';render()");await capture('1366-vi-midnight-reduced-motion.png');
      for(const mode of ['initial','unverified']){await configure(mode);await capture('1366-vi-midnight-'+mode+'.png');}
      await configure('active');await run("fixture.loadError=true;window.dispatchEvent(new Event('focus'))");await wait("document.querySelector('[role=alert]')");await capture('1366-vi-midnight-load-error.png');
      if(!baseline){
        wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        const key=async(key,code=key)=>{await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:13,text:key==='Enter'?'\r':undefined});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:13});};
        await configure('active');const beforeDetails=await run('JSON.stringify({...localStorage})');
        await run("document.querySelector('[data-generation-details-trigger]').focus()");await key('Enter');assert(await run("document.querySelector('[data-generation-details]').open"));
        await run("fixture.beforeRefreshNode=document.querySelector('.generation-workspace');window.dispatchEvent(new Event('focus'))");await wait("document.querySelector('.generation-workspace')!==fixture.beforeRefreshNode && document.activeElement.matches('[data-generation-details-trigger]')");assert(await run("document.querySelector('[data-generation-details]').open"));assert.equal(await run('JSON.stringify({...localStorage})'),beforeDetails);checks.push('native details keyboard, focus and open state survive refresh; no storage write');
        await configure('multiscene',25);const selectedScene=await run('ViralCoreProjectPersistence.snapshot().scenePlan.selectedSceneId');
        await run("document.querySelector('.generation-scenes').scrollTop=160;document.querySelector('[data-generation-select]').focus();fixture.beforeRefreshNode=document.querySelector('.generation-workspace');window.dispatchEvent(new Event('focus'))");
        await wait("document.querySelector('.generation-workspace')!==fixture.beforeRefreshNode && document.activeElement.matches('[data-generation-select]')");
        assert.equal(await run("document.querySelector('.generation-scenes').scrollTop"),160);checks.push('request selector focus and Scene-list scrolling survive refresh');
        await run("document.querySelector('[data-generation-job=fixture-job-0]').click()");await wait("document.querySelector('.generation-scene.is-current [data-generation-job]')?.dataset.generationJob==='fixture-job-0'");assert.equal(await run('ViralCoreProjectPersistence.snapshot().scenePlan.selectedSceneId'),selectedScene);checks.push('row review changes followed request only; canonical Scene selection unchanged');
        assert(await run("document.querySelector('.generation-scenes').scrollHeight>document.querySelector('.generation-scenes').clientHeight && document.querySelector('.generation-scenes').clientHeight<=480"));
        await configure('uncertain');assert(await run("!document.querySelector('[data-generation-action=retry]')&&!document.querySelector('[data-generation-action=recover]')&&!!document.querySelector('[data-generation-action=new-request]')"));
        assert(await run("!document.querySelector('.generation-safety')?.closest('details') && document.querySelector('.generation-explanation').textContent===I18N.messages.vi.generationProgress.acceptanceUnproven"));checks.push('acceptance-unproven cannot retry/recover; warning outside details');
        await configure('recovery');assert(await run("document.querySelectorAll('.generation-primary-action:not(:disabled)').length===1"));
        const beforeRecovery=await run('fixture.calls.length');await run("document.querySelector('[data-recovery-action=list]').click()");await wait("!!document.querySelector('[data-recovery-action=confirm]')");assert(await run("document.querySelector('[data-recovery-action=confirm]').disabled"));
        await run("document.querySelector('[data-recovery-action=view]').click()");await wait("!document.querySelector('[data-recovery-action=confirm]').disabled");await run("document.querySelector('.generation-recovery-candidates').scrollIntoView({block:'center',behavior:'instant'})");await capture('1366-vi-midnight-recovery-candidates.png',false);
        assert(!(await run('fixture.calls.slice('+beforeRecovery+')')).some(c=>c[0]==='confirm'));checks.push('explicit candidates/reveal required before confirm; no automatic confirmation');
        await run("document.querySelector('[data-recovery-action=confirm]').click()");await wait("document.querySelector('.generation-recovery [role=alert]')");assert(await run("document.querySelector('.generation-recovery [role=alert]').textContent===I18N.messages.vi.manualRecovery.changed"));checks.push('changed candidate fails closed with visible recovery error');
        await configure('unverified');assert(await run("!document.querySelector('[data-generation-action=studio]') && document.querySelector('.generation-explanation').textContent===I18N.messages.vi.generationProgress.unverified"));
        await configure('completed');await run("fixture.probe=false;window.dispatchEvent(new Event('focus'))");await wait("!document.querySelector('[data-generation-action=studio]')");checks.push('Studio remains output-probe gated');
        await configure('completed');await run("document.querySelector('[data-generation-action=studio]').click()");await wait("state.page==='ai-video'");checks.push('existing Studio handler routes only verified usable output');
        await configure('active');await run("ViralCoreProjectPersistence.renameProject(ViralCoreProjectPersistence.activeProjectId(),'Long project name '.repeat(100));state.scenePlan.scenes[0].title='Long scene name '.repeat(100);ViralCoreProjectPersistence.flush();render()");
        assert(await run("document.querySelector('#page').scrollWidth<=document.querySelector('#page').clientWidth+1"));
        await run("state.locale='en';for(const group of ['generationProgress','manualRecovery'])for(const [k,v]of Object.entries(I18N.messages.en[group]))if(typeof v==='string')I18N.messages.en[group][k]=v+' '+v.slice(0,Math.ceil(v.length*.4));render();for(const n of document.querySelectorAll('.generation-workspace *')){n.style.letterSpacing='.12em';n.style.wordSpacing='.16em';n.style.lineHeight='1.8'}");
        assert(await run("document.querySelector('#page').scrollWidth<=document.querySelector('#page').clientWidth+1"));checks.push('long names, 40% expansion and text spacing fit');
        assert.equal(await run("getComputedStyle(document.querySelector('.generation-workspace .button')).transitionDuration"),'0s');
        await run("state.motion='balanced';render()");await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run("getComputedStyle(document.querySelector('.generation-workspace .button')).transitionDuration"),'0s');checks.push('application and OS reduced motion');
        wc.debugger.detach();
      }
      const calls=await run('fixture.calls');assert(!calls.some(c=>c[0]==='submit'||c[0]==='retry'),JSON.stringify(calls));assert.deepEqual(network,[]);assert.deepEqual(await run('fixture.errors'),[]);
      const report={ok:true,task:'UX-4',base,baseline,screenshots,metrics,checks,networkRequests:network.length,submitCalls:0,retryCalls:0,mockedPresentationStates:true,mockNote:'All generation jobs, video probe/output, Voice and Export completion facts and manual-recovery candidates are fixtures. Canonical Project/Scene persistence and renderer handlers are real. No live service results.',calls};
      fs.writeFileSync(path.join(output,'desktop-report.json'),JSON.stringify(report,null,2));console.log('UX-4 Electron screenshots and acceptance PASS:',output);win.destroy();app.exit(0);
    }catch(e){console.error(e);if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
  });
}
