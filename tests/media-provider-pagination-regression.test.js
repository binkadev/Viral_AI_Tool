"use strict";

const assert = require("assert");
const {
  MAX_FILTERED_PROVIDER_PAGES_PER_REQUEST,
  createPixabayMediaProvider
} = require("../dev-backend/providers/pixabay-media");

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function hit(id, portrait) {
  return {
    id,
    tags: `asset-${id}`,
    duration: 5,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    user: "Creator",
    user_id: 1,
    videos: {
      medium: {
        url: `https://cdn.pixabay.com/video/${id}.mp4`,
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        size: 1000,
        thumbnail: `https://cdn.pixabay.com/video/${id}.jpg`
      }
    }
  };
}

(async () => {
  assert.strictEqual(MAX_FILTERED_PROVIDER_PAGES_PER_REQUEST, 2);

  const calls = [];
  const provider = createPixabayMediaProvider({
    apiKey: "pixabay-key",
    fetchImpl: async url => {
      const parsed = new URL(url.toString());
      calls.push(parsed);
      const page = Number(parsed.searchParams.get("page") || 1);
      if (page === 1) {
        return response({
          totalHits: 54,
          hits: [
            ...Array.from({ length: 10 }, (_, index) => hit(100 + index, true)),
            ...Array.from({ length: 8 }, (_, index) => hit(200 + index, false))
          ]
        });
      }
      if (page === 2) {
        return response({
          totalHits: 54,
          hits: Array.from({ length: 18 }, (_, index) => hit(300 + index, true))
        });
      }
      return response({
        totalHits: 54,
        hits: Array.from({ length: 18 }, (_, index) => hit(400 + index, true))
      });
    }
  });

  const result = await provider.search({
    query: "portrait wildlife",
    kind: "video",
    orientation: "portrait",
    page: 1,
    perPage: 18
  });

  assert.strictEqual(calls.length, 2, "one filtered UI request must never scan more than its provider-page budget");
  assert.strictEqual(result.results.length, 28, "all matches from fetched pages must remain reachable");
  assert.deepStrictEqual(
    result.results.slice(10).map(item => item.providerAssetId),
    Array.from({ length: 18 }, (_, index) => String(300 + index))
  );
  assert.strictEqual(result.nextPage, 3, "continuation must start after the final completely consumed provider page");

  const deepCalls = [];
  const deepProvider = createPixabayMediaProvider({
    apiKey: "pixabay-key",
    fetchImpl: async url => {
      const parsed = new URL(url.toString());
      deepCalls.push(parsed);
      const page = Number(parsed.searchParams.get("page") || 1);
      const portrait = page === 6;
      return response({
        totalHits: 18,
        hits: Array.from({ length: 3 }, (_, index) => hit(page * 10 + index, portrait))
      });
    }
  });

  let page = 1;
  let deepResult = null;
  const requestCallCounts = [];
  for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
    const before = deepCalls.length;
    deepResult = await deepProvider.search({
      query: "deep portrait wildlife",
      kind: "video",
      orientation: "portrait",
      page,
      perPage: 3
    });
    requestCallCounts.push(deepCalls.length - before);
    if (deepResult.results.length || deepResult.nextPage == null) break;
    page = deepResult.nextPage;
  }

  assert.deepStrictEqual(requestCallCounts, [2, 2, 2], "deep discovery must advance in explicit bounded continuations instead of one quota-heavy request");
  assert.strictEqual(deepCalls.length, 6, "valid page-six matches must remain reachable across continuations");
  assert.strictEqual(deepResult.results.length, 3);
  assert.deepStrictEqual(deepResult.results.map(item => item.providerAssetId), ["60", "61", "62"]);
  assert.strictEqual(deepResult.nextPage, null);

  console.log("Pixabay filtered pagination is quota-bounded while preserving deep continuation reachability.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
