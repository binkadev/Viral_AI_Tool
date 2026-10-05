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

const same = model.applySourceEdit(edited.result, { segmentId: "s1", text: "hello edited" });
assert.strictEqual(same.changed, false);

const byStart = model.applySourceEdit(source, { start: 3.005, text: "world edited" });
assert.strictEqual(byStart.changed, true);
assert.strictEqual(byStart.result.segments[1].text, "world edited");
assert.strictEqual(byStart.result.segments[1].start, 3);
assert.strictEqual(byStart.result.segments[1].end, 4);

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

assert(!bridge.includes("render()"), "Transcript text edits must not trigger a full UI render/video reload.");
assert(workflow.includes('window.addEventListener("viral-ai:core-state-changed", queueRefresh)'), "Workflow must refresh immediately after transcript state changes.");
assert(index.includes('src="core-transcript-model.js"'));
assert(index.includes('src="core-transcript-state.js"'));

console.log("Core transcript edit model and state invalidation tests passed.");
