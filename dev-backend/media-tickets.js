"use strict";

const crypto = require("crypto");
const contract = require("../services/media/provider-contract");
const { providerDownloadAllowed } = require("../services/media/acquisition-policy");

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const VERSION = 1;
const PLACEHOLDER_SECRET = /(?:replace[-_ ]?with|placeholder|change[-_ ]?me|example|your[-_ ]?secret)/i;

function ticketError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function preferredVariant(result) {
  const variants = Array.isArray(result?.variants)
    ? result.variants.filter(item => item?.url)
    : [];
  if (!variants.length) return null;
  return variants.slice().sort((a, b) => {
    const area = item => Number(item?.width || 0) * Number(item?.height || 0);
    const quality = item => String(item?.quality || "").toLowerCase() === "hd" ? 1 : 0;
    return quality(b) - quality(a) || area(b) - area(a);
  })[0];
}

function publicAttribution(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    creatorName: String(source.creatorName || "").slice(0, 240) || null,
    creatorUrl: contract.safeHttpUrl(source.creatorUrl),
    sourceUrl: contract.safeHttpUrl(source.sourceUrl),
    licenseName: String(source.licenseName || "").slice(0, 160) || null,
    licenseUrl: contract.safeHttpUrl(source.licenseUrl),
    attributionText: String(source.attributionText || "").slice(0, 800) || null
  };
}

function resolveTicketSecret(explicitSecret, environment = process.env.VIRAL_AI_ENV) {
  const production = String(environment || "development").trim().toLowerCase() === "production";
  const configured = String(explicitSecret || process.env.VIRAL_AI_MEDIA_TICKET_SECRET || "").trim();

  if (configured) {
    const key = Buffer.from(configured);
    if (key.length < 32) throw new TypeError("Media ticket secret must be at least 32 bytes.");
    if (production && PLACEHOLDER_SECRET.test(configured)) {
      throw new TypeError("Production media ticket secret must not use an example or placeholder value.");
    }
    return configured;
  }

  if (production) {
    throw new TypeError("VIRAL_AI_MEDIA_TICKET_SECRET is required in production.");
  }

  // Development may use an ephemeral process-local key. Production deliberately
  // fails closed because tickets must survive backend restarts and load-balanced replicas.
  return crypto.randomBytes(32).toString("hex");
}

function createMediaTicketService({
  secret,
  environment = process.env.VIRAL_AI_ENV,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now()
} = {}) {
  const key = Buffer.from(resolveTicketSecret(secret, environment));
  const lifetime = Math.max(60_000, Math.min(60 * 60 * 1000, Number(ttlMs || DEFAULT_TTL_MS)));

  function sign(encodedPayload) {
    return crypto.createHmac("sha256", key).update(encodedPayload).digest("base64url");
  }

  function issue(result, { userId } = {}) {
    const normalized = contract.normalizeSearchResult(result);
    const owner = String(userId || "").trim();
    if (!normalized || !owner) throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition source is incomplete.");
    const variant = preferredVariant(normalized);
    if (!variant || !providerDownloadAllowed(normalized.provider, variant.url)) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition source is not allowed.");
    }

    const issuedAt = now();
    const payload = {
      v: VERSION,
      sub: owner,
      iat: issuedAt,
      exp: issuedAt + lifetime,
      provider: normalized.provider,
      providerAssetId: normalized.providerAssetId,
      kind: normalized.kind,
      name: normalized.name,
      previewUrl: normalized.previewUrl,
      download: {
        url: variant.url,
        mime: variant.mime || null,
        quality: variant.quality || null,
        width: Number(variant.width || 0),
        height: Number(variant.height || 0)
      },
      meta: normalized.meta,
      attribution: publicAttribution(normalized.attribution)
    };
    const encoded = base64urlEncode(JSON.stringify(payload));
    return {
      ticket: encoded + "." + sign(encoded),
      expiresAt: new Date(payload.exp).toISOString()
    };
  }

  function resolve(rawTicket, { userId } = {}) {
    const ticket = String(rawTicket || "").trim();
    const owner = String(userId || "").trim();
    const parts = ticket.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket is invalid.");
    }
    const expected = sign(parts[0]);
    if (!safeEqual(expected, parts[1])) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket signature is invalid.");
    }

    let payload;
    try { payload = JSON.parse(base64urlDecode(parts[0])); }
    catch { throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket payload is invalid."); }

    if (payload?.v !== VERSION || !owner || payload?.sub !== owner) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket ownership is invalid.");
    }
    if (!Number.isFinite(Number(payload?.exp)) || now() >= Number(payload.exp)) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition ticket has expired.");
    }
    if (!providerDownloadAllowed(String(payload.provider || ""), payload?.download?.url)) {
      throw ticketError("MEDIA_SOURCE_UNAVAILABLE", "Media acquisition source is not allowed.");
    }

    return {
      provider: String(payload.provider || "").slice(0, 80),
      providerAssetId: String(payload.providerAssetId || "").slice(0, 240),
      kind: String(payload.kind || "video"),
      name: String(payload.name || "").slice(0, 320),
      previewUrl: contract.safeHttpUrl(payload.previewUrl),
      downloadUrl: contract.safeHttpUrl(payload.download.url),
      mime: String(payload.download.mime || "").slice(0, 120) || null,
      quality: String(payload.download.quality || "").slice(0, 80) || null,
      meta: {
        width: Math.max(0, Number(payload?.meta?.width || payload?.download?.width || 0)),
        height: Math.max(0, Number(payload?.meta?.height || payload?.download?.height || 0)),
        duration: Math.max(0, Number(payload?.meta?.duration || 0)),
        sizeBytes: 0,
        mime: String(payload?.meta?.mime || payload.download.mime || "").slice(0, 120) || null,
        orientation: ["portrait", "landscape", "square"].includes(payload?.meta?.orientation)
          ? payload.meta.orientation
          : null
      },
      attribution: publicAttribution(payload.attribution),
      expiresAt: new Date(Number(payload.exp)).toISOString()
    };
  }

  return { issue, resolve, ttlMs: lifetime };
}

module.exports = {
  DEFAULT_TTL_MS,
  PLACEHOLDER_SECRET,
  preferredVariant,
  providerDownloadAllowed,
  resolveTicketSecret,
  createMediaTicketService
};
