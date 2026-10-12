"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const assetModel = require("../renderer/core-automation-asset-model");
const { buildScenePrompt, mediaExtension, SELECTORS, browserExecutableCandidates } = require("../services/automation/meta-muse-browser");

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
  assert(SELECTORS.editor.includes("data-lexical-editor"));
  assert(SELECTORS.assistant.includes("data-message-role"));

  const tempBrowser = path.join(os.tmpdir(), "viral-ai-meta-muse-browser-test.exe");
  fs.writeFileSync(tempBrowser, "test");
  try {
    const candidates = browserExecutableCandidates({ VIRAL_AI_MUSE_BROWSER_PATH: tempBrowser }, process.platform);
    assert(candidates.some(item => item.label === "custom" && item.executablePath === path.resolve(tempBrowser)), "custom Muse browser path must be discoverable");
  } finally {
    fs.rmSync(tempBrowser, { force: true });
  }

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

  const browser = read("services/automation/meta-muse-browser.js");
  const ipc = read("services/automation/meta-muse-ipc.js");
  const preload = read("preload.js");
  const mainEntry = read("main-entry.js");
  const rendererProvider = read("renderer/core-automation-meta-muse-provider.js");
  const ui = read("renderer/core-automation-meta-muse-ui.js");
  const css = read("renderer/core-automation-meta-muse-ui.css");
  const assetState = read("renderer/core-automation-asset-state.js");
  const index = read("renderer/index.html");
  const docs = read("docs/META_MUSE_BROWSER_BRIDGE.md");
  const pkg = JSON.parse(read("package.json"));

  for (const token of [
    "playwright-core",
    "launchPersistentContext",
    "VIRAL_AI_MUSE_BROWSER_PATH",
    "browserExecutableCandidates",
    "executablePath",
    "channel",
    "https://muse.ai/",
    "/api/auth/check",
    "data-hatch-composer-root",
    "hatch-composer-stop-button",
    "data-message-role=\"assistant\"",
    "generateVideo",
    "downloadMedia",
    "BROWSER_UNAVAILABLE",
    "MUSE_NAVIGATION_FAILED"
  ]) assert(browser.includes(token), "Meta Muse browser adapter missing: " + token);

  assert(!browser.includes("muse-video.com"), "Meta Muse integration must not use muse-video.com");
  assert(!browser.includes("MUSE_VIDEO_API_KEY"), "Meta Muse integration must not expect a Muse API key");

  for (const token of [
    "automation:meta-muse-status",
    "automation:meta-muse-open",
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
    "startAutomationMetaMuseVideo",
    "materializeAutomationMetaMuse",
    "cancelAutomationMetaMuse",
    "onAutomationMetaMuseProgress"
  ]) assert(preload.includes(token), "Meta Muse preload bridge missing: " + token);

  assert(mainEntry.includes("installAutomationMetaMuseIpc();"));
  assert(mainEntry.includes("cancelAllAutomationMetaMuse();"));
  assert(mainEntry.includes("closeAutomationMetaMuseBrowser().catch"));

  assert(rendererProvider.includes("id: 'meta-muse'"));
  assert(rendererProvider.includes("strategies: ['generated']"));
  assert(rendererProvider.includes("router.register(provider)"));
  assert(!rendererProvider.includes("password"));
  assert(!rendererProvider.includes("cookie"));

  for (const token of [
    "data-meta-muse-open",
    "data-meta-muse-refresh",
    "data-meta-muse-generate",
    "data-meta-muse-stock",
    "data-meta-muse-cancel",
    "setSceneStrategy",
    "AbortController",
    "BRIDGE_UNAVAILABLE",
    "BROWSER_UNAVAILABLE",
    "MUSE_NAVIGATION_FAILED",
    "connectionError",
    "opening"
  ]) assert(ui.includes(token), "Meta Muse UI missing: " + token);
  assert(!ui.includes("API key"), "Meta Muse UI should use browser sign-in, not API key entry");
  assert(css.includes(".automation-meta-muse-card"));
  assert(css.includes(".automation-meta-muse-error"));
  assert(css.includes("@container viral-workpage"));

  assert(assetState.includes("function setSceneStrategy"));
  assert(assetState.includes("function setAllStrategies"));

  assert(index.includes('href="core-automation-meta-muse-ui.css"'));
  assert(index.includes('src="core-automation-meta-muse-provider.js"'));
  assert(index.includes('src="core-automation-meta-muse-ui.js"'));
  assert(index.indexOf('src="core-automation-asset-state.js"') < index.indexOf('src="core-automation-meta-muse-provider.js"'));
  assert(index.indexOf('src="core-automation-meta-muse-provider.js"') < index.indexOf('src="core-automation-assets-ui.js"'));

  assert(docs.includes("Meta Muse at https://muse.ai"));
  assert(docs.includes("No Muse API key is required"));
  assert(docs.includes("dedicated Chrome/Edge profile"));

  assert.strictEqual(pkg.dependencies["playwright-core"], "1.64.0");
  assert(pkg.scripts["test:core-automation-meta-muse"], "package.json must expose Meta Muse regression");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-meta-muse"), "commercial regression must gate Meta Muse integration");

  console.log("Meta Muse browser sign-in, Windows browser discovery, generated asset routing, launch diagnostics and Automation UI contracts passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}