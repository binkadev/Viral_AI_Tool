'use strict';
// Full renderer + canonical Registry snapshots/models. Runtime views and file
// health are local presentation fixtures, never live provider results.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='4d169a07d975e986c7a89febc5a15705e9d2acdf',baseline=process.argv.includes('--baseline');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const r=require('node:child_process').spawnSync(require('electron'),[__filename,...process.argv.slice(2)],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:240000});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1;
}else{
  const {app,BrowserWindow,session}=require('electron'),{pathToFileURL}=require('node:url'),f=require('./helpers/production-manager-fixtures');
  function scenario(count,kind='mixed'){
    const projects=[],renders={};let production=null,active=null;
    for(let i=0;i<count;i++){
      const p=f.project('ux6-project-'+i),type=kind==='mixed'?['recovery','review','missing','rendering','paused','completed','waiting','draft'][i%8]:kind;
      p.projectName=({recovery:'Interrupted export',review:'Review scene materials',missing:'Missing source',rendering:'Video in production',paused:'Paused preparation',completed:'Finished film',waiting:'Ready for export',draft:'New idea'}[type]||'Project')+' '+String(i+1).padStart(2,'0');
      if(kind==='long')p.projectName='Long project name '.repeat(40);
      if(type==='recovery')p.workflow.jobs.push(f.job(p,'interrupted-'+i,'interrupted',{outputPath:null,fileState:'pending'}));
      if(type==='review')p.mediaAssembly.slots[1].selectedAssetId=null;
      if(type==='missing')p.media.assets[0].fileState='missing';
      if(type==='rendering')renders[p.projectId]={projectId:p.projectId,jobId:'active-'+i,busy:true,state:'scenes',percent:null,sceneIndex:2,sceneCount:3};
      if(type==='completed'){for(let j=0;j<8;j++)p.workflow.jobs.push(f.job(p,'finished-'+i+'-'+j,'completed',{completedAt:'2026-01-0'+(j+1)+'T00:00:01Z'}));}
      if(type==='draft')for(const slot of p.mediaAssembly.slots){slot.candidateAssetIds=[];slot.selectedAssetId=null;}
      if(type==='paused'||type==='active'){active=p.projectId;production={state:type==='active'?'running':'paused',run:{projectId:p.projectId,mode:type==='active'?'auto':'assisted'},current:p.scenePlan.scenes[1].id,phase:'waiting'};}
      projects.push(p);
    }
    return {projects,renders,production,active:active||projects[0]?.projectId||null};
  }
  const scenarios={empty:scenario(0),single:scenario(1,'active'),attention:scenario(3,'missing'),mixed:scenario(8),completed:scenario(1,'completed'),recovery:scenario(1,'recovery'),large:scenario(25),long:scenario(8,'long')};
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'viral-ai-ux6-')),output=path.join(root,'out/ux9',baseline?'home-before':'home-after');fs.mkdirSync(output,{recursive:true});
  app.setPath('userData',profile);app.setPath('sessionData',profile);app.disableHardwareAcceleration();let renderer=path.join(root,'renderer');
  if(baseline){renderer=path.join(profile,'renderer');fs.cpSync(path.join(root,'renderer'),renderer,{recursive:true});for(const name of ['core-start-home.js','core-product-shell.js','core-layout.js','i18n.js','index.html'])fs.writeFileSync(path.join(renderer,name),require('node:child_process').execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'show',base+':renderer/'+name],{cwd:root}));}
  const fixture=`
    const config=JSON.parse(localStorage.getItem('ux6-fixture-config')||'{}'),scenarios=${JSON.stringify(scenarios)},data=scenarios[config.case||'empty'];
    window.fixture={config,production:data.production,renders:data.renders,missing:data.projects.flatMap(p=>p.media.assets.filter(a=>a.fileState==='missing').map(a=>a.localPath)),calls:[],errors:[]};
    localStorage.setItem('viral-ai-core-project-registry-v1',JSON.stringify({schemaVersion:1,activeProjectId:data.active,projects:data.projects}));
    localStorage.removeItem('viral-ai-core-project-snapshot');localStorage.removeItem('viral-ai-tool-state');
    window.addEventListener('error',e=>{if(e.message)fixture.errors.push(e.message)});window.addEventListener('unhandledrejection',e=>fixture.errors.push(String(e.reason)));
    window.desktopAPI={
      getGenerationStatus:async()=>{fixture.calls.push(['readiness']);return ({ok:true,value:{ready:false,state:'not_configured',providers:[],modelIds:[]}})},onGenerationChanged:()=>()=>{},
      async listGenerationJobs(){fixture.calls.push(['jobs-read']);return {ok:true,value:[]}},
      async checkGenerationProvider(){fixture.calls.push(['provider-status-read']);return {ok:true,value:{id:'muse',enabled:false,ready:false,state:'unconfigured'}}},
      async getTelegramStatus(){fixture.calls.push(['telegram-status-read']);return {ok:true,data:{configured:false,secureStorageAvailable:true,enabled:false}}},
      async submitGeneration(){fixture.calls.push(['WORK-generation']);throw Error('forbidden')},async startBatch(){fixture.calls.push(['WORK-batch']);throw Error('forbidden')},
      async fileStatus(p){fixture.calls.push(['stat',p]);return {exists:!fixture.missing.includes(p),sizeBytes:fixture.missing.includes(p)?0:1024}},async showFile(p){fixture.calls.push(['show',p]);return {ok:true}},
      async getVideoUrl(){return ''},async probeVideo(){return {duration:3,width:320,height:180}},
      getAccount:async()=>({ok:false}),getTranslationStatus:async()=>({ready:false}),getVoiceStatus:async()=>({ready:false}),onRenderProgress(){return ()=>{}},minimize(){},toggleMaximize(){},close(){}
    };

  `;
  const file=path.join(profile,'production.html');fs.writeFileSync(file,fs.readFileSync(path.join(renderer,'index.html'),'utf8').replace('<head>','<head><base href="'+pathToFileURL(renderer+path.sep).href+'"><script>'+fixture+'</script>'));
  app.whenReady().then(async()=>{let win;try{
    const network=[],screenshots=[],metrics=[],checks=[],consoleErrors=[];session.defaultSession.webRequest.onBeforeRequest((d,done)=>{const allow=/^(file|data|blob):/.test(d.url);if(!allow)network.push(d.url);done({cancel:!allow});});
    win=new BrowserWindow({show:false,width:1366,height:768,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on('console-message',details=>{if(details.level==='error')consoleErrors.push(details.message)});
    const wc=win.webContents,run=async s=>{try{return await wc.executeJavaScript('{\n'+s+'\n}',true)}catch(e){throw Error(s+'\n'+e.message)}},wait=async s=>{const end=Date.now()+12000;while(!await run(s)){if(Date.now()>end)throw Error('Timed out: '+s);await new Promise(r=>setTimeout(r,30));}};
    const settle=async()=>{await wait("getComputedStyle(document.querySelector('#page')).visibility==='visible'&&document.documentElement.dataset.theme===state.appearance");await run('new Promise(r=>setTimeout(r,400))');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
    const configure=async(name,locale='vi',theme='midnight',motion='balanced')=>{
      if(wc.getURL()){assert.deepEqual(await run('fixture.errors'),[]);await run(`localStorage.setItem('ux6-fixture-config',${JSON.stringify(JSON.stringify({case:name}))})`);}
      await win.loadFile(file);await wait("document.documentElement.dataset.coreFirstPaint==='ready'");
      await run(`(async()=>{const persistence=ViralCoreProjectPersistence,target=persistence.activeProjectId();for(const[id,view]of Object.entries(fixture.renders)){await persistence.openProject(id);persistence.updateProjectAudioSettings(id,{voiceEnabled:false,burnSubtitles:false});const plan=ViralCoreProjectRenderModel.build(persistence.projectAudioSnapshot(id));persistence.updateProjectRender(id,{action:'admit',job:{id:view.jobId,isRenderOutput:true,renderKind:'project',projectId:id,renderInputSignature:plan.renderInputSignature}});}if(target&&persistence.activeProjectId()!==target)await persistence.openProject(target);state.page='home';if(target)persistence.updateProjectAudioSettings(target,{voiceEnabled:false,burnSubtitles:false});const originalProductionView=ViralProductionModes.runtime.view;ViralProductionModes.runtime.view=()=>({...originalProductionView(),...(fixture.production||{})});ViralCoreProjectRender.runtime.view=id=>fixture.renders[id]||{busy:false};const original=persistence.openProject;persistence.openProject=async id=>{fixture.calls.push(['open',id]);return original(id)};state.locale=${JSON.stringify(locale)};state.appearance=${JSON.stringify(theme)};state.motion=${JSON.stringify(motion)};render()})()`);
      await settle();if(name==='completed'||name==='mixed'||name==='large'){await run('ViralProductionManager.runtime.observe()');await wait("ViralProductionManager.runtime.collect().summaries.some(s=>s.status==='ready')");await run('render()');await settle();}
    };
    const capture=async name=>{
      await run("document.querySelector('#page').scrollTop=0;document.querySelectorAll('.sidebar *,.topbar *').forEach(n=>{n.style.setProperty('animation','none','important');n.style.setProperty('transition','none','important')})");await settle();
      const m=await run("(()=>{const p=document.querySelector('#page'),r=p.getBoundingClientRect(),primary=document.querySelector('.home-primary');return {route:state.page,rect:{x:r.x,y:r.y,width:r.width,height:r.height},overflow:p.scrollWidth>p.clientWidth+1,primaryCount:document.querySelectorAll('.home-primary').length,primaryBottom:primary?.getBoundingClientRect().bottom,projectCards:document.querySelectorAll('.home-project').length,nav:[...document.querySelectorAll('#nav [data-page]')].map(n=>n.dataset.page),active:[...document.querySelectorAll('#nav [aria-current=page]')].map(n=>n.dataset.page)}})()");
      assert(!m.overflow,name);if(!baseline){assert.equal(m.primaryCount,1);assert(m.primaryBottom<=768||name.startsWith('1920')||name.includes('expansion')||name.includes('long'));assert(m.projectCards<=3);assert.deepEqual(m.active,['home']);}
      await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(output,name),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());screenshots.push(name);metrics.push({name,...m});
    };
    await configure('empty');
    if(!process.argv.includes('--flow-only')){
    await configure('empty');await capture('1366-vi-midnight-empty.png');
    await configure('single');await capture('1366-vi-midnight-one-project.png');
    await configure('completed');await capture('1366-vi-midnight-continue.png');
    await configure('attention');await capture('1366-vi-midnight-attention.png');
    await configure('mixed');await capture('1366-vi-midnight-multiple-projects.png');
    await configure('empty');await capture('1366-vi-midnight-ai-unconfigured.png');
    win.setContentSize(1920,1080);await configure('mixed');await capture('1920-vi-midnight-home.png');win.setContentSize(1366,768);
    await configure('mixed','en');await capture('1366-en-midnight-home.png');
    await configure('mixed','vi','aurora-light');await capture('1366-vi-aurora-home.png');
    await configure('mixed','vi','midnight','reduced');await capture('1366-vi-midnight-reduced-motion.png');
    await configure('large');await capture('1366-vi-midnight-25-projects.png');
    await configure('long');await capture('1366-vi-midnight-long-names.png');
    }
    {
      await configure('mixed');await run('ViralCoreProjectPersistence.flush()');await settle();
      const registry=await run("localStorage.getItem('viral-ai-core-project-registry-v1')"),active=await run('ViralCoreProjectPersistence.activeProjectId()'),scene=await run('state.scenePlan.selectedSceneId');
      wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      const enter=async()=>{await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});};
      const flow=[];
      for(const id of ['home','ai-create','generation-progress','library','productions','batch-production','settings','home']){
        await run(`document.querySelector('#nav [data-page="${id}"]').focus()`);await enter();await settle();
        assert.deepEqual(await run('fixture.errors'),[],id+': no renderer error');assert.equal(await run('state.page'),id);assert.deepEqual(await run("[...document.querySelectorAll('#nav [aria-current=page]')].map(n=>n.dataset.page)"),[id]);
        assert.equal(await run('document.activeElement.dataset.page'),id);assert(await run('document.activeElement.matches(":focus-visible")'));
        assert.equal(await run('ViralCoreProjectPersistence.activeProjectId()'),active);assert.equal(await run('state.scenePlan.selectedSceneId'),scene);
        const latest=await run("localStorage.getItem('viral-ai-core-project-registry-v1')");
        const business=value=>{const r=JSON.parse(value);for(const p of r.projects){delete p.updatedAt;delete p.editor.page;}return r;};
        assert.deepEqual(business(latest),business(registry),id+': Project content unchanged');flow.push({route:id,keyboardFocus:true,ariaCurrent:true,projectContentUnchanged:true,routeMetadataPersisted:latest!==registry});
      }
      checks.push({flow,metadata:'Existing nav save persists editor.page and updatedAt; all other Registry fields compared exactly. Same baseline flow is also run.'});
      assert.deepEqual(await run("fixture.calls.filter(c=>c[0].startsWith('WORK')||c[0]==='open')"),[]);
      if(!baseline){
      // Original active-production switch guard, followed by exact successful open.
      await run("document.querySelector('[data-home-project=ux6-project-1]').click()");await settle();assert.equal(await run('ViralProductionManager.runtime.collect().error'),'materialRunSwitchBlocked');assert(await run("!!document.querySelector('.home-notice')"));
      await run("fixture.production=null;document.querySelector('[data-home-project=ux6-project-1]').click();document.querySelector('[data-home-project=ux6-project-1]')?.click()");await wait("state.page==='ai-video'");assert.equal(await run('ViralCoreProjectPersistence.activeProjectId()'),'ux6-project-1');assert.deepEqual(await run("fixture.calls.filter(c=>c[0]==='open')"),[['open','ux6-project-1']]);
      checks.push('Native Continue/Review delegates exact ID once, original production-switch guard retained; failed open displays commercial guidance.');
      await configure('empty');await run("document.querySelector('.home-primary').focus()");await enter();await settle();assert.equal(await run('state.page'),'ai-create');assert.equal(await run('ViralCoreProjectPersistence.listProjects().length'),0);checks.push('Empty primary opens drafting without creating Project or calling generation.');
      await configure('mixed','en');await run("for(const[k,v]of Object.entries(I18N.messages.en.homeWorkspace))I18N.messages.en.homeWorkspace[k]=v+' '+v.slice(0,Math.ceil(v.length*.4));render();for(const n of document.querySelectorAll('.home-workspace *')){n.style.letterSpacing='.12em';n.style.wordSpacing='.16em';n.style.lineHeight='1.8'}");if(!process.argv.includes('--flow-only'))await capture('1366-en-midnight-text-expansion.png');
      await configure('empty','vi','midnight','reduced');assert.equal(await run("getComputedStyle(document.querySelector('.home-primary')).transitionDuration"),'0s');await run("state.motion='balanced';render()");await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run("getComputedStyle(document.querySelector('.home-primary')).transitionDuration"),'0s');wc.debugger.detach();
      checks.push('40% Home text expansion plus text spacing; app and OS Reduced Motion.');
      }else wc.debugger.detach();
    }
    assert.deepEqual(consoleErrors,[]);assert.deepEqual(network,[]);assert.deepEqual(await run('fixture.errors'),[]);assert.deepEqual(await run("fixture.calls.filter(c=>c[0].startsWith('WORK'))"),[]);
    fs.writeFileSync(path.join(output,process.argv.includes('--flow-only')?'flow-only-report.json':'desktop-report.json'),JSON.stringify({ok:true,task:'UX-9',base,baseline,screenshots,metrics,checks,consoleErrors,calls:await run('fixture.calls'),networkRequests:0,note:'Canonical local Registry snapshots; local mocked runtime/readiness/file health. Output verification explicitly seeded by fixture setup, never by Home. Existing automatic readiness/status reads retained; no provider execution, live service or network.'},null,2));console.log('UX-9 Home/shell Electron PASS');win.destroy();app.exit(0);
  }catch(e){console.error(e);if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1)}});
}