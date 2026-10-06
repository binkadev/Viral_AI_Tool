(function installCoreEditorActivity() {
  "use strict";

  const jobModel = window.ViralCoreJobModel;
  let queued = false;

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
          title: "Current activity",
          projectSafe: "Your project is safe.",
          retry: "Retry",
          stop: "Stop",
          stopping: "Stopping…",
          percent: value => value + "%",
          steps: {
            speech: "Speech recognition",
            translation: "Translation",
            voice: "AI Voice",
            render: "Rendering video"
          },
          phases: {
            validating: "Checking input",
            preparing: "Preparing",
            uploading: "Uploading",
            queued: "Waiting to start",
            processing: "Processing",
            translating: "Translating",
            generating: "Generating voice",
            downloading: "Downloading result",
            rendering: "Rendering video",
            cancelling: "Stopping safely",
            interrupted: "Interrupted",
            failed: "Needs attention",
            error: "Needs attention",
            stale: "Needs attention",
            cancelled: "Cancelled"
          },
          errors: {
            auth: "Cloud access needs to be reconnected before this step can continue.",
            quota: "Your current Cloud allowance is not enough to finish this step.",
            network: "The connection was interrupted before this step finished.",
            source: "The source video is unavailable. Restore or replace the source file and try again.",
            generic: "This step did not finish. You can retry without losing the completed work in this project.",
            cancelled: "This step was stopped. You can start it again when you are ready."
          }
        }
      : {
          title: "Hoạt động hiện tại",
          projectSafe: "Dữ liệu dự án vẫn an toàn.",
          retry: "Thử lại",
          stop: "Dừng",
          stopping: "Đang dừng…",
          percent: value => value + "%",
          steps: {
            speech: "Nhận diện lời nói",
            translation: "Dịch nội dung",
            voice: "Tạo Giọng AI",
            render: "Render video"
          },
          phases: {
            validating: "Đang kiểm tra đầu vào",
            preparing: "Đang chuẩn bị",
            uploading: "Đang tải lên",
            queued: "Đang chờ bắt đầu",
            processing: "Đang xử lý",
            translating: "Đang dịch",
            generating: "Đang tạo giọng",
            downloading: "Đang nhận kết quả",
            rendering: "Đang render video",
            cancelling: "Đang dừng an toàn",
            interrupted: "Đã bị gián đoạn",
            failed: "Cần xử lý",
            error: "Cần xử lý",
            stale: "Cần xử lý",
            cancelled: "Đã dừng"
          },
          errors: {
            auth: "Kết nối Cloud cần được xác thực lại trước khi tiếp tục bước này.",
            quota: "Hạn mức Cloud hiện tại không đủ để hoàn tất bước này.",
            network: "Kết nối đã bị gián đoạn trước khi bước này hoàn tất.",
            source: "Video nguồn hiện không khả dụng. Hãy khôi phục hoặc thay video nguồn rồi thử lại.",
            generic: "Bước này chưa hoàn tất. Bạn có thể thử lại mà không làm mất phần công việc đã hoàn thành.",
            cancelled: "Bước này đã được dừng. Bạn có thể chạy lại khi sẵn sàng."
          }
        };
  }

  function latestRenderJob(current) {
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index]?.isRenderOutput) return jobs[index];
    }
    return null;
  }

  function describe(job) {
    if (jobModel?.describe) return jobModel.describe(job);
    const phase = String(job?.status || job?.state || "idle").toLowerCase();
    const processing = ["validating", "preparing", "uploading", "queued", "processing", "translating", "generating", "downloading", "rendering", "cancelling"].includes(phase);
    const failed = ["failed", "error", "interrupted", "stale"].includes(phase);
    const cancelled = ["cancelled", "canceled"].includes(phase);
    return {
      phase,
      state: processing ? "processing" : failed ? "failed" : cancelled ? "cancelled" : phase === "completed" ? "completed" : "idle",
      busy: processing,
      retryable: failed || cancelled
    };
  }

  function candidates(current) {
    return [
      { id: "speech", job: current?.speech?.job, start: "#speechStart", stop: "#speechStop" },
      { id: "translation", job: current?.translation?.job, start: "#translationStart", stop: "#translationStop" },
      { id: "voice", job: current?.voice?.job, start: "#voiceStart", stop: "#voiceStop" },
      { id: "render", job: latestRenderJob(current), start: "#render", stop: "#renderStop, #cancelRender" }
    ].filter(item => item.job);
  }

  function activityFor(current) {
    const items = candidates(current).map(item => ({ ...item, meta: describe(item.job) }));
    return items.find(item => item.meta.busy)
      || [...items].reverse().find(item => item.meta.state === "failed")
      || [...items].reverse().find(item => item.meta.state === "cancelled")
      || null;
  }

  function progressFor(job) {
    if (job?.indeterminate === true) return { indeterminate: true, value: null };
    const value = Number(job?.progress);
    if (!Number.isFinite(value)) return { indeterminate: true, value: null };
    return { indeterminate: false, value: Math.max(0, Math.min(100, Math.round(value))) };
  }

  function errorCode(job) {
    return String(job?.error?.code || job?.errorCode || job?.code || "").toUpperCase();
  }

  function failureCopy(job, meta, labels) {
    if (meta.state === "cancelled") return labels.errors.cancelled;
    const code = errorCode(job);
    if (/(AUTH|TOKEN|SESSION|UNAUTHORIZED|FORBIDDEN)/.test(code)) return labels.errors.auth;
    if (/(QUOTA|LIMIT|CREDIT|PLAN|ENTITLEMENT)/.test(code)) return labels.errors.quota;
    if (/(NETWORK|TIMEOUT|SERVICE_UNAVAILABLE|CONNECTION|OFFLINE)/.test(code)) return labels.errors.network;
    if (/(SOURCE|FILE|INPUT|NOT_FOUND)/.test(code)) return labels.errors.source;
    return labels.errors.generic;
  }

  function ensureActivity(page) {
    let activity = page.querySelector(":scope > .core-editor-activity");
    if (activity instanceof HTMLElement) return activity;

    activity = document.createElement("section");
    activity.className = "core-editor-activity";
    activity.hidden = true;
    activity.setAttribute("aria-live", "polite");
    activity.innerHTML = [
      '<div class="core-editor-activity-main">',
        '<div class="core-editor-activity-icon" aria-hidden="true"><i></i></div>',
        '<div class="core-editor-activity-copy">',
          '<small data-activity-kicker></small>',
          '<div class="core-editor-activity-title-row"><b data-activity-title></b><strong data-activity-percent></strong></div>',
          '<span data-activity-detail></span>',
        '</div>',
      '</div>',
      '<div class="core-editor-activity-progress" data-activity-progress role="progressbar"><i></i></div>',
      '<div class="core-editor-activity-actions">',
        '<button type="button" class="core-editor-activity-button is-stop" data-activity-stop></button>',
        '<button type="button" class="core-editor-activity-button is-retry" data-activity-retry></button>',
      '</div>'
    ].join("");

    const rail = page.querySelector(":scope > .core-workflow-shell");
    if (rail) rail.insertAdjacentElement("afterend", activity);
    else page.prepend(activity);
    return activity;
  }

  function buttonFor(selector) {
    if (!selector) return null;
    return document.querySelector(selector);
  }

  function syncActivity(page) {
    const current = appState();
    const active = activityFor(current);
    const activity = ensureActivity(page);
    if (!(activity instanceof HTMLElement)) return;

    if (!active) {
      activity.hidden = true;
      activity.removeAttribute("data-state");
      return;
    }

    const labels = copy();
    const { job, meta } = active;
    const progress = progressFor(job);
    const rawPhase = String(meta.phase || job?.status || job?.state || meta.state || "processing").toLowerCase();
    const phaseLabel = labels.phases[rawPhase] || labels.phases[meta.state] || labels.phases.processing;
    const isAttention = meta.state === "failed" || meta.state === "cancelled";

    activity.hidden = false;
    activity.dataset.state = isAttention ? meta.state : "processing";
    activity.dataset.step = active.id;

    const kicker = activity.querySelector("[data-activity-kicker]");
    const title = activity.querySelector("[data-activity-title]");
    const detail = activity.querySelector("[data-activity-detail]");
    const percent = activity.querySelector("[data-activity-percent]");
    const track = activity.querySelector("[data-activity-progress]");
    const fill = track?.querySelector("i");
    const stop = activity.querySelector("[data-activity-stop]");
    const retry = activity.querySelector("[data-activity-retry]");

    if (kicker) kicker.textContent = labels.title;
    if (title) title.textContent = labels.steps[active.id] || active.id;
    if (detail) detail.textContent = isAttention
      ? failureCopy(job, meta, labels) + " " + labels.projectSafe
      : phaseLabel;

    if (percent) percent.textContent = !isAttention && !progress.indeterminate ? labels.percent(progress.value) : "";

    if (track instanceof HTMLElement) {
      track.hidden = isAttention;
      track.classList.toggle("is-indeterminate", progress.indeterminate);
      track.setAttribute("aria-label", labels.steps[active.id] || active.id);
      if (!isAttention && !progress.indeterminate) {
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", String(progress.value));
      } else {
        track.removeAttribute("aria-valuenow");
      }
    }
    if (fill instanceof HTMLElement) fill.style.width = progress.indeterminate ? "34%" : progress.value + "%";

    const stopTarget = buttonFor(active.stop);
    if (stop instanceof HTMLButtonElement) {
      stop.hidden = !meta.busy || !(stopTarget instanceof HTMLButtonElement);
      stop.textContent = rawPhase === "cancelling" ? labels.stopping : labels.stop;
      stop.disabled = rawPhase === "cancelling" || !(stopTarget instanceof HTMLButtonElement) || stopTarget.disabled;
      stop.onclick = () => {
        if (stopTarget instanceof HTMLButtonElement && !stopTarget.disabled) stopTarget.click();
      };
    }

    const retryTarget = buttonFor(active.start);
    if (retry instanceof HTMLButtonElement) {
      retry.hidden = !isAttention;
      retry.textContent = labels.retry;
      retry.disabled = !(retryTarget instanceof HTMLButtonElement) || retryTarget.disabled;
      retry.title = retryTarget?.title || "";
      retry.onclick = () => {
        if (retryTarget instanceof HTMLButtonElement && !retryTarget.disabled) retryTarget.click();
      };
    }
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement)) return;
    const inCore = page.classList.contains("core-editor-workbench-page") || page.querySelector(".core-workflow-shell");
    if (!inCore) return;
    syncActivity(page);
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
    window.setInterval(queue, 700);
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
