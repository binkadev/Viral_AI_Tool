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

function pixabayVideoHit(id, width, height) {
  return {
    id,
    tags: "lion, savannah, wildlife",
    duration: 8,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    user: "Author",
    user_id: 123,
    videos: {
      medium: {
        url: `https://cdn.example.test/pixabay-${id}.mp4`,
        width,
        height,
        size: 1000,
        thumbnail: `https://cdn.example.test/pixabay-${id}.jpg`
      }
    }
  };
}

(async () => {
  const pexelsCalls = [];
  const pexels = createPexelsMediaProvider({
    apiKey: "pexels-key",
    fetchImpl: async url => {
      const parsed = new URL(url.toString());
      pexelsCalls.push(parsed);
      if (parsed.pathname === "/v1/search") {
        return response({
          page: 1,
          per_page: 18,
          total_results: 1,
          photos: [{
            id: 199,
            width: 1080,
            height: 1920,
            alt: "Portrait lion",
            url: "https://www.pexels.com/photo/199/",
            photographer: "Photo Creator",
            photographer_url: "https://www.pexels.com/@photo-creator/",
            src: {
              original: "https://images.example.test/pexels-199-original.jpg",
              medium: "https://images.example.test/pexels-199-medium.jpg",
              small: "https://images.example.test/pexels-199-small.jpg"
            }
          }]
        });
      }
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
  assert.strictEqual(pexelsCalls[0].pathname, "/videos/search");
  assert.strictEqual(pexelsCalls[0].searchParams.get("orientation"), "portrait");
  assert.strictEqual(pexelsResult.results[0].provider, "pexels");
  assert.strictEqual(pexelsResult.results[0].meta.orientation, "portrait");
  assert.strictEqual(pexelsResult.results[0].attribution.creatorName, "Creator");

  const pexelsImage = await pexels.search({ query: "lion", kind: "image", orientation: "portrait" });
  assert.strictEqual(pexelsCalls[1].pathname, "/v1/search", "Pexels must support image discovery when it is the only configured stock provider");
  assert.strictEqual(pexelsCalls[1].searchParams.get("orientation"), "portrait");
  assert.strictEqual(pexelsImage.results.length, 1);
  assert.strictEqual(pexelsImage.results[0].kind, "image");
  assert.strictEqual(pexelsImage.results[0].providerAssetId, "199");
  assert.strictEqual(pexelsImage.results[0].meta.orientation, "portrait");
  assert.strictEqual(pexelsImage.results[0].attribution.creatorName, "Photo Creator");

  const calls = [];
  const pixabay = createPixabayMediaProvider({
    apiKey: "pixabay-key",
    fetchImpl: async url => {
      const parsed = new URL(url.toString());
      calls.push(parsed);
      if (parsed.pathname.includes("/api/videos/")) {
        const query = parsed.searchParams.get("q");
        const page = Number(parsed.searchParams.get("page") || 1);
        if (query === "fill portrait") {
          if (page === 1) {
            return response({
              totalHits: 6,
              hits: [
                pixabayVideoHit(701, 1920, 1080),
                pixabayVideoHit(702, 1920, 1080),
                pixabayVideoHit(703, 1920, 1080)
              ]
            });
          }
          return response({
            totalHits: 6,
            hits: [
              pixabayVideoHit(704, 1080, 1920),
              pixabayVideoHit(705, 1080, 1920),
              pixabayVideoHit(706, 1920, 1080)
            ]
          });
        }
        return response({
          totalHits: 1,
          hits: [pixabayVideoHit(7, 1080, 1920)]
        });
      }
      if (parsed.searchParams.get("q") === "square") {
        return response({
          totalHits: 2,
          hits: [
            {
              id: 9,
              tags: "square, texture",
              pageURL: "https://pixabay.com/photos/id-9/",
              user: "SquareAuthor",
              user_id: 457,
              previewURL: "https://cdn.example.test/square-preview.jpg",
              previewWidth: 150,
              previewHeight: 150,
              webformatURL: "https://cdn.example.test/square-web.jpg",
              webformatWidth: 960,
              webformatHeight: 940,
              largeImageURL: "https://cdn.example.test/square-large.jpg",
              imageWidth: 3000,
              imageHeight: 2950
            },
            {
              id: 10,
              tags: "wide, landscape",
              pageURL: "https://pixabay.com/photos/id-10/",
              user: "WideAuthor",
              user_id: 458,
              previewURL: "https://cdn.example.test/wide-preview.jpg",
              previewWidth: 150,
              previewHeight: 90,
              webformatURL: "https://cdn.example.test/wide-web.jpg",
              webformatWidth: 960,
              webformatHeight: 540,
              largeImageURL: "https://cdn.example.test/wide-large.jpg",
              imageWidth: 3000,
              imageHeight: 1688
            }
          ]
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

  const beforeFill = calls.length;
  const filled = await pixabay.search({ query: "fill portrait", kind: "video", orientation: "portrait", perPage: 3 });
  const fillCalls = calls.slice(beforeFill);
  assert.strictEqual(fillCalls.length, 2, "orientation-filtered video discovery must continue past an empty filtered first page");
  assert.strictEqual(fillCalls[0].searchParams.get("page"), "1");
  assert.strictEqual(fillCalls[1].searchParams.get("page"), "2");
  assert.strictEqual(filled.results.length, 2);
  assert.deepStrictEqual(filled.results.map(item => item.providerAssetId), ["704", "705"]);
  assert.strictEqual(filled.nextPage, null, "provider exhaustion must not advertise a page that cannot contain more raw results");

  const image = await pixabay.search({ query: "forest", kind: "image", orientation: "portrait", perPage: 3 });
  const imageCall = calls.find(item => item.pathname === "/api/" && item.searchParams.get("q") === "forest");
  assert(imageCall);
  assert.strictEqual(imageCall.searchParams.get("orientation"), "vertical");
  assert.strictEqual(image.results.length, 0, "provider results that do not match the requested image orientation must be removed");

  const square = await pixabay.search({ query: "square", kind: "image", orientation: "square", perPage: 3 });
  const squareCall = calls.find(item => item.pathname === "/api/" && item.searchParams.get("q") === "square");
  assert(squareCall);
  assert.strictEqual(squareCall.searchParams.get("orientation"), "all", "Pixabay has no square API filter, so square is enforced after normalization");
  assert.strictEqual(square.results.length, 1);
  assert.strictEqual(square.results[0].providerAssetId, "9");
  assert.strictEqual(square.results[0].meta.orientation, "square");
  assert.strictEqual(square.results[0].variants.length, 3);

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

  console.log("Pexels/Pixabay video-image capability, orientation paging, fallback and public error isolation tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
