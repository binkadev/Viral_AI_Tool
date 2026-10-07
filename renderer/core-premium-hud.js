(function installPremiumHud() {
  "use strict";

  const root = document.documentElement;
  let raf = 0;

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

  function onPointerMove(event) {
    if (root.dataset.motion === "reduced") return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const x = Math.max(0, Math.min(1, event.clientX / Math.max(1, window.innerWidth)));
      const y = Math.max(0, Math.min(1, event.clientY / Math.max(1, window.innerHeight)));
      root.style.setProperty("--hud-pointer-x", x.toFixed(3));
      root.style.setProperty("--hud-pointer-y", y.toFixed(3));
      root.style.setProperty("--hud-shift-x", ((x - .5) * 12).toFixed(2) + "px");
      root.style.setProperty("--hud-shift-y", ((y - .5) * 8).toFixed(2) + "px");
      raf = 0;
    });
  }

  function start() {
    mount();
    document.addEventListener("pointermove", onPointerMove, { passive: true });

    const page = document.getElementById("page");
    if (page) {
      const observer = new MutationObserver(syncPage);
      observer.observe(page, { childList: true, subtree: false });
    }

    window.addEventListener("viral-ai:startup-complete", () => {
      root.classList.add("premium-hud-ready");
      syncPage();
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
