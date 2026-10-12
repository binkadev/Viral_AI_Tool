"use strict";

const assert = require("assert");
const { createPexelsMediaProvider } = require("../providers/pexels-media");

async function main() {
  let seenUrl = null;
  let seenHeaders = null;
  const provider = createPexelsMediaProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      seenUrl = new URL(url.toString());
      seenHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            page: 1,
            per_page: 18,
            total_results: 1,
            next_page: null,
            videos: [{
              id: 42,
              width: 1080,
              height: 1920,
              duration: 8,
              url: "https://www.pexels.com/video/42/",
              image: "https://images.pexels.test/42.jpg",
              user: {
                id: 9,
                name: "Jane Doe",
                url: "https://www.pexels.com/@jane-doe/"
              },
              video_files: [
                {
                  id: 99,
                  quality: "hd",
                  file_type: "video/mp4",
                  width: 1080,
                  height: 1920,
                  link: "https://videos.pexels.test/42-hd.mp4"
                }
              ]
            }]
          };
        }
      };
    }
  });

  assert.strictEqual(provider.isConfigured(), true);
  const response = await provider.search({
    query: "lion river",
    kind: "video",
    orientation: "portrait"
  });

  assert.strictEqual(seenUrl.pathname, "/videos/search");
  assert.strictEqual(seenUrl.searchParams.get("query"), "lion river");
  assert.strictEqual(seenUrl.searchParams.get("orientation"), "portrait");
  assert.strictEqual(seenHeaders.authorization, "test-key");
  assert.strictEqual(response.results.length, 1);
  assert.strictEqual(response.results[0].provider, "pexels");
  assert.strictEqual(response.results[0].providerAssetId, "42");
  assert.strictEqual(response.results[0].meta.orientation, "portrait");
  assert.strictEqual(response.results[0].variants[0].url, "https://videos.pexels.test/42-hd.mp4");
  assert.strictEqual(response.results[0].attribution.creatorName, "Jane Doe");
  assert.strictEqual(response.results[0].attribution.licenseName, "Pexels License");

  const missing = createPexelsMediaProvider({ apiKey: "", fetchImpl: async () => { throw new Error("must not run"); } });
  await assert.rejects(
    () => missing.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_PROVIDER_UNAVAILABLE" && error?.details?.provider === "pexels"
  );

  const limited = createPexelsMediaProvider({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  });
  await assert.rejects(
    () => limited.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_QUOTA_EXCEEDED"
  );

  const timedOut = createPexelsMediaProvider({
    apiKey: "test-key",
    fetchImpl: async () => { throw Object.assign(new Error("abort"), { name: "AbortError" }); }
  });
  await assert.rejects(
    () => timedOut.search({ query: "lion", kind: "video" }),
    error => error?.code === "MEDIA_SEARCH_TIMEOUT"
  );

  console.log("Pexels media provider normalization, credential isolation and provider error mapping tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
