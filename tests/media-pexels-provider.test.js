"use strict";

const assert = require("assert");
const { createPexelsMediaProvider } = require("../dev-backend/providers/pexels-media");

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; }
  };
}

(async () => {
  const requests = [];
  const provider = createPexelsMediaProvider({
    apiKey: "server-only-key",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return response(200, {
        page: 1,
        per_page: 18,
        total_results: 1,
        next_page: "https://api.pexels.com/videos/search?page=2",
        videos: [{
          id: 987,
          width: 1080,
          height: 1920,
          duration: 13,
          image: "https://images.pexels.com/videos/987/preview.jpg",
          url: "https://www.pexels.com/video/987/",
          user: {
            id: 12,
            name: "Jane Creator",
            url: "https://www.pexels.com/@jane-creator/"
          },
          video_files: [{
            id: 55,
            quality: "hd",
            file_type: "video/mp4",
            width: 1080,
            height: 1920,
            link: "https://videos.pexels.com/video-files/987/55.mp4"
          }]
        }]
      });
    }
  });

  assert.strictEqual(provider.isConfigured(), true);
  const result = await provider.search({
    query: "lion river",
    kind: "video",
    orientation: "portrait",
    page: 1,
    perPage: 18
  });

  assert.strictEqual(requests.length, 1);
  assert(requests[0].url.includes("/videos/search"));
  assert(requests[0].url.includes("query=lion+river"));
  assert(requests[0].url.includes("orientation=portrait"));
  assert.strictEqual(requests[0].options.headers.authorization, "server-only-key");
  assert.strictEqual(result.provider, "pexels");
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].providerAssetId, "987");
  assert.strictEqual(result.results[0].meta.orientation, "portrait");
  assert.strictEqual(result.results[0].variants.length, 1);
  assert.strictEqual(result.results[0].variants[0].url, "https://videos.pexels.com/video-files/987/55.mp4");
  assert.strictEqual(result.results[0].attribution.creatorName, "Jane Creator");
  assert.strictEqual(result.results[0].attribution.licenseName, "Pexels License");

  const unconfigured = createPexelsMediaProvider({ apiKey: "", fetchImpl: async () => response(200, {}) });
  assert.strictEqual(unconfigured.isConfigured(), false);
  await assert.rejects(
    () => unconfigured.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_PROVIDER_UNAVAILABLE"
  );

  const authFailure = createPexelsMediaProvider({
    apiKey: "bad-key",
    fetchImpl: async () => response(401, {})
  });
  await assert.rejects(
    () => authFailure.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_PROVIDER_UNAVAILABLE" && error?.details?.provider === "pexels"
  );

  const quotaFailure = createPexelsMediaProvider({
    apiKey: "key",
    fetchImpl: async () => response(429, {})
  });
  await assert.rejects(
    () => quotaFailure.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_QUOTA_EXCEEDED"
  );

  const abortFailure = createPexelsMediaProvider({
    apiKey: "key",
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
  });
  await assert.rejects(
    () => abortFailure.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_SEARCH_TIMEOUT"
  );

  await assert.rejects(
    () => provider.search({ query: "lion", kind: "image" }),
    error => error?.code === "MEDIA_PROVIDER_UNAVAILABLE"
  );

  console.log("Pexels media adapter normalization, credential isolation and public failure mapping tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
