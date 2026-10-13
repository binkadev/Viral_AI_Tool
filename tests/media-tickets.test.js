"use strict";

const assert = require("assert");
const {
  preferredVariant,
  providerDownloadAllowed,
  createMediaTicketService
} = require("../dev-backend/media-tickets");

const result = {
  provider: "pexels",
  providerAssetId: "987",
  kind: "video",
  name: "Lion by the river",
  previewUrl: "https://images.pexels.com/videos/987/preview.jpg",
  meta: { width: 1080, height: 1920, duration: 15, orientation: "portrait" },
  attribution: {
    creatorName: "Jane Creator",
    creatorUrl: "https://www.pexels.com/@jane/",
    sourceUrl: "https://www.pexels.com/video/987/",
    licenseName: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/",
    attributionText: "Video by Jane Creator"
  },
  variants: [
    { id: "sd", url: "https://videos.pexels.com/video-files/987/sd.mp4", quality: "sd", mime: "video/mp4", width: 540, height: 960 },
    { id: "hd", url: "https://videos.pexels.com/video-files/987/hd.mp4", quality: "hd", mime: "video/mp4", width: 1080, height: 1920 }
  ]
};

let clock = Date.UTC(2026, 9, 12, 13, 0, 0);
const service = createMediaTicketService({
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef",
  ttlMs: 5 * 60 * 1000,
  now: () => clock
});

assert.strictEqual(preferredVariant(result).id, "hd");
assert.strictEqual(providerDownloadAllowed("pexels", "https://videos.pexels.com/a.mp4"), true);
assert.strictEqual(providerDownloadAllowed("pexels", "https://pexels.com/a.mp4"), true);
assert.strictEqual(providerDownloadAllowed("pexels", "https://example.com/a.mp4"), false);
assert.strictEqual(providerDownloadAllowed("pexels", "http://videos.pexels.com/a.mp4"), false);
assert.strictEqual(providerDownloadAllowed("unknown", "https://videos.pexels.com/a.mp4"), false);

const issued = service.issue(result, { userId: "user-1" });
assert.strictEqual(typeof issued.ticket, "string");
assert(issued.ticket.includes("."));
assert.strictEqual(issued.expiresAt, new Date(clock + 5 * 60 * 1000).toISOString());
assert.strictEqual(issued.ticket.includes("videos.pexels.com"), false, "signed ticket must remain opaque in normal UI/log surfaces");

const resolved = service.resolve(issued.ticket, { userId: "user-1" });
assert.strictEqual(resolved.provider, "pexels");
assert.strictEqual(resolved.providerAssetId, "987");
assert.strictEqual(resolved.downloadUrl, "https://videos.pexels.com/video-files/987/hd.mp4");
assert.strictEqual(resolved.attribution.creatorName, "Jane Creator");
assert.strictEqual(resolved.meta.orientation, "portrait");

assert.throws(
  () => service.resolve(issued.ticket, { userId: "other-user" }),
  error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
);

const tampered = issued.ticket.slice(0, -1) + (issued.ticket.endsWith("A") ? "B" : "A");
assert.throws(
  () => service.resolve(tampered, { userId: "user-1" }),
  error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
);

clock += 5 * 60 * 1000;
assert.throws(
  () => service.resolve(issued.ticket, { userId: "user-1" }),
  error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
);

assert.throws(
  () => service.issue({ ...result, variants: [{ ...result.variants[0], url: "https://internal.example.test/file.mp4" }] }, { userId: "user-1" }),
  error => error?.code === "MEDIA_SOURCE_UNAVAILABLE"
);

assert.throws(
  () => createMediaTicketService({ secret: "too-short" }),
  error => error instanceof TypeError
);

console.log("Signed media acquisition ticket ownership, expiry, tamper detection and provider-host restrictions passed.");
