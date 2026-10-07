(function installCoreEditorOutputState() {
  "use strict";

  const workflowModel = window.ViralCoreWorkflowModel;
  let queued = false;
  let unsubscribeRenderProgress = null;

  function appState() {
    try {
      if (typeof state !== "undefined") return state;
    } catch {}
    try { return JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}"); }
    catch { return {}; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          eyebrow: "Output",
          ready: "Rendered video is ready",
          body: "The final rendered file has been created successfully.",
          show: "Show file",
          waiting: "Render the localized video to create the final output file.",
          unavailable: "The output file path is not available yet."
        }
      : {
          eyebrow: "Đầu ra",
          ready: "Video render đã sẵn sàng",
          body: "File video cuối đã được tạo thành công.",
          show: "Hiện file",
          waiting: "Hãy render video đã localize để tạo file đầu ra cuối.",
          unavailable: "Đường dẫn file đầu ra hiện chưa khả dụng."
        };
  }

  function basename(value) {
    const raw = String(value || "");
    if (!raw) return "—";
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  }

  function derived(current) {
    try { return workflowModel?.derive?.(current) || null; }
    catch { return null; }
  }

  function ensureCard(outputPane) {
    let card = outputPane.querySelector(":scope > .core-output-state-card");
    if (card instanceof HTMLElement) return card;

    card = document.createElement("section");
    card.className = "core-output-state-card";
    card.hidden = true;
    card.innerHTML = [
      '<div class="core-output-state-icon" aria-hidden="true">✓</div>',
      '<div class="core-output-state-copy">',
        '<small data-output-eyebrow></small>',
        '<b data-output-title></b>',
        '<span data-output-body></span>',
        '<code data-output-file></code>',
      '</div>',
      '<button type="button" class="core-output-state-action" data-output-show></button>'
    ].join("");

    outputPane.prepend(card);
    return card;
  }

  function ensureHint(outputPane) {
    let hint = outputPane.querySelector(":scope > .core-output-state-hint");
    if (hint instanceof HTMLElement) return hint;
    hint = document.createElement("p");
    hint.className = "core-output-state-hint";
    outputPane.prepend(hint);
    return hint;
  }

  function sync() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    const outputPane = page.querySelector('.core-inspector-pane[data-inspector-pane="output"]');
    if (!(outputPane instanceof HTMLElement)) return;

    const current = appState();
    const flow = derived(current);
    const output = flow?.renderOutput || null;
    const labels = copy();
    const card = ensureCard(outputPane);
    const hint = ensureHint(outputPane);

    if (!output?.outputPath) {
      card.hidden = true;
      hint.hidden = false;
      hint.textContent = labels.waiting;
      return;
    }

    hint.hidden = true;
    card.hidden = false;
    card.dataset.outputReady = "true";

    const eyebrow = card.querySelector("[data-output-eyebrow]");
    const title = card.querySelector("[data-output-title]");
    const body = card.querySelector("[data-output-body]");
    const file = card.querySelector("[data-output-file]");
    const show = card.querySelector("[data-output-show]");

    if (eyebrow) eyebrow.textContent = labels.eyebrow;
    if (title) title.textContent = labels.ready;
    if (body) body.textContent = labels.body;
    if (file) {
      file.textContent = basename(output.outputPath);
      file.title = String(output.outputPath);
    }
    if (show instanceof HTMLButtonElement) {
      show.textContent = labels.show;
      show.disabled = !window.desktopAPI?.showFile;
      show.onclick = async () => {
        if (!window.desktopAPI?.showFile) return;
        try { await window.desktopAPI.showFile(output.outputPath); }
        catch (error) { console.warn("[OutputState] Could not reveal output file", error); }
      };
    }
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function wireRenderProgress() {
    if (typeof window.desktopAPI?.onRenderProgress !== "function") return;
    try { unsubscribeRenderProgress = window.desktopAPI.onRenderProgress(() => queue()); }
    catch (error) { console.warn("[OutputState] Could not subscribe to render progress", error); }
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("beforeunload", () => {
      try { unsubscribeRenderProgress?.(); }
      catch {}
      unsubscribeRenderProgress = null;
    }, { once: true });
    wireRenderProgress();
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
