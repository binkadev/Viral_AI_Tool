"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, "utf8");

function replaceOnce(content, needle, replacement, label) {
  const index = content.indexOf(needle);
  if (index < 0) throw new Error(`Missing anchor: ${label}`);
  if (content.indexOf(needle, index + needle.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + needle.length);
}

let main = read("main.js");
main = replaceOnce(
  main,
  "const { CloudMediaClient } = require('./services/media/cloud-client');",
  "const { registerMediaIpc } = require('./services/media/desktop-ipc');",
  "desktop media module import"
);

const helperStart = main.indexOf("function mediaClient() {");
const helperEnd = main.indexOf("async function withBillingSession(action) {");
if (helperStart < 0 || helperEnd <= helperStart) throw new Error("Media helper block was not found");
main = main.slice(0, helperStart) + main.slice(helperEnd);

const ipcStart = main.indexOf("ipcMain.handle('media:status', async () => {");
const ipcEnd = main.indexOf("ipcMain.handle('files:select-videos', async () => {");
if (ipcStart < 0 || ipcEnd <= ipcStart) throw new Error("Inline media IPC block was not found");
main = main.slice(0, ipcStart) + main.slice(ipcEnd);

if (!main.includes("registerMediaIpc({")) {
  const registration = `  registerMediaIpc({\n    ipcMain,\n    getCloudConfig: () => cloudConfigStore?.read() || { backendUrl: process.env.VIRAL_AI_CLOUD_URL || '' },\n    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    refreshSession: () => refreshSessionIfNeeded(),\n    appVersion: app.getVersion()\n  });\n`;
  main = replaceOnce(main, "  createWindow();\n\n  app.on('activate'", registration + "  createWindow();\n\n  app.on('activate'", "media IPC registration before window creation");
}
write("main.js", main);

let wiring = read("tests/media-workbench-wiring.test.js");
wiring = wiring.replace(
  'assert(main.includes("require(\'./services/media/cloud-client\')"), "desktop main must use the authenticated media cloud client");\nassert(main.includes("ipcMain.handle(\'media:status\'"), "desktop main must expose media status IPC");\nassert(main.includes("ipcMain.handle(\'media:search\'"), "desktop main must expose media search IPC");\nassert(main.includes("function mediaSearchPayload(payload)"), "desktop main must validate media search payloads before network use");\nassert(main.includes("refreshSessionIfNeeded()"), "media search must share authenticated session refresh semantics");\nassert(main.includes("function publicMediaError(error)"), "desktop media errors must be provider-neutral before crossing IPC");\n',
  'assert(main.includes("require(\'./services/media/desktop-ipc\')"), "desktop main must use the dedicated media IPC boundary");\nassert(main.includes("registerMediaIpc({"), "desktop main must register the media IPC service before creating the window");\nassert(main.includes("getCloudConfig: () => cloudConfigStore?.read()"), "media IPC must read the active cloud configuration");\nassert(main.includes("getAccessToken: () => sessionStore?.getAccessToken()"), "media IPC must obtain credentials only in the main process");\nassert(main.includes("refreshSession: () => refreshSessionIfNeeded()"), "media IPC must share authenticated session refresh semantics");\n'
);
wiring = wiring.replace(
  'assert(!main.includes("PEXELS_API_KEY") && !main.includes("PIXABAY_API_KEY"), "desktop main must never contain provider credentials");',
  'assert(!main.includes("PEXELS_API_KEY") && !main.includes("PIXABAY_API_KEY"), "desktop main must never contain provider credentials");\nassert(!main.includes("function mediaSearchPayload(payload)"), "media validation must stay in the dedicated desktop IPC module rather than duplicate main-process logic");'
);
write("tests/media-workbench-wiring.test.js", wiring);

console.log("Media IPC wiring normalized around the dedicated desktop service.");
