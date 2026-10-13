"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");

assert(main.includes("CloudMediaClient"), "desktop main process must own the authenticated media client");
assert(main.includes("ipcMain.handle('media:status'"), "desktop must expose media status IPC");
assert(main.includes("ipcMain.handle('media:search'"), "desktop must expose media search IPC");
assert(main.includes("ipcMain.handle('media:cancel-search'"), "desktop must expose media search cancellation IPC");
assert(main.includes("activeMediaSearchControllers"), "desktop must track cancellable media searches");
assert(main.includes("signal: controller.signal"), "media search cancellation must reach the network request");

assert(preload.includes("getMediaStatus"));
assert(preload.includes("searchMedia"));
assert(preload.includes("cancelMediaSearch"));
assert(!preload.includes("PEXELS_API_KEY"), "provider secrets must never be exposed by preload");
assert(!preload.includes("PIXABAY_API_KEY"), "provider secrets must never be exposed by preload");

assert(backend.includes("createMediaSearchService"), "backend must create the provider-neutral search service");
assert(backend.includes("createMediaRouteHandler"), "backend must install media routes");
assert(backend.includes("handleMediaRoute(req, res, url, method)"), "backend request flow must dispatch media routes");

assert(envExample.includes("PEXELS_API_KEY="));
assert(envExample.includes("PIXABAY_API_KEY="));
assert(!main.includes("process.env.PEXELS_API_KEY"), "desktop main must not read provider API keys");
assert(!main.includes("process.env.PIXABAY_API_KEY"), "desktop main must not read provider API keys");

console.log("Media desktop bridge, authenticated backend dispatch, cancellation, and secret-boundary tests passed.");
