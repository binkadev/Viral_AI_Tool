"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "renderer", "core-shell-workstation.css"), "utf8");
const index = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

for (const required of [
  '.topbar',
  '.breadcrumb',
  '#quickProject',
  '.sidebar',
  '.workspace',
  '.nav-item.active::before',
  '.nav-item.active .nav-icon',
  '.credit-card',
  '.profile',
  ':focus-visible',
  'prefers-reduced-motion',
  'html[data-motion="reduced"]'
]) {
  assert(css.includes(required), "Commercial shell workstation CSS missing: " + required);
}

for (const required of [
  'font-family:"Segoe UI Variable Display","Segoe UI Variable","Segoe UI","Noto Sans",Arial,sans-serif!important',
  'outline-offset:2px!important',
  'transition:none!important',
  'background:linear-gradient(90deg,rgba(124,140,255,.12),rgba(124,140,255,.04))!important'
]) {
  assert(css.includes(required), "Commercial shell workstation behavior missing: " + required);
}

assert(!css.includes("@keyframes"), "Shell chrome must not introduce decorative animation loops.");
assert(!css.includes("filter:blur"), "Shell chrome must not use blur animation effects.");
assert(index.includes('href="core-shell-workstation.css"'), "Final shell workstation stylesheet must be loaded.");
assert(
  index.indexOf('href="core-shell-workstation.css"') > index.indexOf('href="core-shell-stability.css"'),
  "Final shell workstation layer must load after shell stability overrides."
);
assert(
  index.indexOf('href="core-shell-workstation.css"') < index.indexOf('href="core-player-workstation.css"'),
  "Shell chrome should settle before player-specific workstation layers."
);

console.log("Commercial workspace shell hierarchy tests passed.");
