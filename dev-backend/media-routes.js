"use strict";

const { createMediaTicketService } = require("./media-tickets");

function statusForMediaError(code) {
  if (code === "MEDIA_AUTH_REQUIRED") return 401;
  if (code === "MEDIA_QUOTA_EXCEEDED") return 429;
  if (code === "MEDIA_SEARCH_INVALID") return 400;
  if (code === "MEDIA_SOURCE_UNAVAILABLE") return 410;
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

function createMediaHttpHandler({ service, authenticate, json, error, audit, ticketService = createMediaTicketService() } = {}) {
  if (!service || typeof service.status !== "function" || typeof service.search !== "function") {
    throw new TypeError("A media search service is required.");
  }
  if (!ticketService || typeof ticketService.issue !== "function" || typeof ticketService.resolve !== "function") {
    throw new TypeError("A media acquisition ticket service is required.");
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

    if (url.pathname === "/v1/media/acquisition") {
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
      } catch (rawError) {
        audit?.("media.acquisition.rejected", req, {
          userId: user.id || null,
          code: rawError?.code === "MEDIA_SOURCE_UNAVAILABLE" ? "MEDIA_SOURCE_UNAVAILABLE" : "MEDIA_SOURCE_UNAVAILABLE"
        });
        error(res, statusForMediaError("MEDIA_SOURCE_UNAVAILABLE"), "MEDIA_SOURCE_UNAVAILABLE");
      }
      return true;
    }

    if (url.pathname === "/v1/media/search") {
      const controller = new AbortController();
      const abort = () => controller.abort();
      req?.once?.("aborted", abort);

      try {
        const result = await service.search(searchInput(url), { signal: controller.signal });
        const results = Array.isArray(result.results)
          ? result.results.map(item => enrichSearchResult(item, ticketService, user.id))
          : [];
        const publicResult = { ...result, results };
        audit?.("media.search.succeeded", req, {
          userId: user.id || null,
          provider: result.provider || null,
          resultCount: results.length,
          acquirableCount: results.filter(item => item?.acquisition?.ticket).length
        });
        json(res, 200, publicResult);
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
  acquisitionTicket,
  enrichSearchResult,
  createMediaHttpHandler
};
