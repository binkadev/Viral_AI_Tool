"use strict";

const {
  mediaProviderError,
  normalizeSearchRequest,
  normalizeSearchResult
} = require("../../services/media/provider-contract");

const PIXABAY_API_BASE = "https://pixabay.com/api/";
const PIXABAY_VIDEO_API_BASE = "https://pixabay.com/api/videos/";
const PIXABAY_LICENSE_URL = "https://pixabay.com/service/license-summary/";
const MAX_FILTERED_PAGE_SCANS = 5;

function createPixabayMediaProvider({ apiKey = process.env.PIXABAY_API_KEY, fetchImpl = global.fetch } = {}) {
  const credential = String(apiKey || "").trim();

  function isConfigured() {
    return Boolean(credential && typeof fetchImpl === "function");
  }

  function apiOrientation(value) {
    if (value === "portrait") return "vertical";
    if (value === "landscape") return "horizontal";
    return "all";
  }

  function normalizeVideo(hit) {
    if (!hit || typeof hit !== "object" || hit.id == null) return null;
    const source = hit.videos && typeof hit.videos === "object" ? hit.videos : {};
    const variants = Object.entries(source).map(([quality, item]) => ({
      id: quality,
      url: item?.url,
      width: item?.width,
      height: item?.height,
      quality,
      mime: "video/mp4",
      sizeBytes: item?.size
    }));
    const preview = source.medium?.thumbnail || source.small?.thumbnail || source.tiny?.thumbnail || source.large?.thumbnail || null;
    const profileUrl = hit.user && hit.user_id != null
      ? `https://pixabay.com/users/${encodeURIComponent(String(hit.user))}-${encodeURIComponent(String(hit.user_id))}/`
      : null;

    return normalizeSearchResult({
      provider: "pixabay",
      providerAssetId: String(hit.id),
      kind: "video",
      name: hit.tags ? String(hit.tags).split(",").slice(0, 3).join(", ") : `Pixabay ${hit.id}`,
      previewUrl: preview,
      thumbnailUrl: preview,
      meta: {
        width: source.medium?.width || source.small?.width || source.large?.width || source.tiny?.width,
        height: source.medium?.height || source.small?.height || source.large?.height || source.tiny?.height,
        duration: Number(hit.duration || 0)
      },
      attribution: {
        creatorName: hit.user,
        creatorUrl: profileUrl,
        sourceUrl: hit.pageURL,
        licenseName: "Pixabay Content License",
        licenseUrl: PIXABAY_LICENSE_URL,
        attributionText: hit.user ? `Video by ${hit.user} on Pixabay` : "Video from Pixabay"
      },
      variants
    });
  }

  function normalizeImage(hit) {
    if (!hit || typeof hit !== "object" || hit.id == null) return null;
    const variants = [
      { id: "preview", url: hit.previewURL, width: hit.previewWidth, height: hit.previewHeight, quality: "preview", mime: "image/jpeg" },
      { id: "web", url: hit.webformatURL, width: hit.webformatWidth, height: hit.webformatHeight, quality: "web", mime: "image/jpeg" },
      { id: "large", url: hit.largeImageURL, width: hit.imageWidth, height: hit.imageHeight, quality: "large", mime: "image/jpeg" }
    ];
    const profileUrl = hit.user && hit.user_id != null
      ? `https://pixabay.com/users/${encodeURIComponent(String(hit.user))}-${encodeURIComponent(String(hit.user_id))}/`
      : null;

    return normalizeSearchResult({
      provider: "pixabay",
      providerAssetId: String(hit.id),
      kind: "image",
      name: hit.tags ? String(hit.tags).split(",").slice(0, 3).join(", ") : `Pixabay ${hit.id}`,
      previewUrl: hit.webformatURL || hit.previewURL,
      thumbnailUrl: hit.previewURL || hit.webformatURL,
      meta: {
        width: hit.imageWidth || hit.webformatWidth || hit.previewWidth,
        height: hit.imageHeight || hit.webformatHeight || hit.previewHeight,
        duration: 0
      },
      attribution: {
        creatorName: hit.user,
        creatorUrl: profileUrl,
        sourceUrl: hit.pageURL,
        licenseName: "Pixabay Content License",
        licenseUrl: PIXABAY_LICENSE_URL,
        attributionText: hit.user ? `Image by ${hit.user} on Pixabay` : "Image from Pixabay"
      },
      variants
    });
  }

  async function fetchSearchPage(request, page, perPage, signal) {
    const url = new URL(request.kind === "video" ? PIXABAY_VIDEO_API_BASE : PIXABAY_API_BASE);
    url.searchParams.set("key", credential);
    url.searchParams.set("q", request.query.slice(0, 100));
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("safesearch", "true");
    if (request.kind === "image") url.searchParams.set("orientation", apiOrientation(request.orientation));

    let response;
    try {
      response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw mediaProviderError("MEDIA_SEARCH_TIMEOUT", "Media search timed out.", { provider: "pixabay" });
      }
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Media search is unavailable.", { provider: "pixabay" });
    }

    if (response.status === 401 || response.status === 403) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pixabay media provider rejected its credentials.", { provider: "pixabay" });
    }
    if (response.status === 429) {
      throw mediaProviderError("MEDIA_QUOTA_EXCEEDED", "Pixabay media search quota was exceeded.", { provider: "pixabay" });
    }
    if (!response.ok) {
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Pixabay media search failed.", { provider: "pixabay" });
    }

    try {
      return { payload: await response.json(), url };
    } catch {
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Pixabay returned an invalid response.", { provider: "pixabay" });
    }
  }

  async function search(input = {}, { signal } = {}) {
    const request = normalizeSearchRequest(input);
    if (!isConfigured()) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pixabay media provider is not configured.", { provider: "pixabay" });
    }

    const perPage = Math.max(3, request.perPage);
    const normalize = request.kind === "video" ? normalizeVideo : normalizeImage;
    const maxScans = request.orientation === "any" ? 1 : MAX_FILTERED_PAGE_SCANS;
    const results = [];
    const seen = new Set();
    let totalResults = 0;
    let lastRawCount = 0;
    let lastFetchedPage = request.page - 1;

    for (let scan = 0; scan < maxScans && results.length < request.perPage; scan += 1) {
      const page = request.page + scan;
      const { payload } = await fetchSearchPage(request, page, perPage, signal);
      const hits = Array.isArray(payload?.hits) ? payload.hits : [];
      lastRawCount = hits.length;
      lastFetchedPage = page;
      if (scan === 0) {
        totalResults = Math.max(0, Number(payload?.totalHits ?? payload?.total ?? 0) || 0);
      }

      let normalized = hits.map(normalize).filter(Boolean);
      if (request.orientation !== "any") {
        normalized = normalized.filter(item => item.meta?.orientation === request.orientation);
      }

      // Consume the complete provider page before advancing nextPage. A provider
      // page is the smallest stable cursor Pixabay gives us; truncating midway
      // would make the remaining matches on that page unreachable to callers.
      for (const item of normalized) {
        const identity = `${item.provider}:${item.providerAssetId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        results.push(item);
      }

      if (hits.length < perPage) break;
      if (totalResults > 0 && page * perPage >= totalResults) break;
    }

    const hasMore = lastRawCount >= perPage && (
      totalResults <= 0 || lastFetchedPage * perPage < totalResults
    );

    return {
      provider: "pixabay",
      query: request.query,
      kind: request.kind,
      orientation: request.orientation,
      page: request.page,
      perPage,
      totalResults,
      nextPage: hasMore ? lastFetchedPage + 1 : null,
      results
    };
  }

  return { id: "pixabay", isConfigured, normalizeVideo, normalizeImage, search };
}

module.exports = {
  PIXABAY_API_BASE,
  PIXABAY_VIDEO_API_BASE,
  PIXABAY_LICENSE_URL,
  MAX_FILTERED_PAGE_SCANS,
  createPixabayMediaProvider
};
