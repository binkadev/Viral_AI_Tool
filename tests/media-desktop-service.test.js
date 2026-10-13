"use strict";

const assert = require("assert");
const {
  createService,
  normalizeRequestId,
  normalizeProvider,
  serializeMediaError
} = require("../services/media");

assert.strictEqual(normalizeRequestId("search_123"), "search_123");
assert.throws(() => normalizeRequestId("short"), error => error?.code === "MEDIA_REQUEST_INVALID");
assert.strictEqual(normalizeProvider("AUTO"), "auto");
assert.strictEqual(normalizeProvider("pexels"), "pexels");
assert.throws(() => normalizeProvider("bad/provider"), error => error?.code === "MEDIA_SEARCH_INVALID");

let requestCount = 0;
let lastUrl = null;
let deferredResolve;
let deferredReject;
let holdRequest = false;

const fetchImpl = async (url, options = {}) => {
  requestCount += 1;
  lastUrl = new URL(url.toString());

  if (holdRequest) {
    return await new Promise((resolve, reject) => {
      deferredResolve = resolve;
      deferredReject = reject;
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }

  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      provider: "pexels",
      page: 1,
      perPage: 18,
      totalResults: 1,
      nextPage: null,
      results: [{ provider: "pexels", providerAssetId: "1", kind: "video", name: "Lion" }]
    })
  };
};

(async () => {
  const service = createService({
    getBackendUrl: () => "https://api.example.test",
    getAccessToken: () => "access-token",
    appVersion: "0.14.0",
    fetchImpl
  });

  const result = await service.search({
    requestId: "search_123",
    query: "lion",
    kind: "video",
    orientation: "portrait",
    page: 1,
    perPage: 18,
    provider: "auto"
  });

  assert.strictEqual(requestCount, 1);
  assert.strictEqual(lastUrl.pathname, "/v1/media/search");
  assert.strictEqual(lastUrl.searchParams.get("query"), "lion");
  assert.strictEqual(lastUrl.searchParams.get("orientation"), "portrait");
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(service.activeCount(), 0);

  holdRequest = true;
  const pending = service.search({
    requestId: "search_cancel_1",
    query: "crocodile",
    kind: "video",
    orientation: "any",
    provider: "auto"
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(service.activeCount(), 1);
  assert.strictEqual(service.cancel("search_cancel_1"), true);
  await assert.rejects(pending, error => error?.code === "MEDIA_CANCELLED");
  assert.strictEqual(service.activeCount(), 0);
  assert.strictEqual(service.cancel("search_cancel_1"), false);

  holdRequest = true;
  const duplicatePending = service.search({
    requestId: "search_duplicate",
    query: "tiger",
    kind: "video"
  });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    () => service.search({ requestId: "search_duplicate", query: "tiger", kind: "video" }),
    error => error?.code === "MEDIA_SEARCH_ACTIVE"
  );
  service.dispose();
  await assert.rejects(duplicatePending, error => error?.code === "MEDIA_CANCELLED");
  assert.strictEqual(service.activeCount(), 0);

  assert.deepStrictEqual(
    serializeMediaError(Object.assign(new Error("secret endpoint"), { code: "MEDIA_NETWORK", details: { host: "private" } })),
    { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} },
    "desktop media errors must not leak technical backend details"
  );

  console.log("Desktop media service request validation, duplicate protection, cancellation and public error isolation tests passed.");
})().catch(error => {
  try { deferredResolve?.({ ok: true, status: 200, text: async () => "{}" }); } catch {}
  try { deferredReject?.(error); } catch {}
  console.error(error);
  process.exitCode = 1;
});
