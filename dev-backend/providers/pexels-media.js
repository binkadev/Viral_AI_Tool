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

  function normalizeImage(photo) {
    if (!photo || typeof photo !== "object" || photo.id == null) return null;
    const source = photo.src && typeof photo.src === "object" ? photo.src : {};
    const variants = [
      ["original", source.original],
      ["large2x", source.large2x],
      ["large", source.large],
      ["medium", source.medium],
      ["small", source.small],
      ["portrait", source.portrait],
      ["landscape", source.landscape],
      ["tiny", source.tiny]
    ].filter(([, url]) => Boolean(url)).map(([quality, url]) => ({
      id: quality,
      url,
      width: quality === "original" ? photo.width : null,
      height: quality === "original" ? photo.height : null,
      quality,
      mime: "image/jpeg"
    }));
    const preview = source.medium || source.small || source.large || source.original || null;
    const creatorName = String(photo.photographer || "").trim() || null;

    return normalizeSearchResult({
      provider: "pexels",
      providerAssetId: String(photo.id),
      kind: "image",
      name: String(photo.alt || "").trim() || (creatorName ? `${creatorName} — Pexels ${photo.id}` : `Pexels ${photo.id}`),
      previewUrl: preview,
      thumbnailUrl: source.small || source.tiny || preview,
      meta: {
        width: photo.width,
        height: photo.height,
        duration: 0
      },
      attribution: {
        creatorName,
        creatorUrl: photo.photographer_url,
        sourceUrl: photo.url,
        licenseName: "Pexels License",
        licenseUrl: PEXELS_LICENSE_URL,
        attributionText: creatorName ? `Photo by ${creatorName} on Pexels` : "Photo from Pexels"
      },
      variants
    });
  }

  async function search(input = {}, { signal } = {}) {
    const request = normalizeSearchRequest(input);
    if (!isConfigured()) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Pexels media provider is not configured.", {
        provider: "pexels"
      });
    }

    const url = new URL(request.kind === "image" ? "/v1/search" : "/videos/search", PEXELS_API_BASE);
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

    const source = request.kind === "image" ? payload?.photos : payload?.videos;
    const normalize = request.kind === "image" ? normalizeImage : normalizeVideo;
    const results = (Array.isArray(source) ? source : []).map(normalize).filter(Boolean);

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
    normalizeImage,
    search
  };
}

module.exports = {
  PEXELS_API_BASE,
  PEXELS_LICENSE_URL,
  createPexelsMediaProvider
};
