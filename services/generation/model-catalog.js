"use strict";

const PRICING_SNAPSHOT = "2026-10-04";

const MODELS = Object.freeze({
  "runway:seedance2_mini": Object.freeze({
    id: "runway:seedance2_mini",
    provider: "runway",
    providerModel: "seedance2_mini",
    label: "Seedance 2.0 Mini",
    tier: "economy",
    modes: Object.freeze(["text-to-video", "image-to-video", "video-to-video"]),
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSeconds: 15,
    audio: false,
    pricing: Object.freeze({ kind: "perSecond", creditsPerSecond: 16, minimumCredits: 64 })
  }),
  "runway:seedance2_fast": Object.freeze({
    id: "runway:seedance2_fast",
    provider: "runway",
    providerModel: "seedance2_fast",
    label: "Seedance 2.0 Fast",
    tier: "balanced",
    modes: Object.freeze(["text-to-video", "image-to-video", "video-to-video"]),
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSeconds: 15,
    audio: true,
    pricing: Object.freeze({ kind: "perSecond", creditsPerSecond: 29 })
  }),
  "runway:seedance2_5": Object.freeze({
    id: "runway:seedance2_5",
    provider: "runway",
    providerModel: "seedance2_5",
    label: "Seedance 2.5",
    tier: "quality",
    modes: Object.freeze(["text-to-video", "image-to-video", "video-to-video"]),
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSeconds: 30,
    audio: true,
    pricing: Object.freeze({
      kind: "seedance25",
      outputCreditsPerSecond: Object.freeze({ "480p": 20, "720p": 30 }),
      inputVideoCreditsPerSecond: Object.freeze({ "480p": 10, "720p": 15 }),
      minimumCredits: 80
    })
  }),
  "runway:gen4.5": Object.freeze({
    id: "runway:gen4.5",
    provider: "runway",
    providerModel: "gen4.5",
    label: "Gen-4.5",
    tier: "quality",
    modes: Object.freeze(["text-to-video", "image-to-video"]),
    resolutions: Object.freeze(["720p"]),
    maxDurationSeconds: 10,
    audio: false,
    pricing: Object.freeze({ kind: "perSecond", creditsPerSecond: 12 })
  }),
  "runway:veo3.1_fast": Object.freeze({
    id: "runway:veo3.1_fast",
    provider: "runway",
    providerModel: "veo3.1_fast",
    label: "Veo 3.1 Fast",
    tier: "balanced",
    modes: Object.freeze(["text-to-video", "image-to-video"]),
    resolutions: Object.freeze(["720p", "1080p"]),
    maxDurationSeconds: 8,
    audio: true,
    pricing: Object.freeze({
      kind: "audioAware",
      creditsPerSecond: 10,
      creditsPerSecondWithAudio: 15
    })
  }),
  "runway:veo3.1": Object.freeze({
    id: "runway:veo3.1",
    provider: "runway",
    providerModel: "veo3.1",
    label: "Veo 3.1",
    tier: "quality",
    modes: Object.freeze(["text-to-video", "image-to-video"]),
    resolutions: Object.freeze(["720p", "1080p"]),
    maxDurationSeconds: 8,
    audio: true,
    pricing: Object.freeze({
      kind: "audioAware",
      creditsPerSecond: 20,
      creditsPerSecondWithAudio: 40
    })
  }),
  "runway:wan3": Object.freeze({
    id: "runway:wan3",
    provider: "runway",
    providerModel: "wan3",
    label: "WAN 3.0",
    tier: "economy",
    modes: Object.freeze(["text-to-video", "image-to-video"]),
    resolutions: Object.freeze(["480p", "720p", "1080p"]),
    maxDurationSeconds: 15,
    audio: false,
    pricing: Object.freeze({
      kind: "resolutionPerSecond",
      creditsPerSecond: Object.freeze({ "480p": 5, "720p": 10, "1080p": 20 })
    })
  }),
  "local:wan": Object.freeze({
    id: "local:wan",
    provider: "local",
    providerModel: "wan",
    label: "WAN Local",
    tier: "local",
    modes: Object.freeze(["text-to-video", "image-to-video"]),
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSeconds: 15,
    audio: false,
    pricing: Object.freeze({ kind: "local" })
  })
});

function getModel(id) {
  return MODELS[String(id || "")] || null;
}

function listModels() {
  return Object.values(MODELS).map(model => ({ ...model }));
}

module.exports = {
  PRICING_SNAPSHOT,
  MODELS,
  getModel,
  listModels
};
