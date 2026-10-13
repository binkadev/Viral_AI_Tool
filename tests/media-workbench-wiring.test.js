"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const main = read("main.js");
const preload = read("preload.js");
const server = read("dev-backend/server.js");
const routes = read("dev-backend/media-routes.js");
const controller = read("services/media/desktop-controller.js");
const index = read("renderer/index.html");

assert(main.includes("require('./services/media/desktop-controller')"), "desktop main must use the media desktop controller boundary");
assert(main.includes("createMediaDesktopController({"), "desktop main must create one media controller before opening the window");
assert(main.includes("getBackendUrl: () => cloudConfigStore?.read()?.backendUrl"), "media controller must read the active cloud endpoint in the main process");
assert(main.includes("getAccessToken: () => sessionStore?.getAccessToken()"), "media controller must keep access tokens in the main process");
assert(main.includes("refreshSession: () => refreshSessionIfNeeded()"), "media controller must share authenticated session refresh semantics");
assert(main.includes("path.join(app.getPath('userData'), 'media-cache')"), "acquired media must use an application-owned cache root");
assert(main.includes("ipcMain.handle('media:acquire'"), "desktop main must expose media acquisition through a narrow IPC handler");
assert(main.includes("ipcMain.handle('media:acquisition-cancel'"), "desktop main must expose safe acquisition cancellation");
assert(main.includes("mediaDesktopController?.activeAcquisitionCount"), "active acquisitions must participate in close protection");
assert(main.includes("mediaDesktopController?.cancelAll()"), "shutdown/config changes must cancel active media work");

assert(preload.includes("getMediaSearchStatus: () => ipcRenderer.invoke('media:search-status')"), "preload must expose narrow media status access");
assert(preload.includes("searchMedia: payload => ipcRenderer.invoke('media:search', payload)"), "preload must expose narrow media search access");
assert(preload.includes("cancelMediaSearch: requestId => ipcRenderer.invoke('media:search-cancel', requestId)"), "search cancellation must identify the request being cancelled");
assert(preload.includes("acquireMedia: payload => ipcRenderer.invoke('media:acquire', payload)"), "preload must expose acquisition without Node/file-system access");
assert(preload.includes("cancelMediaAcquisition: jobId => ipcRenderer.invoke('media:acquisition-cancel', jobId)"), "preload must expose job-scoped acquisition cancellation");
assert(preload.includes("onMediaAcquisitionProgress"), "renderer must receive acquisition progress only through a narrow event subscription");

assert(controller.includes("resolveAcquisition(ticket"), "desktop controller must resolve a signed server ticket before download");
assert(controller.includes("downloads.acquire({ jobId, projectId, descriptor })"), "resolved provider descriptors must flow into the native acquisition manager");
assert(controller.includes("new AbortController()"), "media search and ticket resolution must remain cancellable");

assert(server.includes('require("./media-search")'), "backend must mount the media search service");
assert(server.includes('require("./media-routes")'), "backend must mount the authenticated media route module");
assert(server.includes("const handleMediaRoute = createMediaRouteHandler"), "backend must configure the media route handler once");
assert(server.includes("if (await handleMediaRoute(req, res, url, method)) return;"), "backend request dispatch must reach media routes");
assert(routes.includes('require("./media-tickets")'), "backend media routes must own signed acquisition ticket issuance/resolution");
assert(routes.includes('url.pathname === "/v1/media/acquisition"'), "backend must expose authenticated ticket resolution");
assert(routes.includes("ticketService.issue(result, { userId })"), "search results must receive account-bound acquisition tickets");
assert(routes.includes("ticketService.resolve(ticket, { userId: user.id })"), "ticket resolution must verify the authenticated account");

assert(!index.includes('src="core-media-i18n.js"'), "renderer must use the central i18n catalog only");
assert(!main.includes("PEXELS_API_KEY") && !main.includes("PIXABAY_API_KEY"), "desktop main must never contain provider credentials");
assert(!preload.includes("PEXELS_API_KEY") && !preload.includes("PIXABAY_API_KEY"), "preload must never contain provider credentials");
assert(!fs.existsSync(path.join(root, "services", "media", "desktop-ipc.js")), "superseded search-only IPC service must not coexist with the media desktop controller");

console.log("Media backend, signed acquisition, desktop controller, preload boundary and central locale wiring contracts passed.");
