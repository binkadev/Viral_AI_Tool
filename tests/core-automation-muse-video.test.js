"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { createMuseConfigStore } = require("../services/automation/muse-config-store");
const {
  createMuseVideoProvider,
  clampDuration,
  dimensionsFor,
  buildPrompt
} = require("../services/automation/muse-video-provider");
const assetModel = require("../renderer/core-automation-asset-model");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from("encrypted:" + String(value), "utf8"),
    decryptString: buffer => String(buffer.toString("utf8")).replace(/^encrypted:/, "")
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function run() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "viral-ai-muse-"));
  try {
    const secret = "sk-muse-super-secret";
    const store = createMuseConfigStore({
      userDataPath: temp,
      safeStorage: fakeSafeStorage(),
      env: {}
    });
    const saved = store.save({
      apiKey: secret,
      model: "kling26-text-to-video",
      resolution: "720p",
      generateAudio: false
    });
    assert.strictEqual(saved.apiKeyConfigured, true);
    assert.strictEqual(saved.apiKeySource, "secure-store");
    assert.strictEqual(store.secret(), secret);
    const rawConfig = fs.readFileSync(store.filePath, "utf8");
    assert(!rawConfig.includes(secret), "Muse API key must never be persisted as plaintext");
    assert(rawConfig.includes("apiKeyEncrypted"), "Muse API key must be persisted only as encrypted data");

    const envStore = createMuseConfigStore({
      userDataPath: path.join(temp, "env"),
      safeStorage: fakeSafeStorage(),
      env: {
        MUSE_VIDEO_API_KEY: "sk-env-key",
        MUSE_VIDEO_MODEL: "happyhorse-1.0-text-to-video",
        MUSE_VIDEO_RESOLUTION: "1080p",
        MUSE_VIDEO_GENERATE_AUDIO: "1"
      }
    });
    assert.strictEqual(envStore.read().apiKey, "sk-env-key");
    assert.strictEqual(envStore.publicConfig().environmentLocked, true);
    assert.strictEqual(envStore.publicConfig().model, "happyhorse-1.0-text-to-video");
    assert.strictEqual(envStore.publicConfig().resolution, "1080p");
    assert.strictEqual(envStore.publicConfig().generateAudio, true);

    assert.strictEqual(clampDuration(2, { minDuration: 5, maxDuration: 10 }), 5);
    assert.strictEqual(clampDuration(20, { minDuration: 5, maxDuration: 10 }), 10);
    assert.strictEqual(clampDuration(8, { minDuration: 6, maxDuration: 10, allowedDurations: [6, 10] }), 10);
    assert.deepStrictEqual(dimensionsFor("9:16", "720p"), { width: 720, height: 1280 });
    assert.deepStrictEqual(dimensionsFor("16:9", "1080p"), { width: 1920, height: 1080 });
    assert(buildPrompt({ visualIntent: "cinematic coffee product shot", narration: "Taste the difference." }).includes("do not render text"));

    const calls = [];
    const cacheDownloads = [];
    const cache = {
      async download(payload) {
        cacheDownloads.push(payload);
        return {
          cacheHit: false,
          record: {
            localPath: path.join(temp, "muse-generated.mp4"),
            checksum: "sha256:test"
          }
        };
      }
    };
    const providerConfig = {
      read() {
        return {
          apiKey: secret,
          model: "kling26-text-to-video",
          resolution: "720p",
          generateAudio: false
        };
      }
    };
    let pollCount = 0;
    const provider = createMuseVideoProvider({
      cache,
      configStore: providerConfig,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/api/v1/generate")) {
          return jsonResponse({ code: 200, message: "success", data: { task_id: "task-123", status: "IN_PROGRESS" } });
        }
        if (String(url).includes("/api/v1/status?task_id=task-123")) {
          pollCount += 1;
          return jsonResponse({
            code: 200,
            message: "success",
            data: pollCount < 2
              ? { task_id: "task-123", status: "IN_PROGRESS" }
              : {
                  task_id: "task-123",
                  status: "SUCCESS",
                  consumed_credits: 54,
                  response: { resultUrls: ["https://cdn.muse-video.test/result-123.mp4"] }
                }
          });
        }
        throw new Error("Unexpected URL: " + url);
      }
    });

    assert.strictEqual(await provider.isConfigured(), true);
    const progress = [];
    const candidates = await provider.generate({
      sceneId: "scene-1",
      prompt: "Premium watch rotating in a dark studio, slow dolly in",
      narration: "A clean premium watch shot.",
      aspectRatio: "9:16",
      desiredDurationSec: 6.9,
      negativeConstraints: ["watermark"]
    }, { onProgress: item => progress.push(item) });

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].providerAssetId, "task-123");
    assert.strictEqual(candidates[0].durationSec, 7);
    assert.strictEqual(candidates[0].width, 720);
    assert.strictEqual(candidates[0].height, 1280);
    assert.strictEqual(candidates[0].raw.consumedCredits, 54);
    assert(!JSON.stringify(candidates).includes(secret), "Muse API key must never enter candidate/project data");
    assert(progress.some(item => item.phase === "queued"));
    assert(progress.some(item => item.phase === "generating"));
    assert(progress.some(item => item.phase === "generated"));

    const createCall = calls.find(item => item.url.endsWith("/api/v1/generate"));
    assert(createCall, "Muse provider must call POST /api/v1/generate");
    assert.strictEqual(createCall.options.method, "POST");
    assert.strictEqual(createCall.options.headers.Authorization, "Bearer " + secret);
    const body = JSON.parse(createCall.options.body);
    assert.strictEqual(body.model, "kling26-text-to-video");
    assert.strictEqual(body.aspect_ratio, "9:16");
    assert.strictEqual(body.duration, 7);
    assert.strictEqual(body.generate_audio, false);
    assert.strictEqual(body.negative_prompt, "watermark");
    assert(calls.some(item => item.url.includes("/api/v1/status?task_id=task-123")), "Muse provider must poll task status");

    const asset = await provider.materialize(candidates[0], {
      request: { desiredDurationSec: 7 }
    });
    assert.strictEqual(asset.provider, "muse-video");
    assert.strictEqual(asset.providerAssetId, "task-123");
    assert.strictEqual(asset.localPath, path.join(temp, "muse-generated.mp4"));
    assert.strictEqual(cacheDownloads.length, 1);
    assert.strictEqual(cacheDownloads[0].url, "https://cdn.muse-video.test/result-123.mp4");
    assert(cacheDownloads[0].cacheKey.startsWith("muse-video:"));

    const generatedRequest = assetModel.validateAssetRequest({
      sceneId: "scene-generated",
      mediaType: "video",
      query: "cinematic product shot",
      aspectRatio: "9:16",
      minDurationSec: 4,
      desiredDurationSec: 6,
      strategy: "generated"
    });
    assert.strictEqual(generatedRequest.ok, true, "Asset model must accept the generated strategy");
    assert(assetModel.ALLOWED_STRATEGIES.has("stock"));
    assert(assetModel.ALLOWED_STRATEGIES.has("generated"));

    const ipc = read("services/automation/muse-video-ipc.js");
    const configSource = read("services/automation/muse-config-store.js");
    const providerSource = read("services/automation/muse-video-provider.js");
    const preload = read("preload.js");
    const mainEntry = read("main-entry.js");
    const assetState = read("renderer/core-automation-asset-state.js");
    const rendererProvider = read("renderer/core-automation-muse-provider.js");
    const museUi = read("renderer/core-automation-muse-ui.js");
    const museCss = read("renderer/core-automation-muse-ui.css");
    const index = read("renderer/index.html");
    const envExample = read(".env.example");
    const pkg = JSON.parse(read("package.json"));

    for (const token of [
      "automation:muse-status",
      "automation:muse-config-save",
      "automation:muse-generate",
      "automation:muse-materialize",
      "automation:muse-cancel",
      "candidateTokens",
      "cancelAllAutomationMuseVideo"
    ]) assert(ipc.includes(token), "Muse IPC missing: " + token);

    assert(configSource.includes("safeStorage.encryptString"), "Muse key must be encrypted by Electron safeStorage");
    assert(configSource.includes("MUSE_VIDEO_API_KEY"), "Muse must support secure environment configuration");
    assert(providerSource.includes("https://muse-video.com"));
    assert(providerSource.includes("/api/v1/generate"));
    assert(providerSource.includes("/api/v1/status?task_id="));
    assert(providerSource.includes("response?.resultUrls"));

    for (const token of [
      "getAutomationMuseStatus",
      "saveAutomationMuseConfig",
      "startAutomationMuseVideo",
      "materializeAutomationMuseVideo",
      "cancelAutomationMuseVideo",
      "onAutomationMuseProgress"
    ]) assert(preload.includes(token), "Muse preload bridge missing: " + token);

    assert(mainEntry.includes("installAutomationMuseVideoIpc();"));
    assert(mainEntry.includes("cancelAllAutomationMuseVideo();"));
    assert(assetState.includes("function setSceneStrategy"));
    assert(assetState.includes("function setAllStrategies"));
    assert(rendererProvider.includes("router.register(provider)"));
    assert(rendererProvider.includes("strategies: ['generated']"));
    assert(rendererProvider.includes("candidateToken"));
    assert(!rendererProvider.includes("MUSE_VIDEO_API_KEY"), "Renderer provider must never read the Muse secret");

    for (const token of [
      "data-muse-api-key",
      "data-muse-model",
      "data-muse-scene",
      "data-muse-all",
      "data-muse-stock",
      "data-muse-cancel",
      "setSceneStrategy",
      "setAllStrategies",
      "AbortController",
      "confirmBatch"
    ]) assert(museUi.includes(token), "Muse UI missing: " + token);
    assert(!museUi.includes("localStorage"), "Muse API key/config must not be stored in renderer localStorage");
    assert(museCss.includes(".automation-muse-card"));
    assert(museCss.includes("@container viral-workpage"));

    assert(index.includes('href="core-automation-muse-ui.css"'));
    assert(index.includes('src="core-automation-muse-provider.js"'));
    assert(index.includes('src="core-automation-muse-ui.js"'));
    assert(index.indexOf('src="core-automation-asset-state.js"') < index.indexOf('src="core-automation-muse-provider.js"'));
    assert(index.indexOf('src="core-automation-muse-provider.js"') < index.indexOf('src="core-automation-assets-ui.js"'));

    assert(envExample.includes("MUSE_VIDEO_API_KEY="));
    assert(envExample.includes("MUSE_VIDEO_MODEL="));
    assert(pkg.scripts["test:core-automation-muse-video"], "package.json must expose Muse provider regression");
    assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-muse-video"), "commercial regression must gate Muse integration");

    console.log("Muse Video secure configuration, async generation, polling, materialization, cancellation and Automation routing contracts passed.");
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
