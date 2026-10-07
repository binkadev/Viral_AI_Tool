"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-creator-home-production.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");
const creator = fs.readFileSync(path.join(root, "renderer", "core-creator-home.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Creator Home production guard must parse.");
for (const required of [
  "projectSource()",
  "job?.sourcePath && !job?.isRenderOutput",
  "current?.cloud?.auth?.authenticated === true",
  "current?.speech?.providerStatus?.local",
  'local.ready === true',
  '"Đang kiểm tra"',
  '"Cần thiết lập"',
  'current.page = "ai-video"',
  'current.page !== "download"',
  "syncStatusChips",
  "subtree:false"
]) {
  assert(js.includes(required), "Creator Home production guard missing: " + required);
}
assert(!js.includes("Boolean(current?.cloud?.account)"), "Cached account data must not imply an authenticated Cloud connection.");
assert(!/projectSource\([\s\S]*?fileState\s*!==\s*["']missing/.test(js), "A missing source is still a project and must remain recoverable in Core Editor.");
assert(creator.includes('if (current) current.page = "download"'), "Legacy startup override stays detectable until the creator module is refactored.");
assert(bootstrap.includes('core-creator-home-production.js'), "Bootstrap must load the Creator Home production guard.");
assert(bootstrap.includes("hasProjectSource"), "Bootstrap must preserve Core Editor for persisted source projects.");
assert(!js.includes("setInterval("), "Creator Home production guard must not poll.");

console.log("core Creator Home production guard tests passed");
