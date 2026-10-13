"use strict";

const { createMediaTicketService } = require("./media-tickets");

const DEFAULT_MEDIA_SEARCH_TIMEOUT_MS = 12000;

function mediaRouteError(errorValue) {
  const code = errorValue?.code || "MEDIA_SEARCH_UNAVAILABLE";
  if (code === "MEDIA_SEARCH_INVALID") return { status: 400, code };
  if (code === "MEDIA_AUTH_REQUIRED") return { status: 401, code };
  if (code === "MEDIA_QUOTA_EXCEEDED") return { status: 429, code };
  if (code === "MEDIA_SOURCE_UNAVAILABLE") return { status: 410, code };
  if (["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_SEARCH_TIMEOUT", "MEDIA_SEARCH_UNAVAILABLE"].includes(code)) {
    return { status: 503, code };
  }
  return { status: 500, code: "MEDIA_SEARCH_UNAVAILABLE" };
}

function acquisitionTicket(req) {
  const raw = req?.headers?.["x-viral-ai-media-ticket"];
  return Array.isArray(raw) ? String(raw[0] || "").trim() : String(raw || "").trim();
}

function enrichSearchResult(result, ticketService, userId) {
  if (!result || typeof result !== "object") return result;
  try {
    return {
      ...result,
      acquisition: ticketService.issue(result, { userId })
    };
  } catch {
    return {
      ...result,
      acquisition: null
    };
  }
}

function createMediaRouteHandler({
  mediaSearchService,
  authenticate,
  json,
  error,
  requestRateLimited,
  audit,
  ticketService = createMediaTicketService(),
  searchTimeoutMs = DEFAULT_MEDIA_SEARCH_TIMEOUT_MS
} = {}) {
  if (!mediaSearchService || typeof mediaSearchService.search !== "function" || typeof mediaSearchService.status !== "function") {
    throw new Error("mediaSearchService is required");
  }
  if (!ticketService || typeof ticketService.issue !== "function" || typeof ticketService.resolve !== "function") {
    throw new Error("media acquisition ticket service is required");
  }
  if (typeof authenticate !== "function" || typeof json !== "function" || typeof error !== "function") {
    throw new Error("media route response helpers are required");
  }

  const boundedSearchTimeoutMs = Math.max(10, Math.min(60000, Number(searchTimeoutMs) || DEFAULT_MEDIA_SEARCH_TIMEOUT_MS));

  return async function handleMediaRoute(req, res, url, method = req?.method || "GET") {
    if (!url || typeof url.pathname !== "string") return false;
    const isStatus = method === "GET" && url.pathname === "/v1/media/status";
    const isSearch = method === "GET" && url.pathname === "/v1/media/search";
    const isAcquisition = method === "GET" && url.pathname === "/v1/media/acquisition";
    if (!isStatus && !isSearch && !isAcquisition) return false;

    if (typeof requestRateLimited === "function" && requestRateLimited(req, isAcquisition ? "media-acquisition" : "media-search")) {
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

    if (isAcquisition) {
      const ticket = acquisitionTicket(req);
      if (!ticket) {
        error(res, 400, "MEDIA_SOURCE_UNAVAILABLE");
        return true;
      }

      try {
        const descriptor = ticketService.resolve(ticket, { userId: user.id });
        audit?.("media.acquisition.resolved", req, {
          userId: user.id || null,
          provider: descriptor.provider || null,
          providerAssetId: descriptor.providerAssetId || null
        });
        json(res, 200, descriptor);
      } catch {
        audit?.("media.acquisition.rejected", req, {
          userId: user.id || null,
          code: "MEDIA_SOURCE_UNAVAILABLE"
        });
        error(res, 410, "MEDIA_SOURCE_UNAVAILABLE");
      }
      return true;
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortSearch = () => controller.abort();
    const abortOnResponseClose = () => { if (!res.writableEnded) abortSearch(); };
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, boundedSearchTimeoutMs);

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

      if (!controller.signal.aborted && !res.writableEnded) {
        const results = Array.isArray(payload?.results)
          ? payload.results.map(item => enrichSearchResult(item, ticketService, user.id))
          : [];
        audit?.("media.search.succeeded", req, {
          userId: user.id || null,
          provider: payload?.provider || null,
          resultCount: results.length,
          acquirableCount: results.filter(item => item?.acquisition?.ticket).length
        });
        json(res, 200, { ...payload, results });
      }
      return true;
    } catch (searchError) {
      if (res.writableEnded) return true;
      if (timedOut) {
        error(res, 503, "MEDIA_SEARCH_TIMEOUT", {});
        return true;
      }
      if (controller.signal.aborted) return true;
      const publicValue = typeof mediaSearchService.publicError === "function"
        ? mediaSearchService.publicError(searchError)
        : { code: searchError?.code || "MEDIA_SEARCH_UNAVAILABLE", details: {} };
      audit?.("media.search.failed", req, {
        userId: user.id || null,
        code: publicValue.code || "MEDIA_SEARCH_UNAVAILABLE"
      });
      const mapped = mediaRouteError(publicValue);
      error(res, mapped.status, mapped.code, publicValue.details || {});
      return true;
    } finally {
      clearTimeout(timeout);
      req.removeListener?.("aborted", abortSearch);
      res.removeListener?.("close", abortOnResponseClose);
    }
  };
}

module.exports = {
  DEFAULT_MEDIA_SEARCH_TIMEOUT_MS,
  acquisitionTicket,
  enrichSearchResult,
  createMediaRouteHandler,
  mediaRouteError
};
