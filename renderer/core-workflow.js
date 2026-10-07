(function installCoreWorkflow() {
  "use strict";

  const model = window.ViralCoreWorkflowModel;
  if (!model) return;

  const CORE_PAGES = new Set(["download", "speech", "translation", "voice", "editor", "ai-video"]);
  let refreshQueued = false;
  let lastRailMarkup = "";

  function savedState() {
    try { return JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}"); }
    catch { return {}; }
  }

  function locale() {
    return savedState().locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          current: "Core workflow",
          comingSoon: "Coming soon",
          importVideo: "Import video",
          stages: { import: "IMPORT", analyze: "ANALYZE", transcript: "TRANSCRIPT", edit: "EDIT", localize: "LOCALIZE", render: "RENDER" },
          states: { completed: "Done", processing: "Working", failed: "Needs attention", cancelled: "Cancelled", blocked: "Locked", active: "Ready", idle: "Waiting" },
          reasons: {
            importActive: "Choose a source video to start.", importDone: "The source video is ready.", importMissing: "The source video is no longer available.",
            analyzeWorking: "Checking video metadata and media information.", analyzeDone: "Video metadata is ready.", analyzeBlocked: "Import an available source video first.",
            transcriptReady: "Run speech recognition to create the transcript.", transcriptWorking: "Speech recognition is running.", transcriptDone: "Transcript and timestamps are ready.", transcriptBlocked: "A valid analyzed video is required first.",
            editReady: "Review and edit the transcript before localization.", editDone: "Transcript editing is available while localization continues.", editBlocked: "Create the transcript first.",
            localizeTranslate: "Translate the transcript before generating AI Voice.", localizeVoice: "Translation is ready. Generate AI Voice next.", localizeWorking: "Localization is being processed.", localizeDone: "Translation and AI Voice are ready.", localizeBlocked: "Create the transcript first.",
            renderReady: "All required localized inputs are ready to render.", renderWorking: "Rendering the final localized video.", renderDone: "The rendered output is ready.", renderFailed: "Rendering did not finish. Review the issue and retry.", renderBlocked: "Complete translation and AI Voice first.",
            busyControl: "Another processing step is currently running.", missingSourceControl: "The source video is unavailable.", analyzeControl: "Wait until the video analysis is ready.", transcriptControl: "Create the transcript first.", translationControl: "Complete translation first.", voiceControl: "Generate AI Voice first.", renderWaitControl: "Wait for the current processing step to finish.", exportWorking: "Rendering is still in progress. Export will unlock when it finishes.", exportControl: "Export becomes available after a successful render."
          }
        }
      : {
          current: "Quy trình chính",
          comingSoon: "Sắp có",
          importVideo: "Nhập video",
          stages: { import: "NHẬP", analyze: "PHÂN TÍCH", transcript: "LỜI NÓI", edit: "CHỈNH SỬA", localize: "LOCALIZE", render: "RENDER" },
          states: { completed: "Đã xong", processing: "Đang xử lý", failed: "Cần xử lý", cancelled: "Đã hủy", blocked: "Chưa mở", active: "Sẵn sàng", idle: "Đang chờ" },
          reasons: {
            importActive: "Chọn video nguồn để bắt đầu.", importDone: "Video nguồn đã sẵn sàng.", importMissing: "Video nguồn hiện không còn khả dụng.",
            analyzeWorking: "Đang kiểm tra metadata và thông tin media của video.", analyzeDone: "Metadata video đã sẵn sàng.", analyzeBlocked: "Cần nhập một video nguồn khả dụng trước.",
            transcriptReady: "Chạy nhận diện lời nói để tạo transcript.", transcriptWorking: "Đang nhận diện lời nói.", transcriptDone: "Transcript và timestamp đã sẵn sàng.", transcriptBlocked: "Cần video hợp lệ và đã phân tích trước.",
            editReady: "Kiểm tra và chỉnh transcript trước khi localize.", editDone: "Bạn vẫn có thể chỉnh transcript trong khi tiếp tục localize.", editBlocked: "Cần tạo transcript trước.",
            localizeTranslate: "Dịch transcript trước khi tạo Giọng AI.", localizeVoice: "Bản dịch đã sẵn sàng. Tiếp theo hãy tạo Giọng AI.", localizeWorking: "Đang xử lý nội dung localize.", localizeDone: "Bản dịch và Giọng AI đã sẵn sàng.", localizeBlocked: "Cần tạo transcript trước.",
            renderReady: "Đã đủ dữ liệu localize để render.", renderWorking: "Đang render video localize cuối.", renderDone: "File render đã sẵn sàng.", renderFailed: "Render chưa hoàn tất. Hãy kiểm tra trạng thái và thử lại.", renderBlocked: "Cần hoàn tất bản dịch và Giọng AI trước.",
            busyControl: "Đang có một bước xử lý khác chạy.", missingSourceControl: "Video nguồn hiện không khả dụng.", analyzeControl: "Hãy chờ video phân tích xong.", transcriptControl: "Cần tạo transcript trước.", translationControl: "Cần hoàn tất bản dịch trước.", voiceControl: "Cần tạo Giọng AI trước.", renderWaitControl: "Hãy chờ bước xử lý hiện tại hoàn tất.", exportWorking: "Video vẫn đang render. Export sẽ mở khi render hoàn tất.", exportControl: "Export chỉ mở sau khi render thành công."
          }
        };
  }

  function coreSurface(saved) {
    if (CORE_PAGES.has(String(saved?.page || ""))) return true;
    return Boolean(document.querySelector(".preview-video, .transcript-list, #speechStart, #translationStart, #voiceStart, #render, #export"));
  }

  function statusIcon(status, index) {
    if (status === "completed") return "✓";
    if (status === "processing") return '<span class="core-stage-spinner" aria-hidden="true"></span>';
    if (status === "failed") return "!";
    if (status === "cancelled") return "×";
    return String(index + 1);
  }

  function stageReason(stage, derived, c) {
    const r = c.reasons;
    if (stage.id === "import") {
      if (stage.status === "failed") return r.importMissing;
      return stage.status === "completed" ? r.importDone : r.importActive;
    }
    if (stage.id === "analyze") {
      if (stage.status === "completed") return r.analyzeDone;
      if (stage.status === "processing") return r.analyzeWorking;
      return r.analyzeBlocked;
    }
    if (stage.id === "transcript") {
      if (stage.status === "completed") return r.transcriptDone;
      if (stage.status === "processing") return r.transcriptWorking;
      if (stage.status === "blocked") return r.transcriptBlocked;
      return r.transcriptReady;
    }
    if (stage.id === "edit") {
      if (stage.status === "blocked") return r.editBlocked;
      return stage.status === "completed" ? r.editDone : r.editReady;
    }
    if (stage.id === "localize") {
      if (stage.status === "blocked") return r.localizeBlocked;
      if (stage.status === "completed") return r.localizeDone;
      if (stage.status === "processing") return r.localizeWorking;
      return derived.translationResult ? r.localizeVoice : r.localizeTranslate;
    }
    if (stage.id === "render") {
      if (stage.status === "completed") return r.renderDone;
      if (stage.status === "processing") return r.renderWorking;
      if (stage.status === "failed") return r.renderFailed;
      if (stage.status === "active") return r.renderReady;
      return r.renderBlocked;
    }
    return "";
  }

  function controlReason(kind, derived, policy, c) {
    if (policy?.enabled) return "";
    const r = c.reasons;
    const busy = Object.values(derived.jobs || {}).some(value => ["preparing", "uploading", "processing"].includes(value));
    if (derived.missingSource) return r.missingSourceControl;
    if (kind === "speech") return !derived.analyzed ? r.analyzeControl : busy ? r.busyControl : policy?.reason || "";
    if (kind === "translate") return !derived.speechResult ? r.transcriptControl : busy ? r.busyControl : policy?.reason || "";
    if (kind === "voice") return !derived.translationResult ? r.translationControl : busy ? r.busyControl : policy?.reason || "";
    if (kind === "render") {
      if (!derived.translationResult) return r.translationControl;
      if (!derived.voiceResult) return r.voiceControl;
      return busy ? r.renderWaitControl : policy?.reason || "";
    }
    if (kind === "export") return derived.jobs?.render === "processing" ? r.exportWorking : r.exportControl;
    return policy?.reason || "";
  }

  function workflowPosition(stages) {
    const total = Math.max(1, stages.length);
    const completed = stages.filter(stage => stage.status === "completed").length;
    if (completed === total) return { completed, currentIndex: total - 1, progress: 1 };

    let currentIndex = stages.findIndex(stage => ["processing", "active", "failed", "cancelled"].includes(stage.status));
    if (currentIndex < 0) currentIndex = stages.findIndex(stage => stage.status !== "completed");
    currentIndex = Math.max(0, currentIndex);

    const currentStage = stages[currentIndex];
    const lastCompletedIndex = Math.max(-1, completed - 1);
    const visualIndex = currentStage?.status === "processing"
      ? Math.max(lastCompletedIndex, currentIndex - 0.5)
      : lastCompletedIndex;
    const progress = total > 1 ? Math.max(0, Math.min(1, visualIndex / (total - 1))) : 0;

    return { completed, currentIndex, progress };
  }

  function ensureWorkflowRail(derived, saved) {
    const page = document.getElementById("page");
    if (!page) return;

    let rail = page.querySelector(":scope > .core-workflow-shell");
    if (!coreSurface(saved)) {
      rail?.remove();
      lastRailMarkup = "";
      return;
    }

    if (!rail) {
      rail = document.createElement("section");
      rail.className = "core-workflow-shell";
      rail.setAttribute("aria-label", copy().current);
      page.prepend(rail);
      lastRailMarkup = "";
    }

    const c = copy();
    const position = workflowPosition(derived.stages);
    const total = derived.stages.length;
    const edge = total ? (100 / (total * 2)).toFixed(4) + "%" : "0%";
    const markup =
      '<div class="core-workflow-head">' +
        '<div class="core-workflow-title">' + c.current + '</div>' +
        '<div class="core-workflow-progress" aria-hidden="true"><span>' + position.completed + ' / ' + total + '</span></div>' +
      '</div>' +
      '<div class="core-workflow-scroll">' +
        '<div class="core-workflow-rail" style="--workflow-progress:' + position.progress.toFixed(4) + ';--workflow-edge:' + edge + '">' +
          derived.stages.map((stage, index) => {
            const reason = stageReason(stage, derived, c);
            const label = c.stages[stage.id] || stage.label;
            const current = index === position.currentIndex && stage.status !== "completed";
            return '<div class="core-workflow-stage is-' + stage.status + (current ? ' is-current' : '') + '" data-core-stage="' + stage.id + '" data-stage-state="' + stage.status + '" title="' + escapeAttr(reason) + '"' + (current ? ' aria-current="step"' : '') + '>' +
              '<span class="core-stage-index"><span class="core-stage-symbol">' + statusIcon(stage.status, index) + '</span></span>' +
              '<span class="core-stage-copy"><b>' + label + '</b><small>' + (c.states[stage.status] || stage.status) + '</small></span>' +
            '</div>';
          }).join("") +
        '</div>' +
      '</div>';

    rail.setAttribute("aria-label", c.current);
    if (markup !== lastRailMarkup) {
      rail.innerHTML = markup;
      lastRailMarkup = markup;
    }
  }

  function escapeAttr(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function applyGate(selector, policy, reason) {
    const button = document.querySelector(selector);
    if (!(button instanceof HTMLButtonElement) || !policy) return;
    const shouldDisable = policy.enabled !== true;
    button.disabled = shouldDisable;
    button.setAttribute("aria-disabled", shouldDisable ? "true" : "false");
    button.classList.toggle("core-gated", shouldDisable);
    button.dataset.coreCapability = policy.enabled ? "functional" : "disabled";
    if (shouldDisable && reason) {
      button.title = reason;
      button.dataset.coreDisabledReason = reason;
    } else {
      if (button.dataset.coreDisabledReason && button.title === button.dataset.coreDisabledReason) button.removeAttribute("title");
      delete button.dataset.coreDisabledReason;
    }
  }

  function applyControlPolicy(derived) {
    const c = copy();
    applyGate("#speechStart", derived.controls.speech, controlReason("speech", derived, derived.controls.speech, c));
    applyGate("#translationStart", derived.controls.translate, controlReason("translate", derived, derived.controls.translate, c));
    applyGate("#voiceStart", derived.controls.voice, controlReason("voice", derived, derived.controls.voice, c));
    applyGate("#render", derived.controls.render, controlReason("render", derived, derived.controls.render, c));
    applyGate("#export", derived.controls.export, controlReason("export", derived, derived.controls.export, c));
  }

  function markComingSoon() {
    const search = document.querySelector(".command-palette");
    if (search instanceof HTMLButtonElement) {
      search.disabled = true;
      search.setAttribute("aria-disabled", "true");
      search.dataset.coreCapability = "coming-soon";
      search.title = copy().comingSoon;
      if (!search.querySelector(".core-coming-soon")) {
        const badge = document.createElement("span");
        badge.className = "core-coming-soon";
        badge.textContent = copy().comingSoon;
        search.appendChild(badge);
      }
    }
  }

  function wireQuickProject() {
    const button = document.getElementById("quickProject");
    if (!(button instanceof HTMLButtonElement)) return;
    button.dataset.coreCapability = "functional";
    const label = document.getElementById("newProjectLabel");
    if (label) label.textContent = copy().importVideo;
    if (button.dataset.coreImportWired === "true") return;
    button.dataset.coreImportWired = "true";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = Array.from(document.querySelectorAll('[data-page="download"]'))
        .find(node => node !== button && node instanceof HTMLElement && node.offsetParent !== null)
        || document.querySelector('[data-page="download"]')
        || document.querySelector('[data-page="speech"]');
      if (target instanceof HTMLElement) target.click();
    }, true);
  }

  function annotateJobs(derived) {
    const map = [["#speechStart", derived.jobs.speech], ["#translationStart", derived.jobs.translation], ["#voiceStart", derived.jobs.voice]];
    for (const [selector, status] of map) {
      const button = document.querySelector(selector);
      if (button) button.dataset.coreJobState = status;
    }
  }

  function refresh() {
    refreshQueued = false;
    const saved = savedState();
    const derived = model.derive(saved);
    ensureWorkflowRail(derived, saved);
    applyControlPolicy(derived);
    annotateJobs(derived);
    markComingSoon();
    wireQuickProject();
    document.documentElement.dataset.coreWorkflow = "enabled";
    document.documentElement.dataset.coreSourceMissing = derived.missingSource ? "true" : "false";
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  const observer = new MutationObserver(queueRefresh);
  const start = () => {
    const page = document.getElementById("page");
    if (page) observer.observe(page, { childList: true, subtree: true, attributes: false });
    window.addEventListener("viral-ai:core-state-changed", queueRefresh);
    queueRefresh();
    window.setInterval(queueRefresh, 900);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
