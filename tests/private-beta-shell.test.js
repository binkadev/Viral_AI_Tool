"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const model = require("../renderer/core-private-beta-model");
test("private beta has exactly seven canonical primary destinations", () => {
  assert.deepEqual([...model.primary], ["home", "ai-create", "generation-progress", "library", "productions", "batch-production", "settings"]);
  for (const route of ["download", "ai-video", "accounts", "usage", "billing"]) assert(!model.primary.has(route));
});
test("stale routes fall back safely while actual media and contextual import remain accessible", () => {
  assert.equal(model.route("ai-video"), "home"); assert.equal(model.route("download"), "home");
  assert.equal(model.route("accounts"), "home"); assert.equal(model.route("billing"), "settings"); assert.equal(model.route("usage"), "settings");
  assert.equal(model.route("ai-video", { source: true }), "ai-video"); assert.equal(model.route("download", { contextualImport: true }), "download");
});
test("Later and repeated checks cannot spam the same release notification", () => {
  const notify = model.notificationSession();
  assert.equal(notify({ status: "checking" }), false);
  assert.equal(notify({ status: "available", availableVersion: "0.14.1-beta.3" }), true);
  assert.equal(notify({ status: "available", availableVersion: "0.14.1-beta.3" }), false);
  assert.equal(notify({ status: "downloaded", availableVersion: "0.14.1-beta.3" }), false);
});
test("all update text including error codes has matching VI/EN keys and natural Unicode", () => {
  const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync("renderer/i18n.js", "utf8"), c);
  const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([key, value]) => typeof value === "object" ? flatten(value, prefix + key + ".") : [prefix + key]);
  const messages = c.window.I18N.messages;
  assert.deepEqual(flatten(messages.vi.betaUpdates), flatten(messages.en.betaUpdates));
  for (const locale of ["vi", "en"]) for (const key of flatten(messages[locale].betaUpdates)) {
    const value = c.window.I18N.t(locale, "betaUpdates." + key); assert(value.length); assert(!value.includes("\ufffd")); assert(!/FFmpeg|electron-updater|GitHub|stack trace/.test(value));
  }
  assert.equal(messages.vi.betaUpdates.title, "Cập nhật");
});
