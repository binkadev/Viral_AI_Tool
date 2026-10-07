"use strict";

const assert = require("assert");
const model = require("../renderer/core-workflow-model");

const source = {
  id: "source-1",
  sourcePath: "C:/source.mp4",
  fileState: "available",
  status: "completed",
  meta: { duration: 20, width: 1920, height: 1080 }
};
const speech = { sourcePath: source.sourcePath, segments: [{ id:"s1", start:0, end:2, text:"hello" }] };
const translation = { sourcePath: source.sourcePath, segments: [{ id:"s1", start:0, end:2, text:"xin chao" }] };
const voice = { sourcePath: source.sourcePath, segments: [{ id:"s1", start:0, end:2, audioPath:"C:/voice/s1.wav" }] };
const base = { jobs:[source], speech:{result:speech}, translation:{result:translation}, voice:{result:voice} };

const availableOutput = {
  id:"render-ok",
  isRenderOutput:true,
  sourcePath:source.sourcePath,
  outputPath:"C:/output.mp4",
  status:"completed",
  fileState:"available"
};
let derived = model.derive({ ...base, jobs:[source, availableOutput] });
assert.strictEqual(derived.renderOutput, availableOutput);
assert.strictEqual(derived.renderOutputMissing, false);
assert.strictEqual(derived.stages[5].status, "completed");
assert.strictEqual(derived.controls.export.enabled, true);

for (const fileState of ["missing", "trashed"]) {
  const unavailable = { ...availableOutput, id:"render-" + fileState, fileState };
  derived = model.derive({ ...base, jobs:[source, unavailable] });
  assert.strictEqual(derived.renderOutput, null, fileState + " output must not count as a render output");
  assert.strictEqual(derived.renderOutputMissing, true);
  assert.strictEqual(derived.stages[5].status, "active");
  assert.strictEqual(derived.controls.render.enabled, true);
  assert.strictEqual(derived.controls.export.enabled, false);
  assert(derived.controls.export.reason.includes("không còn khả dụng"));
  assert.strictEqual(derived.jobs.render, "active");
}

const missingSource = { ...source, fileState:"trashed" };
derived = model.derive({ ...base, jobs:[missingSource, availableOutput] });
assert.strictEqual(derived.missingSource, true);
assert.strictEqual(derived.controls.render.enabled, false);

console.log("Render output integrity tests passed");
