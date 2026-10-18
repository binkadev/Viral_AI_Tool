"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const {discoverChromeBrowser, publicBrowserAvailability} = require("../services/generation/browser/browser-discovery");
const {profilePath, prepareProfile} = require("../services/generation/browser/browser-profile");

test("Windows Chrome discovery never considers Edge or the system default browser", () => {
  const env = {ProgramFiles:"C:\\Programs", "ProgramFiles(x86)":"C:\\Programs32", LOCALAPPDATA:"C:\\Users\\example\\AppData\\Local"};
  const chrome = "C:\\Programs32\\Google\\Chrome\\Application\\chrome.exe";
  const edge = "C:\\Users\\example\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe";
  const calls = [];
  const found = discoverChromeBrowser({platform:"win32",env,isFile:file=>{calls.push(file);return [chrome,edge].includes(file);}});
  assert.deepEqual(found,{id:"chrome",executable:chrome});
  assert.equal(discoverChromeBrowser({platform:"win32",env,isFile:file=>file===edge}),null);
  assert.deepEqual(discoverChromeBrowser({platform:"win32",env,isFile:file=>file===chrome}),{id:"chrome",executable:chrome});
  assert(calls.every(file=>file.endsWith("chrome.exe") && !file.includes("User Data")));
  assert.equal(discoverChromeBrowser({platform:"win32",env,isFile:()=>false}),null);
  assert.equal(discoverChromeBrowser({platform:"linux",env,isFile:()=>{assert.fail();}}),null);
  assert.deepEqual(publicBrowserAvailability(found),{available:true,browser:"chrome"});
  assert.deepEqual(publicBrowserAvailability(null),{available:false,browser:null});
  assert.deepEqual(publicBrowserAvailability({id:"secret",executable:"secret"}),{available:false,browser:null});
});

test("dedicated profiles remain under app userData and reject invalid browser identifiers", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"muse-profile-test-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const profile = prepareProfile(root,"chrome");
  assert.equal(profile,path.join(root,"browser-sessions","muse","chrome"));
  assert.equal(prepareProfile(root,"chrome"),profile);
  assert.throws(()=>profilePath(root,"edge"));
  assert.deepEqual(fs.readdirSync(profile),[]);
  assert.throws(()=>profilePath(root,"../Default"));
  assert.throws(()=>profilePath("relative","chrome"));
});

test("profile preparation rejects file collisions without modifying their content", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"muse-profile-collision-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"browser-sessions"),"keep");
  assert.throws(()=>prepareProfile(root,"chrome"));
  assert.equal(fs.readFileSync(path.join(root,"browser-sessions"),"utf8"),"keep");
});


test("dedicated profile cannot follow a directory redirect", t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"muse-profile-link-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,"other-profile");fs.mkdirSync(target);
 fs.symlinkSync(target,path.join(root,"browser-sessions"),process.platform==="win32"?"junction":"dir");
 assert.throws(()=>prepareProfile(root,"chrome"));assert.deepEqual(fs.readdirSync(target),[]);
});
