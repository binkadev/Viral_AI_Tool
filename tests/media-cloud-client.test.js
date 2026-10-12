"use strict";

const assert = require("assert");
const { CloudMediaClient, MediaClientError, normalizeBaseUrl, stableApiError } = require("../services/media/cloud-client");

assert.throws(() => normalizeBaseUrl(""), error => error?.code === "MEDIA_NOT_CONFIGURED");
assert.throws(() => normalizeBaseUrl("ftp://example.com"), error => error?.code === "MEDIA_HTTPS_REQUIRED");
assert.strictEqual(normalizeBaseUrl("http://127.0.0.1:3000").origin, "http://127.0.0.1:3000");
assert.strictEqual(normalizeBaseUrl("https://api.example.com/base/").pathname, "/base");
assert.strictEqual(stableApiError(401, {}).code, "MEDIA_AUTH_REQUIRED");
assert.strictEqual(stableApiError(429, {}).code, "MEDIA_QUOTA_EXCEEDED");
assert.strictEqual(stableApiError(503, {}).code, "MEDIA_SEARCH_UNAVAILABLE");
assert.strictEqual(stableApiError(400, { error: { code: "MEDIA_SEARCH_INVALID" } }).code, "MEDIA_SEARCH_INVALID");

(async () => {
  const calls = [];
  const client = new CloudMediaClient({
    backendUrl: "https://api.example.com/base",
    getAccessToken: () => "secret-token",
    appVersion: "0.14.0",
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider: "pexels", results: [{ providerAssetId: "42" }] })
      };
    }
  });

  const result = await client.search({
    query: "wild lion",
    kind: "video",
    orientation: "portrait",
    page: 2,
    perPage: 12,
    provider: "auto"
  });
  assert.strictEqual(result.provider, "pexels");
  assert.strictEqual(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.strictEqual(requestUrl.pathname, "/base/v1/media/search");
  assert.strictEqual(requestUrl.searchParams.get("query"), "wild lion");
  assert.strictEqual(requestUrl.searchParams.get("orientation"), "portrait");
  assert.strictEqual(requestUrl.searchParams.get("page"), "2");
  assert.strictEqual(calls[0].options.headers.authorization, "Bearer secret-token");
  assert.strictEqual(calls[0].options.headers["x-viral-ai-version"], "0.14.0");

  const noAuth = new CloudMediaClient({
    backendUrl: "https://api.example.com",
    getAccessToken: () => "",
    fetchImpl: async () => { throw new Error("must not fetch without auth"); }
  });
  await assert.rejects(() => noAuth.status(), error => error instanceof MediaClientError && error.code === "MEDIA_AUTH_REQUIRED");

  const backendError = new CloudMediaClient({
    backendUrl: "https://api.example.com",
    getAccessToken: () => "token",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: "MEDIA_SEARCH_INVALID" } })
    })
  });
  await assert.rejects(() => backendError.search({ query: "x" }), error => error.code === "MEDIA_SEARCH_INVALID");

  console.log("Cloud media client auth, URL, query and public error mapping tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
