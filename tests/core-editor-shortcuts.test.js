"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const editor = fs.readFileSync(path.join(root, "renderer", "core-editor-shortcuts.js"), "utf8");
const player = fs.readFileSync(path.join(root, "renderer", "core-player-interactions.js"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(editor), "Editor shortcuts JavaScript must parse.");
assert.doesNotThrow(() => new Function(player), "Player interactions JavaScript must parse.");

for (const token of [
  "playerOwnsEvent(event.target)",
  'event.shiftKey ? 10 : 5',
  'media.dispatchEvent(new Event("seeked"))',
  'aria-keyshortcuts", "Space K ArrowLeft ArrowRight"'
]) {
  assert(editor.includes(token), "Editor shortcut ownership missing: " + token);
}

assert(!editor.includes("Home End"), "Editor must not advertise unimplemented Home/End shortcuts.");
assert(!editor.includes("event.shiftKey ? 1 : 5"), "Shift+Arrow must not use the old inconsistent 1-second step.");

for (const token of [
  "input, textarea, select, button",
  'event.shiftKey ? -10 : -5',
  'event.shiftKey ? 10 : 5',
  'host.setAttribute("aria-keyshortcuts", "Space K ArrowLeft ArrowRight")'
]) {
  assert(player.includes(token), "Player keyboard guard missing: " + token);
}

assert(index.includes('src="core-player-interactions.js"'));
assert(index.includes('src="core-editor-shortcuts.js"'));
assert(index.indexOf('src="core-player-interactions.js"') < index.indexOf('src="core-editor-shortcuts.js"'), "Player shortcut ownership must be installed before editor-level fallback shortcuts.");

console.log("Editor and player shortcut ownership tests passed.");
