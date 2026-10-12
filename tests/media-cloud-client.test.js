"use strict";

const assert = require("assert");
const {
  CloudMediaClient,
  MediaClientError,
  normalizeBaseUrl,
  stableApiError
} = require("../services/media/cloud-client");

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return JSON.stringify(payload || {}); }
  };
}

(async () => {
  assert.strictEqual(normalizeBaseUrl("https://api.example.test/").toString(), "https://api.example.test/");
  assert.strictEqual(normalizeBaseUrl("http://127.0.0.1:3000").hostname, "127.0.0.1");
  assert.throws(() => normalizeBaseUrl("http://api.example.test"), error => error?.code === "MEDIA_HTTPS_REQUIRED");

  const requests = [];
  const client = new CloudMediaClient({
    backendUrl: "https://api.example.test/base",
    getAccessToken: () => "access-token",
    appVersion: "0.14.0",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return response(200, {
        provider: "pexels",
        page: 1,
        perPage: 18,
        totalResults: 0,
        results: []
      });
    }
  });

  const result = await client.search({
    query: "lion river",
    kind: "video",
    orientation: "portrait",
    page: 1,
    perPage: 18
  });
  assert.strictEqual(result.provider, "pexels");
  assert.strictEqual(requests.length, 1);
  assert(requests[0].url.includes("/base/v1/media/search"));
  assert(requests[0].url.includes("query=lion+river"));
  assert(requests[0].url.includes("orientation=portrait"));
  assert.strictEqual(requests[0].options.headers.authorization, "Bearer access-token");
  assert.strictEqual(requests[0].options.headers["x-viral-ai-version"], "0.14.0");

  const missingToken = new CloudMediaClient({
    backendUrl: "https://api.example.test",
    getAccessToken: () => null,
    fetchImpl: async () => response(200, {})
  });
  await assert.rejects(
    () => missingToken.status(),
    error => error instanceof MediaClientError && error.code === "MEDIA_AUTH_REQUIRED"
  );

  const authClient = new CloudMediaClient({
    backendUrl: "https://api.example.test",
    getAccessToken: () => "token",
    fetchImpl: async () => response(401, { error: { code: "AUTH_EXPIRED" } })
  });
  await assert.rejects(
    () => authClient.status(),
    error => error?.code === "MEDIA_AUTH_REQUIRED" && error?.details?.backendCode === "AUTH_EXPIRED"
  );

  const unavailableClient = new CloudMediaClient({
    backendUrl: "https://api.example.test",
    getAccessToken: () => "token",
    fetchImpl: async () => { throw new Error("ECONNRESET secret-host"); }
  });
  await assert.rejects(
    () => unavailableClient.search({ query: "lion" }),
    error => error?.code === "MEDIA_NETWORK"
  );

  assert.strictEqual(stableApiError(503, {}).code, "MEDIA_SEARCH_UNAVAILABLE");
  assert.strictEqual(stableApiError(429, { error: { code: "MEDIA_QUOTA_EXCEEDED" } }).code, "MEDIA_QUOTA_EXCEEDED");
  assert.strictEqual(stableApiError(400, { error: { code: "MEDIA_SEARCH_INVALID" } }).code, "MEDIA_SEARCH_INVALID");

  console.log("Media cloud client auth, URL safety, query serialization and stable error mapping tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
