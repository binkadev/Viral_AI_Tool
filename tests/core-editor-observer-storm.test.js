"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "renderer", name), "utf8");

const mediaHealth = read("core-media-health.js");
const assets = read("core-editor-assets.js");
const bottomDock = read("core-editor-bottom-dock.js");
const activity = read("core-editor-activity.js");
const commercial = read("core-editor-commercial-ux.js");
const sourceRecovery = read("core-source-recovery.js");

for (const [name, source] of [
  ["core-media-health.js", mediaHealth],
  ["core-editor-assets.js", assets],
  ["core-editor-bottom-dock.js", bottomDock],
  ["core-editor-activity.js", activity],
  ["core-editor-commercial-ux.js", commercial],
  ["core-source-recovery.js", sourceRecovery]
]) {
  assert(source.includes("function setText("), name + " must use idempotent text writes in observer-driven UI sync");
  assert.doesNotThrow(() => new Function(source), name + " must parse");
}

assert(mediaHealth.includes("function mutationNeedsScan(records)"), "media health must filter renderer mutations before rescanning");
assert(mediaHealth.includes("if (mutationNeedsScan(records)) scan();"), "media health must ignore its own overlay text mutations");
assert(!mediaHealth.includes("const observer = new MutationObserver(scan);"), "media health must never directly rescan for every subtree mutation");

assert(assets.includes("function mutationNeedsRefresh(records)"), "assets panel must filter structural mutations");
assert(assets.includes(".core-editor-assets-panel"), "assets observer must recognize its own generated subtree");
assert(!assets.includes('new MutationObserver(queue).observe(page, { childList: true, subtree: true });'), "assets panel must not wake on every text node it updates");

assert(bottomDock.includes('{ childList: true, subtree: false }'), "bottom dock observer must be limited to direct page structure");
assert(!bottomDock.includes('if (time instanceof HTMLOutputElement) time.textContent ='), "bottom dock clock writes must be idempotent");

assert(activity.includes('{ childList: true, subtree: false }'), "activity observer must ignore its own internal progress text changes");
assert(!activity.includes('if (kicker) kicker.textContent ='), "activity labels must not blindly replace text nodes");

assert(commercial.includes("setText(text, c.ready)"), "commercial connection badge must update text idempotently");
assert(commercial.includes("setText(title, c.sourceMissingTitle)"), "commercial missing-media copy must update text idempotently");

assert(sourceRecovery.includes("setText(hint, busy ? c.relinking : c.sourceHint)"), "source recovery hint must not recreate its text node on every observer pass");

console.log("Core editor MutationObserver storm regression passed.");
