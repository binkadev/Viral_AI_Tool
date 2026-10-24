"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=name=>fs.readFileSync("renderer/"+name,"utf8"),css=read("core-commercial-design-system.css"),motion=read("core-commercial-motion.js");
const ids=["home","ai-create","generation-progress","library","productions","batch-production","settings"];
function shell(locale="en") {
  const events={},nav={innerHTML:""},state={page:"home",locale,jobs:[]},window={},document={readyState:"loading",documentElement:{dataset:{}},addEventListener:(n,fn)=>{(events[n]||=[]).push(fn);},getElementById:id=>id==="nav"?nav:null};
  class Element {} const c={state,window,document,navItems:[],pages:{},navRender(){},render(){},save(){},jobsTable:()=>"",t:key=>key,HTMLElement:Element,HTMLButtonElement:Element,MutationObserver:class{observe(){}}};
  vm.createContext(c);vm.runInContext(read("core-product-shell.js"),c);events.DOMContentLoaded.forEach(fn=>fn());c.navRender();return {c,nav};
}
test("source shell has exactly seven canonical routes and two ordered groups",()=>{const {c,nav}=shell();assert.deepEqual(Array.from(c.navItems.filter(n=>n.id),n=>n.id),ids);assert.deepEqual(Array.from(c.navItems.filter(n=>n.group),n=>n.group),["core-workflow","core-manage"]);assert.equal((nav.innerHTML.match(/class="nav-group"/g)||[]).length,2);for(const id of ["download","ai-video","accounts","usage","billing"])assert(!nav.innerHTML.includes('data-page="'+id+'"'));});
test("Private Beta allowlist exactly matches source and repeated filtering stays stable",()=>{const model=require("../renderer/core-private-beta-model"),{c}=shell();assert.deepEqual([...model.primary],ids);for(let i=0;i<3;i++)c.navItems.splice(0,c.navItems.length,...c.navItems.filter(n=>n.group||model.primary.has(n.id)));assert.deepEqual(Array.from(c.navItems.filter(n=>n.id),n=>n.id),ids);});
test("contextual routes and account code remain intact without sidebar entries",()=>{const shell=read("core-product-shell.js"),home=read("core-start-home.js"),beta=read("core-private-beta.js"),app=read("app.js");assert(shell.includes('pages.download = function coreImportPage()'));assert(shell.includes('current.page = "download"'));assert(home.includes("routeButton('download'"));assert(home.includes('runtime.open(project.dataset.homeProject)'));assert(home.includes("['ai-create','download','ai-video','library','settings']"));assert(beta.includes('window.ViralCorePlayer?.projectPreview?.hasProject?.()'));for(const id of ["accounts","usage","billing"])assert(app.includes(id));});
test("palette derives canonical nav and cannot expose hidden primary destinations",()=>{const p=read("core-command-palette.js");assert(p.includes('document.querySelectorAll("#nav .nav-item[data-page]")'));assert(p.includes('!node.hidden && node.getAttribute("aria-hidden") !== "true"'));assert(p.includes('target.click()'));});
test("navigation guard keeps active clicks and Studio DOM preservation",()=>{const n=read("core-navigation-stability.js");for(const token of ['event.stopImmediatePropagation()','structureMatches','locale !== lastLocale','nextSignature === lastEditorSignature','viral-ai:editor-render-preserved'])assert(n.includes(token));assert(!motion.includes('innerHTML'));assert(!motion.includes('replaceChildren'));assert(!motion.includes('appendChild'));});
test("semantic Midnight tokens, radii, surface levels and system typography",()=>{for(const token of ['--viral-bg-0: #090a0f','--viral-bg-1: #0d0f17','--viral-surface-1: #131620','--viral-surface-2: #181b27','--viral-surface-3: #202431','--radius-control: 8px','--radius-card: 12px','--radius-feature: 16px','--radius-modal: 18px','--viral-depth-1:','--viral-depth-2:','--viral-depth-3:','--viral-focus:'])assert(css.includes(token),token);assert(read('styles.css').includes('Segoe UI Variable'));});
test("CSS-first motion durations/easings, no framework or remote asset",()=>{for(const token of ['--motion-instant: 80ms','--motion-fast: 140ms','--motion-normal: 200ms','--motion-slow: 320ms','--motion-hero: 600ms','--ease-standard:','--ease-enter:','--ease-exit:','--ease-emphasized:'])assert(css.includes(token));for(const source of [css,motion])for(const bad of ['transition: all','transition:all','https://','http://','@import','WebGL','THREE.','setInterval','setTimeout','scrollTo(','scrollIntoView(','pointermove','requestAnimationFrame'])assert(!source.includes(bad),bad);assert(!css.includes('infinite'));});
test("explicit scope avoids broad control/card/page descendant redesign",()=>{assert(!/(?:^|\n)\s*(?:button|input|\.card|#page\s+\*)\s*\{/m.test(css));assert(!css.includes('transition-property: all'));assert(!css.includes('animation:.*height'));assert(css.includes('html:is([data-viral-motion-zone="expressive"], [data-viral-motion-zone="controlled"]) #page > .viral-enter-surface'));});
test("reduced-motion covers both app and OS without removing focus",()=>{assert(css.includes('html[data-motion="reduced"]'));assert(css.includes('@media (prefers-reduced-motion: reduce)'));assert.equal((css.match(/animation: none !important; transition: none !important; transform: none !important/g)||[]).length,2);assert(css.includes('outline: 2px solid var(--viral-focus)'));assert(!css.includes('outline: none'));});
test("Studio exclusions do not fight entry lifecycle through panel CSS",()=>{assert(css.includes(':not([data-commercial-page="ai-video"]) #page'));assert(!css.includes('[data-editor-entry]'));assert(!css.includes('transition-property: color, background-color, border-color !important'));for(const bad of ['currentTime','play()','pause()','localStorage','projectName','openProject','save(','persistence','setAttribute("src"'])assert(!motion.includes(bad),bad);});
function motionHarness(page="home") {
  const root={dataset:{}},surfaces=[],events={},calls=[],nodes=()=>surfaces.map(n=>n.classes);let hidden=false;
  class Element {constructor(){this.hidden=hidden;this.classes=new Set();this.classList={add:k=>this.classes.add(k)};}}
  const host={children:surfaces},state={page},c={document:{readyState:"loading",documentElement:root,addEventListener:(n,fn)=>{events[n]=fn;},getElementById:()=>host},state,HTMLElement:Element,
    render(){calls.push(state.page);surfaces.splice(0,surfaces.length,new Element());return "existing-render";}};
  vm.createContext(c);vm.runInContext(motion,c);events.DOMContentLoaded();return {c,state,root,calls,nodes,surfaces,Element,hide:()=>{hidden=true;}};
}
test("motion helper has no second initial render and marks route changes only",()=>{const h=motionHarness();assert.equal(h.calls.length,0);assert.equal(h.root.dataset.viralMotionZone,"expressive");h.state.page="productions";assert.equal(h.c.render(),"existing-render");assert(h.nodes()[0].has('viral-enter-surface'));h.c.render();assert(!h.nodes()[0].has('viral-enter-surface'));assert.equal(h.calls.length,2);});
test("Studio render is delegated once with no animation classes",()=>{const h=motionHarness();h.state.page="ai-video";h.c.render();assert.equal(h.root.dataset.viralMotionZone,"workstation");assert(!h.nodes()[0].has('viral-enter-surface'));h.c.render();assert.equal(h.calls.length,2);assert(!h.nodes()[0].has('viral-enter-surface'));});
test("motion zone mapping covers the seven real pages without affecting routes",()=>{for(const id of ids){const h=motionHarness('download');h.state.page=id;h.c.render();assert.equal(h.state.page,id);assert.equal(h.root.dataset.commercialPage,id);assert.equal(h.root.dataset.viralMotionZone,["home","ai-create"].includes(id)?"expressive":"controlled");}});
test("hidden direct surfaces never receive reveals",()=>{const h=motionHarness();h.hide();h.state.page='settings';h.c.render();assert(!h.nodes()[0].has('viral-enter-surface'));});
test("contextual Import keeps its existing choreography without double entry",()=>{const h=motionHarness();h.state.page='download';h.c.render();assert(!h.nodes()[0].has('viral-enter-surface'));assert.equal(h.root.dataset.viralMotionZone,'controlled');});
test("foundation stylesheet is late and helper is after existing navigation/preservation",()=>{const html=read("index.html");assert(html.indexOf('href="core-commercial-design-system.css"')>html.indexOf('href="core-project-render.css"'));assert(html.indexOf('href="core-commercial-design-system.css"')>html.indexOf('href="core-motion-policy.css"'));assert(html.indexOf('src="core-commercial-motion.js"')>html.indexOf('src="core-navigation-stability.js"'));assert(html.includes('data-motion="balanced"'));});

function entryHarness({zone="workstation",kind="editor",reduced=false,osReduced=false}={}) {
  const root={dataset:{viralMotionZone:zone,motion:reduced?"reduced":"balanced"}},frames=[],events={};
  class Element {
    constructor(){this.listeners=new Map();this.adds=0;this.removes=0;}
    addEventListener(name,fn){this.listeners.set(name,fn);this.adds++;}
    removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);this.removes++;}
  }
  const editor=new Element(),dock=new Element(),home=new Element(),page=new Element();
  let active=kind,observer;
  page.querySelector=selector=>selector==='[data-creator-home]'?(active==='home'?home:null):active==='editor'?(selector==='.core-editor-bottom-dock'?dock:editor):null;
  const state={jobs:[{id:'source-a',sourcePath:'local.mp4'}]},c={state,HTMLElement:Element,
    document:{documentElement:root,readyState:'complete',getElementById:()=>page},
    window:{matchMedia:()=>({matches:osReduced}),addEventListener:(name,fn)=>{events[name]=fn;}},
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}},requestAnimationFrame:fn=>{frames.push(fn);}};
  vm.createContext(c);vm.runInContext(read('core-commercial-entry.js'),c);
  return {root,editor,dock,page,state,frames,events,scan(){observer();this.frame();},frame(){const batch=frames.splice(0);batch.forEach(fn=>fn());},flush(){while(frames.length)this.frame();},surface(value){active=value;},home};
}

test("workstation Editor activation clears stale state without arming cleanup or travel",()=>{
  const h=entryHarness();h.root.dataset.editorEntry='pending';h.root.dataset.creatorEntry='ready';h.frame();
  assert(!('editorEntry' in h.root.dataset));assert(!('creatorEntry' in h.root.dataset));
  assert.equal(h.frames.length,0);assert.equal(h.dock.adds,0);assert.equal(h.dock.listeners.size,0);
  assert.equal(h.page.querySelector('.core-editor-focus-section'),h.editor);
  h.scan();assert(!('editorEntry' in h.root.dataset));assert.equal(h.dock.adds,0);
  h.root.dataset.editorEntry='ready';h.scan();assert(!('editorEntry' in h.root.dataset));
});

test("workstation never arms Editor entry under app or OS reduced motion",()=>{
  for(const options of [{reduced:true},{osReduced:true}]){const h=entryHarness(options);h.flush();assert(!('editorEntry' in h.root.dataset));assert.equal(h.dock.adds,0);assert.equal(h.frames.length,0);}
});

test("Home retains pending-to-ready entry choreography and reduced-motion behavior",()=>{
  const h=entryHarness({zone:'expressive',kind:'home'});h.frame();assert.equal(h.root.dataset.creatorEntry,'pending');
  h.frame();assert.equal(h.root.dataset.creatorEntry,'pending');h.frame();assert.equal(h.root.dataset.creatorEntry,'ready');assert.equal(h.dock.adds,0);
  for(const options of [{reduced:true},{osReduced:true}]){const r=entryHarness({zone:'expressive',kind:'home',...options});r.frame();assert.equal(r.root.dataset.creatorEntry,'ready');assert.equal(r.frames.length,0);}
});

test("workstation entry invalidates queued Home generation without touching Editor nodes",()=>{
  const h=entryHarness({zone:'expressive',kind:'home'});h.frame();h.surface('editor');h.root.dataset.viralMotionZone='workstation';
  h.scan();h.flush();assert(!('editorEntry' in h.root.dataset));assert(!('creatorEntry' in h.root.dataset));assert.equal(h.dock.adds,0);assert.equal(h.page.querySelector('.core-editor-focus-section'),h.editor);
});

test("existing Editor settle listener detaches when the same surface becomes workstation",()=>{
  const h=entryHarness({zone:'controlled'});h.flush();assert.equal(h.root.dataset.editorEntry,'ready');assert.equal(h.dock.listeners.size,1);
  h.root.dataset.viralMotionZone='workstation';h.scan();assert(!('editorEntry' in h.root.dataset));assert.equal(h.dock.listeners.size,0);assert.equal(h.dock.removes,1);h.flush();assert.equal(h.dock.adds,1);
});

test("queued legacy Editor entry rechecks workstation policy before arming cleanup",()=>{
  const h=entryHarness({zone:'controlled'});h.frame();assert.equal(h.root.dataset.editorEntry,'pending');h.frame();
  h.root.dataset.viralMotionZone='workstation';h.flush();assert(!('editorEntry' in h.root.dataset));assert.equal(h.dock.adds,0);
});

test("legacy source identity and normal settle cleanup remain valid outside workstation",()=>{
  const h=entryHarness({zone:'controlled'});h.flush();const handler=h.dock.listeners.get('transitionend');
  handler({target:h.dock,propertyName:'opacity'});assert.equal(h.root.dataset.editorEntry,'ready');
  handler({target:h.dock,propertyName:'translate'});assert(!('editorEntry' in h.root.dataset));assert.equal(h.dock.listeners.size,0);
  h.scan();assert.equal(h.frames.length,0);h.state.jobs[0].id='source-b';h.scan();assert.equal(h.root.dataset.editorEntry,'pending');
  h.surface('home');h.root.dataset.viralMotionZone='expressive';h.scan();h.flush();assert.equal(h.root.dataset.creatorEntry,'ready');assert(!('editorEntry' in h.root.dataset));
});
