"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const pkg = require("../package.json"), lock = require("../package-lock.json"), info = require("../release-info.json");
test("private Beta advances the app version without changing the extension or contracts", () => {
  assert.match(pkg.version, /^0\.14\.1-beta\.\d+$/);
  assert(require("../services/update/release-policy").compareVersions(pkg.version, "0.14.0") > 0);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(require("../extensions/meta-muse-bridge/manifest.json").version, "0.3.18");
});
test("private Beta metadata disables existing remote update and release links", async () => {
  assert.equal(info.source, "private-beta"); assert.equal(info.channel, "beta"); assert.equal(info.commit, null);
  assert.equal(info.updateManifestUrl, null); assert.equal(info.releasePageUrl, null);
  const main = fs.readFileSync("main.js", "utf8");
  const start = main.indexOf("async function runBackgroundUpdateCheck()");
  assert(start >= 0);
  let checks = 0;
  const context = { app: { isPackaged: true }, backgroundUpdateCheckStarted: false, releaseInfo: () => info, checkForUpdate: async () => { checks++; } };
  vm.createContext(context); vm.runInContext(main.slice(start, main.indexOf("\nfunction createWindow()", start)), context);
  await context.runBackgroundUpdateCheck(); assert.equal(checks, 0);
});
for (const locale of ["vi", "en"]) test(locale + " existing version surface shows a localized private Beta label", () => {
  const c = { window: {}, state: { release: { info } } }; vm.createContext(c);
  vm.runInContext(fs.readFileSync("renderer/i18n.js", "utf8"), c);
  c.t = key => c.window.I18N.t(locale, key);
  const app = fs.readFileSync("renderer/app.js", "utf8"), start = app.indexOf("function releaseChannelLabel(");
  vm.runInContext(app.slice(start, app.indexOf("\n}", start) + 2), c);
  assert.equal(c.releaseChannelLabel("beta"), c.window.I18N.messages[locale].settings.releasePrivateBeta);
  assert.equal(c.releaseChannelLabel("beta"), c.window.I18N.messages[locale].betaUpdates.identity);
  assert.notEqual(c.releaseChannelLabel("beta"), c.window.I18N.messages[locale].settings.releasePreview);
  assert(!c.releaseChannelLabel("beta").includes("?"));
  c.state.release.info = { source: "release" };
  assert.equal(c.releaseChannelLabel("preview"), c.window.I18N.messages[locale].settings.releasePreview);
});
test("existing NSIS x64 identity, branding, persistence and no-publish behavior are preserved", () => {
  assert.equal(pkg.build.appId, "com.viralai.tool"); assert.equal(pkg.build.productName, "Viral AI Tool");
  assert.equal(pkg.build.win.target[0].target, "nsis"); assert.deepEqual(pkg.build.win.target[0].arch, ["x64"]);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false); assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true); assert.equal(pkg.build.asar, true);
  assert(pkg.scripts.dist.includes("--publish never")); assert.equal(pkg.dependencies["electron-updater"], "6.6.2");
  assert(!pkg.build.files.some(pattern => pattern === "**/*"));
});

const main = fs.readFileSync("main.js", "utf8");
test("packaged releaseInfo reports beta without a fabricated commit; all existing channels remain valid", () => {
  let metadata = info;
  const c = { fs: { readFileSync: () => JSON.stringify(metadata) }, path: require("node:path"), __dirname: process.cwd(), process,
    app: { isPackaged: true, getName: () => pkg.build.productName, getVersion: () => pkg.version } };
  vm.createContext(c);
  vm.runInContext(main.slice(main.indexOf("function releaseInfo()"), main.indexOf("function closeCopy()")), c);
  const result = c.releaseInfo();
  assert.equal(result.source, "private-beta"); assert.equal(result.channel, "beta"); assert.equal(result.commit, null); assert.equal(result.packaged, true);
  for (const channel of ["development", "preview", "beta", "stable"]) { metadata = { ...info, channel }; assert.equal(c.releaseInfo().channel, channel); }
});
for (const privateBeta of [true, false]) test("startup selects only " + (privateBeta ? "PrivateBetaUpdater" : "the legacy fallback"), async () => {
  const events = {}, timers = [], calls = { beta: 0, legacy: 0 };
  class Window {
    constructor() { this.webContents = { once: (name, fn) => { events[name] = fn; } }; }
    loadFile() {} once() {} on() {}
  }
  const c = { BrowserWindow: Window, path: require("node:path"), __dirname: process.cwd(),
    privateBetaUpdater: privateBeta ? { startupCheck: async () => { calls.beta++; } } : null,
    runBackgroundUpdateCheck: async () => { calls.legacy++; }, setTimeout: (fn, delay) => timers.push({ fn, delay }) };
  vm.createContext(c);
  vm.runInContext(main.slice(main.indexOf("function createWindow()"), main.indexOf("app.whenReady().then")), c);
  c.createWindow(); assert.deepEqual(calls, { beta: 0, legacy: 0 }); events["did-finish-load"]();
  assert.equal(timers.length, 1); assert.equal(timers[0].delay, 12000); await timers[0].fn();
  assert.deepEqual(calls, privateBeta ? { beta: 1, legacy: 0 } : { beta: 0, legacy: 1 });
});
for (const [source, channel, expectedChecks] of [["private-beta", "beta", 0], ["private-beta", "preview", 0], ["private-beta", "stable", 0], ["release", "beta", 0], ["release", "development", 0], ["release", "preview", 1], ["release", "stable", 1]]) {
  test("legacy background authority " + source + "/" + channel + " checks=" + expectedChecks, async () => {
    let checks = 0;
    const c = { app: { isPackaged: true }, backgroundUpdateCheckStarted: false, mainWindow: null, diagnosticLogger: null,
      releaseInfo: () => ({ source, channel, updateManifestUrl: "https://example.invalid/manifest.json" }),
      checkForUpdate: async options => { checks++; assert.equal(options.allowPreview, channel === "preview"); return {}; } };
    vm.createContext(c);
    vm.runInContext(main.slice(main.indexOf("async function runBackgroundUpdateCheck()"), main.indexOf("function createWindow()")), c);
    await c.runBackgroundUpdateCheck(); await c.runBackgroundUpdateCheck(); assert.equal(checks, expectedChecks);
  });
}
function legacyIpcHarness(metadata) {
  const handlers = {}, calls = { check: 0, download: 0, cancel: 0, launch: 0, signature: 0, quit: 0 }, timers = [];
  const path = require("node:path"), crypto = require("node:crypto"), bytes = Buffer.from("legacy installer fixture");
  const filePath = path.resolve("legacy-profile", "updates", "update.exe");
  const result = { filePath, version: "0.15.0", fileName: "update.exe", sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  const c = { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, releaseInfo: () => metadata,
    app: { isPackaged: true, getPath: () => path.resolve("legacy-profile"), quit: () => calls.quit++ },
    activeUpdateDownloadController: { abort: () => calls.cancel++ }, lastVerifiedUpdate: result, AbortController,
    checkForUpdate: async () => { calls.check++; return { decision: { code: "UPDATE_AVAILABLE" } }; },
    downloadVerifiedInstaller: async () => { calls.download++; return result; },
    fs: { existsSync: () => true, statSync: () => ({ isFile: () => true, size: bytes.length }), readFileSync: () => bytes },
    path, crypto, process: { platform: "win32", execPath: "current.exe" }, console,
    verifySamePublisher: async () => { calls.signature++; }, getActiveWorkCount: () => 0,
    shell: { openPath: async () => { calls.launch++; return ""; } }, setTimeout: fn => timers.push(fn) };
  vm.createContext(c);
  vm.runInContext(main.slice(main.indexOf("ipcMain.handle('app:check-update'"), main.indexOf("ipcMain.handle('window:minimize'")), c);
  return { c, handlers, calls, timers };
}
for (const packaged of [true, false]) test("Private Beta legacy IPC fails closed despite configured manifest/cache; packaged=" + packaged, async () => {
  const { c, handlers, calls, timers } = legacyIpcHarness({ source: "private-beta", channel: "beta", updateManifestUrl: "https://example.invalid/manifest.json" });
  c.app.isPackaged = packaged;
  for (const handler of Object.values(handlers)) {
    const response = await handler({ sender: {} }); assert.equal(response.ok, false); assert.equal(response.error.code, "UPDATE_NOT_CONFIGURED");
  }
  assert(Object.values(calls).every(value => value === 0)); assert.equal(timers.length, 0);
});
for (const channel of ["preview", "stable"]) test("non-Beta legacy check/download/cancel/install remains available: " + channel, async () => {
  const { c, handlers, calls, timers } = legacyIpcHarness({ source: "release", channel, updateManifestUrl: "https://example.invalid/manifest.json" });
  assert.equal((await handlers["app:check-update"]()).ok, true);
  assert.equal((await handlers["app:cancel-update-download"]()).data.cancelled, true);
  c.activeUpdateDownloadController = null;
  assert.equal((await handlers["app:download-update"]({ sender: {} })).ok, true);
  assert.equal((await handlers["app:launch-update"]()).data.appWillQuit, true);
  assert.equal(calls.check, 1); assert.equal(calls.download, 1); assert.equal(calls.cancel, 1); assert.equal(calls.launch, 1);
  assert.equal(calls.signature, channel === "stable" ? 1 : 0); assert.equal(timers.length, 1); timers[0](); assert.equal(calls.quit, 1);
});
