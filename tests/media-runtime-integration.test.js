"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "dev-backend", "media-routes.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "services", "media", "desktop-controller.js"), "utf8");
const rendererFiles = fs.readdirSync(path.join(root, "renderer"))
  .filter(name => /\.(?:js|html|css)$/i.test(name))
  .map(name => fs.readFileSync(path.join(root, "renderer", name), "utf8"))
  .join("\n");

for (const required of [
  'require("./media-search")',
  'require("./media-routes")',
  "const mediaSearchService = createMediaSearchService();",
  "const handleMediaRoute = createMediaRouteHandler({",
  "if (await handleMediaRoute(req, res, url, method)) return;"
]) {
  assert(backend.includes(required), "backend media runtime integration is missing: " + required);
}

for (const required of [
  'require("./media-tickets")',
  'url.pathname === "/v1/media/acquisition"',
  "ticketService.issue(result, { userId })",
  "ticketService.resolve(ticket, { userId: user.id })"
]) {
  assert(routes.includes(required), "backend media acquisition runtime is missing: " + required);
}

for (const required of [
  "require('./services/media/desktop-controller')",
  "mediaDesktopController = createMediaDesktopController({",
  "refreshSession: () => refreshSessionIfNeeded()",
  "ipcMain.handle('media:search-status'",
  "ipcMain.handle('media:search'",
  "ipcMain.handle('media:search-cancel'",
  "ipcMain.handle('media:acquire'",
  "ipcMain.handle('media:acquisition-cancel'",
  "mediaDesktopController?.cancelAll()"
]) {
  assert(main.includes(required), "desktop media runtime integration is missing: " + required);
}

for (const required of [
  "resolveAcquisition(ticket",
  "downloads.acquire({ jobId, projectId, descriptor })",
  "activeAcquisitionCount"
]) {
  assert(controller.includes(required), "desktop media controller acquisition contract is missing: " + required);
}

const bridgeContracts = [
  ["getMediaSearchStatus", "media:search-status"],
  ["searchMedia", "media:search"],
  ["cancelMediaSearch", "media:search-cancel"],
  ["acquireMedia", "media:acquire"],
  ["cancelMediaAcquisition", "media:acquisition-cancel"]
];
for (const [method, channel] of bridgeContracts) {
  assert(preload.includes(method + ":"), "preload bridge is missing method: " + method);
  assert(preload.includes("ipcRenderer.invoke('" + channel + "'"), "preload bridge is missing channel: " + channel);
  assert(main.includes("ipcMain.handle('" + channel + "'"), "main process is missing channel: " + channel);
}
assert(preload.includes("onMediaAcquisitionProgress"), "preload must expose acquisition progress subscription");

for (const secret of ["PEXELS_API_KEY", "PIXABAY_API_KEY", "VIRAL_AI_MEDIA_TICKET_SECRET"]) {
  assert.strictEqual(preload.includes(secret), false, secret + " must never enter preload");
  assert.strictEqual(main.includes(secret), false, secret + " must never enter packaged desktop main");
  assert.strictEqual(rendererFiles.includes(secret), false, secret + " must never enter renderer source");
}
assert.strictEqual(preload.includes("api.pexels.com"), false, "preload must not call stock providers directly");
assert.strictEqual(main.includes("api.pexels.com"), false, "desktop main must use the backend media contract, not a provider URL");
assert.strictEqual(rendererFiles.includes("api.pexels.com"), false, "renderer must not call stock providers directly");

assert(
  main.indexOf("mediaDesktopController?.cancelAll()") < main.indexOf("cloudConfigStore?.write({"),
  "active media work must be cancelled before a cloud endpoint switch is persisted"
);
assert(
  main.includes("try { mediaDesktopController?.cancelAll(); } catch {}"),
  "app shutdown must cancel active media discovery/acquisition work"
);

console.log("Media backend, signed acquisition, desktop controller, preload bridge, cancellation and provider-secret boundaries are locked.");
