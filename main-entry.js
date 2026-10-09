'use strict';

const os = require('os');
const { app } = require('electron');

const WINDOWS_11_MIN_BUILD = 22000;
const STARTUP_DIAGNOSTICS = process.env.VIRAL_AI_STARTUP_DIAGNOSTICS === '1';
const STARTUP_PROBE = process.env.VIRAL_AI_STARTUP_PROBE === '1';
const STARTUP_STABILIZER_DISABLED = process.env.VIRAL_AI_DISABLE_STARTUP_STABILIZER === '1';

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
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  if (softwareRendering) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
  }
}

function probeLog(label, value) {
  if (!STARTUP_PROBE) return;
  try {
    console.log('[viral-ai:probe] ' + label, JSON.stringify(value));
  } catch {
    console.log('[viral-ai:probe] ' + label, String(value));
  }
}

/*
 * Windows can occasionally present only the BrowserWindow background after the
 * renderer has already painted the complete shell. The startup probe made the
 * issue disappear because it invalidated the renderer around first paint.
 * Keep that successful behavior without the expensive DOM inspection/capture:
 * invalidate a handful of times around did-finish-load and the first show.
 * This does not rebuild the DOM, change routing, disable the GPU, or retain any
 * screenshots. It only asks Chromium to submit the already-rendered surface.
 */
function installWindowsFirstPaintStabilizer() {
  if (process.platform !== 'win32' || STARTUP_STABILIZER_DISABLED) return;

  app.on('browser-window-created', (_event, win) => {
    if (!win || win.isDestroyed?.()) return;
    const contents = win.webContents;
    if (!contents) return;

    const timers = new Set();
    const scheduleInvalidate = (delay, phase) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (win.isDestroyed?.() || contents.isDestroyed?.()) return;
        try {
          contents.invalidate();
          probeLog('stabilizer:' + phase + '+' + delay + 'ms', { ok: true });
        } catch (error) {
          probeLog('stabilizer:' + phase + '+' + delay + 'ms', {
            ok: false,
            error: String(error?.message || error)
          });
        }
      }, delay);
      timers.add(timer);
    };

    contents.once('did-finish-load', () => {
      [0, 80, 220, 700].forEach(delay => scheduleInvalidate(delay, 'load'));
    });

    win.once('show', () => {
      [0, 120, 500].forEach(delay => scheduleInvalidate(delay, 'show'));
    });

    win.once('closed', () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    });
  });
}

function nativeImageSummary(image) {
  if (!image || image.isEmpty?.()) return { empty: true };
  const size = image.getSize?.() || { width: 0, height: 0 };
  const bitmap = image.toBitmap?.();
  if (!bitmap || !bitmap.length) return { empty: true, size };

  const pixelCount = Math.floor(bitmap.length / 4);
  const targetSamples = 12000;
  const pixelStep = Math.max(1, Math.floor(pixelCount / targetSamples));
  const colors = new Set();
  let minChannel = 255;
  let maxChannel = 0;
  let sampled = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += pixelStep) {
    const offset = pixel * 4;
    const a = bitmap[offset];
    const b = bitmap[offset + 1];
    const c = bitmap[offset + 2];
    minChannel = Math.min(minChannel, a, b, c);
    maxChannel = Math.max(maxChannel, a, b, c);
    colors.add(((a >> 4) << 8) | ((b >> 4) << 4) | (c >> 4));
    sampled += 1;
  }

  return {
    empty: false,
    size,
    bytes: bitmap.length,
    sampled,
    quantizedColors: colors.size,
    minChannel,
    maxChannel
  };
}

function installStartupProbe() {
  if (!STARTUP_PROBE) return;

  app.on('browser-window-created', (_event, win) => {
    if (!win || win.isDestroyed?.()) return;
    const contents = win.webContents;
    if (!contents) return;

    probeLog('window-created', {
      visible: win.isVisible?.(),
      bounds: win.getBounds?.(),
      platform: process.platform,
      windowsBuild,
      softwareRendering
    });

    const inspectRenderer = async label => {
      if (win.isDestroyed?.() || contents.isDestroyed?.()) return;

      let dom = null;
      try {
        dom = await contents.executeJavaScript(`(() => {
          const selectors = ['html','body','.titlebar','.shell','.sidebar','.topbar','#page','#premiumHudLayer','#modal','.core-command-overlay'];
          const nodeInfo = selector => {
            const node = selector === 'html' ? document.documentElement : selector === 'body' ? document.body : document.querySelector(selector);
            if (!node) return { exists:false };
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
              exists:true,
              connected:node.isConnected,
              hidden:Boolean(node.hidden),
              className:String(node.className || ''),
              display:style.display,
              visibility:style.visibility,
              opacity:style.opacity,
              position:style.position,
              zIndex:style.zIndex,
              backgroundColor:style.backgroundColor,
              transform:style.transform,
              filter:style.filter,
              backdropFilter:style.backdropFilter || style.webkitBackdropFilter || '',
              rect:{ x:Math.round(rect.x), y:Math.round(rect.y), width:Math.round(rect.width), height:Math.round(rect.height) },
              children:node.children?.length || 0
            };
          };
          const points = [
            [12,12],
            [80,70],
            [Math.round(innerWidth / 2), Math.round(innerHeight / 2)],
            [Math.max(1, innerWidth - 40), 70]
          ].map(([x,y]) => ({
            x,y,
            stack:(document.elementsFromPoint(x,y) || []).slice(0,8).map(node => ({
              tag:node.tagName,
              id:node.id || '',
              className:String(node.className || '')
            }))
          }));
          let page = null;
          try { page = typeof state !== 'undefined' ? state?.page || null : null; } catch {}
          return {
            readyState:document.readyState,
            href:location.href,
            viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio },
            page,
            rootClass:document.documentElement.className,
            rootDataset:{ ...document.documentElement.dataset },
            bodyChildren:[...document.body.children].map(node => ({ tag:node.tagName, id:node.id || '', className:String(node.className || '') })),
            stylesheets:document.styleSheets.length,
            nodes:Object.fromEntries(selectors.map(selector => [selector,nodeInfo(selector)])),
            points
          };
        })()`, true);
      } catch (error) {
        dom = { executeError: String(error?.stack || error) };
      }

      let capture = null;
      try {
        capture = nativeImageSummary(await win.capturePage());
      } catch (error) {
        capture = { captureError: String(error?.stack || error) };
      }

      probeLog(label, { dom, capture });

      try {
        contents.invalidate();
        probeLog(label + ':invalidate', { ok: true });
      } catch (error) {
        probeLog(label + ':invalidate', { ok: false, error: String(error?.message || error) });
      }
    };

    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      probeLog('did-fail-load', { code, description, url, isMainFrame });
    });
    contents.on('render-process-gone', (_e, details) => probeLog('render-process-gone', details || {}));
    contents.on('unresponsive', () => probeLog('unresponsive', {}));
    contents.on('responsive', () => probeLog('responsive', {}));

    contents.once('did-finish-load', () => {
      probeLog('did-finish-load', { url: contents.getURL?.() || '' });
      inspectRenderer('paint+0ms');
      [150, 500, 1500, 3000].forEach(delay => {
        setTimeout(() => inspectRenderer('paint+' + delay + 'ms'), delay);
      });
    });
  });
}

installWindowsFirstPaintStabilizer();
installStartupProbe();

if (STARTUP_DIAGNOSTICS || STARTUP_PROBE) {
  console.log('[viral-ai:start] windows-rendering-policy', {
    platform: process.platform,
    windowsBuild,
    windows10SafeMode,
    softwareRendering,
    forceGpu,
    forceSoftware,
    startupProbe: STARTUP_PROBE,
    startupStabilizer: process.platform === 'win32' && !STARTUP_STABILIZER_DISABLED
  });
}

require('./main.js');
