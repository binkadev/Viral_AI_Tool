(function installPremiumHud() {
  "use strict";

  const root = document.documentElement;
  const SURFACE_SELECTOR = [
    ".creator-home-hero",
    ".creator-import-surface",
    ".creator-current-project",
    ".creator-recent-item",
    ".core-editor-assets-panel",
    ".core-editor-inspector",
    ".core-editor-bottom-dock",
    ".core-timeline-workspace"
  ].join(",");
  const MAGNET_SELECTOR = [
    ".button.primary",
    ".creator-primary-import",
    ".core-import-primary",
    ".creator-project-action"
  ].join(",");

  let raf = 0;
  let pointerX = 0;
  let pointerY = 0;
  let activeSurface = null;
  let activeMagnet = null;

  function reducedMotion() {
    if (root.dataset.motion === "reduced") return true;
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
    catch { return false; }
  }

  function mount() {
    if (!document.body || document.getElementById("premiumHudLayer")) return;

    const layer = document.createElement("div");
    layer.id = "premiumHudLayer";
    layer.className = "premium-hud-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML =
      '<span class="premium-hud-grid"></span>' +
      '<span class="premium-hud-scan"></span>' +
      '<span class="premium-hud-orbit"></span>' +
      '<span class="premium-hud-trace"></span>' +
      '<span class="premium-hud-vignette"></span>';

    document.body.prepend(layer);
    root.dataset.premiumHud = "enabled";
    syncPage();
  }

  function syncPage() {
    try {
      const page = typeof state !== "undefined" ? state?.page : "";
      if (page) root.dataset.hudPage = page;
    } catch {}
  }

  function ensureReactiveLight(surface) {
    if (!(surface instanceof HTMLElement)) return;
    let light = surface.querySelector(":scope > .hud-reactive-light");
    if (light) return;
    light = document.createElement("span");
    light.className = "hud-reactive-light";
    light.setAttribute("aria-hidden", "true");
    surface.appendChild(light);
  }

  function clearSurface() {
    if (!(activeSurface instanceof HTMLElement)) return;
    activeSurface.classList.remove("is-hud-hover");
    activeSurface.style.removeProperty("--hud-local-x");
    activeSurface.style.removeProperty("--hud-local-y");
    activeSurface = null;
  }

  function clearMagnet() {
    if (!(activeMagnet instanceof HTMLElement)) return;
    activeMagnet.classList.remove("is-hud-magnet");
    activeMagnet.style.removeProperty("--hud-magnet-x");
    activeMagnet.style.removeProperty("--hud-magnet-y");
    activeMagnet = null;
  }

  function clearInteractiveState() {
    clearSurface();
    clearMagnet();
  }

  function syncSurface(target) {
    const surface = target?.closest?.(SURFACE_SELECTOR) || null;
    if (surface !== activeSurface) {
      clearSurface();
      activeSurface = surface instanceof HTMLElement ? surface : null;
      if (activeSurface) {
        ensureReactiveLight(activeSurface);
        activeSurface.classList.add("is-hud-hover");
      }
    }
    if (!activeSurface) return;

    const rect = activeSurface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const localX = Math.max(0, Math.min(100, ((pointerX - rect.left) / rect.width) * 100));
    const localY = Math.max(0, Math.min(100, ((pointerY - rect.top) / rect.height) * 100));
    activeSurface.style.setProperty("--hud-local-x", localX.toFixed(2) + "%");
    activeSurface.style.setProperty("--hud-local-y", localY.toFixed(2) + "%");
  }

  function syncMagnet(target) {
    const magnet = target?.closest?.(MAGNET_SELECTOR) || null;
    if (magnet !== activeMagnet) {
      clearMagnet();
      activeMagnet = magnet instanceof HTMLElement ? magnet : null;
      activeMagnet?.classList.add("is-hud-magnet");
    }
    if (!activeMagnet) return;

    const rect = activeMagnet.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(-1, Math.min(1, ((pointerX - rect.left) / rect.width - .5) * 2));
    const ny = Math.max(-1, Math.min(1, ((pointerY - rect.top) / rect.height - .5) * 2));
    activeMagnet.style.setProperty("--hud-magnet-x", (nx * 4.5).toFixed(2) + "px");
    activeMagnet.style.setProperty("--hud-magnet-y", (ny * 3).toFixed(2) + "px");
  }

  function renderPointer(target) {
    const x = Math.max(0, Math.min(1, pointerX / Math.max(1, window.innerWidth)));
    const y = Math.max(0, Math.min(1, pointerY / Math.max(1, window.innerHeight)));
    const shiftX = (x - .5) * 12;
    const shiftY = (y - .5) * 8;
    root.style.setProperty("--hud-pointer-x", x.toFixed(3));
    root.style.setProperty("--hud-pointer-y", y.toFixed(3));
    root.style.setProperty("--hud-shift-x", shiftX.toFixed(2) + "px");
    root.style.setProperty("--hud-shift-y", shiftY.toFixed(2) + "px");
    root.style.setProperty("--hud-grid-x", (shiftX * .22).toFixed(2) + "px");
    root.style.setProperty("--hud-grid-y", (shiftY * .22).toFixed(2) + "px");
    root.style.setProperty("--hud-orbit-x", (shiftX * .42).toFixed(2) + "px");
    root.style.setProperty("--hud-orbit-y", (shiftY * .42).toFixed(2) + "px");
    root.style.setProperty("--hud-trace-x", (shiftX * -.28).toFixed(2) + "px");
    root.style.setProperty("--hud-trace-y", (shiftY * -.18).toFixed(2) + "px");
    syncSurface(target);
    syncMagnet(target);
  }

  function onPointerMove(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (reducedMotion()) {
      clearInteractiveState();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      renderPointer(target);
      raf = 0;
    });
  }

  function start() {
    mount();
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", clearInteractiveState, { passive: true });
    window.addEventListener("blur", clearInteractiveState);

    const page = document.getElementById("page");
    if (page) {
      const observer = new MutationObserver(syncPage);
      observer.observe(page, { childList: true, subtree: false });
    }

    root.classList.add("premium-hud-ready");
    syncPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
