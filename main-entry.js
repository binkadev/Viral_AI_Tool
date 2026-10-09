'use strict';

const os = require('os');
const { app } = require('electron');

const WINDOWS_11_MIN_BUILD = 22000;
const STARTUP_DIAGNOSTICS = process.env.VIRAL_AI_STARTUP_DIAGNOSTICS === '1';

function windowsBuildNumber() {
  if (process.platform !== 'win32') return 0;
  const release = String(os.release() || '');
  const parts = release.split('.');
  const build = Number(parts[2] || 0);
  return Number.isFinite(build) ? build : 0;
}

const windowsBuild = windowsBuildNumber();
const forceGpu = process.env.VIRAL_AI_FORCE_GPU === '1';
const forceSoftware = process.env.VIRAL_AI_FORCE_SOFTWARE_RENDERING === '1';
const windows10SafeMode =
  process.platform === 'win32' &&
  windowsBuild > 0 &&
  windowsBuild < WINDOWS_11_MIN_BUILD &&
  !forceGpu;
const softwareRendering = process.platform === 'win32' && (forceSoftware || windows10SafeMode);

if (process.platform === 'win32') {
  // Keep hidden/covered frameless windows paintable while Chromium starts.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

  // Chromium persists compiled GPU shaders in sessionData. On affected Windows
  // machines a bad/driver-stale shader cache can leave a frameless Electron
  // window presenting only its background even though the renderer is alive.
  // Keep GPU acceleration on supported systems but never reuse the disk shader
  // cache until the Electron runtime is upgraded past this unstable baseline.
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  // Viral AI Tool targets Windows 10 as well as Windows 11. The current Electron
  // 38 runtime is not reliable enough on some Windows 10 GPU/driver stacks.
  // Prefer a deterministic software compositor there. Video processing itself
  // remains handled by the existing media pipeline; this only protects the UI
  // compositor. Windows 11 keeps normal GPU acceleration by default.
  if (softwareRendering) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
  }
}

if (STARTUP_DIAGNOSTICS) {
  console.log('[viral-ai:start] windows-rendering-policy', {
    platform: process.platform,
    windowsBuild,
    windows10SafeMode,
    softwareRendering,
    forceGpu,
    forceSoftware
  });
}

require('./main.js');
