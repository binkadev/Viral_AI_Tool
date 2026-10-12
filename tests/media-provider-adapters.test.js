"use strict";

const assert = require("assert");
const { createPexelsMediaProvider } = require("../dev-backend/providers/pexels-media");
const { createPixabayMediaProvider } = require("../dev-backend/providers/pixabay-media");
const { createMediaSearchService } = require("../dev-backend/media-search");
const { publicSearchError } = require("../services/media/provider-contract");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

(async () => {
  let pexelsUrl;
  const pexels = createPexelsMediaProvider({
    apiKey: "pexels-key",
    fetchImpl: async url => {
      pexelsUrl = new URL(url.toString());
      return response({
        page: 1,
        per_page: 18,
        total_results: 1,
        videos: [{
          id: 99,
          width: 1080,
          height: 1920,
          duration: 12,
          image: "https://images.example.test/pexels.jpg",
          url: "https://www.pexels.com/video/99/",
          user: { name: "Creator", url: "https://www.pexels.com/@creator/" },
          video_files: [{ id: 1, link: "https://cdn.example.test/pexels.mp4", width: 1080, height: 1920, quality: "hd", file_type: "video/mp4" }]
        }]
      });
    }
  });
  const pexelsResult = await pexels.search({ query: "lion", kind: "video", orientation: "portrait" });
  assert.strictEqual(pexelsUrl.pathname, "/videos/search");
  assert.strictEqual(pexelsUrl.searchParams.get("orientation"), "portrait");
  assert.strictEqual(pexelsResult.results[0].provider, "pexels");
  assert.strictEqual(pexelsResult.results[0].meta.orientation, "portrait");
  assert.strictEqual(pexelsResult.results[0].attribution.creatorName, "Creator");

  const calls = [];
  const pixabay = createPixabayMediaProvider({
    apiKey: "pixabay-key",
    fetchImpl: async url => {
      const parsed = new URL(url.toString());
      calls.push(parsed);
      if (parsed.pathname.includes("/api/videos/")) {
        return response({
          totalHits: 1,
          hits: [{
            id: 7,
            tags: "lion, savannah, wildlife",
            duration: 8,
            pageURL: "https://pixabay.com/videos/id-7/",
            user: "Author",
            user_id: 123,
            videos: {
              medium: { url: "https://cdn.example.test/pixabay.mp4", width: 1080, height: 1920, size: 1000, thumbnail: "https://cdn.example.test/pixabay.jpg" }
            }
          }]
        });
      }
      return response({
        totalHits: 1,
        hits: [{
          id: 8,
          tags: "forest, mist",
          pageURL: "https://pixabay.com/photos/id-8/",
          user: "Photographer",
          user_id: 456,
          previewURL: "https://cdn.example.test/preview.jpg",
          previewWidth: 150,
          previewHeight: 100,
          webformatURL: "https://cdn.example.test/web.jpg",
          webformatWidth: 960,
          webformatHeight: 640,
          largeImageURL: "https://cdn.example.test/large.jpg",
          imageWidth: 3000,
          imageHeight: 2000
        }]
      });
    }
  });

  const video = await pixabay.search({ query: "lion", kind: "video", orientation: "portrait" });
  assert.strictEqual(calls[0].pathname, "/api/videos/");
  assert.strictEqual(calls[0].searchParams.get("safesearch"), "true");
  assert.strictEqual(video.results[0].provider, "pixabay");
  assert.strictEqual(video.results[0].meta.orientation, "portrait");
  assert.strictEqual(video.results[0].attribution.licenseName, "Pixabay Content License");

  const image = await pixabay.search({ query: "forest", kind: "image", orientation: "portrait", perPage: 3 });
  assert.strictEqual(calls[1].pathname, "/api/");
  assert.strictEqual(calls[1].searchParams.get("orientation"), "vertical");
  assert.strictEqual(image.results[0].kind, "image");
  assert.strictEqual(image.results[0].variants.length, 3);

  let fallbackCalls = 0;
  const unavailable = {
    id: "one",
    isConfigured: () => true,
    search: async () => {
      fallbackCalls += 1;
      const error = new Error("provider down");
      error.code = "MEDIA_SEARCH_UNAVAILABLE";
      throw error;
    }
  };
  const healthy = {
    id: "two",
    isConfigured: () => true,
    search: async request => {
      fallbackCalls += 1;
      return { provider: "two", page: request.page, perPage: request.perPage, totalResults: 0, nextPage: null, results: [] };
    }
  };
  const service = createMediaSearchService({ providers: [unavailable, healthy] });
  const auto = await service.search({ query: "wildlife", kind: "video", provider: "auto" });
  assert.strictEqual(auto.provider, "two");
  assert.strictEqual(fallbackCalls, 2);
  await assert.rejects(
    () => service.search({ query: "wildlife", kind: "video", provider: "one" }),
    error => error.code === "MEDIA_SEARCH_UNAVAILABLE"
  );

  const publicError = publicSearchError({
    code: "MEDIA_PROVIDER_UNAVAILABLE",
    details: { provider: "pexels", secret: "never-leak" }
  });
  assert.deepStrictEqual(publicError, { code: "MEDIA_PROVIDER_UNAVAILABLE", details: {} });

  console.log("Pexels, Pixabay normalization, orientation, fallback and public error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
