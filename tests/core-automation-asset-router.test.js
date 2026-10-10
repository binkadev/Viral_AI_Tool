"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const assetModel = require("../renderer/core-automation-asset-model");
const assetRouter = require("../renderer/core-automation-asset-router");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail("Expected rejection: " + code);
  } catch (error) {
    assert.strictEqual(error.code, code);
  }
}

async function run() {
  assert.strictEqual(assetModel.VERSION, 1);

  const brief = { aspectRatio: "9:16", targetDurationSec: 12, topic: "phối đồ nam" };
  const scenePlan = {
    outputSignature: "scene-plan-v1:demo",
    scenes: [
      { id: "scene-a", order: 1, durationHintSec: 5, searchTerms: ["korean", "menswear", "street"], visualIntent: "Opening outfit shot", assetStrategy: "stock" },
      { id: "scene-b", order: 2, durationHintSec: 7, searchTerms: ["jacket", "fashion", "vertical"], visualIntent: "Jacket detail", assetStrategy: "stock" }
    ]
  };

  const built = assetModel.buildAssetRequests({ brief, scenePlan, now: Date.UTC(2026, 9, 10, 10, 0, 0) });
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.value.length, 2);
  assert.strictEqual(built.value[0].sceneId, "scene-a");
  assert.strictEqual(built.value[0].aspectRatio, "9:16");
  assert.strictEqual(built.value[0].mediaType, "video");
  assert.strictEqual(built.value[0].strategy, "stock");
  assert.strictEqual(built.value[0].inputSignature, scenePlan.outputSignature);
  assert(built.value[0].requestSignature.startsWith("asset-request-v1:"));
  assert(built.value[0].id.startsWith("asset-request-"));
  assert(built.value[0].negativeConstraints.includes("watermark"));

  const repeated = assetModel.buildAssetRequests({ brief, scenePlan, now: Date.UTC(2026, 9, 10, 11, 0, 0) });
  assert.deepStrictEqual(
    repeated.value.map(request => request.requestSignature),
    built.value.map(request => request.requestSignature),
    "request identity must not depend on timestamps"
  );

  assert.strictEqual(assetModel.validateAssetRequest({
    sceneId: "x", query: "demo", mediaType: "video", aspectRatio: "9:16", desiredDurationSec: 4, strategy: "ai-video"
  }).ok, false, "A4 must reject AI-video strategies");

  const request = built.value[0];
  const portraitGood = assetModel.normalizeCandidate({ id: "good", type: "video", width: 1080, height: 1920, durationSec: 6, score: 0.7 }, "stock-b");
  const portraitShort = assetModel.normalizeCandidate({ id: "short", type: "video", width: 1080, height: 1920, durationSec: 1, score: 1 }, "stock-b");
  const landscape = assetModel.normalizeCandidate({ id: "landscape", type: "video", width: 1920, height: 1080, durationSec: 8, score: 1 }, "stock-b");
  assert.strictEqual(assetModel.candidateMatchesRequest(portraitGood, request), true);
  assert.strictEqual(assetModel.candidateMatchesRequest(portraitShort, request), false);
  assert.strictEqual(assetModel.candidateMatchesRequest(landscape, request), false);

  const unsupported = assetRouter.createRouter({
    providers: [{
      id: "image-only",
      capabilities: { strategies: ["stock"], mediaTypes: ["image"], aspects: ["9:16"] },
      search: async () => []
    }]
  });
  await expectCode(unsupported.resolve(request), "UNSUPPORTED_REQUEST");

  const notConfigured = assetRouter.createRouter({
    providers: [{
      id: "stock-off",
      capabilities: { strategies: ["stock"], mediaTypes: ["video"], aspects: ["9:16"] },
      isConfigured: () => false,
      search: async () => []
    }]
  });
  await expectCode(notConfigured.resolve(request), "PROVIDER_NOT_CONFIGURED");

  const fallbackRouter = assetRouter.createRouter({
    priority: ["stock-a", "stock-b"],
    providers: [
      {
        id: "stock-a",
        capabilities: { strategies: ["stock"], mediaTypes: ["video"], aspects: ["9:16"] },
        isConfigured: () => true,
        search: async () => { throw new Error("network connection failed"); }
      },
      {
        id: "stock-b",
        capabilities: { strategies: ["stock"], mediaTypes: ["video"], aspects: ["9:16"] },
        isConfigured: () => true,
        search: async () => [
          { id: "wrong-ratio", type: "video", width: 1920, height: 1080, durationSec: 10, score: 1 },
          { id: "too-short", type: "video", width: 1080, height: 1920, durationSec: 1, score: 1 },
          { id: "usable", type: "video", width: 1080, height: 1920, durationSec: 5.5, score: 0.8, sourcePage: "https://example.test/media/usable" }
        ],
        materialize: async candidate => ({
          providerAssetId: candidate.providerAssetId,
          type: "video",
          localPath: "C:/viral-ai/assets/usable.mp4",
          width: 1080,
          height: 1920,
          durationSec: 5.5,
          sourcePage: candidate.sourcePage,
          checksum: "sha256-demo"
        })
      }
    ]
  });
  const routed = await fallbackRouter.resolve(request);
  assert.strictEqual(routed.provider, "stock-b");
  assert.strictEqual(routed.candidates.length, 1, "router must filter wrong ratio and short candidates");
  assert.strictEqual(routed.selected.providerAssetId, "usable");
  assert(routed.asset);
  assert.strictEqual(routed.asset.sceneId, request.sceneId);
  assert.strictEqual(routed.asset.requestSignature, request.requestSignature);
  assert.strictEqual(routed.asset.localPath, "C:/viral-ai/assets/usable.mp4");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(routed.asset, "downloadUrl"), false, "durable AssetRef must not persist transient download URLs");

  const candidateOnly = assetRouter.createRouter({
    providers: [{
      id: "stock-search-only",
      capabilities: { strategies: ["stock"], mediaTypes: ["video"], aspects: ["9:16"] },
      isConfigured: () => true,
      search: async () => [{ id: "candidate", type: "video", width: 1080, height: 1920, durationSec: 6 }]
    }]
  });
  const candidateResult = await candidateOnly.resolve(request);
  assert.strictEqual(candidateResult.materializationRequired, true);
  assert.strictEqual(candidateResult.asset, null);

  const controller = new AbortController();
  controller.abort();
  await expectCode(candidateOnly.resolve(request, { signal: controller.signal }), "CANCELLED");

  let releaseSlow;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });
  const slowRouter = assetRouter.createRouter({
    providers: [{
      id: "slow-stock",
      capabilities: { strategies: ["stock"], mediaTypes: ["video"], aspects: ["9:16"] },
      search: async () => {
        await slowGate;
        return [{ id: "slow", type: "video", width: 1080, height: 1920, durationSec: 6 }];
      }
    }]
  });
  const first = slowRouter.resolve(request);
  await Promise.resolve();
  await expectCode(slowRouter.resolve(request), "DUPLICATE_ACTIVE");
  releaseSlow();
  await first;

  const stateSource = read("renderer/core-automation-asset-state.js");
  const uiSource = read("renderer/core-automation-assets-ui.js");
  const uiCss = read("renderer/core-automation-assets-ui.css");
  const workspace = read("renderer/core-automation-workspace.js");
  const index = read("renderer/index.html");
  const pkg = JSON.parse(read("package.json"));

  for (const required of [
    "syncRequests",
    "requestForScene",
    "resolveScene",
    "automation-asset-requests-synced",
    "ViralAutomationAssetState"
  ]) assert(stateSource.includes(required), "Asset state bridge missing: " + required);
  assert(!stateSource.includes("fetch("), "Asset state bridge must not call providers directly.");

  for (const required of [
    "automation-assets-host",
    "automationSyncAssetRequests",
    "automation-assets-workbench",
    "data-asset-scene",
    "ViralAutomationAssetState?.syncRequests",
    "ViralAutomationAssetsUi"
  ]) assert(uiSource.includes(required), "Asset workspace UI missing: " + required);
  assert(!uiSource.includes("OPENAI_API_KEY"));
  assert(!uiSource.includes("PEXELS_API_KEY"));
  assert(!uiSource.includes("PIXABAY_API_KEY"));

  for (const required of [
    ".automation-assets-workbench",
    ".automation-asset-nav-item",
    ".automation-asset-inspector",
    ".automation-asset-provider-state",
    "@media(max-width:900px)"
  ]) assert(uiCss.includes(required), "Asset UI CSS missing: " + required);

  assert(workspace.includes("if (stage === 4) return hasScenePlan()"));
  assert(workspace.includes("function hasAssetRequests()"));
  assert(workspace.includes("data-automation-workspace-go=\"4\""));
  assert(workspace.includes("ViralAutomationAssetsUi?.refresh"));

  for (const required of [
    'href="core-automation-assets-ui.css"',
    'src="core-automation-asset-model.js"',
    'src="core-automation-asset-router.js"',
    'src="core-automation-asset-state.js"',
    'src="core-automation-assets-ui.js"'
  ]) assert(index.includes(required), "Renderer missing Asset Router module: " + required);
  assert(index.indexOf('src="core-automation-asset-model.js"') < index.indexOf('src="core-automation-asset-router.js"'));
  assert(index.indexOf('src="core-automation-asset-router.js"') < index.indexOf('src="core-automation-asset-state.js"'));
  assert(index.indexOf('src="core-automation-assets-ui.js"') < index.indexOf('src="core-automation-workspace.js"'));

  assert(pkg.scripts["test:core-automation-asset-router"], "package.json must expose Asset Router regression.");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-asset-router"), "commercial regression must gate Asset Router.");

  console.log("Automation AssetRequest schema, provider capability routing, fallback, filtering, cancellation, duplicate protection and stage-4 UI contracts passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});