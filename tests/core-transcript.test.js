"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-transcript-model");

const root = path.resolve(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "renderer", "core-transcript-state.js"), "utf8");
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

const longSource = {
  sourcePath: "C:/long-video.mp4",
  segments: Array.from({ length: 1800 }, (_, index) => ({
    id: "long-" + index,
    start: index * 2.5,
    end: index * 2.5 + 2.25,
    text: "Segment " + index,
    translatedText: "Bản dịch " + index,
    speaker: index % 2 ? "S2" : "S1"
  }))
};
const longNormalized = model.normalizeDocument(longSource);
assert.strictEqual(longNormalized.segments.length, 1800, "long-form transcripts must keep every segment");
const longEdited = model.applySourceEdit(longNormalized, { segmentId: "long-1799", text: "Final segment edited" });
assert.strictEqual(longEdited.changed, true);
assert.strictEqual(longEdited.result.segments.length, 1800, "editing a long transcript must not truncate segments");
assert.strictEqual(longEdited.result.segments[1799].start, 4497.5, "long transcript timing must remain intact");
assert.strictEqual(longEdited.result.segments[1799].end, 4499.75, "long transcript end timing must remain intact");
assert.strictEqual(longEdited.result.segments[1799].speaker, "S2", "long transcript metadata must remain intact");

for (const required of [
  "current.speech.result = applied.result",
  "function archiveStale",
  'archiveStale(current?.translation, "result", "staleResult"',
  'archiveStale(current?.translation, "job", "staleJob"',
  'archiveStale(current?.voice, "result", "staleResult"',
  'archiveStale(current?.voice, "job", "staleJob"',
  'status: "stale"',
  'staleReason: reason',
  'status: "failed"',
  "stale: true",
  '"source-transcript-edited"',
  "persistState()",
  "viral-ai:core-state-changed"
]) {
  assert(bridge.includes(required), "Transcript state bridge is missing: " + required);
}

assert(bridge.includes("bucket[archiveKey] = stale"), "Stale translation/voice data must remain archived for recovery/audit.");
assert(bridge.includes("bucket[activeKey] = null"), "Stale translation/voice data must leave active production action paths.");
assert(!bridge.includes('status: "stale",\n        staleReason: "transcript-edited"'), "Render jobs must use an existing localized status while retaining stale metadata.");
assert(!bridge.includes("render()"), "Transcript text edits must not trigger a full UI render/video reload.");
assert(workflow.includes('window.addEventListener("viral-ai:core-state-changed", queueRefresh)'), "Workflow must refresh immediately after transcript state changes.");
assert(index.includes('src="core-transcript-model.js"'));
assert(index.includes('src="core-transcript-state.js"'));
assert(index.includes('src="core-transcript-workstation.js"'));

console.log("Core transcript editing, long-form timing, stale archive and reopen persistence tests passed.");
