(function installAutomationCreator() {
  "use strict";

  const runtime = {
    providerStatus: null,
    statusLoading: false,
    statusCheckedAt: 0,
    runningJobId: null,
    draft: null
  };

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function c() {
    return locale() === "en"
      ? {
          eyebrow: "AI AUTOMATION",
          title: "Create from an idea",
          desc: "Turn a topic or product into an editable script first. Scenes, assets and timeline are added in the next phases.",
          stageBrief: "Brief",
          stageScript: "Script",
          stageScenes: "Scenes",
          stageAssets: "Assets",
          stageTimeline: "Timeline",
          ready: "Ready",
          pending: "Next phase",
          topic: "Topic",
          topicPlaceholder: "Example: 5 Korean-style outfit ideas for men",
          product: "Product (optional)",
          productPlaceholder: "Product name or offer",
          objective: "Objective",
          objectivePlaceholder: "What should this video achieve?",
          audience: "Audience",
          audiencePlaceholder: "Example: Men 18–28",
          platform: "Platform",
          duration: "Target duration",
          seconds: "seconds",
          language: "Output language",
          tone: "Tone",
          tonePlaceholder: "Natural, fast, premium…",
          cta: "Call to action",
          ctaPlaceholder: "Follow for part 2",
          createScript: "Generate script",
          regenerate: "Generate again",
          stop: "Stop",
          providerReady: "Script AI ready",
          providerMissing: "Script AI is not configured",
          providerChecking: "Checking Script AI…",
          providerHelp: "Configure OPENAI_API_KEY on the backend/dev environment before real generation.",
          briefRequired: "Enter a topic or product first.",
          jobPreparing: "Preparing request…",
          jobProcessing: "Generating script…",
          jobCompleted: "Script ready",
          jobCancelled: "Generation stopped",
          jobFailed: "Generation failed",
          scriptTitle: "Generated script",
          scriptDesc: "This is project data, not a locked final output. Edit it before Scene Planner uses it.",
          titleLabel: "Title",
          hookLabel: "Hook",
          bodyLabel: "Main body",
          ctaLabel: "CTA",
          narrationLabel: "Narration",
          saveEdits: "Save script edits",
          saved: "Script changes saved.",
          noScriptTitle: "No script yet",
          noScriptBody: "Fill the brief and generate the first editable script.",
          nextTitle: "Next: Scene Planner",
          nextBody: "A3 will split this script into editable scenes with timing, visual intent and search terms.",
          a3Locked: "Starts after ScriptEngine verification",
          unavailable: "Script provider is not ready.",
          failed: "Could not generate the script. Check provider configuration and try again.",
          cancelled: "Script generation was cancelled.",
          projectSaved: "Brief saved to this project.",
          stale: "The brief changed. Generate a new script before continuing.",
          edited: "Edited",
          generated: "Generated",
          model: "Model"
        }
      : {
          eyebrow: "AI AUTOMATION",
          title: "Tạo video từ một ý tưởng",
          desc: "Biến chủ đề hoặc sản phẩm thành kịch bản có thể chỉnh sửa trước. Scene, asset và timeline sẽ được nối ở các phase tiếp theo.",
          stageBrief: "Brief",
          stageScript: "Kịch bản",
          stageScenes: "Phân cảnh",
          stageAssets: "Tư liệu",
          stageTimeline: "Timeline",
          ready: "Sẵn sàng",
          pending: "Phase tiếp theo",
          topic: "Chủ đề",
          topicPlaceholder: "Ví dụ: 5 cách phối đồ nam phong cách Hàn",
          product: "Sản phẩm (không bắt buộc)",
          productPlaceholder: "Tên sản phẩm hoặc ưu đãi",
          objective: "Mục tiêu",
          objectivePlaceholder: "Video này cần đạt điều gì?",
          audience: "Đối tượng",
          audiencePlaceholder: "Ví dụ: Nam 18–28 tuổi",
          platform: "Nền tảng",
          duration: "Thời lượng mục tiêu",
          seconds: "giây",
          language: "Ngôn ngữ đầu ra",
          tone: "Giọng điệu",
          tonePlaceholder: "Tự nhiên, nhanh, cao cấp…",
          cta: "Kêu gọi hành động",
          ctaPlaceholder: "Theo dõi để xem phần 2",
          createScript: "Tạo kịch bản",
          regenerate: "Tạo lại",
          stop: "Dừng",
          providerReady: "AI kịch bản đã sẵn sàng",
          providerMissing: "AI kịch bản chưa được cấu hình",
          providerChecking: "Đang kiểm tra AI kịch bản…",
          providerHelp: "Cấu hình OPENAI_API_KEY ở backend/môi trường dev trước khi tạo thật.",
          briefRequired: "Hãy nhập chủ đề hoặc sản phẩm trước.",
          jobPreparing: "Đang chuẩn bị yêu cầu…",
          jobProcessing: "Đang tạo kịch bản…",
          jobCompleted: "Kịch bản đã sẵn sàng",
          jobCancelled: "Đã dừng tạo kịch bản",
          jobFailed: "Tạo kịch bản thất bại",
          scriptTitle: "Kịch bản đã tạo",
          scriptDesc: "Đây là dữ liệu của project, không phải kết quả bị khóa. Bạn có thể sửa trước khi Scene Planner sử dụng.",
          titleLabel: "Tiêu đề",
          hookLabel: "Hook",
          bodyLabel: "Nội dung chính",
          ctaLabel: "CTA",
          narrationLabel: "Lời đọc",
          saveEdits: "Lưu chỉnh sửa",
          saved: "Đã lưu chỉnh sửa kịch bản.",
          noScriptTitle: "Chưa có kịch bản",
          noScriptBody: "Điền brief và tạo kịch bản đầu tiên có thể chỉnh sửa.",
          nextTitle: "Tiếp theo: Scene Planner",
          nextBody: "A3 sẽ tách kịch bản này thành các phân cảnh có timing, visual intent và từ khóa tìm tư liệu.",
          a3Locked: "Bắt đầu sau khi ScriptEngine được verify",
          unavailable: "Provider tạo kịch bản chưa sẵn sàng.",
          failed: "Không thể tạo kịch bản. Kiểm tra cấu hình provider rồi thử lại.",
          cancelled: "Đã hủy tạo kịch bản.",
          projectSaved: "Brief đã được lưu vào project này.",
          stale: "Brief đã thay đổi. Hãy tạo lại kịch bản trước khi đi tiếp.",
          edited: "Đã chỉnh sửa",
          generated: "AI tạo",
          model: "Model"
        };
  }

  function currentAutomation() {
    const current = appState();
    if (!current) return null;
    if (!current.automation) {
      try { current.automation = window.ViralAutomationState?.hydrate?.() || null; } catch {}
    }
    return current.automation || null;
  }

  function briefDraft() {
    const brief = currentAutomation()?.brief;
    if (!runtime.draft) {
      runtime.draft = {
        topic: brief?.topic || "",
        product: brief?.product || "",
        objective: brief?.objective || "",
        audience: brief?.audience || "",
        platform: brief?.platform || "tiktok",
        aspectRatio: brief?.aspectRatio || "9:16",
        targetDurationSec: Number(brief?.targetDurationSec || 30),
        language: brief?.language || locale(),
        tone: brief?.tone || "",
        callToAction: brief?.callToAction || "",
        constraints: Array.isArray(brief?.constraints) ? brief.constraints.slice() : []
      };
    }
    return runtime.draft;
  }

  function scriptJob() {
    return currentAutomation()?.jobs?.script || null;
  }

  function scriptStatusLabel(job) {
    const copy = c();
    if (!job) return "";
    const status = String(job.status || job.state || "");
    if (["preparing", "validating"].includes(status)) return copy.jobPreparing;
    if (["processing", "queued"].includes(status)) return copy.jobProcessing;
    if (status === "completed") return copy.jobCompleted;
    if (status === "cancelled") return copy.jobCancelled;
    if (status === "failed") return copy.jobFailed;
    return copy.jobProcessing;
  }

  function stage(label, number, stateName, detail) {
    return '<div class="automation-stage ' + stateName + '"><span>' + number + '</span><div><b>' + esc(label) + '</b><small>' + esc(detail) + '</small></div></div>';
  }

  function renderScript(script, stale) {
    const copy = c();
    if (!script) {
      return '<div class="automation-script-empty"><div class="automation-empty-icon">✦</div><h3>' + esc(copy.noScriptTitle) + '</h3><p>' + esc(copy.noScriptBody) + '</p></div>';
    }

    const edited = script?.meta?.userEdited === true;
    return '<div class="automation-script-editor">' +
      '<div class="automation-script-head"><div><div class="eyebrow">' + esc(copy.scriptTitle) + '</div><h3>' + esc(script.title || copy.scriptTitle) + '</h3><p>' + esc(copy.scriptDesc) + '</p></div>' +
        '<div class="automation-script-meta"><span>' + esc(edited ? copy.edited : copy.generated) + '</span><code>' + esc(script.model || "—") + '</code></div></div>' +
      (stale ? '<div class="automation-inline-warning">! ' + esc(copy.stale) + '</div>' : '') +
      '<label class="label" for="automationScriptTitle">' + esc(copy.titleLabel) + '</label>' +
      '<input id="automationScriptTitle" class="input" value="' + esc(script.title || "") + '">' +
      '<label class="label" for="automationScriptHook">' + esc(copy.hookLabel) + '</label>' +
      '<textarea id="automationScriptHook" class="textarea" rows="3">' + esc(script.hook || "") + '</textarea>' +
      '<label class="label" for="automationScriptBody">' + esc(copy.bodyLabel) + '</label>' +
      '<textarea id="automationScriptBody" class="textarea automation-script-body" rows="8">' + esc(script.body || "") + '</textarea>' +
      '<label class="label" for="automationScriptCta">' + esc(copy.ctaLabel) + '</label>' +
      '<textarea id="automationScriptCta" class="textarea" rows="2">' + esc(script.callToAction || "") + '</textarea>' +
      '<label class="label" for="automationNarration">' + esc(copy.narrationLabel) + '</label>' +
      '<textarea id="automationNarration" class="textarea automation-narration" rows="8">' + esc(script.narrationText || "") + '</textarea>' +
      '<div class="automation-script-actions"><button id="automationSaveScript" class="button primary" type="button">' + esc(copy.saveEdits) + '</button></div>' +
    '</div>';
  }

  function creatorPage() {
    const copy = c();
    const automation = currentAutomation();
    const brief = briefDraft();
    const script = automation?.script || null;
    const job = scriptJob();
    const busy = job && ["preparing", "validating", "queued", "processing", "cancelling"].includes(String(job.status || job.state || ""));
    const providerReady = runtime.providerStatus?.ready === true;
    const providerCopy = runtime.statusLoading
      ? copy.providerChecking
      : providerReady
        ? copy.providerReady
        : copy.providerMissing;

    if (!runtime.providerStatus && !runtime.statusLoading) {
      setTimeout(() => refreshProviderStatus({ rerender: true }), 0);
    }

    return '<div class="automation-creator">' +
      '<div class="automation-hero"><div><div class="eyebrow">' + esc(copy.eyebrow) + '</div><h2>' + esc(copy.title) + '</h2><p>' + esc(copy.desc) + '</p></div>' +
        '<div class="automation-provider ' + (providerReady ? "ready" : "pending") + '"><i></i><div><b>' + esc(providerCopy) + '</b><small>' + esc(providerReady ? (runtime.providerStatus?.provider || "OpenAI") : copy.providerHelp) + '</small></div></div></div>' +
      '<div class="automation-stage-rail">' +
        stage(copy.stageBrief, "1", "ready", copy.ready) +
        stage(copy.stageScript, "2", script ? "ready" : (busy ? "active" : "active"), script ? copy.ready : (busy ? scriptStatusLabel(job) : copy.ready)) +
        stage(copy.stageScenes, "3", "locked", copy.pending) +
        stage(copy.stageAssets, "4", "locked", copy.pending) +
        stage(copy.stageTimeline, "5", "locked", copy.pending) +
      '</div>' +
      '<div class="automation-grid">' +
        '<section class="card automation-brief-card"><div class="automation-card-head"><div><div class="eyebrow">01 · ' + esc(copy.stageBrief) + '</div><h3>' + esc(copy.title) + '</h3></div>' +
          (busy
            ? '<button id="automationStopScript" class="button danger" type="button">' + esc(copy.stop) + '</button>'
            : '<button id="automationGenerateScript" class="button primary" type="button">✦ ' + esc(script ? copy.regenerate : copy.createScript) + '</button>') +
        '</div>' +
        '<div class="automation-brief-fields">' +
          '<div class="automation-field span-2"><label class="label" for="automationTopic">' + esc(copy.topic) + '</label><input id="automationTopic" class="input" maxlength="1000" placeholder="' + esc(copy.topicPlaceholder) + '" value="' + esc(brief.topic) + '"></div>' +
          '<div class="automation-field span-2"><label class="label" for="automationProduct">' + esc(copy.product) + '</label><input id="automationProduct" class="input" maxlength="1000" placeholder="' + esc(copy.productPlaceholder) + '" value="' + esc(brief.product) + '"></div>' +
          '<div class="automation-field span-2"><label class="label" for="automationObjective">' + esc(copy.objective) + '</label><textarea id="automationObjective" class="textarea" rows="3" placeholder="' + esc(copy.objectivePlaceholder) + '">' + esc(brief.objective) + '</textarea></div>' +
          '<div class="automation-field"><label class="label" for="automationAudience">' + esc(copy.audience) + '</label><input id="automationAudience" class="input" placeholder="' + esc(copy.audiencePlaceholder) + '" value="' + esc(brief.audience) + '"></div>' +
          '<div class="automation-field"><label class="label" for="automationPlatform">' + esc(copy.platform) + '</label><select id="automationPlatform" class="select">' +
            ["tiktok","reels","youtube-shorts","youtube","generic"].map(value => '<option value="' + value + '"' + (brief.platform === value ? " selected" : "") + '>' + value.replace("youtube-shorts","YouTube Shorts").replace("youtube","YouTube").replace("tiktok","TikTok").replace("reels","Reels").replace("generic","Generic") + '</option>').join("") +
          '</select></div>' +
          '<div class="automation-field"><label class="label" for="automationDuration">' + esc(copy.duration) + '</label><div class="automation-duration"><input id="automationDuration" class="input" type="number" min="5" max="1800" step="1" value="' + esc(brief.targetDurationSec) + '"><span>' + esc(copy.seconds) + '</span></div></div>' +
          '<div class="automation-field"><label class="label" for="automationLanguage">' + esc(copy.language) + '</label><select id="automationLanguage" class="select">' +
            ["vi","en","ko","ja"].map(value => '<option value="' + value + '"' + (brief.language === value ? " selected" : "") + '>' + ({vi:"Tiếng Việt",en:"English",ko:"한국어",ja:"日本語"}[value]) + '</option>').join("") +
          '</select></div>' +
          '<div class="automation-field span-2"><label class="label" for="automationTone">' + esc(copy.tone) + '</label><input id="automationTone" class="input" placeholder="' + esc(copy.tonePlaceholder) + '" value="' + esc(brief.tone) + '"></div>' +
          '<div class="automation-field span-2"><label class="label" for="automationCta">' + esc(copy.cta) + '</label><input id="automationCta" class="input" placeholder="' + esc(copy.ctaPlaceholder) + '" value="' + esc(brief.callToAction) + '"></div>' +
        '</div>' +
        (busy ? '<div class="automation-job"><div><b id="automationJobLabel">' + esc(scriptStatusLabel(job)) + '</b><span id="automationJobPercent">' + (job.indeterminate ? "•••" : Math.round(Number(job.progress || 0)) + "%") + '</span></div><div id="automationJobTrack" class="automation-progress ' + (job.indeterminate ? "indeterminate" : "") + '"><i id="automationJobBar" style="width:' + (job.indeterminate ? 36 : Math.round(Number(job.progress || 0))) + '%"></i></div></div>' : '') +
        '</section>' +
        '<section class="card automation-script-card">' + renderScript(script, automation?.stale?.script === true) + '</section>' +
      '</div>' +
      '<div class="card automation-next-card"><div><div class="eyebrow">03 · ' + esc(copy.stageScenes) + '</div><h3>' + esc(copy.nextTitle) + '</h3><p>' + esc(copy.nextBody) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(copy.a3Locked) + '</button></div>' +
    '</div>';
  }

  function captureDraft() {
    const get = id => document.getElementById(id);
    const draft = {
      topic: get("automationTopic")?.value || "",
      product: get("automationProduct")?.value || "",
      objective: get("automationObjective")?.value || "",
      audience: get("automationAudience")?.value || "",
      platform: get("automationPlatform")?.value || "tiktok",
      aspectRatio: "9:16",
      targetDurationSec: Number(get("automationDuration")?.value || 30),
      language: get("automationLanguage")?.value || locale(),
      tone: get("automationTone")?.value || "",
      callToAction: get("automationCta")?.value || "",
      constraints: runtime.draft?.constraints || []
    };
    runtime.draft = draft;
    return draft;
  }

  function setJob(job) {
    window.ViralAutomationScriptState?.setJob?.(job);
  }

  function setJobDirect(job) {
    const current = appState();
    if (!current?.automation) return;
    if (!current.automation.jobs || typeof current.automation.jobs !== "object") current.automation.jobs = {};
    current.automation.jobs.script = job;
    try { window.ViralCoreProjectPersistence?.schedule?.("automation-script-progress"); } catch {}
  }

  function rerender() {
    try { if (typeof render === "function") render(); } catch {}
  }

  async function refreshProviderStatus({ rerender: rerenderPage = false } = {}) {
    if (runtime.statusLoading || !window.desktopAPI?.getAutomationScriptStatus) return runtime.providerStatus;
    runtime.statusLoading = true;
    try {
      runtime.providerStatus = await window.desktopAPI.getAutomationScriptStatus();
    } catch {
      runtime.providerStatus = { ready: false, code: "AUTOMATION_SCRIPT_PROVIDER_UNAVAILABLE" };
    } finally {
      runtime.statusLoading = false;
      runtime.statusCheckedAt = Date.now();
    }
    if (rerenderPage && appState()?.page === "automation") rerender();
    return runtime.providerStatus;
  }

  async function generateScript() {
    if (runtime.runningJobId) return;
    const copy = c();
    const briefInput = captureDraft();
    const savedBrief = window.ViralAutomationState?.setBrief?.(briefInput);
    if (!savedBrief?.ok) {
      try { if (typeof toast === "function") toast(copy.briefRequired); } catch {}
      return;
    }

    const status = await refreshProviderStatus({ rerender: false });
    if (!status?.ready) {
      try {
        if (typeof showNotice === "function") {
          await showNotice({ title: copy.providerMissing, body: copy.providerHelp, buttonLabel: locale() === "en" ? "Close" : "Đóng" });
        } else if (typeof toast === "function") toast(copy.unavailable);
      } catch {}
      rerender();
      return;
    }

    const jobId = "automation-script-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const job = {
      id: jobId,
      type: "automation-script",
      status: "preparing",
      progress: 0,
      indeterminate: false,
      briefSignature: savedBrief.value?.inputSignature || savedBrief.signature || "",
      startedAt: Date.now(),
      failureCode: null
    };
    runtime.runningJobId = jobId;
    setJob(job);
    rerender();

    let response;
    try {
      response = await window.desktopAPI.startAutomationScript({
        jobId,
        brief: savedBrief.value
      });
    } catch {
      response = { ok: false, error: { code: "AUTOMATION_SCRIPT_NETWORK" } };
    }

    runtime.runningJobId = null;
    const currentJob = currentAutomation()?.jobs?.script || job;

    if (!response?.ok) {
      currentJob.status = "failed";
      currentJob.progress = 0;
      currentJob.indeterminate = false;
      currentJob.failureCode = response?.error?.code || "AUTOMATION_SCRIPT_FAILED";
      currentJob.completedAt = Date.now();
      setJob(currentJob);
      rerender();
      try {
        if (typeof showNotice === "function") await showNotice({ title: copy.jobFailed, body: copy.failed, buttonLabel: locale() === "en" ? "Close" : "Đóng" });
      } catch {}
      return;
    }

    if (response.data?.cancelled || currentJob.status === "cancelling") {
      currentJob.status = "cancelled";
      currentJob.progress = 0;
      currentJob.indeterminate = false;
      currentJob.completedAt = Date.now();
      setJob(currentJob);
      rerender();
      try { if (typeof toast === "function") toast(copy.cancelled); } catch {}
      return;
    }

    const accepted = window.ViralAutomationScriptState?.acceptScript?.(response.data?.result);
    if (!accepted?.ok) {
      currentJob.status = "failed";
      currentJob.failureCode = accepted?.code || "AUTOMATION_SCRIPT_RESULT_INVALID";
      currentJob.progress = 0;
      currentJob.indeterminate = false;
      setJob(currentJob);
      rerender();
      try { if (typeof toast === "function") toast(copy.failed); } catch {}
      return;
    }

    currentJob.status = "completed";
    currentJob.progress = 100;
    currentJob.indeterminate = false;
    currentJob.completedAt = Date.now();
    currentJob.failureCode = null;
    setJob(currentJob);
    runtime.draft = null;
    rerender();
    try { if (typeof toast === "function") toast(copy.jobCompleted); } catch {}
  }

  async function stopGeneration() {
    const job = scriptJob();
    if (!job || !["preparing", "validating", "queued", "processing"].includes(String(job.status || ""))) return;
    job.status = "cancelling";
    job.indeterminate = true;
    setJob(job);
    rerender();
    const response = await window.desktopAPI?.cancelAutomationScript?.(job.id);
    if (!response?.cancelled) {
      job.status = "processing";
      setJob(job);
      rerender();
    }
  }

  function saveScriptEdits() {
    const script = currentAutomation()?.script;
    if (!script) return;
    const title = document.getElementById("automationScriptTitle")?.value || "";
    const hook = document.getElementById("automationScriptHook")?.value || "";
    const body = document.getElementById("automationScriptBody")?.value || "";
    const callToAction = document.getElementById("automationScriptCta")?.value || "";
    const narrationText = document.getElementById("automationNarration")?.value || "";
    const result = window.ViralAutomationScriptState?.editScript?.({ title, hook, body, callToAction, narrationText });
    if (result?.ok) {
      rerender();
      try { if (typeof toast === "function") toast(c().saved); } catch {}
    }
  }

  function updateProgress(payload) {
    const current = currentAutomation();
    const job = current?.jobs?.script;
    if (!job || job.id !== payload?.jobId || ["cancelled", "failed", "completed"].includes(String(job.status || ""))) return;
    if (["preparing", "processing"].includes(String(payload.state || ""))) job.status = payload.state;
    job.indeterminate = payload.indeterminate === true;
    if (!job.indeterminate && Number.isFinite(Number(payload.percent))) {
      job.progress = Math.max(0, Math.min(99, Number(payload.percent)));
    }
    setJobDirect(job);

    const label = document.getElementById("automationJobLabel");
    const percent = document.getElementById("automationJobPercent");
    const bar = document.getElementById("automationJobBar");
    const track = document.getElementById("automationJobTrack");
    if (label) label.textContent = scriptStatusLabel(job);
    if (percent) percent.textContent = job.indeterminate ? "•••" : Math.round(Number(job.progress || 0)) + "%";
    if (track) track.classList.toggle("indeterminate", job.indeterminate);
    if (bar) bar.style.width = (job.indeterminate ? 36 : Math.round(Number(job.progress || 0))) + "%";
  }

  function installPage() {
    try {
      if (typeof pages === "undefined" || !pages) return false;
      pages.automation = creatorPage;
      document.documentElement.dataset.automationCreator = "enabled";
      return true;
    } catch {
      return false;
    }
  }

  document.addEventListener("input", event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.closest(".automation-brief-card")) return;
    captureDraft();
  });

  document.addEventListener("change", event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.closest(".automation-brief-card")) return;
    captureDraft();
  });

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.id === "automationGenerateScript") {
      event.preventDefault();
      generateScript();
    } else if (button.id === "automationStopScript") {
      event.preventDefault();
      stopGeneration();
    } else if (button.id === "automationSaveScript") {
      event.preventDefault();
      saveScriptEdits();
    } else if (button.dataset.page === "automation") {
      setTimeout(() => refreshProviderStatus({ rerender: true }), 0);
    }
  }, true);

  if (window.desktopAPI?.onAutomationScriptProgress) {
    window.desktopAPI.onAutomationScriptProgress(updateProgress);
  }

  const start = () => {
    installPage();
    if (appState()?.page === "automation") {
      rerender();
      refreshProviderStatus({ rerender: true });
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationCreator = {
    refreshProviderStatus,
    generateScript,
    stopGeneration,
    saveScriptEdits,
    render: creatorPage
  };
})();
