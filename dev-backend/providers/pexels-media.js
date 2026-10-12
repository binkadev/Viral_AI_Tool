"use strict";

const {
  mediaProviderError,
  normalizeSearchRequest,
  normalizeSearchResult
} = require("../../services/media/provider-contract");

const PEXELS_API_BASE = "https://api.pexels.com";
const PEXELS_LICENSE_URL = "https://www.pexels.com/license/";

function createPexelsMediaProvider({ apiKey = process.env.PEXELS_API_KEY, fetchImpl = global.fetch } = {}) {
  const credential = String(apiKey || "").trim();

  function isConfigured() {
    return Boolean(credential && typeof fetchImpl === "function");
  }

  function normalizeVideo(video) {
    if (!video || typeof video !== "object" || video.id == null) return null;
    const user = video.user && typeof video.user === "object" ? video.user : {};
    const variants = (Array.isArray(video.video_files) ? video.video_files : []).map(file => ({
      id: file?.id == null ? null : String(file.id),
      url: file?.link,
      width: file?.width,
      height: file?.height,
      quality: file?.quality,
      mime: file?.file_type
    }));

    return normalizeSearchResult({
      provider: "pexels",
      providerAssetId: String(video.id),
      kind: "video",
      name: user.name ? `${user.name} — Pexels ${video.id}` : `Pexels ${video.id}`,
      previewUrl: video.image,
      thumbnailUrl: video.image,
      meta: {
        width: video.width,
        height: video.height,
        duration: video.duration
      },
      attribution: {
        creatorName: user.name,
        creatorUrl: user.url,
        sourceUrl: video.url,
        licenseName: "Pexels License",
        licenseUrl: PEXELS_LICENSE_URL,
        attributionText: user.name ? `Video by ${user.name} on Pexels` : "Video from Pexels"
      },
      variants
    });
  }

  async function search(input = {}, { signal } = {}) {
    const request = normalizeSearchRequest(input);
    if (request.kind !== "video") {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pexels image search is not enabled in this provider yet.", {
        provider: "pexels"
      });
    }
    if (!isConfigured()) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pexels media provider is not configured.", {
        provider: "pexels"
      });
    }

    const url = new URL("/videos/search", PEXELS_API_BASE);
    url.searchParams.set("query", request.query);
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("per_page", String(request.perPage));
    if (request.orientation !== "any") url.searchParams.set("orientation", request.orientation);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: credential
        },
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw mediaProviderError("MEDIA_SEARCH_TIMEOUT", "Media search timed out.", { provider: "pexels" });
      }
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Media search is unavailable.", { provider: "pexels" });
    }

    if (response.status === 401 || response.status === 403) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pexels media provider rejected its credentials.", {
        provider: "pexels"
      });
    }
    if (response.status === 429) {
      throw mediaProviderError("MEDIA_QUOTA_EXCEEDED", "Pexels media search quota was exceeded.", {
        provider: "pexels"
      });
    }
    if (!response.ok) {
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Pexels media search failed.", {
        provider: "pexels"
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Pexels returned an invalid response.", {
        provider: "pexels"
      });
    }

    const results = (Array.isArray(payload?.videos) ? payload.videos : [])
      .map(normalizeVideo)
      .filter(Boolean);

    return {
      provider: "pexels",
      query: request.query,
      kind: request.kind,
      orientation: request.orientation,
      page: Number(payload?.page) || request.page,
      perPage: Number(payload?.per_page) || request.perPage,
      totalResults: Math.max(0, Number(payload?.total_results) || 0),
      nextPage: typeof payload?.next_page === "string" ? payload.next_page : null,
      results
    };
  }

  return {
    id: "pexels",
    isConfigured,
    normalizeVideo,
    search
  };
}

module.exports = {
  PEXELS_API_BASE,
  PEXELS_LICENSE_URL,
  createPexelsMediaProvider
};
