"use strict";

const assert = require("assert");
const contract = require("../services/media/provider-contract");

const normalizedRequest = contract.normalizeSearchRequest({
  query: " lion river ",
  kind: "video",
  orientation: "portrait",
  page: 2,
  perPage: 999
});
assert.deepStrictEqual(normalizedRequest, {
  query: "lion river",
  kind: "video",
  orientation: "portrait",
  page: 2,
  perPage: contract.MAX_PER_PAGE
});

assert.throws(
  () => contract.normalizeSearchRequest({ query: "x" }),
  error => error?.code === "MEDIA_SEARCH_INVALID"
);
assert.throws(
  () => contract.normalizeSearchRequest({ query: "tiger", kind: "audio" }),
  error => error?.code === "MEDIA_SEARCH_INVALID" && error?.details?.field === "kind"
);

const result = contract.normalizeSearchResult({
  provider: "PEXELS",
  providerAssetId: 123,
  kind: "video",
  name: "Lion",
  previewUrl: "https://example.test/preview.jpg",
  thumbnailUrl: "javascript:alert(1)",
  meta: { width: 1080, height: 1920, duration: 12.5 },
  attribution: {
    creatorName: "Jane",
    creatorUrl: "https://example.test/jane",
    sourceUrl: "https://example.test/video/123",
    licenseName: "Provider License",
    licenseUrl: "https://example.test/license",
    attributionText: "Video by Jane"
  },
  variants: [
    { id: "hd", url: "https://cdn.example.test/hd.mp4", width: 1080, height: 1920, quality: "hd", mime: "video/mp4" },
    { id: "unsafe", url: "file:///C:/secret.mp4", width: 720, height: 1280 }
  ]
});

assert.strictEqual(result.provider, "pexels");
assert.strictEqual(result.providerAssetId, "123");
assert.strictEqual(result.meta.orientation, "portrait");
assert.strictEqual(result.thumbnailUrl, null);
assert.strictEqual(result.variants.length, 1);
assert.strictEqual(result.variants[0].quality, "hd");

assert.deepStrictEqual(
  contract.publicSearchError(Object.assign(new Error("secret raw provider body"), {
    code: "MEDIA_PROVIDER_UNAVAILABLE",
    details: { provider: "PEXELS", secret: "do-not-leak" }
  })),
  // The existing public boundary intentionally retains only a validation field;
  // provider details and raw responses stay behind the backend boundary.
  { code: "MEDIA_PROVIDER_UNAVAILABLE", details: {} }
);

assert.deepStrictEqual(contract.publicSearchError(Object.assign(new Error("private"), {
  code: "MEDIA_SEARCH_INVALID", details: { field: "kind", provider: "PEXELS", secret: "private" }
})), { code: "MEDIA_SEARCH_INVALID", details: { field: "kind" } });

assert.deepStrictEqual(
  contract.publicSearchError(Object.assign(new Error("sensitive"), {
    code: "ECONNRESET",
    details: { url: "https://secret.example.test" }
  })),
  { code: "MEDIA_SEARCH_UNAVAILABLE", details: {} }
);

console.log("Media provider-neutral search contract, URL safety and public error isolation tests passed.");
