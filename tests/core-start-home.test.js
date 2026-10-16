"use strict";
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
// Execute bootstrap with a persisted project: startup routing must not discard it.
for (const previousRoute of ['ai-video', 'ai-create', 'download', 'home']) {
  const source = {id:'project-source', name:'Existing.mp4', sourcePath:'C:/existing.mp4', fileState:'missing'};
  let saved = {page:previousRoute, locale:'en', jobs:[source], translation:{result:{segments:[{text:'Preserve me'}]}}};
  const listeners = {};
  const context = {
    localStorage:{getItem:()=>JSON.stringify(saved),setItem:(_,v)=>{saved=JSON.parse(v);}},
    document:{documentElement:{dataset:{}},createElement:()=>({remove(){}}),head:{appendChild(){}},body:{appendChild(){}},getElementById:()=>null,querySelector:()=>null,addEventListener:(name,fn)=>{listeners[name]=fn;}},
    requestAnimationFrame:fn=>fn()
  };
  vm.runInNewContext(read('core-bootstrap.js'), context);
  assert.equal(saved.page,'home');
  assert.deepEqual(saved.jobs,[source]);
  assert.equal(saved.translation.result.segments[0].text,'Preserve me');
  context.state = {...saved,page:previousRoute};
  context.render = ()=>{};
  listeners.DOMContentLoaded();
  assert.equal(context.state.page,'home');
}
const context = {window:{}};
vm.runInNewContext(read('i18n.js'),context);
const {vi,en} = context.window.I18N.messages;
assert.deepEqual(Object.keys(vi.startHome).sort(),Object.keys(en.startHome).sort());
assert(!read('core-creator-home.js').includes('if (current) current.page = "download"'));
assert(!read('core-creator-home-production.js').includes('restoreStartupRoute'));
assert(read('index.html').includes('src="core-start-home.js"'));
new Function(read('core-start-home.js'));
console.log('Home launch routing, persisted project recovery, and VI/EN contracts passed');
