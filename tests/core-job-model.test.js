"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const jobs = require("../renderer/core-job-model");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const workflowModel = fs.readFileSync(path.join(root, "renderer", "core-workflow-model.js"), "utf8");

const cases = [
  [null, "idle", false, false],
  ["validating", "preparing", true, false],
  ["preparing", "preparing", true, false],
  ["uploading", "uploading", true, false],
  ["queued", "processing", true, false],
  ["processing", "processing", true, false],
  ["translating", "processing", true, false],
  ["generating", "processing", true, false],
  ["rendering", "processing", true, false],
  ["cancelling", "processing", true, false],
  ["completed", "completed", false, true],
  ["failed", "failed", false, true],
  ["interrupted", "failed", false, true],
  ["stale", "failed", false, true],
  ["cancelled", "cancelled", false, true]
];

for (const [input, expectedState, busy, terminal] of cases) {
  const described = jobs.describe(input);
  assert.strictEqual(described.state, expectedState, String(input));
  assert.strictEqual(described.busy, busy, String(input));
  assert.strictEqual(described.terminal, terminal, String(input));
}

assert.strictEqual(jobs.describe("failed").retryable, true);
assert.strictEqual(jobs.describe("cancelled").retryable, true);
assert.strictEqual(jobs.describe("completed").successful, true);
assert.strictEqual(jobs.isBusy({ status: "uploading" }), true);
assert.strictEqual(jobs.isBusy({ status: "completed" }), false);

assert(index.includes('src="core-job-model.js"'));
assert(workflowModel.includes('require("./core-job-model")'));
assert(workflowModel.includes("jobModel?.isBusy"));

console.log("Reusable core async job state tests passed.");
