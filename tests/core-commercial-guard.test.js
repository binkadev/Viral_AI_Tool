"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const index = read("renderer/index.html");
const bootstrap = read("renderer/core-bootstrap.js");
const accounts = read("renderer/core-accounts-real-data.js");
const settings = read("renderer/core-settings-production.js");
const creator = read("renderer/core-creator-home-production.js");
const output = read("renderer/core-editor-output-state-v2.js");
const libraryRecovery = read("renderer/core-library-output-recovery.js");
const folderRecovery = read("renderer/core-export-folder-recovery.js");
const jobHealth = read("renderer/core-job-file-health.js");
const motion = read("renderer/core-motion-policy.css");

assert(index.includes('data-motion="balanced"'), "New installs must default to balanced motion.");
assert(!index.includes("core-startup-experience"), "Removed startup animation must stay out of production shell.");
assert(index.indexOf('src="core-bootstrap.js"') < index.indexOf('src="app.js"'), "Startup sanitizer must execute before legacy app state is constructed.");
assert(bootstrap.includes("const jobs = Array.isArray(saved.jobs) ? saved.jobs : []"), "Bootstrap must materialize an empty real jobs array on fresh installs.");
assert(bootstrap.includes("saved.jobs = jobs.filter"), "Bootstrap must sanitize persisted jobs before app.js reads them.");
assert(bootstrap.includes("prototypeNames.has"), "Bootstrap must remove legacy prototype jobs before first paint.");
assert(bootstrap.includes("hasProjectSource"), "Startup bootstrap must identify persisted source projects.");
assert(bootstrap.includes('saved.page = hasProjectSource ? "ai-video" : "download"'), "First render must go directly to the workflow route.");
assert(bootstrap.includes('root.dataset.coreFirstPaint = "pending"'), "First paint must be gated until production routing settles.");
assert(bootstrap.includes('visibility:hidden!important'), "First-paint guard must hide only intermediate page content.");
assert(bootstrap.includes("requestAnimationFrame(() =>"), "Production page must be revealed on the pre-paint frame.");
assert(bootstrap.includes('root.dataset.coreFirstPaint = "ready"'), "Production page must explicitly complete first paint.");
assert(!bootstrap.includes("opacity:0"), "First-paint guard must not introduce another fade animation.");
assert(!bootstrap.includes("setInterval("), "Startup stabilization must not poll.");

for (const productionModule of [
  "core-accounts-real-data.js",
  "core-library-output-recovery.js",
  "core-settings-production.js",
  "core-creator-home-production.js",
  "core-export-folder-recovery.js"
]) {
  assert(bootstrap.includes(productionModule), "Production bootstrap missing override: " + productionModule);
}

for (const fake of ["@hoangstudio", "@hoang.creates", "Hoang Studio"]) {
  assert(!accounts.includes(fake), "Production account surface contains fake identity: " + fake);
}
assert(accounts.includes("state?.cloud?.accountSessions"), "Accounts must use real session data.");
assert(creator.includes("current?.cloud?.auth?.authenticated === true"), "Cloud connected state must require authenticated auth state.");
assert(!creator.includes("Boolean(current?.cloud?.account)"), "Cached account data must not imply connectivity.");
assert(creator.includes("current?.speech?.providerStatus?.local"), "Local readiness must come from the real speech provider state.");
assert(creator.includes("local.ready === true"), "Local must only say ready when the provider reports ready.");
assert(creator.includes("Cần thiết lập"), "Unavailable local AI must show a setup-required state.");
assert(creator.includes("projectSource()"), "Creator route recovery must keep persisted projects recoverable.");

for (const token of ["setting-row", "1080p", "4K", "__coreProductionSettings"]) {
  assert(settings.includes(token), "Production settings guard missing control sanitizer: " + token);
}

for (const stateName of ["idle", "checking", "ready", "missing", "unverified"]) {
  assert(output.includes('"' + stateName + '"'), "Output verifier missing state: " + stateName);
}
assert(output.includes("Kiểm tra lại"), "Output verification failure must offer an explicit retry.");
assert(output.includes("Render lại"), "Missing output must offer rerender recovery.");
assert(!output.includes("setInterval("), "Output verifier must not poll.");
assert(output.includes("subtree:false"), "Output observer must stay scoped to page replacement.");

assert(libraryRecovery.includes("missingRerender"), "Library must offer rerender for missing output files.");
assert(folderRecovery.includes("selectOutputFolder"), "Export errors must allow choosing another output folder.");
assert(jobHealth.includes('window.addEventListener("focus"'), "File health must refresh on app focus.");
assert(!jobHealth.includes("setInterval("), "File health must remain event-driven.");

assert(motion.includes('html[data-motion="balanced"]'), "Balanced motion policy must be explicit.");
assert(motion.includes("animation:none!important"), "Balanced/reduced policy must suppress ambient loops.");

for (const [name, source] of [
  ["accounts", accounts],
  ["settings", settings],
  ["creator", creator],
  ["output", output],
  ["library recovery", libraryRecovery],
  ["folder recovery", folderRecovery]
]) {
  assert(!source.includes("setInterval("), name + " production guard must not introduce UI polling.");
}

console.log("core commercial product guard passed");
