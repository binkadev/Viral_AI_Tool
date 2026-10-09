(function installCoreSourceRecovery() {
  "use strict";

  let busy = false;
  let queued = false;

  function setTextIfChanged(node, value) {
    if (!(node instanceof Node)) return;
    const next = String(value ?? "");
    if (node.textContent !== next) node.textContent = next;
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" || document.documentElement.lang === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          missingTitle: "Source video is unavailable",
          trashedTitle: "Source video is no longer available",
          body: "Relink the correct source video to continue. Source-dependent steps will be checked again after relinking.",
          relink: "Relink source video",
          relinking: "Relinking…",
          sourceHint: "Relink",
          unavailable: "Source unavailable"
        }
      : {
          missingTitle: "Video nguồn không còn khả dụng",
          trashedTitle: "Video nguồn hiện không thể sử dụng",
          body: "Chọn lại đúng video nguồn để tiếp tục. Các bước phụ thuộc vào nguồn sẽ được kiểm tra lại sau khi liên kết.",
          relink: "Chọn lại video nguồn",
          relinking: "Đang liên kết lại…",
          sourceHint: "Chọn lại",
          unavailable: "Video nguồn không khả dụng"
        };
  }

  function latestSource() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function unavailable(source) {
    return Boolean(source && (
      source.fileState === "missing" ||
      source.fileState === "trashed" ||
      source.mediaState === "missing"
    ));
  }

  async function recover(source) {
    if (busy || !unavailable(source) || typeof relinkJob !== "function") return false;
    busy = true;
    document.documentElement.dataset.sourceRecoveryBusy = "true";
    sync();

    try {
      const restored = await relinkJob(source);
      if (restored) {
        window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
          detail: { reason: "source-relinked-from-editor", sourcePath: source.sourcePath }
        }));
      }
      return Boolean(restored);
    } catch (error) {
      console.warn("[SourceRecovery] Could not relink source", error);
      return false;
    } finally {
      busy = false;
      delete document.documentElement.dataset.sourceRecoveryBusy;
      queue();
    }
  }

  function syncCommercialOverlay(source, c) {
    const overlay = document.querySelector("#page .core-commercial-media-state");
    if (!(overlay instanceof HTMLElement)) return;
    const action = overlay.querySelector("[data-commercial-media-action]");
    const title = overlay.querySelector("[data-commercial-media-title]");
    const body = overlay.querySelector("[data-commercial-media-body]");

    if (!unavailable(source)) {
      overlay.removeAttribute("data-source-recovery");
      return;
    }

    overlay.dataset.sourceRecovery = "true";
    setTextIfChanged(title, source?.fileState === "trashed" ? c.trashedTitle : c.missingTitle);
    setTextIfChanged(body, c.body);
    if (action instanceof HTMLButtonElement) {
      setTextIfChanged(action, busy ? c.relinking : c.relink);
      action.disabled = busy;
      action.dataset.sourceRecoveryAction = "relink";
      action.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function syncAssetPanel(source, c) {
    const button = document.querySelector("#page .core-editor-assets-panel [data-source-asset]");
    if (!(button instanceof HTMLButtonElement)) return;
    let hint = button.querySelector(":scope .core-source-recovery-hint");

    if (!unavailable(source)) {
      button.classList.remove("needs-source-recovery");
      button.removeAttribute("data-source-recovery-action");
      button.removeAttribute("aria-busy");
      hint?.remove();
      return;
    }

    button.disabled = false;
    button.classList.remove("is-disabled");
    button.classList.add("needs-source-recovery");
    button.dataset.sourceRecoveryAction = "relink";
    button.title = c.unavailable + " · " + c.relink;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-busy", busy ? "true" : "false");

    if (!hint) {
      hint = document.createElement("span");
      hint.className = "core-source-recovery-hint";
      button.appendChild(hint);
    }
    setTextIfChanged(hint, busy ? c.relinking : c.sourceHint);
  }

  function sync() {
    queued = false;
    const source = latestSource();
    const c = copy();
    syncCommercialOverlay(source, c);
    syncAssetPanel(source, c);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function onClickCapture(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const source = latestSource();
    if (!unavailable(source)) return;

    const recovery = target.closest("[data-source-recovery-action='relink'], [data-commercial-media-action], [data-source-asset]");
    if (!(recovery instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    recover(source).catch(() => {});
  }

  function start() {
    document.addEventListener("click", onClickCapture, true);
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "data-state"] });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("focus", queue);
    new MutationObserver(queue).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    queue();
    document.documentElement.dataset.coreSourceRecovery = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
