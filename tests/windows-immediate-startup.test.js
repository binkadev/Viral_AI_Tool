"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("events");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "main-entry.js"), "utf8");

assert.strictEqual(pkg.main, "main-entry.js", "Electron must boot through the Windows rendering policy bridge.");
assert(pkg.build.files.includes("main-entry.js"), "Packaged builds must include the rendering policy bridge.");
assert(entry.includes("CalculateNativeWinOcclusion"), "Windows startup must disable native occlusion classification.");
assert(entry.includes("disable-renderer-backgrounding"), "Hidden renderer backgrounding must be disabled on Windows.");
assert(entry.includes("disable-backgrounding-occluded-windows"), "Occluded Windows windows must remain paintable.");
assert(entry.includes("disable-gpu-shader-disk-cache"), "Windows must not reuse potentially stale compiled GPU shaders.");
assert(entry.includes("app.disableHardwareAcceleration()"), "Windows 10 must retain a deterministic software compositor fallback.");
assert(entry.includes("app.commandLine.appendSwitch('disable-gpu')"), "Windows 10 safe mode must fully disable GPU compositing.");
assert(entry.includes("VIRAL_AI_FORCE_GPU"), "GPU opt-in must remain available for controlled validation.");
assert(entry.includes("VIRAL_AI_FORCE_SOFTWARE_RENDERING"), "Software rendering must remain forceable for support diagnostics.");
assert(entry.includes("installWindowsFirstPaintStabilizer"), "Windows startup must install the targeted first-paint stabilizer.");
assert(entry.includes("contents.invalidate()"), "The first-paint stabilizer must request compositor resubmission without rebuilding renderer DOM.");
assert(entry.includes("VIRAL_AI_DISABLE_STARTUP_STABILIZER"), "Support must be able to disable the first-paint stabilizer for controlled comparison.");
assert(!entry.includes("BrowserWindow.prototype"), "Rendering policy must not monkey-patch BrowserWindow.");
assert(!entry.includes("requestAnimationFrame"), "Native rendering policy must not depend on renderer timing.");
assert(!entry.includes("win.capturePage()") || entry.includes("STARTUP_PROBE"), "Page capture must remain diagnostics-only, never required by the production stabilizer.");

function boot({ platform = "win32", release = "10.0.19045", env = {} } = {}) {
  const app = new EventEmitter();
  const switches = [];
  let disableHardwareCount = 0;
  let delegated = 0;

  app.commandLine = {
    appendSwitch(name, value) {
      switches.push([String(name), value === undefined ? undefined : String(value)]);
    }
  };
  app.disableHardwareAcceleration = () => { disableHardwareCount += 1; };

  const sandbox = {
    require(id) {
      if (id === "electron") return { app };
      if (id === "os") return { release: () => release };
      if (id === "./main.js") {
        delegated += 1;
        return {};
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { platform, env: { ...env } },
    console,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(entry, sandbox, { filename: "main-entry.js" });
  assert.strictEqual(delegated, 1, "Rendering policy must delegate to main.js exactly once.");
  return { app, switches, disableHardwareCount };
}

function hasSwitch(switches, name, value) {
  return switches.some(([key, actual]) => key === name && (value === undefined || actual === value));
}

{
  const result = boot({ release: "10.0.19045" });
  assert.strictEqual(result.disableHardwareCount, 1, "Windows 10 must default to the stable software compositor.");
  assert(hasSwitch(result.switches, "disable-gpu"), "Windows 10 safe mode must pass --disable-gpu.");
  assert(hasSwitch(result.switches, "disable-gpu-shader-disk-cache"), "Windows 10 must disable shader disk cache reuse.");
  assert(hasSwitch(result.switches, "disable-features", "CalculateNativeWinOcclusion"), "Windows 10 must disable native occlusion classification.");
}

{
  const result = boot({ release: "10.0.22631" });
  assert.strictEqual(result.disableHardwareCount, 0, "Windows 11 must preserve GPU acceleration by default.");
  assert(!hasSwitch(result.switches, "disable-gpu"), "Windows 11 must not disable the GPU by default.");
  assert(hasSwitch(result.switches, "disable-gpu-shader-disk-cache"), "Windows 11 must still avoid stale shader disk cache reuse.");
}

{
  const result = boot({ release: "10.0.19045", env: { VIRAL_AI_FORCE_GPU: "1" } });
  assert.strictEqual(result.disableHardwareCount, 0, "Explicit GPU validation must bypass Windows 10 safe mode.");
  assert(!hasSwitch(result.switches, "disable-gpu"), "Explicit GPU validation must not pass --disable-gpu.");
}

{
  const result = boot({ release: "10.0.22631", env: { VIRAL_AI_FORCE_SOFTWARE_RENDERING: "1" } });
  assert.strictEqual(result.disableHardwareCount, 1, "Support safe mode must be forceable on Windows 11.");
  assert(hasSwitch(result.switches, "disable-gpu"), "Forced software rendering must pass --disable-gpu.");
}

{
  const result = boot({ platform: "linux", release: "6.8.0" });
  assert.strictEqual(result.disableHardwareCount, 0, "Windows compatibility policy must not affect non-Windows platforms.");
  assert.strictEqual(result.switches.length, 0, "Windows Chromium switches must not leak to non-Windows platforms.");
}

console.log("Windows rendering compatibility policy passed");
