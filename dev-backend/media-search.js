"use strict";

const { createPexelsMediaProvider } = require("./providers/pexels-media");
const { createPixabayMediaProvider } = require("./providers/pixabay-media");
const {
  mediaProviderError,
  normalizeSearchRequest,
  publicSearchError
} = require("../services/media/provider-contract");

function createMediaSearchService({ providers, fetchImpl } = {}) {
  const providerList = Array.isArray(providers)
    ? providers.filter(Boolean)
    : [
        createPexelsMediaProvider({ fetchImpl }),
        createPixabayMediaProvider({ fetchImpl })
      ];

  function status() {
    return {
      ready: providerList.some(provider => provider?.isConfigured?.()),
      providers: providerList.map(provider => ({
        id: provider?.id || "unknown",
        configured: Boolean(provider?.isConfigured?.())
      }))
    };
  }

  async function search(input = {}, { signal } = {}) {
    const request = normalizeSearchRequest(input);
    const requestedProvider = String(input.provider || "auto").trim().toLowerCase() || "auto";
    const eligible = providerList.filter(provider => {
      if (!provider?.isConfigured?.()) return false;
      if (requestedProvider !== "auto" && provider.id !== requestedProvider) return false;
      return true;
    });

    if (!eligible.length) {
      throw mediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "No configured media provider is available.", {
        provider: requestedProvider === "auto" ? undefined : requestedProvider
      });
    }

    let lastError = null;
    for (const provider of eligible) {
      try {
        const response = await provider.search(request, { signal });
        return {
          request,
          provider: response.provider,
          page: response.page,
          perPage: response.perPage,
          totalResults: response.totalResults,
          nextPage: response.nextPage,
          results: response.results
        };
      } catch (error) {
        lastError = error;
        if (requestedProvider !== "auto") throw error;
        if (!["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_SEARCH_UNAVAILABLE", "MEDIA_QUOTA_EXCEEDED"].includes(error?.code)) {
          throw error;
        }
      }
    }

    throw lastError || mediaProviderError("MEDIA_SEARCH_UNAVAILABLE", "Media search is unavailable.");
  }

  return {
    status,
    search,
    publicError: publicSearchError
  };
}

module.exports = {
  createMediaSearchService
};
