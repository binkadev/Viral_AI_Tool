"use strict";

const assert = require("assert");
const { createMediaSearchService } = require("../dev-backend/media-search");

(async () => {
  const calls = [];
  const provider = {
    id: "pexels",
    isConfigured: () => true,
    async search(request, { signal } = {}) {
      calls.push({ request, signal });
      return {
        provider: "pexels",
        page: request.page,
        perPage: request.perPage,
        totalResults: 1,
        nextPage: null,
        results: [{
          provider: "pexels",
          providerAssetId: "1",
          kind: "video",
          name: "Lion"
        }]
      };
    }
  };

  const service = createMediaSearchService({ providers: [provider] });
  assert.deepStrictEqual(service.status(), {
    ready: true,
    providers: [{ id: "pexels", configured: true }]
  });

  const controller = new AbortController();
  const result = await service.search({
    query: "lion",
    kind: "video",
    orientation: "portrait",
    page: 2,
    perPage: 10,
    provider: "auto"
  }, { signal: controller.signal });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].signal, controller.signal);
  assert.deepStrictEqual(calls[0].request, {
    query: "lion",
    kind: "video",
    orientation: "portrait",
    page: 2,
    perPage: 10
  });
  assert.strictEqual(result.provider, "pexels");
  assert.strictEqual(result.results.length, 1);

  const unavailable = createMediaSearchService({
    providers: [{ id: "pexels", isConfigured: () => false }]
  });
  assert.deepStrictEqual(unavailable.status(), {
    ready: false,
    providers: [{ id: "pexels", configured: false }]
  });
  await assert.rejects(
    () => unavailable.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_PROVIDER_UNAVAILABLE"
  );

  await assert.rejects(
    () => service.search({ query: "x" }),
    error => error?.code === "MEDIA_SEARCH_INVALID"
  );

  assert.deepStrictEqual(
    service.publicError(Object.assign(new Error("raw provider payload"), {
      code: "SOMETHING_PRIVATE",
      details: { url: "https://secret.example.test", token: "secret" }
    })),
    { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} }
  );

  console.log("Media search service provider selection, validation and public error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
