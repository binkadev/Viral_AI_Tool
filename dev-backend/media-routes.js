"use strict";

function mediaRouteError(errorValue) {
  const code = errorValue?.code || "MEDIA_SEARCH_UNAVAILABLE";
  if (code === "MEDIA_SEARCH_INVALID") return { status: 400, code };
  if (code === "MEDIA_AUTH_REQUIRED") return { status: 401, code };
  if (code === "MEDIA_QUOTA_EXCEEDED") return { status: 429, code };
  if (["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_SEARCH_TIMEOUT", "MEDIA_SEARCH_UNAVAILABLE"].includes(code)) {
    return { status: 503, code };
  }
  return { status: 500, code: "MEDIA_SEARCH_UNAVAILABLE" };
}

function createMediaRouteHandler({ mediaSearchService, authenticate, json, error, requestRateLimited } = {}) {
  if (!mediaSearchService || typeof mediaSearchService.search !== "function" || typeof mediaSearchService.status !== "function") {
    throw new Error("mediaSearchService is required");
  }
  if (typeof authenticate !== "function" || typeof json !== "function" || typeof error !== "function") {
    throw new Error("media route response helpers are required");
  }

  return async function handleMediaRoute(req, res, url, method = req?.method || "GET") {
    if (!url || typeof url.pathname !== "string") return false;
    const isStatus = method === "GET" && url.pathname === "/v1/media/status";
    const isSearch = method === "GET" && url.pathname === "/v1/media/search";
    if (!isStatus && !isSearch) return false;

    if (typeof requestRateLimited === "function" && requestRateLimited(req, "media-search")) {
      error(res, 429, "RATE_LIMITED");
      return true;
    }

    const user = authenticate(req);
    if (!user) {
      error(res, 401, "AUTH_REQUIRED");
      return true;
    }

    if (isStatus) {
      json(res, 200, mediaSearchService.status());
      return true;
    }

    const controller = new AbortController();
    const abortSearch = () => controller.abort();
    const abortOnResponseClose = () => { if (!res.writableEnded) abortSearch(); };
    req.once?.("aborted", abortSearch);
    res.once?.("close", abortOnResponseClose);
    try {
      const payload = await mediaSearchService.search({
        query: url.searchParams.get("query") || "",
        kind: url.searchParams.get("kind") || "video",
        orientation: url.searchParams.get("orientation") || "any",
        page: url.searchParams.get("page") || 1,
        perPage: url.searchParams.get("perPage") || 18,
        provider: url.searchParams.get("provider") || "auto"
      }, { signal: controller.signal });
      if (!controller.signal.aborted && !res.writableEnded) json(res, 200, payload);
      return true;
    } catch (searchError) {
      if (controller.signal.aborted || res.writableEnded) return true;
      const publicValue = typeof mediaSearchService.publicError === "function"
        ? mediaSearchService.publicError(searchError)
        : { code: searchError?.code || "MEDIA_SEARCH_UNAVAILABLE", details: {} };
      const mapped = mediaRouteError(publicValue);
      error(res, mapped.status, mapped.code, publicValue.details || {});
      return true;
    } finally {
      req.removeListener?.("aborted", abortSearch);
      res.removeListener?.("close", abortOnResponseClose);
    }
  };
}

module.exports = {
  createMediaRouteHandler,
  mediaRouteError
};
