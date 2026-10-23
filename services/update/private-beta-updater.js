"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const PRODUCTION_FEED = Object.freeze({ provider: "github", owner: "binkadev", repo: "Viral_AI_Tool", channel: "beta" });
const betaVersion = value => typeof value === "string" && value.length <= 48 && /^\d+\.\d+\.\d+-beta\.\d+$/.test(value) ? value : null;
function newerBeta(candidate, current) {
  if (!betaVersion(candidate) || !betaVersion(current)) return false;
  const a = candidate.match(/\d+/g).map(Number), b = current.match(/\d+/g).map(Number);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function testFeed(value) {
  if (!value) return null;
  if (typeof value !== "string" || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(value)) throw Error("UPDATE_TEST_FEED_INVALID");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw Error("UPDATE_TEST_FEED_INVALID");
  return { provider: "generic", url: url.href.endsWith("/") ? url.href : url.href + "/", channel: "beta" };
}
function verificationProfile({ packaged, feed, profile, tempPath }) {
  if (!packaged || !feed || !profile) return null;
  testFeed(feed);
  const temp = fs.realpathSync(tempPath), target = fs.realpathSync(profile);
  const relative = path.relative(temp, target);
  if (!/^viral-private-beta-update-[a-z0-9-]+[\\/]profile$/i.test(relative)) throw Error("UPDATE_TEST_PROFILE_INVALID");
  return target;
}
function plain(value, limit) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, limit) : "";
}
function notes(value) {
  return plain(Array.isArray(value) ? value.slice(0, 8).map(item => plain(item?.note, 1000)).join("\n") : value, 4000);
}

// Owns the updater and every native transition. Only snapshot() crosses IPC.
class PrivateBetaUpdater extends EventEmitter {
  constructor({ updater, packaged, version, preferencesPath, testUrl, activeWork = () => 1, prepareInstall = async () => false }) {
    super();
    this.updater = updater; this.packaged = packaged === true; this.activeWork = activeWork; this.prepareInstall = prepareInstall;
    this.preferencesPath = preferencesPath; this.checkPromise = null; this.downloadPromise = null; this.startupStarted = false;
    this.state = { status: "idle", currentVersion: betaVersion(version), availableVersion: null, channel: "beta", percent: 0,
      releaseName: "", releaseNotes: "", lastCheckedAt: null, errorCode: null, automatic: true, enabled: this.packaged && !!betaVersion(version) };
    try { this.state.automatic = JSON.parse(fs.readFileSync(preferencesPath, "utf8")).automatic !== false; } catch {}
    if (!this.state.enabled) return;
    try {
      const feed = testFeed(testUrl) || PRODUCTION_FEED;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.disableWebInstaller = true;
      updater.allowPrerelease = true;
      updater.setFeedURL({ ...feed });
      updater.channel = "beta";
      updater.allowDowngrade = false;
      updater.on("checking-for-update", () => this.change({ status: "checking", errorCode: null }));
      updater.on("update-available", info => {
        if (!newerBeta(info?.version, version)) return this.fail("UPDATE_CHANNEL_REJECTED");
        this.change({ status: "available", availableVersion: info.version, percent: 0,
          releaseName: plain(info.releaseName, 120), releaseNotes: notes(info.releaseNotes), errorCode: null });
      });
      updater.on("update-not-available", () => this.change({ status: "not-available", availableVersion: null, errorCode: null }));
      updater.on("download-progress", progress => {
        if (this.state.status !== "downloading" || this.cancelRequested) return;
        const percent = Number(progress?.percent);
        this.change({ percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0 });
      });
      updater.on("update-downloaded", info => {
        if (this.cancelRequested || this.state.status !== "downloading") return;
        if (info?.version !== this.state.availableVersion || !newerBeta(info?.version, version)) return this.fail("UPDATE_CHANNEL_REJECTED");
        this.change({ status: "downloaded", percent: 100, errorCode: null });
      });
      updater.on("update-cancelled", () => this.change({ status: "idle", percent: 0, errorCode: null }));
      updater.on("error", error => this.handleError(error));
    } catch { this.configInvalid = true; this.fail("UPDATE_CONFIGURATION"); }
  }
  snapshot() { return { ...this.state }; }
  change(patch) { Object.assign(this.state, patch); this.emit("state", this.snapshot()); return this.snapshot(); }
  fail(errorCode) { return this.change({ status: "error", errorCode }); }
  handleError(error) {
    if (this.cancelRequested || error?.code === "ERR_CANCELLED") return this.change({ status: "idle", percent: 0, errorCode: null });
    return this.fail(["ERR_UPDATER_INVALID_SIGNATURE", "ERR_CHECKSUM_MISMATCH"].includes(error?.code) ? "UPDATE_VERIFICATION" : "UPDATE_REQUEST_FAILED");
  }
  setAutomatic(value) {
    if (typeof value !== "boolean") return this.fail("UPDATE_INVALID_REQUEST");
    try {
      fs.mkdirSync(path.dirname(this.preferencesPath), { recursive: true });
      fs.writeFileSync(this.preferencesPath + ".tmp", JSON.stringify({ automatic: value }), { mode: 0o600 });
      fs.renameSync(this.preferencesPath + ".tmp", this.preferencesPath);
      return this.change({ automatic: value, errorCode: null });
    } catch { return this.change({ errorCode: "UPDATE_PREFERENCES_FAILED" }); }
  }
  startupCheck() {
    if (this.startupStarted) return Promise.resolve(this.snapshot());
    this.startupStarted = true;
    return this.state.automatic ? this.check() : Promise.resolve(this.snapshot());
  }
  check() {
    if (!this.state.enabled || this.configInvalid) return Promise.resolve(this.snapshot());
    if (this.checkPromise) return this.checkPromise;
    if (["downloading", "downloaded", "installing"].includes(this.state.status)) return Promise.resolve(this.snapshot());
    this.change({ status: "checking", errorCode: null, lastCheckedAt: new Date().toISOString() });
    this.cancelRequested = false;
    this.checkPromise = Promise.resolve().then(() => this.updater.checkForUpdates()).then(result => {
      this.cancellationToken = result?.cancellationToken;
      return this.snapshot();
    }).catch(error => this.handleError(error)).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  download() {
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.state.enabled || this.configInvalid || this.state.status !== "available") return Promise.resolve(this.snapshot());
    this.cancelRequested = false;
    this.change({ status: "downloading", percent: 0, errorCode: null });
    this.downloadPromise = Promise.resolve().then(() => this.updater.downloadUpdate(this.cancellationToken)).then(() => this.snapshot())
      .catch(error => this.handleError(error)).finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }
  cancel() {
    if (this.state.status === "downloading" && this.cancellationToken) {
      this.cancelRequested = true; this.cancellationToken.cancel();
    }
    return this.snapshot();
  }
  async install() {
    if (!this.state.enabled || this.state.status !== "downloaded" || this.installPending) return this.snapshot();
    if (this.activeWork() !== 0) return this.change({ errorCode: "UPDATE_WORK_ACTIVE" });
    this.installPending = true;
    try {
      if (!await this.prepareInstall()) return this.change({ errorCode: "UPDATE_SAVE_REQUIRED" });
      if (this.activeWork() !== 0) return this.change({ errorCode: "UPDATE_WORK_ACTIVE" });
      this.change({ status: "installing", errorCode: null });
      // Explicit consent only. No installation merely because the app quits.
      this.updater.quitAndInstall(true, true);
      return this.snapshot();
    } catch { return this.change({ status: "downloaded", errorCode: "UPDATE_INSTALL_FAILED" }); }
    finally { this.installPending = false; }
  }
}
module.exports = { PrivateBetaUpdater, PRODUCTION_FEED, testFeed, verificationProfile, newerBeta, plain, notes };
