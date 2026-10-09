"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "renderer", file), "utf8");

const player = read("core-player.js");
const playerSync = read("core-player-sync.js");
const workstation = read("core-player-workstation.js");
const mediaHealth = read("core-media-health.js");
const transcript = read("core-transcript-workstation.js");
const bottomDock = read("core-editor-bottom-dock.js");
const activity = read("core-editor-activity.js");
const assets = read("core-editor-assets.js");
const layout = read("core-layout.js");
const rebind = read("core-player-rebind.js");
const commercialUx = read("core-editor-commercial-ux.js");

for (const [name, source] of [
  ["core-player.js", player],
  ["core-player-sync.js", playerSync],
  ["core-player-workstation.js", workstation],
  ["core-media-health.js", mediaHealth],
  ["core-transcript-workstation.js", transcript],
  ["core-editor-bottom-dock.js", bottomDock],
  ["core-editor-activity.js", activity],
  ["core-editor-assets.js", assets],
  ["core-layout.js", layout],
  ["core-player-rebind.js", rebind],
  ["core-editor-commercial-ux.js", commercialUx]
]) {
  assert.doesNotThrow(() => new Function(source), name + " must parse.");
  assert(source.includes("setTextIfChanged") || source.includes("setAttrIfChanged"), name + " must use idempotent DOM writes around observed surfaces.");
}

assert(!player.includes('play.textContent = video.paused ? "▶" : "❚❚"'));
assert(!player.includes('if (time) time.textContent = model.formatClock'));
assert(player.includes("setTextIfChanged(play"));
assert(player.includes("if (time) setTextIfChanged(time"));

assert(!playerSync.includes("node.textContent = duration > 0"));
assert(!playerSync.includes("bottomTime.textContent = duration > 0"));
assert(playerSync.includes("setTextIfChanged(node, timeCopy)"));
assert(playerSync.includes("setTextIfChanged(bottomTime, timeCopy)"));

assert(workstation.includes("button.dataset.coreVolumeIcon !== iconState"));
assert(!workstation.includes('button.innerHTML = volumeIcon(silent);\n      button.setAttribute'));

assert(!mediaHealth.includes("if (title) title.textContent = state ==="));
assert(mediaHealth.includes("setTextIfChanged(title"));
assert(mediaHealth.includes("setTextIfChanged(body"));

assert(!transcript.includes("if (source) source.textContent = copy.source"));
assert(!transcript.includes("if (translation) translation.textContent = copy.translation"));
assert(transcript.includes("setTextIfChanged(source, copy.source)"));

assert(!bottomDock.includes('button.textContent = collapsed ? "⌃" : "⌄"'));
assert(!bottomDock.includes('time.textContent = formatClock(current) + " / " + formatClock(duration)'));
assert(bottomDock.includes("setTextIfChanged(time"));

for (const unsafe of [
  "if (kicker) kicker.textContent = labels.title",
  "if (title) title.textContent = labels.steps",
  "if (percent) percent.textContent ="
]) assert(!activity.includes(unsafe), "Activity observer must not rewrite observed text: " + unsafe);
assert(activity.includes("setTextIfChanged(kicker"));
assert(activity.includes("setTextIfChanged(detail"));

for (const unsafe of [
  "name.textContent = basename(sourceName)",
  "meta.textContent = dimensions +",
  "transcriptStatus.textContent ="
]) assert(!assets.includes(unsafe), "Asset panel must not unconditionally write observed text: " + unsafe);
assert(assets.includes("setTextIfChanged(name"));
assert(assets.includes("setTextIfChanged(meta"));
assert(assets.includes("setTextIfChanged(transcriptStatus"));

assert(!layout.includes('button.textContent = collapsed ? "⇤" : "⇥"'));
assert(layout.includes('setTextIfChanged(button, collapsed ? "⇤" : "⇥")'));

assert(!rebind.includes('time.textContent = duration > 0'));
assert(rebind.includes("setTextIfChanged(time, nextTime)"));

assert(!commercialUx.includes("if (text) text.textContent = c.ready"));
assert(!commercialUx.includes("if (text) text.textContent = c.needsSetup"));
assert(commercialUx.includes("setTextIfChanged(text, c.ready)"));
assert(commercialUx.includes("setTextIfChanged(text, c.needsSetup)"));
assert(commercialUx.includes("setDatasetIfChanged"));

console.log("Renderer interaction observers are mutation-safe and will not starve click handling.");
