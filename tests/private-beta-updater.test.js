"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), { EventEmitter } = require("node:events");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const vm = require("node:vm");
const { PrivateBetaUpdater, PRODUCTION_FEED, testFeed, verificationProfile } = require("../services/update/private-beta-updater");
const { registerPrivateBetaUpdateIpc } = require("../services/update/private-beta-ipc");
const pkg = require("../package.json");
const next = "0.14.1-beta.3", tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-update-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const native = new EventEmitter();
  native.setFeedURL = feed => { native.feed = feed; };
  native.checks = native.downloads = native.installs = 0;
  const token = { cancel() { native.emit("update-cancelled"); } };
  native.checkForUpdates = async () => { native.checks++; native.emit("update-available", { version: next, releaseName: "Beta 3", releaseNotes: "<script>ignored()</script>" }); return { cancellationToken: token }; };
  native.downloadUpdate = async () => { native.downloads++; native.emit("download-progress", { percent: 25, path: "SECRET" }); native.emit("update-downloaded", { version: next }); return ["SECRET_PATH"]; };
  native.quitAndInstall = (...args) => { native.installs++; native.installArgs = args; };
  const config = { updater: native, packaged: true, version: "0.14.1-beta.2", preferencesPath: path.join(dir, "preferences.json"), activeWork: () => 0, prepareInstall: async () => true, ...options };
  return { native, service: new PrivateBetaUpdater(config), config };
}
test("pinned v26 updater and explicit GitHub beta metadata agree", () => {
  assert.equal(pkg.dependencies["electron-updater"], "6.6.2");
  assert.equal(pkg.devDependencies["electron-builder"], "26.0.12");
  assert.deepEqual(pkg.build.publish, [{ ...PRODUCTION_FEED, releaseType: "prerelease" }]);
  assert.equal(pkg.build.generateUpdatesFilesForAllChannels, false);
});
test("production defaults check only, once at startup; manual checks remain available", async t => {
  const { native, service } = fixture(t);
  assert.deepEqual(native.feed, PRODUCTION_FEED); assert.equal(native.channel, "beta");
  assert.equal(native.autoDownload, false); assert.equal(native.autoInstallOnAppQuit, false); assert.equal(native.allowDowngrade, false);
  await service.startupCheck(); await service.startupCheck(); assert.equal(native.checks, 1); assert.equal(native.downloads, 0);
  await service.check(); assert.equal(native.checks, 2);
});
test("dev never initializes or contacts provider even with remote override", async t => {
  const { native, service } = fixture(t, { packaged: false, testUrl: "https://evil.example" });
  await service.check(); await service.startupCheck(); await service.download(); await service.install();
  assert.equal(native.feed, undefined); assert.equal(native.checks + native.downloads + native.installs, 0);
});
test("only literal loopback HTTP test feeds are accepted", t => {
  for (const url of ["http://127.0.0.1:123/feed/", "http://localhost:123/"]) assert.equal(testFeed(url).provider, "generic");
  assert.equal(testFeed(undefined), null);
  for (const url of ["https://localhost/", "http://localhost.example/", "http://evil.example/", "http://[::1]/", "http://user:token@localhost/", "file:///tmp/", "http://localhost/?secret=x", "http://localhost/#x"]) assert.throws(() => testFeed(url));
  const { native, service } = fixture(t, { testUrl: "https://evil.example" });
  assert.equal(service.snapshot().errorCode, "UPDATE_CONFIGURATION"); assert.equal(native.feed, undefined);
});
test("preference persists outside Project and disables only automatic checks", async t => {
  const { service, native, config } = fixture(t);
  assert.equal(service.setAutomatic(false).automatic, false);
  const restored = new PrivateBetaUpdater(config); assert.equal(restored.snapshot().automatic, false);
  await restored.startupCheck(); assert.equal(native.checks, 0); await restored.check(); assert.equal(native.checks, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(config.preferencesPath)), { automatic: false });
  assert.equal(service.setAutomatic("true").errorCode, "UPDATE_INVALID_REQUEST");
});
test("restart profile override is restricted to packaged loopback verification under the real temp directory", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-private-beta-update-unit-"));
  const profile = path.join(root, "profile"); fs.mkdirSync(profile);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { packaged: true, feed: "http://127.0.0.1:123/", profile, tempPath: os.tmpdir() };
  assert.equal(verificationProfile(config), fs.realpathSync(profile));
  assert.equal(verificationProfile({ ...config, packaged: false }), null);
  assert.equal(verificationProfile({ ...config, feed: undefined }), null);
  assert.throws(() => verificationProfile({ ...config, feed: "https://evil.example/" }));
  assert.throws(() => verificationProfile({ ...config, profile: root }));
  assert.throws(() => verificationProfile({ ...config, profile: process.cwd() }));
});
test("duplicate checks coalesce; safe state contains no raw data/paths", async t => {
  const { native, service } = fixture(t); let finish;
  native.checkForUpdates = () => { native.checks++; return new Promise(resolve => { finish = resolve; }); };
  const first = service.check(), second = service.check(); assert.equal(first, second); await tick(); assert.equal(native.checks, 1);
  native.emit("update-available", { version: next, releaseName: "x".repeat(500), releaseNotes: "<b>safe</b>" + "y".repeat(10000), path: "SECRET", token: "SECRET" }); finish({});
  const state = await first; assert.equal(state.releaseName.length, 120); assert.equal(state.releaseNotes.length, 4000);
  assert(!JSON.stringify(state).includes("SECRET")); assert(!state.releaseNotes.includes("<b>"));
});
test("unintended alpha/stable/downgrade versions cannot be downloaded", async t => {
  for (const version of ["0.15.0-alpha.1", "0.15.0", "0.14.1-beta.1", "invalid"]) {
    const { native, service } = fixture(t); native.emit("update-available", { version });
    assert.equal(service.snapshot().errorCode, "UPDATE_CHANNEL_REJECTED"); await service.download(); assert.equal(native.downloads, 0);
  }
});
test("no newer update transitions without downloading", async t => {
  const { native, service } = fixture(t);
  native.checkForUpdates = async () => { native.emit("update-not-available"); return {}; };
  assert.equal((await service.check()).status, "not-available"); await service.download(); assert.equal(native.downloads, 0);
});
test("explicit download emits bounded progress and downloaded state, deduplicated", async t => {
  const { native, service } = fixture(t), states = []; service.on("state", s => states.push(s));
  await service.check(); const first = service.download(), second = service.download(); assert.equal(first, second);
  const result = await first; assert.equal(result.status, "downloaded"); assert.equal(native.downloads, 1);
  assert(states.some(s => s.status === "downloading" && s.percent === 25)); assert(!JSON.stringify(result).includes("SECRET_PATH"));
  await service.check(); assert.equal(native.checks, 1);
});
test("download can cancel; late progress/download cannot restore completion; check enables retry", async t => {
  const { native, service } = fixture(t); await service.check(); let finish;
  native.downloadUpdate = () => new Promise(resolve => { finish = resolve; });
  const downloading = service.download(); await tick(); service.cancel(); native.emit("download-progress", { percent: 100 }); native.emit("update-downloaded", { version: next }); finish([]);
  await downloading; assert.equal(service.snapshot().status, "idle"); await service.check(); assert.equal(service.snapshot().status, "available");
});
for (const failure of ["feed unreachable", "metadata 404", "download error", "checksum mismatch", "disk full"]) test(failure + " is recoverable and hides raw errors", async t => {
  const { native, service } = fixture(t);
  const error = Object.assign(new Error("SECRET token stack provider localPath"), { code: failure === "checksum mismatch" ? "ERR_CHECKSUM_MISMATCH" : "EFAIL" });
  if (["download error", "checksum mismatch", "disk full"].includes(failure)) { await service.check(); native.downloadUpdate = async () => { native.emit("error", error); throw error; }; await service.download(); }
  else { native.checkForUpdates = async () => { native.emit("error", error); throw error; }; await service.check(); }
  assert.equal(service.snapshot().status, "error"); assert(!JSON.stringify(service.snapshot()).includes("SECRET"));
  assert.equal(service.snapshot().errorCode, failure === "checksum mismatch" ? "UPDATE_VERIFICATION" : "UPDATE_REQUEST_FAILED");
});
test("install fails closed on native work, failed project save and work appearing during save", async t => {
  let busy = 1, save = true;
  const { native, service } = fixture(t, { activeWork: () => busy, prepareInstall: async () => save });
  await service.check(); await service.download();
  assert.equal((await service.install()).errorCode, "UPDATE_WORK_ACTIVE"); assert.equal(native.installs, 0);
  busy = 0; save = false; assert.equal((await service.install()).errorCode, "UPDATE_SAVE_REQUIRED");
  service.prepareInstall = async () => { busy = 1; return true; }; assert.equal((await service.install()).errorCode, "UPDATE_WORK_ACTIVE");
  busy = 0; service.prepareInstall = async () => true;
  await Promise.all([service.install(), service.install()]); assert.equal(native.installs, 1); assert.deepEqual(native.installArgs, [true, true]);
});
test("installer launch failure keeps the downloaded update retryable", async t => {
  const { native, service } = fixture(t);
  await service.check(); await service.download();
  native.quitAndInstall = () => { throw Error("SECRET_NATIVE_LAUNCH_ERROR"); };
  const failed = await service.install();
  assert.equal(failed.status, "downloaded");
  assert.equal(failed.errorCode, "UPDATE_INSTALL_FAILED");
  assert.equal(service.installPending, false);
  assert(!JSON.stringify(failed).includes("SECRET"));
  native.quitAndInstall = () => { native.installs++; };
  assert.equal((await service.install()).status, "installing");
  assert.equal(native.installs, 1);
});

test("main install barrier saves Project, ignores passive imported queue rows and vetoes real workflow/render activity", () => {
  const script = fs.readFileSync("main.js", "utf8").match(/const barrier = mainWindow\.webContents\.executeJavaScript\(`([\s\S]*?)`\)/)[1];
  let saved = 0;
  const api = { storageError: () => null, unsupportedSchemaVersion: () => null, activeProjectId: () => "test", flush: () => { saved++; return {}; } };
  const state = { jobs: [{ status: "queued", sourcePath: "fixture.mp4" }], voice: {}, speech: {}, translation: {}, scenePlan: {} };
  const context = { window: { ViralCoreProjectPersistence: api }, state };
  assert.equal(vm.runInNewContext(script, context), true); assert.equal(saved, 1);
  context.window.ViralBatchProduction = { runtime: { view: () => ({ busy: true }) } };
  assert.equal(vm.runInNewContext(script, context), false); assert.equal(saved, 1);
  context.window.ViralBatchProduction.runtime.view = () => ({ busy: false });
  let production = { state: "running", settling: false };
  context.window.ViralProductionModes = { runtime: { view: () => production } };
  assert.equal(vm.runInNewContext(script, context), false);
  production = { state: "paused", settling: false };
  assert.equal(vm.runInNewContext(script, context), false);
  production = { state: "idle", settling: true };
  assert.equal(vm.runInNewContext(script, context), false);
  production = { state: "idle", settling: false };
  assert.equal(vm.runInNewContext(script, context), true); assert.equal(saved, 2);
  state.voice.job = { status: "generating" }; assert.equal(vm.runInNewContext(script, context), false); state.voice.job = null;
  state.jobs.push({ isRenderOutput: true, status: "rendering" }); assert.equal(vm.runInNewContext(script, context), false); state.jobs.pop();
  state.scenePlan.plannerJob = { status: "planning" }; assert.equal(vm.runInNewContext(script, context), false); state.scenePlan.plannerJob = null;
  api.flush = () => null; assert.equal(vm.runInNewContext(script, context), false);
  api.activeProjectId = () => null; assert.equal(vm.runInNewContext(script, context), true);
  api.storageError = () => "unwritable"; assert.equal(vm.runInNewContext(script, context), false);
});
test("IPC rejects untrusted senders, extra arguments and nonboolean preference; forwards no native paths", async () => {
  const handlers = {}, calls = [];
  registerPrivateBetaUpdateIpc({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, trusted: event => event === "trusted", service: () => new Proxy({}, { get: (_, method) => (...args) => { calls.push([method, ...args]); return { status: "idle" }; } }) });
  for (const name of Object.keys(handlers)) assert.equal((await handlers[name]("other")).errorCode, "UPDATE_UNAUTHORIZED");
  for (const name of Object.keys(handlers).filter(name => name !== "updates:automatic")) assert.equal((await handlers[name]("trusted", "/installer.exe")).errorCode, "UPDATE_INVALID_REQUEST");
  assert.equal((await handlers["updates:automatic"]("trusted", {})).errorCode, "UPDATE_INVALID_REQUEST"); assert.equal(calls.length, 0);
  await handlers["updates:check"]("trusted"); await handlers["updates:automatic"]("trusted", false);
  assert.deepEqual(calls, [["check"], ["setAutomatic", false]]);
});
test("main authorizes only the current app window's exact local main frame", () => {
  const source = fs.readFileSync("main.js", "utf8");
  const registration = source.slice(source.indexOf("registerPrivateBetaUpdateIpc({ ipcMain"), source.indexOf("registerGenerationIpc({ ipcMain"));
  const expression = registration.match(/trusted: event =>([\s\S]*?)\n\}\);/)[1].trim();
  const { pathToFileURL } = require("node:url"), root = path.resolve(__dirname, "..");
  const frame = { url: pathToFileURL(path.join(root, "renderer", "index.html")).href }, contents = { mainFrame: frame };
  const mainWindow = { isDestroyed: () => false, webContents: contents };
  const trusted = vm.runInNewContext("(event => " + expression + ")", { mainWindow, pathToFileURL, path, __dirname: root });
  assert.equal(trusted({ sender: contents, senderFrame: frame }), true);
  assert.equal(trusted({ sender: {}, senderFrame: frame }), false);
  assert.equal(trusted({ sender: contents, senderFrame: { url: frame.url } }), false);
  frame.url = "https://evil.example/"; assert.equal(trusted({ sender: contents, senderFrame: frame }), false);
  mainWindow.isDestroyed = () => true; assert.equal(trusted({ sender: contents, senderFrame: frame }), false);
});
