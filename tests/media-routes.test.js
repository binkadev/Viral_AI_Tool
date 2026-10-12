"use strict";

const assert = require("assert");
const {
  statusForMediaError,
  searchInput,
  createMediaHttpHandler
} = require("../dev-backend/media-routes");

function makeResponse() {
  return { status: null, payload: null };
}

function json(res, status, payload) {
  res.status = status;
  res.payload = payload;
}

function error(res, status, code) {
  res.status = status;
  res.payload = { error: { code } };
}

function request(url, { authenticated = true } = {}) {
  return {
    req: {
      authenticated,
      once() {},
      removeListener() {}
    },
    res: makeResponse(),
    url: new URL(url, "https://api.example.test"),
    method: "GET"
  };
}

(async () => {
  assert.strictEqual(statusForMediaError("MEDIA_SEARCH_INVALID"), 400);
  assert.strictEqual(statusForMediaError("MEDIA_AUTH_REQUIRED"), 401);
  assert.strictEqual(statusForMediaError("MEDIA_QUOTA_EXCEEDED"), 429);
  assert.strictEqual(statusForMediaError("MEDIA_SEARCH_TIMEOUT"), 504);
  assert.strictEqual(statusForMediaError("MEDIA_PROVIDER_UNAVAILABLE"), 503);

  assert.deepStrictEqual(
    searchInput(new URL("https://api.example.test/v1/media/search?query=lion%20river&kind=video&orientation=portrait&page=2&perPage=12&provider=pexels")),
    {
      query: "lion river",
      kind: "video",
      orientation: "portrait",
      provider: "pexels",
      page: "2",
      perPage: "12"
    }
  );

  const audits = [];
  const calls = [];
  const service = {
    status() {
      return {
        ready: true,
        providers: [{ id: "pexels", configured: true, secret: "do-not-leak" }]
      };
    },
    async search(input, { signal } = {}) {
      calls.push({ input, signal });
      return {
        provider: "pexels",
        page: 1,
        perPage: 18,
        totalResults: 1,
        nextPage: null,
        results: [{ provider: "pexels", providerAssetId: "1", kind: "video", name: "Lion" }]
      };
    },
    publicError(raw) {
      return raw?.publicError || { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} };
    }
  };

  const handler = createMediaHttpHandler({
    service,
    authenticate: req => req.authenticated ? { id: "user-1" } : null,
    json,
    error,
    audit: (event, _req, details) => audits.push({ event, details })
  });

  const unrelated = request("/v1/account/me");
  assert.strictEqual(await handler(unrelated), false);
  assert.strictEqual(unrelated.res.status, null);

  const unauthenticated = request("/v1/media/status", { authenticated: false });
  assert.strictEqual(await handler(unauthenticated), true);
  assert.deepStrictEqual(unauthenticated.res, {
    status: 401,
    payload: { error: { code: "AUTH_REQUIRED" } }
  });

  const statusReq = request("/v1/media/status");
  assert.strictEqual(await handler(statusReq), true);
  assert.strictEqual(statusReq.res.status, 200);
  assert.deepStrictEqual(statusReq.res.payload, {
    ready: true,
    code: "READY",
    providers: [{ id: "pexels", configured: true }]
  });
  assert.strictEqual(JSON.stringify(statusReq.res.payload).includes("do-not-leak"), false);

  const searchReq = request("/v1/media/search?query=lion%20river&orientation=portrait");
  assert.strictEqual(await handler(searchReq), true);
  assert.strictEqual(searchReq.res.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].input.query, "lion river");
  assert.strictEqual(calls[0].input.orientation, "portrait");
  assert(calls[0].signal instanceof AbortSignal);
  assert.strictEqual(audits.at(-1).event, "media.search.succeeded");
  assert.strictEqual(audits.at(-1).details.userId, "user-1");
  assert.strictEqual(audits.at(-1).details.resultCount, 1);

  const failingHandler = createMediaHttpHandler({
    service: {
      status: service.status,
      async search() {
        const err = new Error("raw provider secret");
        err.publicError = { code: "MEDIA_PROVIDER_UNAVAILABLE", details: { provider: "pexels" } };
        throw err;
      },
      publicError: service.publicError
    },
    authenticate: () => ({ id: "user-2" }),
    json,
    error,
    audit: (event, _req, details) => audits.push({ event, details })
  });

  const failingReq = request("/v1/media/search?query=lion");
  assert.strictEqual(await failingHandler(failingReq), true);
  assert.deepStrictEqual(failingReq.res, {
    status: 503,
    payload: { error: { code: "MEDIA_PROVIDER_UNAVAILABLE" } }
  });
  assert.strictEqual(JSON.stringify(failingReq.res.payload).includes("raw provider secret"), false);
  assert.strictEqual(audits.at(-1).event, "media.search.failed");

  const unknownReq = request("/v1/media/unknown");
  assert.strictEqual(await handler(unknownReq), true);
  assert.deepStrictEqual(unknownReq.res, {
    status: 404,
    payload: { error: { code: "NOT_FOUND" } }
  });

  console.log("Authenticated media HTTP routes, provider status isolation and public search error mapping tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
