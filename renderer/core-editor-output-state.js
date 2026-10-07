(function installCoreEditorOutputState() {
  "use strict";

  const workflowModel = window.ViralCoreWorkflowModel;
  let queued = false;
  let unsubscribeRenderProgress = null;
  let checkedOutputPath = "";
  let outputExists = null;
  let outputCheckPending = false;

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
          checking: "Checking file…",
          missing: "Rendered file is no longer available",
          missingBody: "The output may have been moved, renamed, or deleted. Your project is still available and can be rendered again.",
          rerender: "Render again",
          waiting: "Render the localized video to create the final output file.",
          unavailable: "The output file path is not available yet."
        }
      : {
          eyebrow: "Đầu ra",
          ready: "Video render đã sẵn sàng",
          body: "File video cuối đã được tạo thành công.",
          show: "Hiện file",
          checking: "Đang kiểm tra file…",
          missing: "File render không còn khả dụng",
          missingBody: "File đầu ra có thể đã bị di chuyển, đổi tên hoặc xóa. Dự án vẫn còn và bạn có thể render lại.",
          rerender: "Render lại",
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

  function currentOutput() {
    return derived(appState())?.renderOutput || null;
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

  async function checkOutput(path, { force = false } = {}) {
    const value = String(path || "");
    if (!value) return null;

    if (checkedOutputPath !== value) {
      checkedOutputPath = value;
      outputExists = null;
    }

    if (!window.desktopAPI?.fileStatus) {
      outputExists = true;
      return true;
    }
    if (outputCheckPending) return outputExists;
    if (!force && outputExists !== null) return outputExists;

    outputCheckPending = true;
    try {
      const status = await window.desktopAPI.fileStatus(value);
      if (checkedOutputPath === value) outputExists = status?.exists === true;
    } catch {
      if (checkedOutputPath === value) outputExists = null;
    } finally {
      outputCheckPending = false;
      queue();
    }
    return outputExists;
  }

  function outputAvailability(output) {
    const path = String(output?.outputPath || "");
    if (!path) return "none";
    if (output?.fileState === "missing" || output?.fileState === "trashed") return "missing";
    if (checkedOutputPath !== path) {
      checkedOutputPath = path;
      outputExists = null;
    }
    if (outputExists === false) return "missing";
    if (outputExists === true) return "ready";
    checkOutput(path).catch(() => {});
    return "checking";
  }

  function sync() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    const outputPane = page.querySelector('.core-inspector-pane[data-inspector-pane="output"]');
    if (!(outputPane instanceof HTMLElement)) return;

    const output = currentOutput();
    const labels = copy();
    const card = ensureCard(outputPane);
    const hint = ensureHint(outputPane);

    if (!output?.outputPath) {
      card.hidden = true;
      hint.hidden = false;
      hint.textContent = labels.waiting;
      checkedOutputPath = "";
      outputExists = null;
      return;
    }

    hint.hidden = true;
    card.hidden = false;
    const availability = outputAvailability(output);
    card.dataset.outputState = availability;
    card.dataset.outputReady = availability === "ready" ? "true" : "false";

    const icon = card.querySelector(".core-output-state-icon");
    const eyebrow = card.querySelector("[data-output-eyebrow]");
    const title = card.querySelector("[data-output-title]");
    const body = card.querySelector("[data-output-body]");
    const file = card.querySelector("[data-output-file]");
    const action = card.querySelector("[data-output-show]");

    if (eyebrow) eyebrow.textContent = labels.eyebrow;
    if (file) {
      file.textContent = basename(output.outputPath);
      file.title = String(output.outputPath);
    }

    if (availability === "missing") {
      if (icon) icon.textContent = "!";
      if (title) title.textContent = labels.missing;
      if (body) body.textContent = labels.missingBody;
      if (action instanceof HTMLButtonElement) {
        const render = document.getElementById("render");
        action.textContent = labels.rerender;
        action.disabled = !(render instanceof HTMLButtonElement) || render.disabled;
        action.onclick = () => {
          const target = document.getElementById("render");
          if (target instanceof HTMLButtonElement && !target.disabled) target.click();
        };
      }
      return;
    }

    if (availability === "checking") {
      if (icon) icon.textContent = "…";
      if (title) title.textContent = labels.checking;
      if (body) body.textContent = labels.body;
      if (action instanceof HTMLButtonElement) {
        action.textContent = labels.checking;
        action.disabled = true;
        action.onclick = null;
      }
      return;
    }

    if (icon) icon.textContent = "✓";
    if (title) title.textContent = labels.ready;
    if (body) body.textContent = labels.body;
    if (action instanceof HTMLButtonElement) {
      action.textContent = labels.show;
      action.disabled = !window.desktopAPI?.showFile;
      action.onclick = async () => {
        if (!window.desktopAPI?.showFile) return;
        const exists = await checkOutput(output.outputPath, { force: true });
        if (exists === false) return;
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

  function recheckCurrentOutput() {
    const output = currentOutput();
    if (!output?.outputPath) {
      queue();
      return;
    }
    checkOutput(output.outputPath, { force: true }).catch(() => {});
  }

  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("focus", recheckCurrentOutput);
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
