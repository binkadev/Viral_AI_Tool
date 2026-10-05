"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-editor-model");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-editor.css"), "utf8");
const stabilityCss = fs.readFileSync(path.join(root, "renderer", "core-editor-stability.css"), "utf8");
const ui = fs.readFileSync(path.join(root, "renderer", "core-editor.js"), "utf8");
const stabilityUi = fs.readFileSync(path.join(root, "renderer", "core-editor-stability.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

function closeTo(actual, expected, epsilon = 0.001) {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
}

// Landscape in landscape preview: entire frame fits without crop.
{
  const rect = model.containRect(1280, 720, 1920, 1080);
  closeTo(rect.width, 1280);
  closeTo(rect.height, 720);
  closeTo(rect.x, 0);
  closeTo(rect.y, 0);
}

// Portrait in landscape preview: pillarbox, never crop.
{
  const rect = model.containRect(1280, 720, 1080, 1920);
  closeTo(rect.height, 720);
  assert(rect.width < 720);
  assert(rect.x > 0);
  closeTo(rect.y, 0);
}

// Square in landscape preview: pillarbox, never distort.
{
  const rect = model.containRect(1280, 720, 1080, 1080);
  closeTo(rect.width, 720);
  closeTo(rect.height, 720);
  closeTo(rect.x, 280);
}

// Resizing preserves contain geometry and ratio.
{
  const a = model.containRect(900, 500, 1920, 1080);
  const b = model.containRect(1500, 800, 1920, 1080);
  const portrait = model.containRect(640, 900, 1080, 1920);
  closeTo(a.width / a.height, 16 / 9);
  closeTo(b.width / b.height, 16 / 9);
  closeTo(portrait.width / portrait.height, 9 / 16);
  assert(a.width <= 900 && a.height <= 500);
  assert(b.width <= 1500 && b.height <= 800);
  assert(portrait.width <= 640 && portrait.height <= 900);
}

// Playback clock is clamped and transcript highlight follows actual speech only.
{
  const segments = [
    { start: 1, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 8 }
  ];
  assert.strictEqual(model.findActiveSegmentIndex(segments, 0), -1);
  assert.strictEqual(model.findActiveSegmentIndex(segments, 1), 0);
  assert.strictEqual(model.findActiveSegmentIndex(segments, 2.5), -1);
  assert.strictEqual(model.findActiveSegmentIndex(segments, 4), 1);
  assert.strictEqual(model.findActiveSegmentIndex(segments, 7.9), 2);
  assert.strictEqual(model.findActiveSegmentIndex(segments, 9), -1);
  assert.strictEqual(model.clampTime(-3, 10), 0);
  assert.strictEqual(model.clampTime(30, 10), 10);
  assert.strictEqual(model.clampTime(3599.99, 7200), 3599.99);
}

// Editor data model preserves timing while combining source/translation/speaker/voice.
{
  const rows = model.normalizeSegments(
    { segments: [{ id: "a", start: 1.25, end: 3.5, text: "hello", speaker: "spk-1" }] },
    { segments: [{ id: "a", start: 1.25, end: 3.5, text: "xin chào", speaker: "spk-1" }] },
    { "spk-1": "voice-a" }
  );
  assert.deepStrictEqual(rows[0], {
    id: "a",
    index: 0,
    sourceText: "hello",
    translatedText: "xin chào",
    start: 1.25,
    end: 3.5,
    speaker: "spk-1",
    voice: "voice-a",
    status: "localized"
  });
}

// Workflow gating reflects real prerequisites instead of fake clickable actions.
{
  const source = {
    sourcePath: "C:/video.mp4",
    fileState: "available",
    mediaState: "ready",
    meta: { duration: 30, width: 1920, height: 1080 }
  };
  let workflow = model.deriveWorkflow({ source, jobs: [] });
  assert.strictEqual(workflow.can.transcribe, true);
  assert.strictEqual(workflow.can.translate, false);
  assert.strictEqual(workflow.can.voice, false);
  assert.strictEqual(workflow.can.render, false);

  const speechResult = { text: "hello", segments: [{ id: "1", start: 0, end: 1, text: "hello" }] };
  workflow = model.deriveWorkflow({ source, speechResult, jobs: [] });
  assert.strictEqual(workflow.can.translate, true);
  assert.strictEqual(workflow.can.voice, false);

  const translationResult = { segments: [{ id: "1", start: 0, end: 1, text: "xin chào" }] };
  workflow = model.deriveWorkflow({ source, speechResult, translationResult, jobs: [] });
  assert.strictEqual(workflow.can.voice, true);
  assert.strictEqual(workflow.can.render, false);

  const voiceResult = { segments: [{ id: "1", start: 0, end: 1, text: "xin chào", audioPath: "C:/voice.wav" }] };
  workflow = model.deriveWorkflow({ source, speechResult, translationResult, voiceResult, jobs: [] });
  assert.strictEqual(workflow.can.render, true);

  // A source edit makes localization stale; voice/render must lock until re-run.
  workflow = model.deriveWorkflow({
    source,
    speechResult,
    translationResult,
    voiceResult,
    translationStale: true,
    voiceStale: true,
    jobs: []
  });
  assert.strictEqual(workflow.localized, false);
  assert.strictEqual(workflow.can.voice, false);
  assert.strictEqual(workflow.can.render, false);
  assert.strictEqual(workflow.steps.find(step => step.id === "localize").status, "stale");

  // Missing/deleted source blocks analyze and transcription even if metadata remains.
  workflow = model.deriveWorkflow({
    source: { ...source, fileState: "missing" },
    speechResult,
    jobs: []
  });
  assert.strictEqual(workflow.imported, false);
  assert.strictEqual(workflow.can.analyze, false);
  assert.strictEqual(workflow.can.transcribe, false);
}

// Old completed renders can be invalidated without deleting them from history.
{
  const jobs = [{
    isRenderOutput: true,
    sourcePath: "C:/video.mp4",
    outputPath: "C:/out.mp4",
    status: "completed",
    fileState: "available",
    stale: true
  }];
  assert.strictEqual(model.completedRenderForSource(jobs, "C:/video.mp4"), null);
}

// Static browser contracts: contain-first rendering, one playback clock, seek both ways,
// fullscreen preview, transcript editing without recreating the player.
assert(css.includes("object-fit:contain !important"));
assert(css.includes("transform:none !important"));
assert(css.includes("background:#080b12"));
assert(stabilityCss.includes("object-fit:contain !important"));
assert(stabilityCss.includes("scale:1 !important"));
assert(ui.includes('video.addEventListener("timeupdate", update)'));
assert(ui.includes('seek.addEventListener("input"'));
assert(ui.includes('data-segment-start'));
assert(ui.includes('seekTo(video'));
assert(ui.includes('requestFullscreen'));
assert(ui.includes('field.addEventListener("input"'));
assert(ui.includes('field.addEventListener("blur"'));

// Stability layer captures blur before the legacy handler, invalidates downstream
// state in-place and never calls render(), so editing text cannot recreate video.
assert(stabilityUi.includes('document.addEventListener("blur"'));
assert(stabilityUi.includes('event.stopImmediatePropagation()'));
assert(stabilityUi.includes('markRenderedOutputsStale'));
assert(stabilityUi.includes('Model.findActiveSegmentIndex(segments, currentTime)'));
assert(!stabilityUi.includes("render();"));

assert(index.includes('core-editor.css'));
assert(index.includes('core-editor-stability.css'));
assert(index.includes('core-editor-model.js'));
assert(index.includes('core-editor.js'));
assert(index.includes('core-editor-stability.js'));

console.log("Core editor player, workflow and transcript tests passed.");
