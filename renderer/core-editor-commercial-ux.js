(function installCoreEditorCommercialUx() {
  "use strict";

  let queued = false;
  let toastObserver = null;

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved?.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function catalog(key, fallback) {
    try {
      const value = window.I18N?.t?.(locale(), key);
      return typeof value === "string" && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function copy() {
    return locale() === "en"
      ? {
          ready: "Ready",
          needsSetup: "Needs setup",
          connectionError: "Connection error",
          sourceMissingTitle: "Source video is unavailable",
          sourceMissingBody: "The original file may have been moved, renamed, or deleted. Your project data and completed processing are still kept.",
          sourceTrashedTitle: "Source video was moved to Recycle Bin",
          sourceTrashedBody: "The project is still available, but this source file can no longer be read from its previous location.",
          previewUnavailableTitle: "Preview is temporarily unavailable",
          previewUnavailableBody: "The source file is still safe. Retry the preview without changing the project.",
          addAnother: "Add another video",
          retryPreview: "Retry preview",
          sourceUnavailable: "Source video unavailable",
          sourceReady: "Source video",
          transcript: "Transcript",
          collapsedAssets: "Assets panel collapsed"
        }
      : {
          ready: "Sẵn sàng",
          needsSetup: "Cần thiết lập",
          connectionError: "Lỗi kết nối",
          sourceMissingTitle: "Video nguồn không còn khả dụng",
          sourceMissingBody: "File gốc có thể đã bị di chuyển, đổi tên hoặc xóa. Dữ liệu dự án và các bước đã xử lý vẫn được giữ nguyên.",
          sourceTrashedTitle: "Video nguồn đã được chuyển vào Thùng rác",
          sourceTrashedBody: "Dự án vẫn còn nguyên, nhưng file nguồn không thể được đọc từ vị trí cũ.",
          previewUnavailableTitle: "Bản xem trước tạm thời chưa khả dụng",
          previewUnavailableBody: "File nguồn vẫn an toàn. Bạn có thể thử tải lại preview mà không làm thay đổi dự án.",
          addAnother: "Thêm video khác",
          retryPreview: "Thử lại preview",
          sourceUnavailable: "Video nguồn không khả dụng",
          sourceReady: "Video nguồn",
          transcript: "Transcript",
          collapsedAssets: "Thanh tài nguyên đang thu gọn"
        };
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function workflowSnapshot() {
    try {
      return window.ViralCoreWorkflowModel?.derive?.(appState() || {}) || null;
    } catch {
      return null;
    }
  }

  function latestSource() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function sourceVisualState(source) {
    if (!source) return "none";
    if (source.fileState === "trashed") return "trashed";
    if (source.fileState === "missing" || source.mediaState === "missing") return "missing";
    if (source.mediaState === "preview-unavailable") return "preview-unavailable";
    if (source.mediaState === "reading") return "reading";
    return "ready";
  }

  function ensureCommercialMediaState(host) {
    let overlay = host?.querySelector?.(".core-commercial-media-state");
    if (overlay || !(host instanceof HTMLElement)) return overlay;

    overlay = document.createElement("div");
    overlay.className = "core-commercial-media-state";
    overlay.hidden = true;
    overlay.innerHTML = [
      '<div class="core-commercial-media-card" role="status">',
        '<div class="core-commercial-media-icon" aria-hidden="true">!</div>',
        '<div class="core-commercial-media-copy">',
          '<b data-commercial-media-title></b>',
          '<span data-commercial-media-body></span>',
        '</div>',
        '<button type="button" class="core-commercial-media-action" data-commercial-media-action></button>',
      '</div>'
    ].join("");

    host.appendChild(overlay);
    return overlay;
  }

  async function addReplacementVideo() {
    try {
      if (typeof addFiles === "function") await addFiles();
    } catch (error) {
      console.warn("[CommercialUX] Could not open video picker", error);
    }
  }

  function retryPreview(host) {
    const video = host?.querySelector?.("video.preview-video, video.core-player-media");
    try { video?.load?.(); } catch {}
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "commercial-preview-retry" }
    }));
  }

  function syncMediaState(page) {
    const host = page?.querySelector?.(".preview.core-player-host, .preview.preview-real, .core-editor-focus-section .preview");
    if (!(host instanceof HTMLElement)) return;

    const source = latestSource();
    const visualState = sourceVisualState(source);
    const overlay = ensureCommercialMediaState(host);
    if (!(overlay instanceof HTMLElement)) return;

    host.dataset.commercialMediaState = visualState;
    const title = overlay.querySelector("[data-commercial-media-title]");
    const body = overlay.querySelector("[data-commercial-media-body]");
    const action = overlay.querySelector("[data-commercial-media-action]");
    const c = copy();

    if (!["missing", "trashed", "preview-unavailable"].includes(visualState)) {
      overlay.hidden = true;
      return;
    }

    overlay.hidden = false;
    overlay.dataset.state = visualState;

    if (visualState === "missing") {
      if (title) title.textContent = c.sourceMissingTitle;
      if (body) body.textContent = c.sourceMissingBody;
      if (action) action.textContent = c.addAnother;
    } else if (visualState === "trashed") {
      if (title) title.textContent = c.sourceTrashedTitle;
      if (body) body.textContent = c.sourceTrashedBody;
      if (action) action.textContent = c.addAnother;
    } else {
      if (title) title.textContent = c.previewUnavailableTitle;
      if (body) body.textContent = c.previewUnavailableBody;
      if (action) action.textContent = c.retryPreview;
    }

    if (action instanceof HTMLButtonElement && action.dataset.wired !== visualState) {
      action.dataset.wired = visualState;
      action.onclick = () => {
        if (visualState === "preview-unavailable") retryPreview(host);
        else addReplacementVideo();
      };
    }
  }

  function syncAssets(page) {
    const panel = page?.querySelector?.(".core-editor-assets-panel");
    if (!(panel instanceof HTMLElement)) return;

    const c = copy();
    const isCollapsed = panel.classList.contains("is-collapsed");
    panel.dataset.collapsed = isCollapsed ? "true" : "false";
    if (isCollapsed) panel.setAttribute("aria-description", c.collapsedAssets);
    else panel.removeAttribute("aria-description");

    const source = latestSource();
    const stateName = sourceVisualState(source);
    const sourceButton = panel.querySelector("[data-source-asset]");
    const transcriptButton = panel.querySelector("[data-transcript-asset]");

    if (sourceButton instanceof HTMLElement) {
      sourceButton.dataset.fileState = stateName;
      sourceButton.title = stateName === "missing" || stateName === "trashed"
        ? c.sourceUnavailable
        : c.sourceReady;
      sourceButton.setAttribute("aria-label", sourceButton.title);
    }

    if (transcriptButton instanceof HTMLElement) {
      const status = transcriptButton.querySelector("[data-transcript-status]")?.textContent?.trim();
      transcriptButton.title = status ? c.transcript + " · " + status : c.transcript;
      transcriptButton.setAttribute("aria-label", transcriptButton.title);
    }

    panel.querySelectorAll(".core-asset-item").forEach(item => {
      if (!(item instanceof HTMLElement)) return;
      const label = item.querySelector("b")?.textContent?.trim();
      if (label && !item.title) item.title = label;
    });
  }

  function normalizeLegacyConnectionCopy(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const replacement = copy().connectionError;
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    const touched = new Set();
    let node = walker.nextNode();

    while (node) {
      const value = String(node.nodeValue || "").trim();
      if (value === "Lỗi nối") {
        node.nodeValue = String(node.nodeValue || "").replace("Lỗi nối", replacement);
        const owner = node.parentElement?.closest?.("button, [role='button'], .speech-provider-badge, .core-commercial-connection-badge");
        if (owner instanceof HTMLElement) touched.add(owner);
      }
      node = walker.nextNode();
    }

    touched.forEach(owner => owner.setAttribute("aria-label", replacement));
  }

  function syncConnectionPanels(page) {
    const c = copy();
    const selector = [
      ".core-inspector-card .cloud-connection",
      ".core-inspector-card .speech-cloud-panel",
      ".core-inspector-card .translation-connection",
      ".core-inspector-card .voice-connection",
      ".core-inspector-card [class*='connection-panel']",
      ".core-inspector-card [class*='connection-row']"
    ].join(",");

    page?.querySelectorAll?.(selector).forEach(panel => {
      if (!(panel instanceof HTMLElement)) return;
      panel.classList.add("core-commercial-connection");
      normalizeLegacyConnectionCopy(panel);

      const stateName = panel.classList.contains("is-ready")
        ? "ready"
        : panel.classList.contains("needs-action")
          ? "needs-action"
          : "neutral";

      panel.dataset.commercialConnectionState = stateName;
      let badge = panel.querySelector(":scope > .core-commercial-connection-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "core-commercial-connection-badge";
        badge.innerHTML = '<i aria-hidden="true"></i><span></span>';
        panel.prepend(badge);
      }

      const text = badge.querySelector("span");
      if (stateName === "ready") {
        badge.hidden = false;
        if (text) text.textContent = c.ready;
      } else if (stateName === "needs-action") {
        badge.hidden = false;
        if (text) text.textContent = c.needsSetup;
      } else {
        badge.hidden = true;
      }
    });
  }

  function actionState(button) {
    if (!(button instanceof HTMLButtonElement)) return "blocked";
    const value = String(button.textContent || "");
    if (button.dataset.coreJobState === "processing" || /Stop|Dừng|Hủy|Cancel/i.test(value)) return "processing";
    if (button.disabled) return "blocked";
    return "ready";
  }

  function outputActionState(button) {
    const renderState = String(workflowSnapshot()?.jobs?.render || "idle");
    if (["preparing", "uploading", "processing"].includes(renderState)) return "processing";
    return actionState(button);
  }

  function stageStatusLabel(value) {
    const fallback = locale() === "en"
      ? { ready: "Ready", processing: "Processing", blocked: "Not ready" }
      : { ready: "Sẵn sàng", processing: "Đang xử lý", blocked: "Chưa sẵn sàng" };
    if (value === "processing") return catalog("common.processing", fallback.processing);
    if (value === "blocked") return catalog("translation.notReady", fallback.blocked);
    return catalog("translation.ready", fallback.ready);
  }

  function syncWorkflowActions(page) {
    const stages = [
      ["speech", "#speechStart, #speechStop"],
      ["translate", "#translationStart, #translationStop"],
      ["voice", "#voiceStart, #voiceStop"],
      ["output", "#render"]
    ];

    stages.forEach(([stage, selector]) => {
      const button = page?.querySelector?.(selector);
      const tab = page?.querySelector?.('.core-inspector-tab[data-inspector-tab="' + stage + '"]');
      const value = stage === "output" ? outputActionState(button) : actionState(button);

      if (button instanceof HTMLButtonElement) {
        button.classList.add("core-commercial-action");
        button.dataset.commercialActionState = value;
        button.setAttribute("aria-busy", value === "processing" ? "true" : "false");
      }

      if (!(tab instanceof HTMLButtonElement)) return;
      tab.setAttribute("data-commercial-stage-state", value);
      tab.classList.toggle("has-commercial-active", value === "processing");
      tab.classList.toggle("is-commercial-blocked", value === "blocked");

      let dot = tab.querySelector(":scope > .core-commercial-stage-dot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "core-commercial-stage-dot";
        dot.setAttribute("aria-hidden", "true");
        tab.appendChild(dot);
      }

      if (!tab.dataset.commercialBaseLabel) {
        tab.dataset.commercialBaseLabel = String(tab.textContent || "").trim();
      }
      const base = tab.dataset.commercialBaseLabel || String(tab.textContent || "").trim();
      const status = stageStatusLabel(value);
      tab.title = base + " · " + status;
      tab.setAttribute("aria-label", tab.title);
    });

    page?.querySelectorAll?.(".core-inspector-card").forEach(card => {
      if (!(card instanceof HTMLElement)) return;
      const processing = card.querySelector('[data-commercial-action-state="processing"]');
      const available = card.querySelector('[data-commercial-action-state="ready"]');
      card.dataset.commercialCardState = processing ? "processing" : available ? "ready" : "idle";
    });
  }

  function classifyToast(toast) {
    if (!(toast instanceof HTMLElement)) return;
    const value = String(toast.textContent || "").toLowerCase();
    let tone = "neutral";

    if (/(không thể|không tìm thấy|thất bại|lỗi|could not|not found|failed|error)/i.test(value)) tone = "error";
    else if (/(thành công|hoàn tất|đã lưu|sẵn sàng|completed|success|saved|ready)/i.test(value)) tone = "success";
    else if (/(đang |đợi|processing|preparing|uploading|loading|waiting)/i.test(value)) tone = "info";

    toast.dataset.tone = tone;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
  }

  function wireToast() {
    const toast = document.getElementById("toast");
    if (!(toast instanceof HTMLElement) || toastObserver) return;
    classifyToast(toast);
    toastObserver = new MutationObserver(() => classifyToast(toast));
    toastObserver.observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    if (!page.classList.contains("core-editor-workbench-page") && !page.querySelector(".core-editor-focus-section")) return;

    syncAssets(page);
    syncMediaState(page);
    syncConnectionPanels(page);
    syncWorkflowActions(page);
    wireToast();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  function start() {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(queue).observe(page, {
        attributes: true,
        attributeFilter: ["class", "data-core-media-state", "disabled", "data-core-job-state"],
        childList: true,
        subtree: true
      });
    }

    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:transcript-edit", queue);
    wireToast();
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();