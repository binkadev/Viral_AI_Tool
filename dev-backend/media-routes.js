"use strict";

function statusForMediaError(code) {
  if (code === "MEDIA_AUTH_REQUIRED") return 401;
  if (code === "MEDIA_QUOTA_EXCEEDED") return 429;
  if (code === "MEDIA_SEARCH_INVALID") return 400;
  if (code === "MEDIA_SEARCH_TIMEOUT") return 504;
  if (["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_SEARCH_UNAVAILABLE"].includes(code)) return 503;
  return 503;
}

function searchInput(url) {
  const params = url?.searchParams;
  return {
    query: params?.get("query") || "",
    kind: params?.get("kind") || "video",
    orientation: params?.get("orientation") || "any",
    provider: params?.get("provider") || "auto",
    page: params?.get("page") || 1,
    perPage: params?.get("perPage") || 18
  };
}

function createMediaHttpHandler({ service, authenticate, json, error, audit } = {}) {
  if (!service || typeof service.status !== "function" || typeof service.search !== "function") {
    throw new TypeError("A media search service is required.");
  }
  if (typeof authenticate !== "function" || typeof json !== "function" || typeof error !== "function") {
    throw new TypeError("Media route dependencies are incomplete.");
  }

  return async function handleMediaHttp({ req, res, url, method }) {
    if (method !== "GET" || !url?.pathname?.startsWith("/v1/media/")) return false;

    const user = authenticate(req);
    if (!user) {
      error(res, 401, "AUTH_REQUIRED");
      return true;
    }

    if (url.pathname === "/v1/media/status") {
      const status = service.status();
      json(res, 200, {
        ready: status.ready === true,
        code: status.ready === true ? "READY" : "MEDIA_PROVIDER_UNAVAILABLE",
        providers: Array.isArray(status.providers)
          ? status.providers.map(item => ({
              id: String(item?.id || "unknown").slice(0, 80),
              configured: item?.configured === true
            }))
          : []
      });
      return true;
    }

    if (url.pathname === "/v1/media/search") {
      const controller = new AbortController();
      const abort = () => controller.abort();
      req?.once?.("aborted", abort);

      try {
        const result = await service.search(searchInput(url), { signal: controller.signal });
        audit?.("media.search.succeeded", req, {
          userId: user.id || null,
          provider: result.provider || null,
          resultCount: Array.isArray(result.results) ? result.results.length : 0
        });
        json(res, 200, result);
      } catch (rawError) {
        const publicError = service.publicError(rawError);
        audit?.("media.search.failed", req, {
          userId: user.id || null,
          code: publicError.code
        });
        error(res, statusForMediaError(publicError.code), publicError.code);
      } finally {
        req?.removeListener?.("aborted", abort);
      }
      return true;
    }

    error(res, 404, "NOT_FOUND");
    return true;
  };
}

module.exports = {
  statusForMediaError,
  searchInput,
  createMediaHttpHandler
};
