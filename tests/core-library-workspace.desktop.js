'use strict';
// Real renderer + canonical Project persistence. Records and IPC outcomes are
// presentation fixtures; one preview comes from the existing thumbnail service
// reading a real deterministic local test clip. Network is always blocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='c96d7f041d54c73f79fcb651043d0338b7740eed',baseline=process.argv.includes('--baseline');
if(!process.versions.electron){
  (async()=>{
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'viral-ai-ux5-media-')),clip=path.join(folder,'test-pattern.mp4');
    await require('../dev/generated-handoff-harness').makeVideo(clip);
    const preview=await require('../services/ffmpeg').createThumbnail(clip,folder),file=path.join(folder,'media.json');fs.writeFileSync(file,JSON.stringify({path:clip,...preview}));
    const env={...process.env,VIRAL_UX5_MEDIA_FIXTURE:file};delete env.ELECTRON_RUN_AS_NODE;
    const r=require('node:child_process').spawnSync(require('electron'),[__filename,...(baseline?['--baseline']:[])],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:240000});
    process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1;
  })().catch(e=>{console.error(e);process.exitCode=1;});
}else{
  const {app,BrowserWindow,session}=require('electron'),{pathToFileURL}=require('node:url'),media=JSON.parse(fs.readFileSync(process.env.VIRAL_UX5_MEDIA_FIXTURE,'utf8'));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'viral-ai-ux5-library-')),output=path.join(root,'out/ux5',baseline?'before':'after');fs.mkdirSync(output,{recursive:true});
  app.setPath('userData',profile);app.setPath('sessionData',profile);app.disableHardwareAcceleration();let renderer=path.join(root,'renderer');
  if(baseline){renderer=path.join(profile,'renderer');fs.cpSync(path.join(root,'renderer'),renderer,{recursive:true});for(const name of ['index.html','i18n.js'])fs.writeFileSync(path.join(renderer,name),require('node:child_process').execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'show',base+':renderer/'+name],{cwd:root}));}
  const fixture=`
    window.fixture={calls:[],errors:[],real:${JSON.stringify(media)}};
    window.addEventListener('error',e=>{if(e.message)fixture.errors.push(e.message)});window.addEventListener('unhandledrejection',e=>fixture.errors.push(String(e.reason)));
    window.desktopAPI={
      async getGenerationStatus(){return {ok:true,value:{ready:false,state:'not_configured',providers:[],modelIds:[]}}},
      async getGenerationJob(id){return {ok:true,value:{id,projectId:state.projectId,sceneId:state.scenePlan.selectedSceneId,status:'interrupted'}}},onGenerationChanged(){return ()=>{}},
      async fileStatus(p){fixture.calls.push(['fileStatus',p]);return {exists:!p.includes('missing')&&!p.includes('trashed')}},
      async showFile(p){fixture.calls.push(['showFile',p]);return {ok:true}},
      async selectVideos(){fixture.calls.push(['selectVideos']);return [{path:fixture.real.path,name:'Local test pattern.mp4'}]},
      async createThumbnail(p){fixture.calls.push(['thumbnail',p]);return {metadata:fixture.real.metadata,dataUrl:fixture.real.dataUrl}},async getVideoUrl(){return ''},
      async selectReplacementVideo(){fixture.calls.push(['replacement']);return {path:fixture.real.path,name:'Relinked test pattern.mp4'}},
      async trashFile(p){fixture.calls.push(['trash',p]);return {ok:true}},
      getAccount:async()=>({ok:false}),getTranslationStatus:async()=>({ready:false}),getVoiceStatus:async()=>({ready:false}),minimize(){},toggleMaximize(){},close(){}
    };
  `;
  const file=path.join(profile,'library.html');fs.writeFileSync(file,fs.readFileSync(path.join(renderer,'index.html'),'utf8').replace('<head>','<head><base href="'+pathToFileURL(renderer+path.sep).href+'"><script>'+fixture+'</script>'));
  app.whenReady().then(async()=>{
    let win;
    try{
      const network=[],screenshots=[],metrics=[],checks=[];
      session.defaultSession.webRequest.onBeforeRequest((d,done)=>{const allow=/^(file|data|blob):/.test(d.url);if(!allow)network.push(d.url);done({cancel:!allow});});
      win=new BrowserWindow({show:false,width:1366,height:768,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      const wc=win.webContents,run=async s=>{try{return await wc.executeJavaScript('{\n'+s+'\n}',true)}catch(e){throw Error(s+'\n'+e.message)}};
      const wait=async s=>{const end=Date.now()+10000;while(!await run(s)){if(Date.now()>end)throw Error('Timed out: '+s);await new Promise(r=>setTimeout(r,30));}};
      const settle=async()=>{await wait("getComputedStyle(document.querySelector('#page')).visibility==='visible' && document.documentElement.dataset.theme===state.appearance");await run('new Promise(r=>setTimeout(r,500))');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
      const capture=async(name,initial=true)=>{
        if(initial)await run("document.querySelector('#page').scrollTop=0");await settle();
        const m=await run(`(()=>{const p=document.querySelector('#page'),cards=document.querySelectorAll('[data-library-item]'),action=cards[0]?.querySelector('.library-context-action'),empty=document.querySelector('.library-empty');return {width:innerWidth,height:innerHeight,locale:state.locale,theme:state.appearance,overflow:p.scrollWidth>p.clientWidth+1,count:cards.length,pageBottom:p.getBoundingClientRect().bottom,firstActionBottom:action?.getBoundingClientRect().bottom,emptyBottom:empty?.getBoundingClientRect().bottom,realPreviews:document.querySelectorAll('[data-library-preview]:not([hidden])').length}})()`);
        assert(!m.overflow,name+JSON.stringify(m));if(!baseline&&initial&&m.emptyBottom)assert(m.emptyBottom<=m.pageBottom,name+JSON.stringify(m));if(!baseline&&initial&&m.firstActionBottom)assert(m.firstActionBottom<=m.pageBottom,name+JSON.stringify(m));
        if(!baseline){m.statusContrast=await run(`(()=>{const lum=v=>{const n=v.match(/[0-9]*[.]?[0-9]+/g).slice(0,3).map(Number),rgb=v.startsWith('color(srgb')?n:n.map(x=>x/255);return rgb.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0)};return [...document.querySelectorAll('.library-status')].map(n=>{const a=lum(getComputedStyle(n).color),b=lum(getComputedStyle(n.closest('.library-media-item')).backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})})()`);assert(m.statusContrast.every(n=>n>=4.5),name+': status contrast '+JSON.stringify(m.statusContrast));}
        await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(output,name),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());screenshots.push(name);metrics.push({name,...m});
      };
      await win.loadFile(file);await wait("document.documentElement.dataset.coreFirstPaint==='ready'");await run("state.locale='vi';state.appearance='midnight';state.page='library';render()");
      await run("ViralCoreProjectPersistence.createProject({kind:'ai',projectName:'Studio 01'})");
      const configure=async(count,mode='grid')=>{
        await run(`(()=>{
          if(fixture.originalStorageError)ViralCoreProjectPersistence.storageError=fixture.originalStorageError;
          const id=ViralCoreProjectPersistence.activeProjectId(),sceneId=state.scenePlan.selectedSceneId;
          state.media={schemaVersion:1,assets:[],selectedAssetId:null};state.generationOutputs=[];
          state.jobs=Array.from({length:${count}},(_,i)=>{const kind=${JSON.stringify(mode)}==='unverified'?'unverified':${JSON.stringify(mode)}==='missing'?'missing':${JSON.stringify(mode)}==='loading'?'loading':i===1?'generated':i===2?'exported':i===3?'unverified':i===4?'missing':i===5?'processing':i===6?'loading':'imported';
            const j={id:'library-source-'+i,projectId:id,name:kind==='unverified'?'AI video awaiting confirmation.mp4':kind==='generated'?'AI scene video.mp4':kind==='exported'?'Project export.mp4':kind==='missing'?'Missing source.mp4':kind==='processing'?'Export in progress.mp4':kind==='loading'?'Reading source.mp4':i===0?'Local test pattern.mp4':'Coast '+String(i).padStart(3,'0')+'.mp4',sourcePath:i===0?fixture.real.path:'C:/fixture/source-'+i+'.mp4',fileState:'available',mediaState:kind==='loading'?'reading':'ready',status:'queued',meta:{...fixture.real.metadata}};
            if(i===0&&kind==='imported')j.thumbnail=fixture.real.dataUrl;
            if(kind==='missing'){j.sourcePath='C:/fixture/missing-'+i+'.mp4';j.fileState='missing';j.mediaState='missing';}
            if(kind==='loading')delete j.meta;
            if(kind==='generated'||kind==='unverified'){j.generationJobId='library-gen-'+i;j.assetId='generation:'+j.generationJobId;j.sceneId=sceneId;state.generationOutputs.push({jobId:j.generationJobId,sceneId,assetId:kind==='generated'?j.assetId:null});if(kind==='generated')state.media.assets.push({id:j.assetId,kind:'video',origin:'generated',providerAssetId:j.generationJobId,localPath:j.sourcePath,name:j.name,status:'ready',fileState:'available',meta:j.meta});}
            if(kind==='exported'||kind==='processing'){j.isRenderOutput=true;j.outputPath='C:/fixture/export-'+i+'.mp4';j.status=kind==='processing'?'processing':'completed';if(kind==='processing')j.progress=28;}
            return j;
          });ViralCoreProjectPersistence.flush();state.page='library';const old=document.querySelector('#library-search');if(old)old.value='';render();
        })()`);await settle();
      };
      await configure(0);await capture('1366-vi-midnight-empty.png');
      await configure(1);await capture('1366-vi-midnight-one-item.png');
      await configure(8);await capture('1366-vi-midnight-grid.png');
      const search=async q=>{await run(`const input=document.querySelector(${JSON.stringify(baseline?'#search':'#library-search')});input.value=${JSON.stringify(q)};input.dispatchEvent(new Event('input',{bubbles:true}))`);};
      await search('Coast');await capture('1366-vi-midnight-search-results.png');await search('nothing-matches');await capture('1366-vi-midnight-search-empty.png');
      await configure(1,'unverified');await capture('1366-vi-midnight-unverified.png');
      await configure(1,'missing');await capture('1366-vi-midnight-missing-source.png');
      await configure(1,'loading');await capture('1366-vi-midnight-loading.png');
      await run("fixture.originalStorageError=ViralCoreProjectPersistence.storageError;ViralCoreProjectPersistence.storageError=()=> 'RAW_FIXTURE_ERROR';render()");await capture('1366-vi-midnight-error.png');
      await configure(8);win.setContentSize(1920,1080);await capture('1920-vi-midnight-grid.png');
      win.setContentSize(1366,768);await run("state.locale='en';render()");await capture('1366-en-midnight-grid.png');await run("state.locale='vi';state.appearance='aurora-light';render()");await capture('1366-vi-aurora-grid.png');await run("state.appearance='midnight';state.motion='reduced';render()");await capture('1366-vi-midnight-reduced-motion.png');
      for(const count of [25,100]){await configure(count);await capture('1366-vi-midnight-'+count+'-items.png');assert(await run("document.querySelector('#page').scrollHeight>document.querySelector('#page').clientHeight"));}
      if(!baseline){
        checks.push('0/1/8/25/100 records; 1366/1920; VI/EN; Midnight/Aurora; no horizontal overflow');
        await configure(8);const ids=await run('state.jobs.map(j=>j.id)'),scene=await run('state.scenePlan.selectedSceneId');
        await search('Coast');assert.equal(await run("document.querySelectorAll('[data-library-item]').length"),1);await run("document.querySelector('[data-library-item] [data-job-action=reveal]').click()");await wait("fixture.calls.some(c=>c[0]==='showFile')");assert.equal((await run("fixture.calls.filter(c=>c[0]==='showFile')")).length,1);checks.push('existing file action executes once after search replaces items');
        await run("window.dispatchEvent(new Event('focus'))");await settle();assert.equal(await run("document.querySelector('#library-search').value"),'Coast');assert.deepEqual(await run('state.jobs.map(j=>j.id)'),ids);assert.equal(await run('state.scenePlan.selectedSceneId'),scene);checks.push('search/paint never changes records, Project or selected Scene');
        wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        const key=async k=>{await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:13,text:k==='Enter'?'\r':undefined});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:13});};
        await configure(1);await run("document.querySelector('.library-item-details summary').focus()");await key('Enter');assert(await run("document.querySelector('.library-item-details').open"));checks.push('native Details keyboard access and visible focus');
        const beforeTrash=await run("fixture.calls.filter(c=>c[0]==='trash').length");await run("document.querySelector('[data-job-action=trash]').click()");await wait("!document.querySelector('#modal').classList.contains('hidden')");assert.equal(await run("fixture.calls.filter(c=>c[0]==='trash').length"),beforeTrash);await run("document.querySelector('#modal .button.ghost').click()");assert.equal(await run('state.jobs.length'),1);checks.push('Trash still requires existing confirmation; cancelling retains record and file');
        await configure(1,'missing');const id=await run('state.jobs[0].id');await run("document.querySelector('[data-job-action=relink]').click()");await wait("state.jobs[0].fileState==='available'");assert.equal(await run('state.jobs[0].id'),id);checks.push('existing relink replaces path through original handler and retains record ID');
        await configure(1,'unverified');assert(await run("document.querySelector('.library-status').textContent===I18N.messages.vi.libraryWorkspace.states.unverified"));assert(await run("document.querySelector('[data-library-check]') && !document.querySelector('.library-item-actions [data-job-action=reveal]')"));checks.push('unverified generation is never visually Ready or attached by Library');
        await configure(0);await run("document.querySelector('.library-empty [data-page=download]').click()");await wait("state.page==='download' && document.querySelector('#creatorPrimaryImport')?.dataset.creatorWired==='true'");await run("document.querySelector('#creatorPrimaryImport').click()");await wait("state.jobs.length===1 && state.jobs[0].mediaState==='ready'");checks.push('Import uses unchanged download route, creator import action, picker, addSourceFiles and thumbnail mechanism');
        await configure(8);await run("ViralCoreProjectPersistence.renameProject(ViralCoreProjectPersistence.activeProjectId(),'Long project name '.repeat(80));state.jobs[0].name='Long filename '.repeat(80)+'.mp4';ViralCoreProjectPersistence.flush();render()");assert(await run("document.querySelector('#page').scrollWidth<=document.querySelector('#page').clientWidth+1"));await capture('1366-vi-midnight-long-names.png',false);
        await run("state.locale='en';for(const[k,v]of Object.entries(I18N.messages.en.libraryWorkspace))if(typeof v==='string')I18N.messages.en.libraryWorkspace[k]=v+' '+v.slice(0,Math.ceil(v.length*.4));render();for(const n of document.querySelectorAll('.library-workspace *')){n.style.letterSpacing='.12em';n.style.wordSpacing='.16em';n.style.lineHeight='1.8'}");assert(await run("document.querySelector('#page').scrollWidth<=document.querySelector('#page').clientWidth+1"));await capture('1366-en-midnight-text-expansion.png',false);checks.push('long filenames/Project names, 40% expansion and text spacing fit');
        assert.equal(await run("getComputedStyle(document.querySelector('.library-workspace .button')).transitionDuration"),'0s');await run("state.motion='balanced';render()");await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run("getComputedStyle(document.querySelector('.library-workspace .button')).transitionDuration"),'0s');checks.push('application and OS Reduced Motion');wc.debugger.detach();
      }
      assert.deepEqual(network,[]);assert.deepEqual(await run('fixture.errors'),[]);
      fs.writeFileSync(path.join(output,'desktop-report.json'),JSON.stringify({ok:true,task:'UX-5',base,baseline,screenshots,metrics,checks,networkRequests:0,fixtureNote:'Records and IPC outcomes are mocked presentation states. The first preview is a real thumbnail of a deterministic local test-pattern MP4 from the existing thumbnail service; no fake sample thumbnail or live provider result.',realPreview:{metadata:media.metadata,sha256:require('node:crypto').createHash('sha256').update(Buffer.from(media.dataUrl.split(',')[1],'base64')).digest('hex')}},null,2));
      console.log('UX-5 Library Electron acceptance PASS:',output);win.destroy();app.exit(0);
    }catch(e){console.error(e);if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
  });
}
