"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-ai-create.js");
const css = read("renderer/core-ai-create.css");
const shell = read("renderer/core-product-shell.js");
const index = read("renderer/index.html");
const catalog = read("services/generation/model-catalog.js");
const router = read("services/generation/model-router.js");
const estimator = read("services/generation/cost-estimator.js");

assert.doesNotThrow(() => new Function(js), "Create with AI workspace must parse.");

for (const required of [
  'pages["ai-create"] = page',
  'data-generation-execution="not-wired"',
  'disabled aria-disabled="true">Generate',
  'const GOAL_KEY = "viral-ai-generation-goal"',
  'const BRIEF_KEY = "viral-ai-generation-brief"',
  'window.ViralCoreScenePlanModel',
  'window.desktopAPI?.searchMedia',
  'type === "local-ai"',
  'route("settings")',
  'provider execution is intentionally not faked',
  'Phần thực thi provider không được giả lập'
]) assert(js.includes(required), "Create with AI workspace missing: " + required);

for (const required of [
  '{ id: "ai-create", icon: "✦", label: "core-ai-create" }',
  'aiCreate: "Tạo bằng AI"',
  'aiCreate: "Create with AI"',
  'if (current.page === "ai-create") return;',
  'current.page === "ai-create"'
]) assert(shell.includes(required), "Product shell AI Create integration missing: " + required);

for (const required of [
  'href="core-ai-create.css"',
  'src="core-ai-create.js"'
]) assert(index.includes(required), "Create with AI asset not loaded: " + required);
assert(index.indexOf('src="core-ai-create.js"') > index.indexOf('src="core-product-shell.js"'), "AI Create must install after product shell navigation.");
assert(index.indexOf('src="core-ai-create.js"') < index.indexOf('src="core-navigation-stability.js"'), "AI Create nav must exist before stable navigation snapshots the structure.");

for (const required of [
  ".core-ai-create-workspace",
  ".core-ai-strategy-grid",
  ".core-ai-setup-grid",
  ".core-ai-generation-lock"
]) assert(css.includes(required), "Create with AI styling missing: " + required);
assert(!css.includes("@keyframes"), "Create with AI must not introduce ambient animation loops.");
assert(!js.includes("MutationObserver"), "Create with AI must not reintroduce renderer observer storms.");
assert(!js.includes("setInterval("), "Create with AI must not poll the renderer.");
assert(!/API[_-]?KEY/i.test(js), "Provider secrets must never be embedded in the renderer workspace.");

for (const required of [
  '"local:wan"',
  '"runway:wan3"',
  '"runway:veo3.1"',
  '"runway:seedance2_5"',
  '"runway:gen4.5"'
]) assert(catalog.includes(required), "Restored generation catalog missing: " + required);
assert(router.includes("ROUTE_ORDER"));
assert(router.includes("chooseModel"));
assert(estimator.includes("estimateGenerationCost"));

console.log("Create with AI workspace contract passed");
