"use strict";

const assert = require("assert");
const { createMediaRouteHandler, mediaRouteError } = require("../dev-backend/media-routes");

function responseCapture() {
  return { calls: [], writableEnded: false };
}

(async () => {
  assert.deepStrictEqual(mediaRouteError({ code: "MEDIA_SEARCH_INVALID" }), { status: 400, code: "MEDIA_SEARCH_INVALID" });
  assert.deepStrictEqual(mediaRouteError({ code: "MEDIA_QUOTA_EXCEEDED" }), { status: 429, code: "MEDIA_QUOTA_EXCEEDED" });
  assert.deepStrictEqual(mediaRouteError({ code: "MEDIA_PROVIDER_UNAVAILABLE" }), { status: 503, code: "MEDIA_PROVIDER_UNAVAILABLE" });
  assert.deepStrictEqual(mediaRouteError({ code: "MEDIA_SEARCH_TIMEOUT" }), { status: 503, code: "MEDIA_SEARCH_TIMEOUT" });

  const captures = [];
  const service = {
    status: () => ({ ready: true, providers: [{ id: "pexels", configured: true }] }),
    search: async input => {
      captures.push(input);
      return { provider: "pexels", results: [], page: Number(input.page), perPage: Number(input.perPage), totalResults: 0, nextPage: null };
    },
    publicError: error => ({ code: error.code || "MEDIA_SEARCH_UNAVAILABLE", details: {} })
  };
  const jsonCalls = [];
  const errorCalls = [];
  const handler = createMediaRouteHandler({
    mediaSearchService: service,
    authenticate: () => ({ id: "user-1" }),
    json: (_res, status, payload) => jsonCalls.push({ status, payload }),
    error: (_res, status, code, details) => errorCalls.push({ status, code, details })
  });

  const unrelated = await handler({}, responseCapture(), new URL("http://localhost/v1/account/me"), "GET");
  assert.strictEqual(unrelated, false);

  const statusHandled = await handler({}, responseCapture(), new URL("http://localhost/v1/media/status"), "GET");
  assert.strictEqual(statusHandled, true);
  assert.strictEqual(jsonCalls.at(-1).status, 200);
  assert.strictEqual(jsonCalls.at(-1).payload.ready, true);

  const searchHandled = await handler({}, responseCapture(), new URL("http://localhost/v1/media/search?query=lion&kind=video&orientation=portrait&page=2&perPage=12&provider=auto"), "GET");
  assert.strictEqual(searchHandled, true);
  assert.deepStrictEqual(captures[0], {
    query: "lion",
    kind: "video",
    orientation: "portrait",
    page: "2",
    perPage: "12",
    provider: "auto"
  });
  assert.strictEqual(jsonCalls.at(-1).payload.provider, "pexels");

  const unauthErrors = [];
  const unauthenticated = createMediaRouteHandler({
    mediaSearchService: service,
    authenticate: () => null,
    json: () => { throw new Error("must not respond with json"); },
    error: (_res, status, code) => unauthErrors.push({ status, code })
  });
  await unauthenticated({}, responseCapture(), new URL("http://localhost/v1/media/search?query=lion"), "GET");
  assert.deepStrictEqual(unauthErrors[0], { status: 401, code: "AUTH_REQUIRED" });

  const rateErrors = [];
  const rateLimited = createMediaRouteHandler({
    mediaSearchService: service,
    authenticate: () => ({ id: "user-1" }),
    requestRateLimited: () => true,
    json: () => { throw new Error("must not respond with json"); },
    error: (_res, status, code) => rateErrors.push({ status, code })
  });
  await rateLimited({}, responseCapture(), new URL("http://localhost/v1/media/search?query=lion"), "GET");
  assert.deepStrictEqual(rateErrors[0], { status: 429, code: "RATE_LIMITED" });

  const failing = createMediaRouteHandler({
    mediaSearchService: {
      status: () => ({ ready: false, providers: [] }),
      search: async () => {
        const err = new Error("raw provider secret");
        err.code = "MEDIA_PROVIDER_UNAVAILABLE";
        err.details = { provider: "internal-provider", secret: "never-leak" };
        throw err;
      },
      publicError: () => ({ code: "MEDIA_PROVIDER_UNAVAILABLE", details: {} })
    },
    authenticate: () => ({ id: "user-1" }),
    json: () => { throw new Error("must not succeed"); },
    error: (_res, status, code, details) => errorCalls.push({ status, code, details })
  });
  await failing({}, responseCapture(), new URL("http://localhost/v1/media/search?query=lion"), "GET");
  assert.deepStrictEqual(errorCalls.at(-1), { status: 503, code: "MEDIA_PROVIDER_UNAVAILABLE", details: {} });

  const timeoutErrors = [];
  const timeoutHandler = createMediaRouteHandler({
    mediaSearchService: {
      status: () => ({ ready: true, providers: [{ id: "pixabay", configured: true }] }),
      search: async (_input, { signal } = {}) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
          const aborted = new Error("aborted");
          aborted.name = "AbortError";
          reject(aborted);
          return;
        }
        signal?.addEventListener("abort", () => {
          const aborted = new Error("aborted");
          aborted.name = "AbortError";
          reject(aborted);
        }, { once: true });
      })
    },
    authenticate: () => ({ id: "user-1" }),
    json: () => { throw new Error("timed-out search must not succeed"); },
    error: (_res, status, code, details) => timeoutErrors.push({ status, code, details }),
    searchTimeoutMs: 10
  });
  const timeoutHandled = await timeoutHandler({}, responseCapture(), new URL("http://localhost/v1/media/search?query=slow"), "GET");
  assert.strictEqual(timeoutHandled, true);
  assert.deepStrictEqual(timeoutErrors[0], { status: 503, code: "MEDIA_SEARCH_TIMEOUT", details: {} });

  console.log("Media HTTP route auth, validation, rate-limit, timeout and public-error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
