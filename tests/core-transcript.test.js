"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-transcript-model");
const playerModel = require("../renderer/core-player-model");

const root = path.resolve(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "renderer", "core-transcript-state.js"), "utf8");
const workstation = fs.readFileSync(path.join(root, "renderer", "core-transcript-workstation.js"), "utf8");
const workstationCss = fs.readFileSync(path.join(root, "renderer", "core-transcript-workstation.css"), "utf8");
const player = fs.readFileSync(path.join(root, "renderer", "core-player.js"), "utf8");
const workflow = fs.readFileSync(path.join(root, "renderer", "core-workflow.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

const source = {
  sourcePath: "C:/video.mp4",
  text: "hello world",
  segments: [
    {
      id: "s1",
      start: 1.25,
      end: 2.75,
      text: "hello",
      speaker: "S1",
      voice: "alloy",
      translatedText: "xin chao",
      status: "ready"
    },
    {
      id: "s2",
      start: 3,
      end: 4,
      text: "world"
    }
  ]
};

const normalized = model.normalizeDocument(source);
assert.strictEqual(normalized.segments[0].sourceText, "hello");
assert.strictEqual(normalized.segments[0].translatedText, "xin chao");
assert.strictEqual(normalized.segments[0].speaker, "S1");
assert.strictEqual(normalized.segments[0].voice, "alloy");
assert.strictEqual(normalized.text, "hello world");

const edited = model.applySourceEdit(source, {
  segmentId: "s1",
  start: 99,
  text: "hello edited"
});
assert.strictEqual(edited.changed, true);
assert.strictEqual(edited.result.segments[0].start, 1.25, "editing text must preserve start timestamp");
assert.strictEqual(edited.result.segments[0].end, 2.75, "editing text must preserve end timestamp");
assert.strictEqual(edited.result.segments[0].speaker, "S1", "editing text must preserve speaker");
assert.strictEqual(edited.result.segments[0].voice, "alloy", "editing text must preserve voice assignment");
assert.strictEqual(edited.result.segments[0].translatedText, "xin chao", "editor model may retain translated text while downstream state is marked stale");
assert.strictEqual(edited.result.segments[0].status, "source-edited");
assert.strictEqual(edited.result.text, "hello edited world");

const reopened = model.normalizeDocument(JSON.parse(JSON.stringify(edited.result)));
assert.strictEqual(reopened.segments[0].sourceText, "hello edited", "edited text must survive project reopen");
assert.strictEqual(reopened.segments[0].start, 1.25, "start timestamp must survive project reopen");
assert.strictEqual(reopened.segments[0].end, 2.75, "end timestamp must survive project reopen");
assert.strictEqual(reopened.segments[0].speaker, "S1", "speaker must survive project reopen");
assert.strictEqual(reopened.segments[0].voice, "alloy", "voice assignment must survive project reopen");
assert.strictEqual(reopened.segments[0].translatedText, "xin chao", "translated text field must survive project reopen");
assert.strictEqual(reopened.segments[0].status, "source-edited", "segment status must survive project reopen");

const same = model.applySourceEdit(edited.result, { segmentId: "s1", text: "hello edited" });
assert.strictEqual(same.changed, false);

const byStart = model.applySourceEdit(source, { start: 3.005, text: "world edited" });
assert.strictEqual(byStart.changed, true);
assert.strictEqual(byStart.result.segments[1].text, "world edited");
assert.strictEqual(byStart.result.segments[1].start, 3);
assert.strictEqual(byStart.result.segments[1].end, 4);

// Long-form regression: 1,800 segments (~90 minutes) must normalize and remain addressable.
const longSource = {
  sourcePath: "C:/long-video.mp4",
  segments: Array.from({ length: 1800 }, (_, index) => ({
    id: "long-" + index,
    start: index * 3,
    end: (index + 1) * 3,
    text: "Segment " + index,
    translatedText: "Bản dịch " + index,
    speaker: "S" + ((index % 3) + 1),
    voice: index % 2 ? "voice-b" : "voice-a"
  }))
};
const longNormalized = model.normalizeDocument(longSource);
assert.strictEqual(longNormalized.segments.length, 1800, "long transcript must never be truncated to a demo-sized subset");
assert.strictEqual(longNormalized.segments[1799].start, 5397);
assert.strictEqual(longNormalized.segments[1799].end, 5400);
assert.strictEqual(playerModel.activeSegmentIndex(longNormalized.segments, 5399.5), 1799, "playback highlighting must remain correct near the end of a long video");
const longEdit = model.applySourceEdit(longNormalized, { segmentId: "long-1200", text: "Edited deep segment" });
assert.strictEqual(longEdit.result.segments.length, 1800);
assert.strictEqual(longEdit.result.segments[1200].start, 3600, "deep transcript edit must preserve timing");
assert.strictEqual(longEdit.result.segments[1200].end, 3603, "deep transcript edit must preserve end timing");
assert.strictEqual(longEdit.result.segments[1200].speaker, "S1", "deep transcript edit must preserve speaker metadata");
assert.strictEqual(longEdit.result.segments[1200].voice, "voice-a", "deep transcript edit must preserve voice metadata");

for (const required of [
  "current.speech.result = applied.result",
  "current.translation.result = null",
  "current.translation.job = null",
  "current.voice.result = null",
  "current.voice.job = null",
  'status: "stale"',
  "persistState()",
  "viral-ai:core-state-changed"
]) {
  assert(bridge.includes(required), "Transcript state bridge is missing: " + required);
}

for (const required of [
  "translationLookup",
  "translatedTextFor",
  "segments.forEach",
  "list.replaceChildren(fragment)",
  "data-core-transcript-workstation",
  "list.contains(document.activeElement)",
  "MutationObserver",
  "requestAnimationFrame",
  "viral-ai:core-state-changed",
  "viral-ai:transcript-workstation-ready"
]) {
  assert(workstation.includes(required), "Transcript workstation is missing: " + required);
}
assert(!workstation.includes("setInterval("), "Transcript workstation must be event-driven, never polling.");
assert(!workstation.includes("segments.slice("), "Transcript workstation must render the complete transcript without demo limits.");
assert(!workstation.includes("render()"), "Transcript workstation must not trigger a full app render/video replacement.");

for (const required of [
  ".core-transcript-workstation-head",
  ".core-transcript-row.is-active",
  ".core-transcript-time",
  "font-variant-numeric:tabular-nums",
  ".core-transcript-source p[contenteditable]:focus",
  ".core-transcript-translation-text",
  "max-height:min(48vh,560px)",
  "overflow:auto",
  "scrollbar-gutter:stable",
  'html[data-motion="reduced"].core-editor-premium'
]) {
  assert(workstationCss.includes(required), "Transcript workstation CSS is missing: " + required);
}
assert(!workstationCss.includes("@keyframes"), "Transcript workstation must not add decorative animation loops.");

for (const required of [
  "seekVideo(activeVideo, Number(row.dataset.start || 0))",
  "model.activeSegmentIndex",
  "row.classList.toggle(\"is-active\", active)",
  "activeRow.scrollIntoView",
  'paragraph.setAttribute("contenteditable", "plaintext-only")',
  "viral-ai:transcript-edit",
  "video.currentTime is the single source of truth"
]) {
  assert(player.includes(required), "Transcript/player integration is missing: " + required);
}

assert(!bridge.includes("render()"), "Transcript text edits must not trigger a full UI render/video reload.");
assert(workflow.includes('window.addEventListener("viral-ai:core-state-changed", queueRefresh)'), "Workflow must refresh immediately after transcript state changes.");
assert(index.includes('src="core-transcript-model.js"'));
assert(index.includes('src="core-transcript-state.js"'));
assert(index.includes('src="core-transcript-workstation.js"'));
assert(index.includes('href="core-transcript-workstation.css"'));
assert(index.indexOf('src="core-transcript-state.js"') < index.indexOf('src="core-transcript-workstation.js"'), "Transcript projection must load after persistence bridge.");

console.log("Core transcript workstation, long-form editing, state invalidation and timing tests passed.");
