"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-player-workstation.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-player-workstation.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

assert.doesNotThrow(() => new Function(js), "Workstation player JavaScript must parse.");

for (const required of [
  "video.muted",
  "video.volume",
  'data-core-mute',
  'data-core-volume',
  'dataset.coreCapability = "functional"',
  'video.addEventListener("volumechange"',
  "const wiredVideos = new WeakSet()",
  "function mediaFor(host)",
  "function wireVideo(video)",
  'video.closest(".preview")',
  'host?.querySelector?.(".core-player-controls")',
  "const currentVideo = mediaFor(host)",
  "MutationObserver",
  "requestAnimationFrame",
  'root'
]) {
  if (required === "root") continue;
  assert(js.includes(required), "Workstation player behavior missing: " + required);
}

assert(!js.includes("setInterval("), "Workstation player must not create an independent media clock.");
assert(js.includes('currentState') === false, "Workstation volume controls must use native media state, not duplicate app state.");

for (const required of [
  "object-fit:contain!important",
  "position:absolute!important",
  "height:calc(100% - 100px)!important",
  ".core-player-volume",
  "grid-template-columns:34px minmax(90px,1fr) auto 34px minmax(66px,92px) 34px!important",
  ":fullscreen",
  "prefers-reduced-motion",
  ".core-player-button[data-core-play]",
  'data-core-playback-state="playing"',
  '.core-player-mute[aria-pressed="true"]',
  "font-variant-numeric:tabular-nums",
  ":focus-within",
  ".core-player-button:focus-visible",
  'html[data-motion="reduced"].core-editor-premium',
  "transition:none!important"
]) {
  assert(css.includes(required), "Workstation player CSS missing: " + required);
}
assert(!css.includes("object-fit:cover"), "Workstation player must never crop source media.");
assert(!css.includes("@keyframes"), "Workstation player geometry must not introduce decorative animation loops.");
assert(css.includes('font-family:"Segoe UI Variable Text","Segoe UI Variable","Segoe UI","Noto Sans",Arial,sans-serif!important'), "Timecode must remain on the product Windows font stack.");
assert(!css.includes('font-family:"Cascadia Mono"'), "Timecode must not introduce an alternate monospace font stack.");
assert(css.includes("outline-offset:2px!important"), "Transport controls need a visible keyboard focus treatment.");

assert(index.includes('href="core-player-workstation.css"'), "Final workstation player CSS must be loaded.");
assert(index.includes('src="core-player-workstation.js"'), "Workstation player controls must be loaded.");
assert(
  index.indexOf('href="core-player-workstation.css"') > index.indexOf('href="core-shell-stability.css"'),
  "Player geometry must load after all shell/theme layers so fit behavior wins."
);
assert(
  index.indexOf('src="core-player-workstation.js"') > index.indexOf('src="core-player-rebind.js"'),
  "Volume controls must augment the hardened core player after rebind wiring."
);

console.log("Workstation player fit, transport hierarchy and native volume controls tests passed.");
