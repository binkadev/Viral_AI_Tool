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
  assert.equal(info.source, "private-beta"); assert.equal(info.channel, "preview");
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
  assert.equal(c.releaseChannelLabel("preview"), c.window.I18N.messages[locale].settings.releasePrivateBeta);
  assert(!c.releaseChannelLabel("preview").includes("?"));
  c.state.release.info = { source: "release" };
  assert.equal(c.releaseChannelLabel("preview"), c.window.I18N.messages[locale].settings.releasePreview);
});
test("existing NSIS x64 identity, branding, persistence and no-publish behavior are preserved", () => {
  assert.equal(pkg.build.appId, "com.viralai.tool"); assert.equal(pkg.build.productName, "Viral AI Tool");
  assert.equal(pkg.build.win.target[0].target, "nsis"); assert.deepEqual(pkg.build.win.target[0].arch, ["x64"]);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false); assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true); assert.equal(pkg.build.asar, true);
  assert(pkg.scripts.dist.includes("--publish never")); assert.equal(pkg.dependencies["electron-updater"], undefined);
  assert(!pkg.build.files.some(pattern => pattern === "**/*"));
});
