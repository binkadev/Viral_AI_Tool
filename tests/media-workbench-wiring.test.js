"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const main = read("main.js");
const preload = read("preload.js");
const server = read("dev-backend/server.js");
const index = read("renderer/index.html");

assert(main.includes("require('./services/media/desktop-ipc')"), "desktop main must use the dedicated media IPC boundary");
assert(main.includes("registerMediaIpc({"), "desktop main must register the media IPC service before creating the window");
assert(main.includes("getCloudConfig: () => cloudConfigStore?.read()"), "media IPC must read the active cloud configuration");
assert(main.includes("getAccessToken: () => sessionStore?.getAccessToken()"), "media IPC must obtain credentials only in the main process");
assert(main.includes("refreshSession: () => refreshSessionIfNeeded()"), "media IPC must share authenticated session refresh semantics");
assert(preload.includes("getMediaStatus: () => ipcRenderer.invoke('media:status')"), "preload must expose only the narrow media status method");
assert(preload.includes("searchMedia: payload => ipcRenderer.invoke('media:search', payload)"), "preload must expose only the narrow media search method");
assert(server.includes('require("./media-search")'), "backend must mount the media search service");
assert(server.includes('require("./media-routes")'), "backend must mount the authenticated media route module");
assert(server.includes("const handleMediaRoute = createMediaRouteHandler"), "backend must configure the media route handler once");
assert(server.includes("if (await handleMediaRoute(req, res, url, method)) return;"), "backend request dispatch must reach media routes");
assert(!index.includes('src="core-media-i18n.js"'), "renderer must use the central i18n catalog only");
assert(!main.includes("PEXELS_API_KEY") && !main.includes("PIXABAY_API_KEY"), "desktop main must never contain provider credentials");
assert(!main.includes("function mediaSearchPayload(payload)"), "media validation must stay in the dedicated desktop IPC module rather than duplicate main-process logic");
assert(!preload.includes("PEXELS_API_KEY") && !preload.includes("PIXABAY_API_KEY"), "preload must never contain provider credentials");

console.log("Media backend, authenticated desktop IPC, preload boundary and central locale wiring contracts passed.");
