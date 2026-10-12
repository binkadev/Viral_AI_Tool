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
    publicDesktopMediaError(Object.assign(new Error("secret"), { code: "ECONNRESET" })),
    { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} }
  );

  console.log("Media desktop controller auth, duplicate request, cancellation and public error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
