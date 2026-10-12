"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const assetModel = require("../renderer/core-automation-asset-model");
const {
  buildScenePrompt,
  mediaExtension,
  PORT_START,
  PORT_END,
  EXTENSION_FILES
} = require("../services/automation/meta-muse-extension-bridge");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function run() {
  const prompt = buildScenePrompt({
    visualIntent: "Close-up of Vietnamese iced coffee, condensation on the glass, slow push in",
    narration: "Một ly cà phê rang xay có thể thay đổi cách bạn bắt đầu ngày mới.",
    aspectRatio: "9:16",
    desiredDurationSec: 5,
    negativeConstraints: ["watermark"]
  });
  assert(prompt.includes("Generate the actual video clip"));
  assert(prompt.includes("Target aspect ratio: 9:16"));
  assert(prompt.includes("about 5 seconds"));
  assert(prompt.includes("do not render these words as text"));
  assert(prompt.includes("No subtitles, captions"));
  assert(prompt.includes("Avoid: watermark"));
  assert.strictEqual(mediaExtension("https://muse.ai/files/demo.mp4"), ".mp4");
  assert.strictEqual(mediaExtension("blob:https://muse.ai/123", "video/webm"), ".webm");
  assert.strictEqual(PORT_START, 32147);
  assert.strictEqual(PORT_END, 32157);
  assert(EXTENSION_FILES.includes("manifest.json"));
  assert(EXTENSION_FILES.includes("content-script.js"));

  const generatedRequest = assetModel.validateAssetRequest({
    sceneId: "scene-meta-muse",
    mediaType: "video",
    query: "coffee product cinematic",
    aspectRatio: "9:16",
    minDurationSec: 3,
    desiredDurationSec: 5,
    strategy: "generated"
  });
  assert.strictEqual(generatedRequest.ok, true, "Asset model must allow generated scenes");
  assert(assetModel.ALLOWED_STRATEGIES.has("stock"));
  assert(assetModel.ALLOWED_STRATEGIES.has("generated"));

  const bridge = read("services/automation/meta-muse-extension-bridge.js");
  const ipc = read("services/automation/meta-muse-ipc.js");
  const preload = read("preload.js");
  const mainEntry = read("main-entry.js");
  const rendererProvider = read("renderer/core-automation-meta-muse-provider.js");
  const ui = read("renderer/core-automation-meta-muse-ui.js");
  const css = read("renderer/core-automation-meta-muse-ui.css");
  const assetState = read("renderer/core-automation-asset-state.js");
  const index = read("renderer/index.html");
  const docs = read("docs/META_MUSE_BROWSER_BRIDGE.md");
  const manifestText = read("extensions/meta-muse-bridge/manifest.json");
  const serviceWorker = read("extensions/meta-muse-bridge/service-worker.js");
  const contentScript = read("extensions/meta-muse-bridge/content-script.js");
  const popup = read("extensions/meta-muse-bridge/popup.js");
  const pkg = JSON.parse(read("package.json"));
  const manifest = JSON.parse(manifestText);

  assert.doesNotThrow(() => new Function(serviceWorker), "Meta Muse service worker must parse");
  assert.doesNotThrow(() => new Function(contentScript), "Meta Muse content script must parse");
  assert.doesNotThrow(() => new Function(popup), "Meta Muse popup script must parse");
  assert.doesNotThrow(() => new Function(ui), "Meta Muse renderer UI must parse");

  for (const token of [
    "127.0.0.1",
    "32147",
    "32157",
    "/v1/register",
    "/v1/heartbeat",
    "/v1/poll",
    "/v1/result",
    "chrome-extension://",
    "selectedInstanceId",
    "requiresSelection",
    "selectSession",
    "generateVideo",
    "downloadMedia",
    "extensionInstallDir"
  ]) assert(bridge.includes(token), "Meta Muse extension bridge missing: " + token);

  assert(!ipc.includes("createMetaMuseBrowser"), "Meta Muse IPC must not launch a dedicated browser profile anymore");
  assert(ipc.includes("createMetaMuseExtensionBridge"));
  for (const token of [
    "automation:meta-muse-status",
    "automation:meta-muse-open",
    "automation:meta-muse-extension-reveal",
    "automation:meta-muse-select-session",
    "automation:meta-muse-generate",
    "automation:meta-muse-materialize",
    "automation:meta-muse-cancel",
    "candidateToken",
    "probeVideo",
    "cache().adopt"
  ]) assert(ipc.includes(token), "Meta Muse IPC missing: " + token);

  for (const token of [
    "getAutomationMetaMuseStatus",
    "openAutomationMetaMuse",
    "revealAutomationMetaMuseExtension",
    "selectAutomationMetaMuseSession",
    "startAutomationMetaMuseVideo",
    "materializeAutomationMetaMuse",
    "cancelAutomationMetaMuse",
    "onAutomationMetaMuseProgress"
  ]) assert(preload.includes(token), "Meta Muse preload bridge missing: " + token);

  assert(mainEntry.includes("installAutomationMetaMuseIpc();"));
  assert(mainEntry.includes("cancelAllAutomationMetaMuse();"));

  assert(rendererProvider.includes("id: 'meta-muse'"));
  assert(rendererProvider.includes("strategies: ['generated']"));
  assert(rendererProvider.includes("router.register(provider)"));
  assert(rendererProvider.includes("revealExtension"));
  assert(rendererProvider.includes("selectSession"));
  assert(!rendererProvider.includes("password"));
  assert(!rendererProvider.includes("cookie"));

  for (const token of [
    "data-meta-muse-install",
    "data-meta-muse-session",
    "data-meta-muse-open",
    "data-meta-muse-refresh",
    "data-meta-muse-generate",
    "data-meta-muse-stock",
    "data-meta-muse-cancel",
    "setSceneStrategy",
    "AbortController",
    "selectSession"
  ]) assert(ui.includes(token), "Meta Muse UI missing: " + token);
  assert(!ui.includes("data-meta-muse-api-key"), "Meta Muse UI must not expose an API-key field");
  assert(!ui.includes('type=\"password\"'), "Meta Muse UI must not expose a password/API-key input");
  assert(css.includes(".automation-meta-muse-card"));
  assert(css.includes(".automation-meta-muse-session"));
  assert(css.includes("-webkit-app-region:no-drag"), "Meta Muse controls must stay clickable in Electron");
  assert(css.includes("pointer-events:auto"), "Meta Muse controls must explicitly accept pointer input");

  assert.strictEqual(manifest.manifest_version, 3);
  assert(manifest.permissions.includes("storage"));
  assert(manifest.permissions.includes("tabs"));
  assert(manifest.permissions.includes("downloads"));
  assert(manifest.host_permissions.includes("https://muse.ai/*"));
  assert(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert(manifest.content_scripts.some(item => item.matches.includes("https://muse.ai/*") && item.js.includes("content-script.js")));

  for (const token of [
    "instanceId",
    "profileLabel",
    "bridgePort",
    "bridgeToken",
    "viral-ai:muse-tab",
    "chrome.tabs.query",
    "chrome.tabs.sendMessage",
    "chrome.downloads.download",
    "viral-ai:set-profile-label",
    "viral-ai:bridge-state"
  ]) assert(serviceWorker.includes(token), "Meta Muse extension service worker missing: " + token);
  assert(!serviceWorker.includes("document.cookie"), "Extension must not read Muse cookies");

  for (const token of [
    "data-hatch-composer-root",
    "data-lexical-editor",
    "hatch-composer-stop-button",
    "data-message-role=\"assistant\"",
    "viral-ai:muse-generate",
    "viral-ai:muse-cancel",
    "mediaFromNode",
    "Generate"
  ]) assert(contentScript.includes(token), "Meta Muse content script missing: " + token);
  assert(!contentScript.includes("document.cookie"), "Muse content script must not extract cookies");

  assert(assetState.includes("function setSceneStrategy"));
  assert(assetState.includes("function setAllStrategies"));
  assert(index.includes('href="core-automation-meta-muse-ui.css"'));
  assert(index.includes('src="core-automation-meta-muse-provider.js"'));
  assert(index.includes('src="core-automation-meta-muse-ui.js"'));
  assert(index.indexOf('src="core-automation-asset-state.js"') < index.indexOf('src="core-automation-meta-muse-provider.js"'));
  assert(index.indexOf('src="core-automation-meta-muse-provider.js"') < index.indexOf('src="core-automation-assets-ui.js"'));

  assert(docs.includes("existing Chrome profile and existing muse.ai tab"));
  assert(docs.includes("does not export cookies, passwords or Meta tokens"));
  assert(docs.includes("multiple profiles"));
  assert(docs.includes("Load unpacked"));

  assert(pkg.build.files.includes("extensions/**/*"), "Packaged builds must include the Chrome extension source");
  assert(pkg.scripts["test:core-automation-meta-muse"], "package.json must expose Meta Muse regression");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-meta-muse"), "commercial regression must gate Meta Muse integration");

  console.log("Meta Muse current-profile Chrome extension bridge, multi-profile selection, generation, download boundary and Automation UI contracts passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
