"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const discovery = fs.readFileSync(path.join(root, "renderer", "core-media-discovery.js"), "utf8");
const i18n = fs.readFileSync(path.join(root, "renderer", "i18n.js"), "utf8");

const closeCancel = main.indexOf("mediaDesktopController?.cancelAll()");
const closeDrain = main.indexOf("await waitForWorkToStop();");
assert(closeCancel >= 0 && closeCancel < closeDrain, "confirmed close must cancel media work before drain wait");

assert(discovery.includes("addAcquiredAsset(rawAsset, expectedProjectId)"));
assert(discovery.includes("currentProjectId() !== expectedProjectId"), "completion must verify originating project before mutating state");
assert(discovery.includes('error: "MEDIA_PROJECT_CHANGED"'));
assert(discovery.includes("acquisitionErrorKey(active.error)"), "download failures must use stable actionable copy mapping");

for (const key of [
  "acquisitionDiskBody",
  "acquisitionDestinationBody",
  "acquisitionSourceBody",
  "acquisitionVerifyBody",
  "acquisitionDuplicateBody",
  "acquisitionAuthBody",
  "acquisitionDownloadBody",
  "acquisitionProjectChangedBody"
]) {
  const matches = i18n.match(new RegExp(key + ":", "g")) || [];
  assert.strictEqual(matches.length, 2, `${key} must exist in VI and EN catalogs`);
}

console.log("PR #38 close cancellation, project binding and acquisition recovery-copy regressions passed.");
