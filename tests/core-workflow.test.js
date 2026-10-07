"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../renderer/core-workflow-model");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, "renderer", "core-workflow.js"), "utf8");
const workflowMotion = fs.readFileSync(path.join(root, "renderer", "core-workflow-motion.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-workflow.css"), "utf8");
const premiumInteractions = fs.readFileSync(path.join(root, "renderer", "core-premium-interactions.css"), "utf8");
const startup = fs.readFileSync(path.join(root, "renderer", "core-startup-experience.js"), "utf8");
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
assert.strictEqual(derived.stages[4].status, "active");
assert.strictEqual(derived.stages[5].status, "blocked");
assert.strictEqual(derived.controls.voice.enabled, true);
assert.strictEqual(derived.controls.render.enabled, false);
assert(derived.controls.render.reason.includes("AI Voice"));
assert.strictEqual(derived.controls.export.enabled, false);

const voiced = {
  sourcePath: source.sourcePath,
  segments: [{ id: "s1", start: 0, end: 2, text: "xin chao", audioPath: "C:/voice/s1.wav" }]
};
derived = model.derive({
  jobs: [source],
  speech: { result: transcript },
  translation: { result: translated },
  voice: { result: voiced }
});
assert.strictEqual(derived.stages[4].status, "completed");
assert.strictEqual(derived.stages[5].status, "active");
assert.strictEqual(derived.controls.render.enabled, true);

const rendering = {
  id: "render-working",
  isRenderOutput: true,
  sourcePath: source.sourcePath,
  outputPath: "C:/output.partial.mp4",
  status: "processing"
};
derived = model.derive({
  jobs: [source, rendering],
  speech: { result: transcript },
  translation: { result: translated },
  voice: { result: voiced }
});
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
derived = model.derive({
  jobs: [source, output],
  speech: { result: transcript },
  translation: { result: translated },
  voice: { result: voiced }
});
assert.strictEqual(derived.stages[5].status, "completed");
assert.strictEqual(derived.controls.export.enabled, true);

const failedRender = { ...output, id: "render-failed", status: "failed" };
derived = model.derive({
  jobs: [source, failedRender],
  speech: { result: transcript },
  translation: { result: translated },
  voice: { result: voiced }
});
assert.strictEqual(derived.jobs.render, "failed");
assert.strictEqual(derived.stages[5].status, "failed");
assert.strictEqual(derived.controls.export.enabled, false);

const missing = { ...source, fileState: "missing" };
derived = model.derive({
  jobs: [missing],
  speech: { result: transcript },
  translation: { result: translated },
  voice: { result: voiced }
});
assert.strictEqual(derived.stages[0].status, "failed");
assert.strictEqual(derived.controls.speech.enabled, false);
assert.strictEqual(derived.controls.render.enabled, false);

assert.doesNotThrow(() => new Function(workflow), "Core workflow UI script must parse.");
assert.doesNotThrow(() => new Function(workflowMotion), "Core workflow motion script must parse.");
assert.doesNotThrow(() => new Function(startup), "Startup transition script must parse.");

for (const selector of ["#speechStart", "#translationStart", "#voiceStart", "#render", "#export"]) {
  assert(workflow.includes(selector), "Core workflow must gate " + selector);
}
assert(!workflow.includes('document.querySelector(".command-palette")'), "Core workflow must not treat the functional Quick Switcher as a placeholder.");
assert(!workflow.includes("markComingSoon"), "Legacy workflow refreshes must not disable functional shell controls.");
assert(workflow.includes('event.stopImmediatePropagation()'), "Quick project must not fall through to the legacy AI-video route.");
assert(workflow.includes('import: "IMPORT"'), "English workflow stage labels must be explicit.");
assert(workflow.includes('import: "NHẬP"'), "Vietnamese workflow stage labels must be explicit.");
assert(workflow.includes("stageReason(stage, derived, c)"), "Workflow stage reasons must be localized in the UI layer.");
assert(workflow.includes('controlReason("render"'), "Disabled render guidance must be localized in the UI layer.");
assert(workflow.includes("workflowPosition(derived.stages)"), "Workflow rail must derive a real stage position.");
assert(workflow.includes("contiguousCompleted"), "Workflow progress must only count completed stages that are contiguous from the start.");
assert(workflow.includes('class="core-workflow-progress"'), "Workflow rail must expose completed-stage progress.");
assert(!workflow.includes("progressPercent"), "Workflow header must not expose a misleading completion percentage.");
assert(workflow.includes('aria-current="step"'), "The active workflow stage must be exposed accessibly.");
assert(workflow.includes("lastRailMarkup"), "Workflow refreshes must avoid unnecessary DOM replacement.");

assert(workflowMotion.includes("lastProgress"), "Workflow motion must preserve the previous visual position.");
assert(workflowMotion.includes("requestAnimationFrame"), "Workflow progress changes must animate after layout settles.");
assert(workflowMotion.includes('style.setProperty("--workflow-progress"'), "Workflow motion must drive the continuous progress track.");

assert(startup.includes("lastPageKey"), "Page transitions must deduplicate same-page rerenders.");
assert(startup.includes("nextPageKey === lastPageKey"), "Same-page state updates must not replay navigation motion.");
assert(!premiumInteractions.includes("from { opacity:0"), "Navigation refinement must not fade the entire page from zero opacity.");
assert(premiumInteractions.includes("#page.core-page-enter::before"), "Navigation changes need a non-blocking premium signal.");
assert(premiumInteractions.includes(".core-workflow-rail::after"), "Workflow rail must render a continuous progress layer.");
assert(premiumInteractions.includes("workflowNodeBreath"), "Active stages need restrained state motion.");
assert(premiumInteractions.includes("workflowSpinner"), "Processing stages need a dedicated spinner.");
assert(premiumInteractions.includes("white-space:normal"), "Localized workflow labels must be allowed to wrap.");
assert(!premiumInteractions.includes("text-overflow:ellipsis"), "Workflow labels must not be truncated with ellipsis.");

assert(!coreEditorCss.includes('[data-page="ai-video"]'), "The production Core Editor route must remain visible.");
assert(coreEditorCss.includes('[data-page="workflow"]'), "Workflow Builder entry points must stay out of the core UI pass.");
assert(css.includes(".core-workflow-stage.is-failed"));
assert(css.includes("button.core-gated:disabled"));
assert(index.includes('href="core-workflow.css"'));
assert(index.includes('href="core-premium-interactions.css"'));
assert(index.indexOf('href="core-premium-interactions.css"') > index.indexOf('href="core-premium-hud.css"'), "Interaction refinements must load after the HUD layer.");
assert(index.includes('src="core-workflow-model.js"'));
assert(index.includes('src="core-workflow.js"'));
assert(index.includes('src="core-workflow-motion.js"'));
assert(index.indexOf('src="core-workflow-motion.js"') > index.indexOf('src="core-workflow.js"'), "Workflow motion must load after workflow rendering.");

console.log("Core workflow and premium interaction tests passed.");
