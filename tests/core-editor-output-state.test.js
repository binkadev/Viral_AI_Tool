const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const js = read("renderer/core-editor-output-state-v2.js");
const css = read("renderer/core-editor-output-state.css");
const index = read("renderer/index.html");
const preload = read("preload.js");
const i18n = read("renderer/i18n.js");

assert.doesNotThrow(() => new Function(js), "Output-state v2 must parse.");

for (const required of [
  'state: "idle"',
  '"checking"',
  '"ready"',
  '"missing"',
  '"unverified"',
  "window.I18N?.t?.(locale(), key, vars)",
  'tr("common.export")',
  'tr("media.renderDone")',
  'tr("media.exportDone")',
  'tr("media.showFile")',
  'tr("settings.updateChecking")',
  'tr("file.missingTitle")',
  'tr("file.missingBody"',
  'tr("export.retry")',
  'tr("file.unknownDetails")',
  'tr("translation.retry")',
  "window.desktopAPI?.fileStatus",
  "window.desktopAPI.showFile",
  "onRenderProgress",
  "beforeunload",
  "data-output-show",
  "core-output-state-card",
  'setAttribute("role", "status")',
  'setAttribute("aria-live", "polite")',
  'setAttribute("aria-busy"',
  "subtree:false"
]) {
  assert(js.includes(required), "Output state v2 missing: " + required);
}

assert(preload.includes("onRenderProgress"), "Desktop bridge must expose render progress events.");
assert(!js.includes("setInterval("), "Output verification must remain event-driven.");
assert(!js.includes("subtree:true"), "Output card mutations must not retrigger a subtree observer loop.");
assert(!js.includes("outputExists = null"), "V2 must not overload null as both unchecked and verification failure.");
for (const forbidden of [
  "Exported video is ready",
  "Video đã xuất sẵn sàng",
  "Chưa kiểm tra được video đã xuất",
  "Kiểm tra lại",
  "Xuất lại",
  "Mở thư mục",
  "Video render đã sẵn sàng",
  "File render không còn khả dụng",
  "Render lại",
  "Hãy render video"
]) {
  assert(!js.includes(forbidden), "Output module must not hard-code customer copy: " + forbidden);
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(i18n, context);
for (const locale of ["vi", "en"]) {
  for (const key of [
    "common.export",
    "media.renderDone",
    "media.exportDone",
    "media.showFile",
    "settings.updateChecking",
    "file.missingTitle",
    "file.missingBody",
    "export.retry",
    "file.unknownDetails",
    "translation.retry"
  ]) {
    const value = context.window.I18N.t(locale, key, { name: "video.mp4" });
    assert(typeof value === "string" && value && value !== key, `Missing ${locale} catalog entry for ${key}`);
  }
}
assert(!/\bRender lại\b|Video render|File render/.test(context.window.I18N.t("vi", "media.renderDone")), "Visible completion copy must not expose render jargon.");
assert(!/\bRender again\b|Rendered video/.test(context.window.I18N.t("en", "media.renderDone")), "English completion copy must stay customer-facing.");

for (const required of [
  ".core-output-state-card",
  '.core-output-state-card[data-output-state="checking"]',
  '.core-output-state-card[data-output-state="unverified"]',
  '.core-output-state-card[data-output-state="missing"]',
  ".core-output-state-action",
  ".core-output-state-action:focus-visible",
  ".core-output-state-hint",
  "font-size:var(--type-control)!important",
  "font-size:var(--type-meta)!important",
  "font-size:var(--type-caption)!important",
  "font-size:var(--type-section)!important",
  "font-family:var(--font)!important",
  'html[data-motion="reduced"].core-editor-premium'
]) {
  assert(css.includes(required), "Output state CSS missing: " + required);
}
assert(!css.includes("@keyframes"), "Output state must not introduce decorative animation loops.");
assert(!/font-size:(?:9|10)px/.test(css), "Output state copy must respect the commercial readability floor.");

assert(index.includes('href="core-editor-output-state.css"'), "Output state CSS must be loaded.");
assert(index.includes('src="core-editor-output-state-v2.js"'), "Production shell must load output state v2.");
assert(!index.includes('src="core-editor-output-state.js"'), "Legacy output state must not run beside v2.");

console.log("core-editor-output-state locale-backed commercial export UX tests passed");
