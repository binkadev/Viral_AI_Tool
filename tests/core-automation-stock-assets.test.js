"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { createAssetCache, cacheFileName } = require("../services/automation/asset-cache");
const { createPexelsStockProvider, pickVideoFile } = require("../services/automation/pexels-stock-provider");
const { createDevStockProvider, dimensionsFor } = require("../services/automation/dev-stock-provider");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

async function run() {
  assert.strictEqual(cacheFileName("same-key", ".mp4"), cacheFileName("same-key", ".mp4"));
  assert(cacheFileName("same-key", ".mp4").endsWith(".mp4"));
  assert.deepStrictEqual(dimensionsFor("9:16"), { width: 720, height: 1280 });
  assert.deepStrictEqual(dimensionsFor("16:9"), { width: 1280, height: 720 });

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "viral-ai-asset-cache-"));
  const source = path.join(tempRoot, "source.mp4");
  await fsp.writeFile(source, Buffer.from("asset-cache-test"));
  const cache = createAssetCache({ rootDir: path.join(tempRoot, "cache"), now: () => Date.UTC(2026, 9, 10, 12, 0, 0) });
  const adopted = await cache.adopt({
    cacheKey: "provider:item:1",
    sourcePath: source,
    extension: ".mp4",
    metadata: { provider: "test", providerAssetId: "1", width: 720, height: 1280, durationSec: 4 }
  });
  assert.strictEqual(adopted.cacheHit, false);
  assert(fs.existsSync(adopted.record.localPath));
  assert(adopted.record.checksum.startsWith("sha256:"));
  const cached = await cache.get("provider:item:1");
  assert(cached && cached.localPath === adopted.record.localPath);
  await fsp.rm(adopted.record.localPath, { force: true });
  assert.strictEqual(await cache.get("provider:item:1"), null, "missing cached file must recover as a cache miss");
  await fsp.rm(tempRoot, { recursive: true, force: true });

  const portrait = { id: 1, width: 720, height: 1280, link: "https://cdn.example/portrait.mp4", quality: "hd" };
  const landscape = { id: 2, width: 1280, height: 720, link: "https://cdn.example/landscape.mp4", quality: "hd" };
  assert.strictEqual(pickVideoFile({ video_files: [landscape, portrait] }, "9:16").id, 1);
  assert.strictEqual(pickVideoFile({ video_files: [portrait, landscape] }, "16:9").id, 2);

  let requestedUrl = "";
  let requestedAuth = "";
  const pexels = createPexelsStockProvider({
    cache: createAssetCache({ rootDir: path.join(os.tmpdir(), "viral-ai-pexels-provider-test") }),
    apiKey: "server-secret-key",
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      requestedAuth = String(options?.headers?.Authorization || "");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            videos: [{
              id: 99,
              duration: 6,
              width: 720,
              height: 1280,
              image: "https://images.example/99.jpg",
              url: "https://www.pexels.com/video/99/",
              user: { name: "Creator" },
              video_files: [{ id: 7, width: 720, height: 1280, quality: "hd", link: "https://videos.example/99.mp4" }]
            }]
          };
        }
      };
    }
  });
  assert.strictEqual(await pexels.isConfigured(), true);
  const candidates = await pexels.search({ query: "street food", aspectRatio: "9:16" });
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].providerAssetId, "99");
  assert.strictEqual(candidates[0].width, 720);
  assert(requestedUrl.includes("orientation=portrait"));
  assert.strictEqual(requestedAuth, "server-secret-key");
  assert(!JSON.stringify(candidates[0]).includes("server-secret-key"), "provider credentials must never enter candidate data");

  const dev = createDevStockProvider({ cache: createAssetCache({ rootDir: path.join(os.tmpdir(), "viral-ai-dev-stock-test") }), enabled: false });
  assert.strictEqual(await dev.isConfigured(), false);

  const ipc = read("services/automation/stock-desktop-ipc.js");
  const preload = read("preload.js");
  const bridge = read("renderer/core-automation-desktop-stock-provider.js");
  const assetUi = read("renderer/core-automation-assets-ui.js");
  const index = read("renderer/index.html");
  const mainEntry = read("main-entry.js");
  const env = read(".env.example");
  const pkg = JSON.parse(read("package.json"));

  for (const required of [
    "automation:stock-status",
    "automation:stock-search",
    "automation:stock-materialize",
    "automation:stock-cancel",
    "candidateTokens",
    "publicCandidate",
    "cancelAllAutomationStockOperations"
  ]) assert(ipc.includes(required), "Stock IPC missing: " + required);
  assert(!ipc.includes("PEXELS_API_KEY"), "Stock IPC response layer must not read or expose provider secrets directly");

  for (const required of [
    "getAutomationStockStatus",
    "searchAutomationStock",
    "materializeAutomationStock",
    "cancelAutomationStock"
  ]) assert(preload.includes(required), "Preload stock bridge missing: " + required);

  for (const required of [
    "router.register(createProvider(id))",
    "['pexels', 'dev-stock']",
    "candidateToken",
    "viral-ai:automation-stock-status",
    "ViralAutomationDesktopStockProvider"
  ]) assert(bridge.includes(required), "Renderer stock adapter missing: " + required);
  assert(!bridge.includes("PEXELS_API_KEY"));

  for (const required of [
    "data-asset-resolve",
    "resolveScene(sceneId)",
    "ViralAutomationAssetState?.resolveScene",
    "data-asset-open",
    "viral-ai:automation-stock-status"
  ]) assert(assetUi.includes(required), "Assets UI real materialization missing: " + required);

  assert(index.includes('src="core-automation-desktop-stock-provider.js"'));
  assert(index.indexOf('src="core-automation-asset-state.js"') < index.indexOf('src="core-automation-desktop-stock-provider.js"'));
  assert(index.indexOf('src="core-automation-desktop-stock-provider.js"') < index.indexOf('src="core-automation-assets-ui.js"'));
  assert(mainEntry.includes("installAutomationStockIpc();"));
  assert(mainEntry.includes("cancelAllAutomationStockOperations();"));
  assert(env.includes("PEXELS_API_KEY="));
  assert(env.includes("VIRAL_AI_AUTOMATION_DEV_STOCK_PROVIDER=0"));
  assert(pkg.scripts["test:core-automation-stock-assets"], "package.json must expose stock asset regression.");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-stock-assets"), "commercial regression must gate stock assets.");

  console.log("Automation stock provider bridge, Pexels normalization, no-key dev provider, durable cache and real Assets workspace materialization tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
