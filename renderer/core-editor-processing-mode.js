(function installCoreEditorProcessingMode() {
  "use strict";

  let queued = false;

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved?.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function copy() {
    return locale() === "en"
      ? {
          title: "Processing mode",
          speech: "Speech",
          translation: "Translation",
          voice: "AI Voice",
          cloud: "Cloud",
          local: "Local",
          unknown: "Not set"
        }
      : {
          title: "Chế độ xử lý",
          speech: "Nhận diện",
          translation: "Dịch",
          voice: "Giọng AI",
          cloud: "Cloud",
          local: "Local",
          unknown: "Chưa chọn"
        };
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function normalizeMode(value) {
    return value === "cloud" ? "cloud" : value === "local" ? "local" : "unknown";
  }

  function ensureStrip(inspector) {
    let strip = inspector.querySelector(":scope > .core-commercial-mode-strip");
    if (strip instanceof HTMLElement) return strip;

    const tabs = inspector.querySelector(":scope > .core-inspector-tabs");
    if (!(tabs instanceof HTMLElement)) return null;

    strip = document.createElement("section");
    strip.className = "core-commercial-mode-strip";
    strip.setAttribute("aria-label", copy().title);
    strip.innerHTML = [
      '<div class="core-commercial-mode-title"></div>',
      '<div class="core-commercial-mode-items">',
        '<div class="core-commercial-mode-item" data-commercial-mode-item="speech"><span></span><b></b></div>',
        '<div class="core-commercial-mode-item" data-commercial-mode-item="translation"><span></span><b></b></div>',
        '<div class="core-commercial-mode-item" data-commercial-mode-item="voice"><span></span><b></b></div>',
      '</div>'
    ].join("");
    tabs.insertAdjacentElement("afterend", strip);
    return strip;
  }

  function updateItem(strip, key, label, mode, labels) {
    const item = strip.querySelector('[data-commercial-mode-item="' + key + '"]');
    if (!(item instanceof HTMLElement)) return;
    const modeName = normalizeMode(mode);
    item.dataset.mode = modeName;

    const labelNode = item.querySelector("span");
    const valueNode = item.querySelector("b");
    const modeLabel = modeName === "cloud" ? labels.cloud : modeName === "local" ? labels.local : labels.unknown;

    if (labelNode && labelNode.textContent !== label) labelNode.textContent = label;
    if (valueNode && valueNode.textContent !== modeLabel) valueNode.textContent = modeLabel;
    item.setAttribute("aria-label", label + ": " + modeLabel);
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    const inspector = page.querySelector(".core-editor-inspector");
    if (!(inspector instanceof HTMLElement)) return;

    const current = appState();
    const labels = copy();
    const strip = ensureStrip(inspector);
    if (!(strip instanceof HTMLElement)) return;

    strip.setAttribute("aria-label", labels.title);
    const title = strip.querySelector(".core-commercial-mode-title");
    if (title && title.textContent !== labels.title) title.textContent = labels.title;

    updateItem(strip, "speech", labels.speech, current?.speech?.mode, labels);
    updateItem(strip, "translation", labels.translation, current?.translation?.mode, labels);
    updateItem(strip, "voice", labels.voice, current?.voice?.mode, labels);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
