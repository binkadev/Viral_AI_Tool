"use strict";

const assert = require("assert");
const { createPixabayMediaProvider } = require("../dev-backend/providers/pixabay-media");

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
        url: `https://cdn.example.test/${id}.mp4`,
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        size: 1000,
        thumbnail: `https://cdn.example.test/${id}.jpg`
      }
    }
  };
}

(async () => {
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

  assert.strictEqual(calls.length, 2, "search should stop after the second complete provider page fills the requested result count");
  assert.strictEqual(result.results.length, 28, "all filtered matches from the final fetched provider page must be preserved");
  assert.deepStrictEqual(
    result.results.slice(10).map(item => item.providerAssetId),
    Array.from({ length: 18 }, (_, index) => String(300 + index)),
    "no matches from the partially-consumed provider page may become unreachable"
  );
  assert.strictEqual(result.nextPage, 3, "nextPage must advance only after the complete second provider page was consumed");

  console.log("Pixabay filtered pagination preserves complete provider pages without dropping matches.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
