"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const rendererFiles = fs.readdirSync(path.join(root, "renderer"))
  .filter(name => /\.(?:js|html|css)$/i.test(name))
  .map(name => fs.readFileSync(path.join(root, "renderer", name), "utf8"))
  .join("\n");

for (const required of [
  'require("./media-search")',
  'require("./media-routes")',
  "const mediaSearchService = createMediaSearchService();",
  "const handleMediaHttp = createMediaHttpHandler({",
  "if (await handleMediaHttp({ req, res, url, method })) return;",
  "mediaProviderConfigured: mediaSearchService.status().ready",
  "mediaConfigured: mediaSearchService.status().ready"
]) {
  assert(backend.includes(required), "backend media runtime integration is missing: " + required);
}

for (const required of [
  "require('./services/media/desktop-controller')",
  "mediaDesktopController = createMediaDesktopController({",
  "refreshSession: () => refreshSessionIfNeeded()",
  "ipcMain.handle('media:search-status'",
  "ipcMain.handle('media:search'",
  "ipcMain.handle('media:search-cancel'",
  "mediaDesktopController?.cancelAll()"
]) {
  assert(main.includes(required), "desktop media runtime integration is missing: " + required);
}

const bridgeContracts = [
  ["getMediaSearchStatus", "media:search-status"],
  ["searchMedia", "media:search"],
  ["cancelMediaSearch", "media:search-cancel"]
];
for (const [method, channel] of bridgeContracts) {
  assert(preload.includes(method + ":"), "preload bridge is missing method: " + method);
  assert(preload.includes("ipcRenderer.invoke('" + channel + "'"), "preload bridge is missing channel: " + channel);
  assert(main.includes("ipcMain.handle('" + channel + "'"), "main process is missing channel: " + channel);
}

assert.strictEqual(preload.includes("PEXELS_API_KEY"), false, "provider secrets must never enter preload");
assert.strictEqual(main.includes("PEXELS_API_KEY"), false, "provider secrets must never enter the packaged desktop main process");
assert.strictEqual(rendererFiles.includes("PEXELS_API_KEY"), false, "provider secrets must never enter renderer source");
assert.strictEqual(preload.includes("api.pexels.com"), false, "preload must not call stock providers directly");
assert.strictEqual(main.includes("api.pexels.com"), false, "desktop main must use the backend media contract, not a provider URL");
assert.strictEqual(rendererFiles.includes("api.pexels.com"), false, "renderer must not call stock providers directly");

assert(
  main.indexOf("mediaDesktopController?.cancelAll()") < main.indexOf("cloudConfigStore?.write({"),
  "active media searches must be cancelled before a cloud endpoint switch is persisted"
);
assert(
  main.includes("try { mediaDesktopController?.cancelAll(); } catch {}"),
  "app shutdown must cancel active media discovery work"
);

console.log("Media backend, desktop controller, preload bridge, cancellation and provider-secret boundaries are locked.");
