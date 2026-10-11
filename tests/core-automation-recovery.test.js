"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const recoverySource = read("renderer/core-automation-recovery.js");
const voiceState = read("renderer/core-automation-voice-state.js");
const compositionState = read("renderer/core-automation-composition-state.js");
const controller = read("renderer/core-automation-mvp-controller.js");
const index = read("renderer/index.html");
const pkg = JSON.parse(read("package.json"));

for (const required of [
  "recoverInterruptedScriptJob",
  "validateLocalAssets",
  "validateLocalAudio",
  "validateExportOutputs",
  "refreshStatus",
  "ViralAutomationVoiceState",
  "viral-ai:automation-recovery",
  "failureCode = \"INTERRUPTED\"",
  "retryable = true"
]) assert(recoverySource.includes(required), "Automation recovery missing: " + required);

assert(!recoverySource.includes("setInterval("), "Automation recovery must not poll");
assert(!recoverySource.includes("setTimeout("), "Automation recovery must not use artificial timers");
assert(voiceState.includes("validateLocalAudio"), "Voice state must validate persisted local audio");
assert(voiceState.includes("fileHealth"), "Voice state must persist voice file health");
assert(compositionState.includes("fileHealth?.missingSceneIds"), "Composition must reject persisted missing voice files");
assert(controller.includes("Previous session recovered") && controller.includes("Đã khôi phục phiên trước"), "MVP controller must surface friendly recovery copy");
assert(controller.includes("viral-ai:automation-recovery"), "MVP controller must refresh after recovery");
assert(index.includes('src="core-automation-recovery.js"'), "Automation recovery runtime must be loaded");
assert(index.indexOf('src="core-automation-mvp-controller.js"') < index.indexOf('src="core-automation-recovery.js"'), "Recovery must load after the MVP controller APIs it refreshes");
assert(index.indexOf('src="core-automation-voice-state.js"') < index.indexOf('src="core-automation-recovery.js"'), "Recovery must load after voice state");

(async () => {
  const events = [];
  let persisted = 0;
  let stockRefreshes = 0;
  let voiceRefreshes = 0;
  const state = {
    automation: {
      jobs: {
        script: {
          id: "script-old",
          status: "processing",
          progress: 41,
          indeterminate: true
        }
      },
      stale: { script: false, scenes: false, assets: [], composition: false },
      composition: { id: "composition-1" }
    },
    jobs: [
      {
        id: "export-old",
        status: "completed",
        isAutomationCompositionExport: true,
        outputPath: "C:/missing/output.mp4",
        fileState: "available"
      }
    ]
  };

  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const window = {
    desktopAPI: {
      async fileStatus(filePath) {
        return { exists: filePath !== "C:/missing/output.mp4" };
      }
    },
    ViralAutomationAssetState: {
      async validateLocalAssets() {
        return { ok: true, checked: 2, missing: ["asset-missing"], available: ["asset-ok"] };
      }
    },
    ViralAutomationVoiceState: {
      async validateLocalAudio() {
        return { ok: true, checked: 2, missingSceneIds: ["scene-2"], availableSceneIds: ["scene-1"] };
      },
      async refreshStatus() {
        voiceRefreshes += 1;
        return { ready: true };
      }
    },
    ViralAutomationDesktopStockProvider: {
      async refreshStatus() {
        stockRefreshes += 1;
        return { providers: [{ id: "dev-stock", ready: true }] };
      }
    },
    ViralCoreProjectPersistence: {
      schedule() { persisted += 1; }
    },
    dispatchEvent(event) { events.push(event); }
  };

  const document = {
    readyState: "loading",
    documentElement: { dataset: {} },
    addEventListener() {}
  };

  const context = {
    window,
    document,
    state,
    CustomEvent,
    requestAnimationFrame() {},
    save() { persisted += 1; },
    console,
    Date,
    Promise,
    Set,
    JSON,
    Array,
    String,
    Number,
    Boolean,
    Math
  };
  vm.createContext(context);
  vm.runInContext(recoverySource, context, { filename: "core-automation-recovery.js" });

  const snapshot = await window.ViralAutomationRecovery.run({ announce: true });
  assert.strictEqual(state.automation.jobs.script.status, "failed");
  assert.strictEqual(state.automation.jobs.script.failureCode, "INTERRUPTED");
  assert.strictEqual(state.automation.jobs.script.retryable, true);
  assert.strictEqual(state.jobs[0].fileState, "missing");
  assert.deepStrictEqual(Array.from(snapshot.missingAssets), ["asset-missing"]);
  assert.deepStrictEqual(Array.from(snapshot.missingVoice), ["scene-2"]);
  assert.deepStrictEqual(Array.from(snapshot.missingExports), ["export-old"]);
  assert.strictEqual(snapshot.recoveredScript, true);
  assert.strictEqual(snapshot.changed, true);
  assert(stockRefreshes >= 1, "Stock provider status should refresh during recovery");
  assert(voiceRefreshes >= 1, "Voice provider status should refresh during recovery");
  assert(persisted >= 1, "Recovered state must be persisted");
  assert(events.some(event => event.type === "viral-ai:automation-recovery"), "Recovery event must be emitted");
  assert(events.some(event => event.type === "viral-ai:core-state-changed"), "Core state event must be emitted");

  assert(pkg.scripts["test:core-automation-recovery"], "package.json must expose Automation recovery regression");
  assert(pkg.scripts["test:core-commercial"].includes("test:core-automation-recovery"), "commercial regression must gate Automation recovery");

  console.log("Automation restart checkpoint, missing local media/voice/output recovery and retry-state tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});