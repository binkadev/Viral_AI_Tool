"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const workflowModel = require("../renderer/core-workflow-model");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const workstation = read("renderer/core-transcript-workstation.js");
const css = read("renderer/core-transcript-workstation.css");
const index = read("renderer/index.html");

assert.doesNotThrow(() => new Function(workstation), "Transcript workstation module must parse.");

for (const required of [
  "context.source.segments.forEach",
  "list.replaceChildren(fragment)",
  "dataset.transcriptCount",
  "dataset.longTranscript",
  "translationAvailable",
  "translationStale",
  "translationForContext",
  "targetLanguage",
  "result?.sourcePath",
  "result?.targetLanguage",
  'typeof t === "function"',
  "window.I18N?.t?.",
  'tr("speech.resultTitle")',
  'tr("translation.resultTitle")',
  'tr("translation.translateAgain")',
  "viral-ai:player-seek",
  "currentTime",
  "pointerdown",
  "document.activeElement === source",
  "workstationSignature",
  "list.scrollTop = scrollTop",
  "segment.start",
  "segment.end",
  "segment.speaker",
  "segment.voice"
]) {
  assert(workstation.includes(required), "Transcript workstation is missing: " + required);
}

assert(!workstation.includes("segments.slice("), "Transcript workstation must not truncate long transcripts.");
assert(!workstation.includes("setInterval("), "Transcript workstation must be event-driven, not polling-based.");
assert(!workstation.includes("render()"), "Transcript workstation must not trigger a full app render/video replacement.");
assert(!workstation.includes('source: "Source"'), "Transcript workstation production copy must use the locale catalog.");
assert(!workstation.includes('source: "Nguồn"'), "Transcript workstation production copy must use the locale catalog.");
assert(!workstation.includes('translation: "Translation"'), "Transcript workstation production copy must use the locale catalog.");
assert(!workstation.includes('translation: "Bản dịch"'), "Transcript workstation production copy must use the locale catalog.");

for (const required of [
  ".core-transcript-toolbar",
  ".core-transcript-view-button",
  ".core-transcript-row.is-active",
  ".core-transcript-source",
  ".core-transcript-translation",
  "content-visibility:auto",
  "contain-intrinsic-size:64px",
  "font-variant-numeric:tabular-nums",
  "font:650 13px/1.25",
  "max-height:min(54vh,620px)!important",
  "prefers-reduced-motion",
  'html[data-motion="reduced"]'
]) {
  assert(css.includes(required), "Transcript workstation CSS is missing: " + required);
}
assert(!css.includes("@keyframes"), "Transcript workstation must not add decorative animation loops.");

assert(index.includes('href="core-transcript-workstation.css"'));
assert(index.includes('src="core-transcript-workstation.js"'));
assert(
  index.indexOf('src="core-transcript-state.js"') < index.indexOf('src="core-transcript-workstation.js"'),
  "Transcript workstation must load after transcript state ownership."
);
assert(
  index.indexOf('href="core-transcript-workstation.css"') > index.indexOf('href="core-timeline-workstation.css"'),
  "Transcript workstation styling must layer after timeline styling."
);

const staleSaved = {
  jobs: [{ sourcePath: "C:/video.mp4", meta: { duration: 120 } }],
  speech: { result: { sourcePath: "C:/video.mp4", segments: [{ id: "s1", start: 0, end: 2, text: "hello" }] } },
  translation: {
    result: { sourcePath: "C:/video.mp4", status: "stale", staleReason: "source-transcript-edited", segments: [{ id: "s1", text: "xin chao" }] },
    job: null
  },
  voice: {
    result: { sourcePath: "C:/video.mp4", status: "stale", staleReason: "source-transcript-edited" },
    job: null
  }
};
const derived = workflowModel.derive(staleSaved);
assert.strictEqual(derived.translationResult, null, "stale translation must not be treated as valid localization output");
assert.strictEqual(derived.voiceResult, null, "stale voice must not be treated as valid downstream output");
assert.strictEqual(derived.staleTranslationResult.status, "stale", "stale translation must remain available for recovery/audit");
assert.strictEqual(derived.staleVoiceResult.status, "stale", "stale voice must remain available for recovery/audit");
assert.strictEqual(derived.controls.voice.enabled, false, "stale translation must block voice generation ownership");
assert.strictEqual(derived.controls.render.enabled, false, "stale downstream data must block render ownership");
assert.strictEqual(derived.jobs.translation, "failed", "workflow must surface stale translation as non-complete");
assert.strictEqual(derived.jobs.voice, "failed", "workflow must surface stale voice as non-complete");

console.log("Long-form transcript workstation, locale and stale dependency tests passed.");
