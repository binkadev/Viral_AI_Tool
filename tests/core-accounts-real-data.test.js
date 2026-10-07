"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "renderer", "core-accounts-real-data.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "core-accounts-real-data.css"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "core-bootstrap.js"), "utf8");
const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");

assert.doesNotThrow(() => new Function(js), "Real accounts override must parse.");
for (const fake of ["@hoangstudio", "@hoang.creates", "Hoang Studio"]) {
  assert(!js.includes(fake), "Production accounts override must not contain demo identity: " + fake);
}
for (const required of ["pages.accounts = page", "state?.cloud?.auth", "state?.cloud?.account", "state?.cloud?.accountSessions", "data-revoke-session", "accountsSessionLogin"]) {
  assert(js.includes(required), "Real account surface missing: " + required);
}
assert(js.includes("TikTok, YouTube, Instagram"), "Unsupported social providers must be explained rather than faked.");
assert(bootstrap.includes('core-accounts-real-data.css'), "Bootstrap must load real-account styles.");
assert(bootstrap.includes('core-accounts-real-data.js'), "Bootstrap must load real-account behavior.");
assert(css.includes(".core-real-account-grid"), "Real account layout styles must exist.");
assert(app.includes('@hoangstudio'), "Legacy demo fixture remains detectable until app.js is refactored; production override must supersede it.");

console.log("core accounts real-data tests passed");
