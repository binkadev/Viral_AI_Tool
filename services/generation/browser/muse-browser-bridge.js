"use strict";
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {discoverChromeBrowser} = require("./browser-discovery");
const {prepareProfile} = require("./browser-profile");
const {connectBrowser} = require("./browser-connection");

const MUSE_URL = "https://muse.ai/";
const {sanitizeSession} = require("./session-status");

class MuseBrowserBridge {
  constructor({userDataPath, discover = discoverChromeBrowser, launch = spawn, connect = connectBrowser, startupTimeoutMs = 12000}) {
    if (!path.isAbsolute(userDataPath)) throw new Error("BROWSER_PROFILE_UNAVAILABLE");
    this.userDataPath = path.resolve(userDataPath);
    this.discover = discover; this.launch = launch; this.connect = connect;
    this.startupTimeoutMs = startupTimeoutMs;
    this.browser = null; this.child = null; this.connection = null;
    this.opening = null; this.checking = null; this.stopped = false;
    this.abort = new AbortController(); this.wake = null;
  }
  result(state, messageCode) { return sanitizeSession({state,browser:this.browser?.id,messageCode}, "muse"); }
  descriptor(profile) {
    try {
      const file = path.join(profile, "DevToolsActivePort");
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return null;
      const [rawPort, browserPath] = fs.readFileSync(file,"utf8").trim().split(/\r?\n/);
      if (!/^\d{1,5}$/.test(rawPort) || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath)) return null;
      const port = Number(rawPort);
      return port > 0 && port <= 65535 ? {port,browserPath} : null;
    } catch {return null;}
  }
  async probe(profile) {
    if (this.stopped) return false;
    this.connection?.close(); this.connection=null;
    const descriptor=this.descriptor(profile);
    if (!descriptor) return false;
    try {
      const connection=await this.connect(descriptor,{signal:this.abort.signal});
      if (this.stopped) {connection.close();return false;}
      this.connection=connection;
      return connection.alive();
    } catch {return false;}
  }
  check() {
    if (this.opening) return Promise.resolve(this.result("browser_starting"));
    if (!this.checking) this.checking=this.checkNow().finally(()=>{this.checking=null;});
    return this.checking;
  }
  async checkNow() {
    if (this.stopped) return this.result("browser_closed");
    this.browser ||= this.discover();
    if (this.browser?.id !== "chrome") {this.browser=null;return this.result("browser_unavailable");}
    let profile;
    try {profile=prepareProfile(this.userDataPath,this.browser.id);}
    catch {return this.result("browser_closed","BROWSER_PROFILE_UNAVAILABLE");}
    if (await this.probe(profile)) return this.result("browser_connected");
    return this.result(this.child?"browser_starting":"browser_closed",this.child?"BROWSER_CONNECTION_FAILED":undefined);
  }
  open() {
    if (!this.opening) this.opening=this.openNow().finally(()=>{this.opening=null;});
    return this.opening;
  }
  async openNow() {
    if (this.checking) await this.checking;
    if (this.stopped) return this.result("browser_closed");
    this.browser ||= this.discover();
    if (this.browser?.id !== "chrome") {this.browser=null;return this.result("browser_unavailable");}
    let profile;
    try {profile=prepareProfile(this.userDataPath,this.browser.id);}
    catch {return this.result("browser_closed","BROWSER_PROFILE_UNAVAILABLE");}
    // A persisted endpoint belongs only to this dedicated profile. Its random browser
    // identifier must complete a fresh handshake before it can be reused.
    if (await this.probe(profile)) return this.result("browser_connected");
    if (this.stopped) return this.result("browser_closed");
    if (!this.child) {
      try {
        const child=this.launch(this.browser.executable,[
          "--user-data-dir="+profile,"--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0","--no-first-run","--no-default-browser-check",
          "--disable-background-mode","--new-window",MUSE_URL
        ],{shell:false,detached:true,windowsHide:true,stdio:"ignore"});
        this.child=child;
        const released=()=>{if(this.child===child)this.child=null;};
        child.once("error",released);child.once("exit",released);child.unref();
      } catch {return this.result("browser_closed","BROWSER_LAUNCH_FAILED");}
    }
    const deadline=Date.now()+this.startupTimeoutMs;
    while (!this.stopped && Date.now()<deadline) {
      if (await this.probe(profile)) return this.result("browser_connected");
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{this.wake=null;resolve();},150);
        this.wake=()=>{clearTimeout(timer);this.wake=null;resolve();};
      });
    }
    return this.result(this.child?"browser_starting":"browser_closed","BROWSER_CONNECTION_FAILED");
  }
  detach() {
    this.stopped=true;this.abort.abort();this.wake?.();
    this.connection?.close();this.connection=null;
    // Deliberately leave the user's dedicated browser open; never terminate processes.
    this.child?.unref();this.child=null;
  }
}
module.exports = {MuseBrowserBridge, sanitizeSession, MUSE_URL};
