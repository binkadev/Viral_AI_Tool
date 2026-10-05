"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-workflow-model");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, "renderer", "core-workflow.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-workflow.css"), "utf8");
const coreEditorCss = fs.readFileSync(path.join(root, "renderer", "core-editor.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

let derived = model.derive({});
assert.strictEqual(derived.stages[0].id, "import");
assert.strictEqual(derived.stages[0].status, "active");
assert.strictEqual(derived.controls.speech.enabled, false);
assert.strictEqual(derived.controls.translate.enabled, false);
assert.strictEqual(derived.controls.voice.enabled, false);
assert.strictEqual(derived.controls.render.enabled, false);
assert.strictEqual(derived.controls.export.enabled, false);

const source = {
  id: "src-1",
  sourcePath: "C:/video.mp4",
  name: "video.mp4",
  fileState: "available",
  meta: { duration: 12, width: 1920, height: 1080 },
  status: "completed"
};

derived = model.derive({ jobs: [source] });
assert.strictEqual(derived.stages[0].status, "completed");
assert.strictEqual(derived.stages[1].status, "completed");
assert.strictEqual(derived.stages[2].status, "active");
assert.strictEqual(derived.controls.speech.enabled, true);
assert.strictEqual(derived.controls.translate.enabled, false);

const transcript = {
  sourcePath: source.sourcePath,
  segments: [{ id: "s1", start: 0, end: 2, text: "hello" }]
};
derived = model.derive({ jobs: [source], speech: { result: transcript } });
assert.strictEqual(derived.stages[2].status, "completed");
assert.strictEqual(derived.stages[3].status, "active");
assert.strictEqual(derived.controls.translate.enabled, true);
assert.strictEqual(derived.controls.voice.enabled, false);

const translated = {
  sourcePath: source.sourcePath,
  segments: [{ id: "s1", start: 0, end: 2, text: "xin chao" }]
};
derived = model.derive({ jobs: [source], speech: { result: transcript }, translation: { result: translated } });
assert.strictEqual(derived.stages[4].status, "completed");
assert.strictEqual(derived.stages[5].status, "active");
assert.strictEqual(derived.controls.voice.enabled, true);
assert.strictEqual(derived.controls.render.enabled, true);
assert.strictEqual(derived.controls.export.enabled, false);

const rendering = {
  id: "render-working",
  isRenderOutput: true,
  sourcePath: source.sourcePath,
  outputPath: "C:/output.partial.mp4",
  status: "processing"
};
derived = model.derive({ jobs: [source, rendering], speech: { result: transcript }, translation: { result: translated } });
assert.strictEqual(derived.jobs.render, "processing");
assert.strictEqual(derived.stages[5].status, "processing");
assert.strictEqual(derived.controls.speech.enabled, false);
assert.strictEqual(derived.controls.translate.enabled, false);
assert.strictEqual(derived.controls.voice.enabled, false);
assert.strictEqual(derived.controls.render.enabled, false);
assert.strictEqual(derived.controls.export.enabled, false);

const output = {
  id: "render-1",
  isRenderOutput: true,
  sourcePath: source.sourcePath,
  outputPath: "C:/output.mp4",
  status: "completed"
};
derived = model.derive({ jobs: [source, output], speech: { result: transcript }, translation: { result: translated } });
assert.strictEqual(derived.stages[5].status, "completed");
assert.strictEqual(derived.controls.export.enabled, true);

const failedRender = { ...output, id: "render-failed", status: "failed" };
derived = model.derive({ jobs: [source, failedRender], speech: { result: transcript }, translation: { result: translated } });
assert.strictEqual(derived.jobs.render, "failed");
assert.strictEqual(derived.stages[5].status, "failed");
assert.strictEqual(derived.controls.export.enabled, false);

const missing = { ...source, fileState: "missing" };
derived = model.derive({ jobs: [missing], speech: { result: transcript }, translation: { result: translated } });
assert.strictEqual(derived.stages[0].status, "failed");
assert.strictEqual(derived.controls.speech.enabled, false);
assert.strictEqual(derived.controls.render.enabled, false);

for (const selector of ["#speechStart", "#translationStart", "#voiceStart", "#render", "#export"]) {
  assert(workflow.includes(selector), "Core workflow must gate " + selector);
}
assert(workflow.includes('dataset.coreCapability = "coming-soon"'), "Unimplemented controls must be labeled coming soon.");
assert(workflow.includes('event.stopImmediatePropagation()'), "Quick project must not fall through to the legacy AI-video route.");
assert(!coreEditorCss.includes('[data-page="ai-video"]'), "The production Core Editor route must remain visible.");
assert(coreEditorCss.includes('[data-page="workflow"]'), "Workflow Builder entry points must stay out of the core UI pass.");
assert(css.includes(".core-workflow-stage.is-failed"));
assert(css.includes("button.core-gated:disabled"));
assert(index.includes('href="core-workflow.css"'));
assert(index.includes('src="core-workflow-model.js"'));
assert(index.includes('src="core-workflow.js"'));

console.log("Core workflow and render gating tests passed.");
