"use strict";

const assert = require("assert");
const {
  createMediaDesktopController,
  publicDesktopMediaError,
  requestId
} = require("../services/media/desktop-controller");

(async () => {
  assert.strictEqual(requestId("media-search-1"), "media-search-1");
  assert.throws(() => requestId("x"), error => error?.code === "MEDIA_SEARCH_INVALID");

  let token = "access-token";
  let refreshCalls = 0;
  const clientCalls = [];
  let releaseSearch;

  const controller = createMediaDesktopController({
    getBackendUrl: () => "https://api.example.test",
    getAccessToken: () => token,
    refreshSession: async () => {
      refreshCalls += 1;
      return Boolean(token);
    },
    appVersion: "0.14.0",
    clientFactory: options => ({
      async status() {
        clientCalls.push({ type: "status", options });
        return { ready: true, code: "READY" };
      },
      async search(payload) {
        clientCalls.push({ type: "search", options, payload });
        return new Promise((resolve, reject) => {
          releaseSearch = () => resolve({ results: [], provider: "pexels" });
          payload.signal.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.code = "MEDIA_CANCELLED";
            reject(error);
          }, { once: true });
        });
      }
    })
  });

  const status = await controller.status();
  assert.strictEqual(status.ready, true);
  assert.strictEqual(refreshCalls, 1);
  assert.strictEqual(clientCalls[0].options.backendUrl, "https://api.example.test");
  assert.strictEqual(clientCalls[0].options.getAccessToken(), "access-token");

  const pending = controller.search({
    requestId: "media-search-0001",
    query: "lion",
    kind: "video",
    orientation: "portrait"
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(controller.activeCount(), 1);

  await assert.rejects(
    () => controller.search({ requestId: "media-search-0001", query: "lion" }),
    error => error?.code === "MEDIA_SEARCH_CONFLICT"
  );

  assert.deepStrictEqual(controller.cancel("media-search-0001"), { cancelled: true });
  await assert.rejects(() => pending, error => error?.code === "MEDIA_CANCELLED");
  assert.strictEqual(controller.activeCount(), 0);
  assert.deepStrictEqual(controller.cancel("media-search-0001"), { cancelled: false });

  const success = controller.search({
    requestId: "media-search-0002",
    query: "river"
  });
  await new Promise(resolve => setImmediate(resolve));
  releaseSearch();
  assert.deepStrictEqual(await success, { results: [], provider: "pexels" });
  assert.strictEqual(controller.activeCount(), 0);

  token = null;
  await assert.rejects(() => controller.status(), error => error?.code === "MEDIA_AUTH_REQUIRED");

  assert.deepStrictEqual(
    publicDesktopMediaError(Object.assign(new Error("secret technical detail"), {
      code: "MEDIA_SEARCH_INVALID",
      details: { field: "query", providerResponse: "do-not-leak" }
    })),
    { code: "MEDIA_SEARCH_INVALID", details: { field: "query" } }
  );
  assert.deepStrictEqual(
    publicDesktopMediaError(Object.assign(new Error("secret"), { code: "MEDIA_DESTINATION_UNAVAILABLE", details: { path: "C:/private/cache" } })),
    { code: "MEDIA_DESTINATION_UNAVAILABLE", details: {} }
  );
  assert.deepStrictEqual(
    publicDesktopMediaError(Object.assign(new Error("secret"), { code: "ECONNRESET" })),
    { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} }
  );

  token = "access-token";
  const acquisitionCalls = [];
  const managerState = { active: 0 };
  const acquisitionManager = {
    async acquire(payload) {
      acquisitionCalls.push({ type: "acquire", payload });
      managerState.active += 1;
      managerState.active -= 1;
      return {
        duplicate: false,
        asset: {
          id: "stock:pexels:987",
          origin: "stock",
          provider: "pexels",
          providerAssetId: "987",
          localPath: "C:/app-cache/project/file.mp4",
          status: "ready",
          fileState: "available"
        }
      };
    },
    cancel(jobId) {
      acquisitionCalls.push({ type: "cancel", jobId });
      return { cancelled: false };
    },
    cancelAll() {
      acquisitionCalls.push({ type: "cancelAll" });
      return managerState.active;
    },
    activeCount() { return managerState.active; }
  };

  let resolveMode = "success";
  const acquisitionController = createMediaDesktopController({
    getBackendUrl: () => "https://api.example.test",
    getAccessToken: () => token,
    refreshSession: async () => Boolean(token),
    acquisitionManager,
    clientFactory: () => ({
      async resolveAcquisition(ticket, { signal } = {}) {
        acquisitionCalls.push({ type: "resolve", ticket, signal });
        if (resolveMode === "pending") {
          return new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => {
              const error = new Error("cancelled");
              error.code = "MEDIA_CANCELLED";
              reject(error);
            }, { once: true });
          });
        }
        return {
          provider: "pexels",
          providerAssetId: "987",
          kind: "video",
          name: "Lion",
          downloadUrl: "https://videos.pexels.com/video-files/987/hd.mp4",
          mime: "video/mp4",
          meta: { width: 1080, height: 1920, duration: 12, orientation: "portrait" },
          attribution: { creatorName: "Jane" }
        };
      }
    })
  });

  const acquired = await acquisitionController.acquire({
    jobId: "media-acquire-0001",
    projectId: "project-source-1",
    ticket: "opaque.ticket"
  });
  assert.strictEqual(acquired.asset.id, "stock:pexels:987");
  assert.strictEqual(acquisitionCalls[0].type, "resolve");
  assert.strictEqual(acquisitionCalls[0].ticket, "opaque.ticket");
  assert(acquisitionCalls[0].signal instanceof AbortSignal);
  assert.strictEqual(acquisitionCalls[1].type, "acquire");
  assert.strictEqual(acquisitionCalls[1].payload.projectId, "project-source-1");
  assert.strictEqual(acquisitionCalls[1].payload.descriptor.downloadUrl, "https://videos.pexels.com/video-files/987/hd.mp4");

  resolveMode = "pending";
  const resolving = acquisitionController.acquire({
    jobId: "media-acquire-0002",
    projectId: "project-source-1",
    ticket: "opaque.ticket.2"
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(acquisitionController.activeCount(), 1);
  assert.deepStrictEqual(acquisitionController.cancelAcquisition("media-acquire-0002"), { cancelled: true });
  await assert.rejects(() => resolving, error => error?.code === "MEDIA_CANCELLED");
  assert.strictEqual(acquisitionController.activeCount(), 0);

  await assert.rejects(
    () => acquisitionController.acquire({ jobId: "media-acquire-0003", projectId: "", ticket: "opaque.ticket" }),
    error => error?.code === "MEDIA_DESTINATION_UNAVAILABLE"
  );
  await assert.rejects(
    () => acquisitionController.acquire({ jobId: "media-acquire-0004", projectId: "project-source-1", ticket: "bad\nticket" }),
    error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
  );

  console.log("Media desktop controller search/auth plus acquisition redeem, cancellation and public error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

// Source-contract regressions intentionally ride the same package gate as the
// desktop controller so backend/main/preload/UI wiring cannot drift unnoticed.
require("./media-runtime-integration.test");
require("./media-acquisition-manager.test");
