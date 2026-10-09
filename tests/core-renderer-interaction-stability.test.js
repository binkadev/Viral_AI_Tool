"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "renderer", file), "utf8");

const workstation = read("core-player-workstation.js");
const assets = read("core-editor-assets.js");
const layout = read("core-layout.js");
const rebind = read("core-player-rebind.js");
const commercialUx = read("core-editor-commercial-ux.js");

for (const [name, source] of [
  ["core-player-workstation.js", workstation],
  ["core-editor-assets.js", assets],
  ["core-layout.js", layout],
  ["core-player-rebind.js", rebind],
  ["core-editor-commercial-ux.js", commercialUx]
]) {
  assert.doesNotThrow(() => new Function(source), name + " must parse.");
  assert(source.includes("setTextIfChanged") || source.includes("setAttrIfChanged"), name + " must use idempotent DOM writes around observed surfaces.");
}

assert(workstation.includes("button.dataset.coreVolumeIcon !== iconState"), "Player workstation must not rebuild its SVG on every observer scan.");
assert(!workstation.includes('button.innerHTML = volumeIcon(silent);\n      button.setAttribute'), "Player workstation must not unconditionally mutate childList from its observer scan.");

for (const unsafe of [
  "name.textContent = basename(sourceName)",
  "meta.textContent = dimensions +",
  "transcriptStatus.textContent ="
]) {
  assert(!assets.includes(unsafe), "Asset panel must not unconditionally write observed text: " + unsafe);
}
assert(assets.includes("setTextIfChanged(name"));
assert(assets.includes("setTextIfChanged(meta"));
assert(assets.includes("setTextIfChanged(transcriptStatus"));

assert(!layout.includes('button.textContent = collapsed ? "⇤" : "⇥"'), "Layout observer must not rewrite toggle text on every pass.");
assert(layout.includes('setTextIfChanged(button, collapsed ? "⇤" : "⇥")'));

assert(!rebind.includes('time.textContent = duration > 0'), "Player rebind must not rewrite time labels on every observer pass.");
assert(rebind.includes("setTextIfChanged(time, nextTime)"));

assert(!commercialUx.includes("if (text) text.textContent = c.ready"), "Commercial connection status must not rewrite observed text each frame.");
assert(!commercialUx.includes("if (text) text.textContent = c.needsSetup"), "Commercial setup status must not rewrite observed text each frame.");
assert(commercialUx.includes("setTextIfChanged(text, c.ready)"));
assert(commercialUx.includes("setTextIfChanged(text, c.needsSetup)"));
assert(commercialUx.includes("setDatasetIfChanged"), "Commercial UX must avoid repeated observed dataset writes.");

console.log("Renderer interaction observers are mutation-safe and will not starve click handling.");
