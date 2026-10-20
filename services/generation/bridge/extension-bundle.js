"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=Object.freeze(['manifest.json','receipt-v2.js','service-worker.js','content-script.js','popup.html','popup.js','popup.css','strings.js']);
function check(ok){if(!ok)throw Object.assign(Error('Invalid managed extension bundle'),{code:'INVALID_REQUEST'});}
function safeDirectory(directory) {
  const absolute=path.resolve(directory),parsed=path.parse(absolute);
  let current=parsed.root;
  for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    if(fs.existsSync(current)){const s=fs.lstatSync(current);check(s.isDirectory() && !s.isSymbolicLink());}
    else {try{fs.lstatSync(current);check(false);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
}
function safeContents(directory,ancestors=true) {
  if(ancestors)safeDirectory(directory);
  if(!fs.existsSync(directory))return;
  const root=fs.lstatSync(directory);check(root.isDirectory() && !root.isSymbolicLink());
  for(const name of fs.readdirSync(directory)) {
    check(FILES.includes(name));
    const s=fs.lstatSync(path.join(directory,name));check(s.isFile() && !s.isSymbolicLink());
  }
}
function readBundle(source,config) {
  check(typeof source==='string' && path.isAbsolute(source));
  safeContents(source,false); // Source may be inside Electron's virtual ASAR.
  const files=FILES.map(file=>({file,data:fs.readFileSync(path.join(source,file))}));
  const manifest=JSON.parse(files.find(f=>f.file==='manifest.json').data);
  check(manifest.version===config.expectedExtensionVersion && manifest.manifest_version===3 &&
    manifest.background?.service_worker==='service-worker.js' && manifest.action?.default_popup==='popup.html' &&
    JSON.stringify(manifest.content_scripts?.flatMap(s=>s.js))===JSON.stringify(['receipt-v2.js','content-script.js']));
  const marker=(file,name)=>files.find(f=>f.file===file).data.toString('utf8').match(new RegExp("const "+name+"='([^']+)'"))?.[1];
  const workerBuild=marker('service-worker.js','WORKER_BUILD'),contentBuild=marker('content-script.js','CONTENT_BUILD');
  check(workerBuild===config.expectedWorkerBuild && contentBuild===config.expectedContentBuild);
  return {files,summary:{extensionVersion:manifest.version,workerBuild,contentBuild}};
}
function matches(directory,bundle) {
  try {safeContents(directory);return bundle.files.every(({file,data})=>fs.readFileSync(path.join(directory,file)).equals(data));}
  catch {return false;}
}
function identity(directory) {
  try {
    safeContents(directory);
    const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
    const marker=(file,name)=>fs.readFileSync(path.join(directory,file),'utf8').match(new RegExp("const "+name+"='([^']+)'"))?.[1];
    const workerBuild=marker('service-worker.js','WORKER_BUILD'),contentBuild=marker('content-script.js','CONTENT_BUILD');
    check(/^\d+\.\d+\.\d+$/.test(manifest.version) && /^muse-worker-[a-z0-9-]{1,64}$/.test(workerBuild||'') && /^muse-content-[a-z0-9-]{1,64}$/.test(contentBuild||''));
    return {extensionVersion:manifest.version,workerBuild,contentBuild};
  }catch{return null;}
}
function removeOwnedDirectory(directory) {
  // Only the eight known regular files in a unique staging/backup directory.
  // No recursive removal, no junction following, no unrelated files.
  safeContents(directory);
  if(!fs.existsSync(directory))return;
  for(const file of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,file));
  fs.rmdirSync(directory);
}
function stageBundle(source,destination,config) {
  const bundle=readBundle(source,config); // Read and validate everything first.
  const parent=path.dirname(destination);
  safeDirectory(parent);safeContents(destination);
  fs.mkdirSync(parent,{recursive:true});
  const suffix=crypto.randomUUID(),stage=path.join(parent,'.meta-muse-stage-'+suffix),backup=path.join(parent,'.meta-muse-backup-'+suffix);
  let backedUp=false,published=false;
  fs.mkdirSync(stage);
  try {
    const ordered=bundle.files.filter(f=>f.file!=='manifest.json').concat(bundle.files.filter(f=>f.file==='manifest.json'));
    for(const {file,data} of ordered)fs.writeFileSync(path.join(stage,file),data,{flag:'wx',mode:0o600});
    check(matches(stage,bundle));
    safeDirectory(parent);safeContents(destination);
    if(fs.existsSync(destination)){fs.renameSync(destination,backup);backedUp=true;}
    fs.renameSync(stage,destination);published=true;
    check(matches(destination,bundle)); // Deterministic post-publication bytes.
  } catch(error) {
    if(published)removeOwnedDirectory(destination);
    if(backedUp)fs.renameSync(backup,destination);
    throw error;
  } finally {
    if(fs.existsSync(stage))removeOwnedDirectory(stage);
  }
  // Publication already succeeded; an occupied backup must not undo the new
  // verified bundle. Retain it if Windows prevents cleanup.
  if(backedUp)try{removeOwnedDirectory(backup);}catch{}
  return {...bundle.summary,bundleVerified:true};
}
module.exports={FILES,readBundle,matches,stageBundle,identity};
