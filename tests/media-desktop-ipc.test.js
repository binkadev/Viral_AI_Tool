"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  normalizeDesktopSearchPayload,
  publicMediaClientError,
  createMediaDesktopService,
  registerMediaIpc
} = require("../services/media/desktop-ipc");

assert.deepStrictEqual(
  normalizeDesktopSearchPayload({ query: "wild lion", kind: "video", orientation: "portrait", page: 2, perPage: 12, provider: "auto" }),
  { query: "wild lion", kind: "video", orientation: "portrait", page: 2, perPage: 12, provider: "auto" }
);
assert.throws(
  () => normalizeDesktopSearchPayload({ query: "wild lion", provider: "unknown-provider" }),
  error => error?.code === "MEDIA_SEARCH_INVALID" && error?.details?.field === "provider"
);
assert.deepStrictEqual(
  publicMediaClientError(Object.assign(new Error("raw secret"), { code: "INTERNAL_PROVIDER_FAILURE", details: { secret: "never-leak" } })),
  { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} }
);
assert.deepStrictEqual(
  publicMediaClientError(Object.assign(new Error("invalid"), { code: "MEDIA_SEARCH_INVALID", details: { field: "kind", secret: "never-leak" } })),
  { code: "MEDIA_SEARCH_INVALID", details: { field: "kind" } }
);

(async () => {
  let refreshed = 0;
  const requests = [];
  const service = createMediaDesktopService({
    getCloudConfig: () => ({ backendUrl: "https://api.example.com" }),
    getAccessToken: () => "access-token",
    refreshSession: async () => { refreshed += 1; },
    appVersion: "0.14.0",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider: "pexels", results: [], ready: true })
      };
    }
  });

  const status = await service.status();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.ready, true);

  const search = await service.search({ query: "wild lion", kind: "video", orientation: "portrait", provider: "auto" });
  assert.strictEqual(search.ok, true);
  assert.strictEqual(search.provider, "pexels");
  assert.strictEqual(refreshed, 2, "media service should attempt session refresh before each cloud request");
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(new URL(requests[1].url).pathname, "/v1/media/search");
  assert.strictEqual(requests[1].options.headers.authorization, "Bearer access-token");

  const bad = await service.search({ query: "x" });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, "MEDIA_SEARCH_INVALID");
  assert.strictEqual(requests.length, 2, "invalid renderer payload must not reach the network");

  const handlers = new Map();
  registerMediaIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    getCloudConfig: () => ({ backendUrl: "https://api.example.com" }),
    getAccessToken: () => "access-token",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" })
  });
  assert(handlers.has("media:status"));
  assert(handlers.has("media:search"));
  assert.strictEqual(handlers.size, 2, "media IPC surface should stay narrow");

  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert(preload.includes("getMediaStatus: () => ipcRenderer.invoke('media:status')"));
  assert(preload.includes("searchMedia: payload => ipcRenderer.invoke('media:search', payload)"));
  assert(!preload.includes("PEXELS_API_KEY") && !preload.includes("PIXABAY_API_KEY"));
  assert(!preload.includes("access-token"), "preload must not contain session credentials");

  console.log("Media desktop IPC validation, auth boundary, public errors and narrow preload bridge tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
