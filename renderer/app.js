const $ = (id) => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");

const state = {
  locale: I18N.supported.includes(saved.locale) ? saved.locale : "vi",
  appearance: saved.appearance || "aurora-light",
  motion: saved.motion || "balanced",
  scale: saved.scale || "comfortable",
  page: saved.page || "dashboard",
  output: saved.output || "",
  cloud: {
    config: null,
    auth: null,
    account: null,
    accountOffline: false,
    accountVerifiedAt: null,
    test: null,
    draftBackendUrl: null,
    draftEnvironment: null,
    loading: false,
    statusCheckedAt: 0
  },
  billing: {
    catalog: null,
    invoices: null,
    loading: false,
    loadedAt: 0,
    errorCode: null
  },
  speech: {
    mode: saved.speech?.mode === "cloud" ? "cloud" : "local",
    language: saved.speech?.language || "auto",
    providerStatus: null,
    modelCatalog: null,
    modelStatus: null,
    modelDownload: null,
    job: saved.speech?.job || null,
    result: saved.speech?.result || null
  },
  translation: {
    mode: saved.translation?.mode === "local" ? "local" : "cloud",
    targetLanguage: saved.translation?.targetLanguage || "en",
    preserveTone: saved.translation?.preserveTone !== false,
    cloudStatus: null,
    statusCheckedAt: 0,
    statusCheckPending: false,
    job: saved.translation?.job || null,
    result: saved.translation?.result || null
  },
  voice: {
    mode: saved.voice?.mode === "local" ? "local" : "cloud",
    cloudStatus: null,
    statusCheckedAt: 0,
    statusCheckPending: false,
    catalog: [],
    assignments: saved.voice?.assignments || {},
    job: saved.voice?.job || null,
    result: saved.voice?.result || null
  },
  jobs: saved.jobs || [
    { name: "Douyin_Product_042.mp4", lang: "vi", status: "processing", progress: 73, time: "2 min ago" },
    { name: "UGC_Beauty_118.mp4", lang: "ko", status: "completed", progress: 100, time: "18 min ago" },
    { name: "Review_Camera_090.mp4", lang: "en", status: "completed", progress: 100, time: "41 min ago" },
    { name: "Short_Fashion_031.mp4", lang: "", status: "queued", progress: 0, time: "1 hr ago" }
  ]
};

function makeJobId(prefix = "job") {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

if (state.speech.job && ["validating", "preparing", "uploading", "queued", "processing", "cancelling"].includes(state.speech.job.status)) {
  state.speech.job = {
    ...state.speech.job,
    status: "interrupted",
    progress: Number(state.speech.job.progress || 0)
  };
}

if (state.translation.job && ["validating", "queued", "translating", "cancelling"].includes(state.translation.job.status)) {
  state.translation.job = {
    ...state.translation.job,
    status: "interrupted",
    progress: Number(state.translation.job.progress || 0)
  };
}

if (state.voice.job && ["validating", "queued", "generating", "downloading", "cancelling"].includes(state.voice.job.status)) {
  state.voice.job = {
    ...state.voice.job,
    status: "interrupted",
    progress: Number(state.voice.job.progress || 0)
  };
}

state.jobs = state.jobs.map((job, index) => ({
  ...job,
  id: job.id || ("saved-" + index + "-" + Date.now()),
  status: normalizeSavedStatus(job.status),
  fileState: job.fileState || ((job.sourcePath || job.outputPath) ? "available" : "unknown"),
  progress: Number(job.progress || 0)
}));

function normalizeSavedStatus(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("complete") || v.includes("hoàn") || v.includes("xong")) return "completed";
  if (v.includes("process") || v.includes("xử lý") || v.includes("render")) return "processing";
  if (v.includes("queue") || v.includes("chờ")) return "queued";
  if (v.includes("cancel") || v.includes("hủy")) return "cancelled";
  if (v.includes("fail") || v.includes("lỗi") || v.includes("thất")) return "failed";
  return v || "queued";
}

function t(key, vars) {
  return I18N.t(state.locale, key, vars);
}

function save() {
  localStorage.setItem("viral-ai-tool-state", JSON.stringify({
    locale: state.locale,
    appearance: state.appearance,
    motion: state.motion,
    scale: state.scale,
    page: state.page,
    output: state.output,
    speech: {
      mode: state.speech.mode,
      language: state.speech.language,
      job: state.speech.job,
      result: state.speech.result
    },
    translation: {
      mode: state.translation.mode,
      targetLanguage: state.translation.targetLanguage,
      preserveTone: state.translation.preserveTone,
      job: state.translation.job,
      result: state.translation.result
    },
    voice: {
      mode: state.voice.mode,
      assignments: state.voice.assignments,
      job: state.voice.job,
      result: state.voice.result
    },
    jobs: state.jobs.slice(0, 50).map(({ thumbnail, previewUrl, ...job }) => job)
  }));
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__viralToast);
  window.__viralToast = setTimeout(() => el.classList.remove("show"), 2200);
}

function normalizeStatus(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("complete") || v.includes("hoàn") || v.includes("xong")) return "completed";
  if (v.includes("process") || v.includes("xử lý") || v.includes("xuất")) return "processing";
  if (v.includes("queue") || v.includes("chờ")) return "queued";
  if (v.includes("cancelling") || v.includes("đang dừng")) return "cancelling";
  if (v.includes("cancel") || v.includes("hủy") || v.includes("dừng")) return "cancelled";
  if (v.includes("fail") || v.includes("lỗi") || v.includes("thất")) return "failed";
  return v || "queued";
}

function statusBadge(value) {
  const code = normalizeStatus(value);
  const cls = code === "completed"
    ? "success"
    : code === "processing"
      ? "processing"
      : code === "queued"
        ? "warn"
        : (code === "cancelled" || code === "cancelling")
          ? "neutral"
          : "error";
  return '<span class="badge ' + cls + '">' + t("common." + code) + "</span>";
}

function fileStateBadge(job) {
  if (!job || job.fileState === "available" || job.fileState === "unknown") return "";
  const code = job.fileState === "trashed" ? "trashed" : "missing";
  return '<span class="file-state-badge ' + code + '"><span aria-hidden="true">!</span>' + t("file." + code) + '</span>';
}

function languageName(code) {
  const map = {
    vi: state.locale === "vi" ? "Tiếng Việt" : "Vietnamese",
    en: "English",
    ko: state.locale === "vi" ? "Tiếng Hàn" : "Korean",
    ja: state.locale === "vi" ? "Tiếng Nhật" : "Japanese"
  };
  return map[code] || (code ? code : t("common.notSet"));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? String(h).padStart(2, "0") + ":" : "") +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return (size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)) + " " + units[unit];
}

function mediaMetaText(job) {
  const meta = job.meta;
  if (!meta) return job.sourcePath ? t("media.readingInfo") : "";
  const parts = [];
  if (meta.width && meta.height) parts.push(meta.width + "×" + meta.height);
  if (meta.duration) parts.push(formatDuration(meta.duration));
  if (meta.sizeBytes) parts.push(formatBytes(meta.sizeBytes));
  return parts.join(" · ");
}

function latestSourceJob() {
  return state.jobs.find(job => job.sourcePath && !job.isRenderOutput);
}

function jobFilePath(job) {
  return job?.isRenderOutput ? job.outputPath : job?.sourcePath;
}

function findJob(jobId) {
  return state.jobs.find(job => job.id === jobId);
}

const navItems = [
  { group: "nav.workspace" },
  { id: "dashboard", icon: "⌂", label: "nav.dashboard" },
  { id: "download", icon: "⇩", label: "nav.download" },
  { id: "monitor", icon: "◉", label: "nav.monitor", badge: "8" },
  { group: "nav.create" },
  { id: "ai-video", icon: "✦", label: "nav.aiVideo" },
  { id: "voice", icon: "◖", label: "nav.voice" },
  { id: "editor", icon: "◫", label: "nav.editor" },
  { id: "automation", icon: "⚡", label: "nav.automation" },
  { group: "nav.manage" },
  { id: "library", icon: "▦", label: "nav.library" },
  { id: "accounts", icon: "◎", label: "nav.accounts" },
  { id: "usage", icon: "◔", label: "nav.usage" },
  { id: "billing", icon: "◇", label: "nav.billing" },
  { id: "settings", icon: "⚙", label: "nav.settings" }
];

const pageMeta = {
  dashboard: ["nav.dashboard", "dashboard.breadcrumb"],
  download: ["nav.download", "download.breadcrumb"],
  monitor: ["nav.monitor", "monitor.breadcrumb"],
  "ai-video": ["nav.aiVideo", "aiVideo.breadcrumb"],
  voice: ["nav.voice", "voice.breadcrumb"],
  editor: ["nav.editor", "editor.breadcrumb"],
  automation: ["nav.automation", "automation.breadcrumb"],
  library: ["nav.library", "library.breadcrumb"],
  accounts: ["nav.accounts", "accounts.breadcrumb"],
  usage: ["nav.usage", "usage.breadcrumb"],
  billing: ["nav.billing", "billing.breadcrumb"],
  settings: ["nav.settings", "settings.breadcrumb"]
};

function navRender() {
  const nav = $("nav");
  nav.innerHTML = navItems.map((item) => {
    if (item.group) return '<div class="nav-group">' + t(item.group) + "</div>";
    return '<button class="nav-item ' + (state.page === item.id ? "active" : "") + '" data-page="' + item.id + '" type="button">' +
      '<span class="nav-icon" aria-hidden="true">' + item.icon + "</span>" +
      "<span>" + t(item.label) + "</span>" +
      (item.badge ? '<span class="nav-badge">' + item.badge + "</span>" : "") +
      "</button>";
  }).join("");
}

function applyChromeLocale() {
  document.documentElement.lang = state.locale;
  document.documentElement.dataset.theme = state.appearance;
  document.documentElement.dataset.motion = state.motion;
  document.documentElement.dataset.scale = state.scale;
  document.body.dataset.locale = state.locale;
  document.body.dataset.dropLabel = t("download.dropOverlay");
  window.desktopAPI?.setLocale?.(state.locale);

  $("desktopPill").textContent = t("app.desktop");
  $("workspaceLabel").textContent = t("app.workspace");
  $("creditsLabel").textContent = t("app.monthlyCredits");
  $("remainingLabel").textContent = t("app.remaining");
  $("newProjectLabel").textContent = t("app.newProject");

  const langName = $("langName");
  const langHint = $("langHint");
  const commandCopy = document.querySelector(".command-copy");
  if (langName) langName.textContent = state.locale === "vi" ? "Tiếng Việt" : "English";
  if (langHint) langHint.textContent = t("app.language");
  if (commandCopy) commandCopy.textContent = t("app.searchAnything");

  document.querySelectorAll(".popover-option[data-locale]").forEach((node) => {
    const selected = node.dataset.locale === state.locale;
    node.classList.toggle("is-selected", selected);
    node.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function jobsTable(rows) {
  const data = rows || state.jobs;
  return '<div class="card table-wrap"><table class="data-table">' +
    "<thead><tr>" +
    "<th>" + t("common.video") + "</th>" +
    "<th>" + t("common.language") + "</th>" +
    "<th>" + t("common.status") + "</th>" +
    "<th>" + t("common.progress") + "</th>" +
    "<th>" + t("common.updated") + "</th>" +
    '<th class="actions-head" aria-label="' + t("file.actions") + '"></th>' +
    "</tr></thead><tbody>" +
    data.map((job) => {
      const isUnavailable = job.fileState === "missing" || job.fileState === "trashed";
      const thumb = job.thumbnail
        ? '<div class="thumb thumb-image ' + (isUnavailable ? "is-unavailable" : "") + '"><img src="' + job.thumbnail + '" alt=""><span>▶</span></div>'
        : '<div class="thumb ' + (isUnavailable ? "is-unavailable" : "") + '"><span>▶</span></div>';
      const meta = mediaMetaText(job);
      const fileBadge = fileStateBadge(job);
      const menu = '<div class="job-menu">' +
        '<button class="job-menu-button" data-job-menu="' + escapeHtml(job.id) + '" type="button" aria-label="' + t("file.actions") + '">•••</button>' +
        '<div class="job-menu-popover hidden" data-job-menu-popover="' + escapeHtml(job.id) + '">' +
          ((jobFilePath(job) && job.fileState === "available")
            ? '<button type="button" data-job-action="reveal" data-job-id="' + escapeHtml(job.id) + '">⌕ <span>' + t("file.openFolder") + '</span></button>'
            : '') +
          (!job.isRenderOutput
            ? '<button type="button" data-job-action="relink" data-job-id="' + escapeHtml(job.id) + '">↻ <span>' + t("file.relink") + '</span></button>'
            : '') +
          (job.isRenderOutput && normalizeStatus(job.status) === "processing"
            ? '<button type="button" data-job-action="cancel-export" data-job-id="' + escapeHtml(job.id) + '">■ <span>' + t("export.stop") + '</span></button>'
            : '') +
          '<div class="job-menu-separator"></div>' +
          '<button type="button" data-job-action="remove" data-job-id="' + escapeHtml(job.id) + '">− <span>' + t(job.isRenderOutput ? "file.removeHistory" : "file.removeLibrary") + '</span></button>' +
          ((jobFilePath(job) && job.fileState === "available")
            ? '<button class="danger-action" type="button" data-job-action="trash" data-job-id="' + escapeHtml(job.id) + '">♲ <span>' + t("file.moveToTrash") + '</span></button>'
            : '') +
        '</div>' +
      '</div>';

      return '<tr class="' + (isUnavailable ? "file-unavailable-row" : "") + '" data-job-id="' + escapeHtml(job.id) + '">' +
        '<td><div class="video-cell">' + thumb + '<div class="video-copy"><b>' + escapeHtml(job.name) + '</b>' +
        (meta ? '<small>' + escapeHtml(meta) + '</small>' : '') + fileBadge + '</div></div></td>' +
        "<td>" + languageName(job.lang) + "</td>" +
        "<td>" + statusBadge(job.status) + "</td>" +
        '<td><div class="job-progress"><div class="job-progress-head"><span data-progress-label="' + job.id + '">' +
          Number(job.progress || 0) + '%</span>' +
        '</div><div class="mini-progress"><i data-progress-bar="' + job.id + '" style="width:' + Number(job.progress || 0) + '%"></i></div></div></td>' +
        '<td><div class="updated-cell"><span>' + (job.time || t("common.now")) + '</span>' +
          (job.outputPath && job.fileState === "available" ? '<button class="reveal-output" data-output-path="' + encodeURIComponent(job.outputPath) + '" type="button">' + t("media.showFile") + '</button>' : '') +
        '</div></td>' +
        '<td class="job-actions-cell">' + menu + '</td>' +
      "</tr>";
    }).join("") +
    "</tbody></table></div>";
}

function dashboard() {
  const stats = [
    [t("dashboard.videosToday"), "24", t("dashboard.videosFoot"), "up"],
    [t("dashboard.processing"), "3", t("dashboard.processingFoot"), ""],
    [t("dashboard.completed"), "218", t("dashboard.completedFoot"), ""],
    [t("dashboard.aiMinutes"), "1,482", t("dashboard.aiMinutesFoot"), ""]
  ];

  const tools = [
    ["↯", t("dashboard.translate"), t("dashboard.translateDesc"), "ai-video"],
    ["◖", t("dashboard.aiVoice"), t("dashboard.aiVoiceDesc"), "voice"],
    ["▤", t("dashboard.subtitle"), t("dashboard.subtitleDesc"), "editor"],
    ["⇩", t("dashboard.download"), t("dashboard.downloadDesc"), "download"]
  ];

  const processingJobs = state.jobs.filter(job => normalizeStatus(job.status) === "processing");
  const queuedJobs = state.jobs.filter(job => normalizeStatus(job.status) === "queued");
  const renderJobs = processingJobs.filter(job => job.isRenderOutput);
  const focusJob = processingJobs[0];
  const focusPercent = focusJob ? Math.round(Number(focusJob.progress || 0)) + "%" : "—";
  const renderState = renderJobs.length ? t("dashboard.running") : "—";

  return '<div class="dashboard-shell">' +
    '<div class="dashboard-main">' +
      '<div class="hero dashboard-hero"><div class="hero-copy">' +
        '<div class="eyebrow">' + t("dashboard.eyebrow") + '</div>' +
        '<h2>' + t("dashboard.title") + '</h2>' +
        '<p>' + t("dashboard.desc") + '</p>' +
        '<div class="hero-actions">' +
          '<button class="button primary" data-page="ai-video" type="button">✦ ' + t("dashboard.createAi") + '</button>' +
          '<button class="button ghost" data-page="download" type="button">⇩ ' + t("dashboard.importVideo") + '</button>' +
        '</div>' +
      '</div></div>' +

      '<div class="stat-grid dashboard-stats">' +
        stats.map((x) =>
          '<div class="stat-card">' +
            '<div class="stat-label">' + x[0] + '</div>' +
            '<div class="stat-value">' + x[1] + '</div>' +
            '<div class="stat-foot ' + x[3] + '">' + x[2] + '</div>' +
          '</div>'
        ).join("") +
      '</div>' +

      '<div class="section-head dashboard-section-head"><div><h3>' + t("dashboard.quickTools") + '</h3><p>' + t("dashboard.quickToolsDesc") + '</p></div></div>' +
      '<div class="tool-grid dashboard-tools">' +
        tools.map((x) =>
          '<div class="tool-card" data-page="' + x[3] + '">' +
            '<div class="tool-icon">' + x[0] + '</div>' +
            '<div class="tool-copy"><h4>' + x[1] + '</h4><p>' + x[2] + '</p></div>' +
          '</div>'
        ).join("") +
      '</div>' +

      '<div class="section-head dashboard-section-head"><div><h3>' + t("dashboard.recentJobs") + '</h3><p>' + t("dashboard.recentJobsDesc") + '</p></div></div>' +
      jobsTable() +
    '</div>' +

    '<aside class="dashboard-side">' +
      '<div class="dashboard-side-card focus-card">' +
        '<div class="side-card-head"><div><span class="side-kicker">' + t("dashboard.today") + '</span><h4>' + t("dashboard.activityTitle") + '</h4></div><span class="live-dot"><i></i>' + t("dashboard.live") + '</span></div>' +
        '<p class="side-intro">' + t("dashboard.activityDesc") + '</p>' +
        '<div class="activity-list">' +
          '<div class="activity-row"><span class="activity-icon purple">↻</span><div><b>' + t("dashboard.activityProcessing") + '</b><span>' + processingJobs.length + ' ' + t("dashboard.videos") + '</span></div><strong data-activity-progress>' + focusPercent + '</strong></div>' +
          '<div class="activity-row"><span class="activity-icon blue">▶</span><div><b>' + t("dashboard.activityRendering") + '</b><span>' + renderJobs.length + ' ' + t("dashboard.videos") + '</span></div><strong>' + renderState + '</strong></div>' +
          '<div class="activity-row"><span class="activity-icon amber">◷</span><div><b>' + t("dashboard.activityQueued") + '</b><span>' + queuedJobs.length + ' ' + t("dashboard.videos") + '</span></div><strong>' + queuedJobs.length + '</strong></div>' +
        '</div>' +
      '</div>' +

      '<div class="dashboard-side-card usage-card">' +
        '<div class="side-card-head"><div><span class="side-kicker">' + t("dashboard.monthlyLimit") + '</span><h4>2,480</h4></div><span class="usage-percent">66%</span></div>' +
        '<div class="bar animated-progress"><i style="width:66%"></i></div>' +
        '<p class="side-intro">' + t("dashboard.monthlyLimitDesc") + '</p>' +
      '</div>' +

      '<div class="dashboard-side-card">' +
        '<div class="side-card-head"><div><span class="side-kicker">' + t("dashboard.next") + '</span><h4>' + t("dashboard.suggestions") + '</h4></div></div>' +
        '<div class="suggestion-list">' +
          '<button class="suggestion-row" data-page="ai-video" type="button"><span class="suggestion-icon purple">✦</span><span><b>' + t("dashboard.suggestTranslate") + '</b><small>' + t("dashboard.suggestTranslateDesc") + '</small></span><i>›</i></button>' +
          '<button class="suggestion-row" data-page="voice" type="button"><span class="suggestion-icon pink">◖</span><span><b>' + t("dashboard.suggestVoice") + '</b><small>' + t("dashboard.suggestVoiceDesc") + '</small></span><i>›</i></button>' +
          '<button class="suggestion-row" data-page="accounts" type="button"><span class="suggestion-icon blue">◎</span><span><b>' + t("dashboard.suggestAccount") + '</b><small>' + t("dashboard.suggestAccountDesc") + '</small></span><i>›</i></button>' +
        '</div>' +
      '</div>' +
    '</aside>' +
  '</div>';
}

function downloadPage() {
  const platforms = ["TikTok", "Douyin", "YouTube", "Bilibili", "Facebook", "Instagram", "Xiaohongshu"];

  return '<div class="grid-2">' +
    '<div class="card card-pad"><div class="eyebrow">' + t("download.urlEyebrow") + "</div><h3>" + t("download.urlTitle") + "</h3>" +
    '<p class="muted">' + t("download.urlDesc") + "</p>" +
    '<div class="row"><input id="url" class="input" placeholder="' + t("download.urlPlaceholder") + '">' +
    '<button id="analyze" class="button primary" type="button">' + t("download.analyze") + "</button></div>" +
    '<div class="platforms">' + platforms.map((x) => '<span class="platform">' + x + "</span>").join("") + "</div></div>" +
    '<div class="card card-pad"><div class="eyebrow">' + t("download.localEyebrow") + "</div><h3>" + t("download.localTitle") + "</h3>" +
    '<p class="muted">' + t("download.localDesc") + "</p>" +
    '<div id="dropzone" class="dropzone" tabindex="0" role="button"><div class="dropzone-icon">⇧</div><strong>' + t("download.dropTitle") +
    "</strong><p>" + t("download.dropDesc") + "</p></div></div></div>" +
    '<div class="section-head"><div><h3>' + t("download.queue") + "</h3><p>" + t("download.queueDesc") + "</p></div></div>" +
    jobsTable();
}

function monitorPage() {
  const channels = [
    ["Beauty Daily", "Douyin", "12", true],
    ["Review Lab", "TikTok", "6", true],
    ["Camera Zone", "YouTube", "3", false]
  ];
  return '<div class="hero"><div class="hero-copy"><div class="eyebrow">' + t("monitor.eyebrow") + "</div>" +
    "<h2>" + t("monitor.title") + "</h2><p>" + t("monitor.desc") + "</p>" +
    '<div class="hero-actions"><button id="addChannel" class="button primary" type="button">＋ ' + t("monitor.add") + "</button></div></div></div>" +
    '<div class="section-head"><div><h3>' + t("monitor.monitored") + "</h3><p>" + t("monitor.monitoredDesc") + "</p></div></div>" +
    '<div class="card">' + channels.map((x) =>
      '<div class="automation-card"><div class="auto-icon">◉</div><div class="auto-copy"><b>' + x[0] + " · " + x[1] +
      "</b><p>" + x[2] + " " + t("monitor.detected") + '</p></div><div class="switch ' + (x[3] ? "on" : "") + '"></div></div>'
    ).join("") + "</div>";
}

function speechProviderStatusLabel(status) {
  const code = status?.code || "CHECKING";
  const map = {
    READY: "speech.ready",
    LOCAL_MODEL_REQUIRED: "speech.localModelRequired",
    LOCAL_MODEL_INCOMPLETE: "speech.localModelIncomplete",
    LOCAL_MODEL_INVALID: "speech.localModelInvalid",
    LOCAL_RUNTIME_REQUIRED: "speech.runtimeRequired",
    CLOUD_NOT_CONFIGURED: "speech.cloudNotConfigured",
    CLOUD_CONFIG_INVALID: "speech.cloudConfigInvalid",
    CLOUD_HTTPS_REQUIRED: "speech.cloudHttpsRequired",
    CLOUD_AUTH_REQUIRED: "speech.cloudAuthRequired",
    CLOUD_QUOTA_EXCEEDED: "speech.cloudQuotaExceeded",
    CLOUD_PLAN_REQUIRED: "speech.cloudPlanRequired",
    CLOUD_SUBSCRIPTION_INACTIVE: "speech.cloudSubscriptionInactive",
    CLOUD_CONCURRENCY_LIMIT: "speech.cloudConcurrencyLimit",
    CLOUD_UNAVAILABLE: "speech.cloudUnavailable",
    CLOUD_PROVIDER_NOT_CONFIGURED: "speech.cloudProviderPending",
    CLOUD_NETWORK: "speech.cloudUnavailable",
    CLOUD_TIMEOUT: "speech.cloudUnavailable",
    CHECKING: "speech.checking"
  };
  return t(map[code] || "speech.providerUnavailable");
}

function speechProviderBadge(mode) {
  const status = state.speech.providerStatus?.[mode];
  const ready = status?.ready === true;
  const checking = !status;

  if (mode === "local" && state.speech.modelDownload) {
    return '<span class="speech-provider-badge checking"><i></i>' +
      escapeHtml(t("speech.modelDownloading")) + ' ' +
      Math.round(Number(state.speech.modelDownload.percent || 0)) + '%</span>';
  }

  return '<span class="speech-provider-badge ' + (ready ? "ready" : checking ? "checking" : "warning") + '">' +
    '<i></i>' + escapeHtml(speechProviderStatusLabel(status)) + '</span>';
}

function cloudHostLabel(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

async function refreshCloudUiState({ rerender = false } = {}) {
  if (!window.desktopAPI || state.cloud.loading) return state.cloud;
  state.cloud.loading = true;

  try {
    const [config, auth] = await Promise.all([
      window.desktopAPI.getCloudConfig?.(),
      window.desktopAPI.getAuthStatus?.()
    ]);
    state.cloud.config = config || null;
    state.cloud.auth = auth || null;

    if (auth?.authenticated && window.desktopAPI.getAccount) {
      const accountResponse = await window.desktopAPI.getAccount();
      if (accountResponse?.ok) {
        state.cloud.auth = accountResponse.data?.status || auth;
        state.cloud.account = accountResponse.data?.account || null;
        state.cloud.accountOffline = accountResponse.data?.offline === true;
        state.cloud.accountVerifiedAt = accountResponse.data?.verifiedAt || null;
      } else if (accountResponse?.error?.code === "AUTH_REQUIRED") {
        state.cloud.auth = { ...auth, authenticated: false, accessReady: false, refreshReady: false };
        state.cloud.account = null;
        state.cloud.accountOffline = false;
        state.cloud.accountVerifiedAt = null;
      }
    } else {
      state.cloud.account = null;
      state.cloud.accountOffline = false;
      state.cloud.accountVerifiedAt = null;
    }

    state.cloud.statusCheckedAt = Date.now();
  } catch {
    state.cloud.config = null;
    state.cloud.auth = null;
  } finally {
    state.cloud.loading = false;
  }

  if (rerender && ["ai-video", "settings", "usage", "billing"].includes(state.page)) render();
  return state.cloud;
}

function localConnectionPanel() {
  const status = state.speech.providerStatus?.local;
  const model = Array.isArray(state.speech.modelCatalog) ? state.speech.modelCatalog[0] : null;
  const modelStatus = state.speech.modelStatus;
  const installed = modelStatus?.state === "installed";
  const downloading = Boolean(state.speech.modelDownload);
  const ready = status?.ready === true;
  const size = formatBytes(model?.installedSizeBytes || model?.downloadSizeBytes || modelStatus?.totalBytes || 0);

  return '<div class="ai-connection-panel ' + (ready ? "is-ready" : "needs-action") + '">' +
    '<div class="ai-connection-icon local">◈</div>' +
    '<div class="ai-connection-copy"><div class="ai-connection-title-row"><b>' +
      escapeHtml(ready ? t("speech.localReadyTitle") : downloading ? t("speech.localDownloadingTitle") : t("speech.localSetupTitle")) +
      '</b>' + speechProviderBadge("local") + '</div>' +
      '<p>' + escapeHtml(ready ? t("speech.localReadyBody") : downloading ? t("speech.localDownloadingBody") : t("speech.localSetupBody")) + '</p>' +
      '<div class="ai-connection-meta">' +
        (size ? '<span>' + escapeHtml(t("speech.localSize", { size })) + '</span>' : '') +
        '<span>' + escapeHtml(t("speech.localPrivacy")) + '</span>' +
      '</div></div>' +
    '<div class="ai-connection-actions">' +
      '<button id="manageLocalAiPanel" class="button ' + (ready ? "ghost" : "primary") + '" type="button">' +
        escapeHtml(ready ? t("speech.manageLocal") : downloading ? t("speech.viewDownload") : t("speech.prepareLocal")) +
      '</button>' +
    '</div>' +
  '</div>';
}

function cloudConnectionPanel() {
  const status = state.speech.providerStatus?.cloud;
  const config = state.cloud.config;
  const auth = state.cloud.auth;
  const account = state.cloud.account;
  const configured = Boolean(config?.backendUrl);
  const devVisible = config?.developerSettingsVisible === true;
  const authenticated = auth?.authenticated === true;
  const ready = status?.ready === true;
  const host = cloudHostLabel(config?.backendUrl || "");

  const quota = account?.quota || status?.quota || null;
  const user = account?.user || null;
  const remaining = Number(quota?.remainingMinutes);
  const plan = user?.plan || auth?.plan || quota?.plan || null;

  let title = t("speech.cloudSetupTitleShort");
  let body = t("speech.cloudSetupBodyShort");
  let action = devVisible
    ? '<button id="openCloudSettings" class="button primary" type="button">' + escapeHtml(t("speech.configureCloud")) + '</button>'
    : "";

  if (configured && !authenticated) {
    title = t("speech.cloudLoginTitle");
    body = t("speech.cloudLoginBody");
    action =
      '<button id="cloudAccountAction" class="button primary" type="button">' + escapeHtml(t("speech.signIn")) + '</button>' +
      (devVisible ? '<button id="openCloudSettings" class="button ghost" type="button">' + escapeHtml(t("speech.cloudSettings")) + '</button>' : '');
  } else if (configured && authenticated && ready) {
    title = t("speech.cloudReadyTitle");
    body = t("speech.cloudReadyBody");
    action =
      '<button id="cloudLogoutAction" class="button ghost" type="button">' + escapeHtml(t("account.signOut")) + '</button>' +
      (devVisible ? '<button id="openCloudSettings" class="button ghost" type="button">' + escapeHtml(t("speech.cloudSettings")) + '</button>' : '');
  } else if (configured && authenticated) {
    title = status?.code === "CLOUD_PROVIDER_NOT_CONFIGURED"
      ? t("speech.cloudProviderPending")
      : speechProviderStatusLabel(status);
    body =
      status?.code === "CLOUD_PROVIDER_NOT_CONFIGURED"
        ? t("speech.cloudProviderPendingBody")
        : status?.code === "CLOUD_SUBSCRIPTION_INACTIVE"
          ? t("speech.cloudSubscriptionBody")
          : t("speech.cloudUnavailableBody");
    action =
      '<button id="cloudLogoutAction" class="button ghost" type="button">' + escapeHtml(t("account.signOut")) + '</button>' +
      (devVisible ? '<button id="openCloudSettings" class="button ghost" type="button">' + escapeHtml(t("speech.cloudSettings")) + '</button>' : '');
  }

  return '<div class="ai-connection-panel ' + (ready ? "is-ready" : authenticated ? "is-connected" : "needs-action") + '">' +
    '<div class="ai-connection-icon cloud">☁</div>' +
    '<div class="ai-connection-copy"><div class="ai-connection-title-row"><b>' + escapeHtml(title) + '</b>' +
      speechProviderBadge("cloud") + '</div>' +
      '<p>' + escapeHtml(body) + '</p>' +
      '<div class="ai-connection-meta">' +
        (user?.email ? '<span>' + escapeHtml(user.email) + '</span>' : '') +
        (plan ? '<span>' + escapeHtml(t("account.plan", { plan })) + '</span>' : '') +
        (host ? '<span>' + escapeHtml(t("speech.cloudServer", { host })) + '</span>' : '') +
        (Number.isFinite(remaining) ? '<span>' + escapeHtml(t("speech.cloudRemaining", { minutes: Math.max(0, Math.floor(remaining)) })) + '</span>' : '') +
        '<span>' + escapeHtml(t("speech.cloudConsentNote")) + '</span>' +
      '</div></div>' +
    '<div class="ai-connection-actions">' + action + '</div>' +
  '</div>';
}

function speechConnectionPanel() {
  return state.speech.mode === "local" ? localConnectionPanel() : cloudConnectionPanel();
}

function speechJobForSource(source) {
  return source && state.speech.job?.sourcePath === source.sourcePath ? state.speech.job : null;
}

function speechResultForSource(source) {
  return source && state.speech.result?.sourcePath === source.sourcePath ? state.speech.result : null;
}

function speechStatusCopy(job) {
  if (!job) return "";
  const key = {
    validating: "speech.preparing",
    preparing: "speech.preparing",
    uploading: "speech.uploading",
    queued: "speech.queued",
    processing: "speech.processing",
    cancelling: "speech.cancelling",
    completed: "speech.completed",
    cancelled: "speech.cancelled",
    failed: "speech.failed",
    interrupted: "speech.interrupted"
  }[job.status] || "speech.processing";
  return t(key);
}

function speechTranscriptView(result) {
  if (!result) return "";
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const timingAvailable = result?.meta?.timingAvailable === true;
  const plainText = String(result.text || "").trim();
  return '<div class="speech-result">' +
    '<div class="speech-result-head"><div><span class="side-kicker">' + t("speech.resultTitle") + '</span>' +
      '<h4>' + escapeHtml(t("speech.resultDesc", { count: segments.length, duration: formatDuration(result.duration || 0) })) + '</h4></div>' +
      '<span class="speech-provider-badge ready"><i></i>' + t("speech.completed") + '</span></div>' +
    (segments.length
      ? '<div class="transcript-list">' + segments.slice(0, 12).map(segment =>
          '<div class="transcript-row"><time>' + formatDuration(segment.start) + '</time><p>' + escapeHtml(segment.text) + '</p></div>'
        ).join("") + '</div>'
      : plainText
        ? '<div class="transcript-plain"><p>' + escapeHtml(plainText) + '</p></div>'
        : '<div class="speech-empty">' + t("speech.emptyResult") + '</div>') +
    '<p class="speech-result-note">' + (timingAvailable ? t("speech.transcriptReady") : t("speech.timingUnavailable")) + '</p>' +
  '</div>';
}

function translationJobForSource(source) {
  const job = state.translation.job;
  return source &&
    job?.sourcePath === source.sourcePath &&
    job?.targetLanguage === state.translation.targetLanguage
    ? job
    : null;
}

function translationResultForSource(source) {
  const result = state.translation.result;
  if (!source || result?.sourcePath !== source.sourcePath) return null;
  if (result?.targetLanguage !== state.translation.targetLanguage) return null;
  return result;
}

function translationStatusCopy(job) {
  if (!job) return "";
  const key = {
    validating: "translation.validating",
    queued: "translation.queued",
    translating: "translation.translating",
    cancelling: "translation.cancelling",
    completed: "translation.completed",
    cancelled: "translation.cancelled",
    failed: "translation.failed",
    interrupted: "translation.interrupted"
  }[job.status] || "translation.translating";
  return t(key);
}

async function refreshTranslationStatus({ rerender = false } = {}) {
  if (!window.desktopAPI?.getTranslationStatus || state.translation.statusCheckPending) {
    return state.translation.cloudStatus;
  }

  state.translation.statusCheckPending = true;
  try {
    state.translation.cloudStatus = await window.desktopAPI.getTranslationStatus();
    state.translation.statusCheckedAt = Date.now();
  } catch {
    state.translation.cloudStatus = {
      ready: false,
      code: "TRANSLATION_UNAVAILABLE"
    };
  } finally {
    state.translation.statusCheckPending = false;
  }

  if (rerender && ["ai-video", "settings"].includes(state.page)) render();
  return state.translation.cloudStatus;
}

function translationConnectionPanel() {
  if (state.translation.mode === "local") {
    return '<div class="translation-connection needs-action">' +
      '<div><b>' + t("translation.localPendingTitle") + '</b><p>' + t("translation.localPendingBody") + '</p></div>' +
      '<span class="speech-provider-badge pending"><i></i>' + t("translation.notReady") + '</span>' +
    '</div>';
  }

  const status = state.translation.cloudStatus;
  const ready = status?.ready === true;
  const code = status?.code || "CHECKING";

  let title = t("translation.cloudChecking");
  let body = t("translation.cloudCheckingBody");

  if (ready) {
    title = t("translation.cloudReadyTitle");
    body = t("translation.cloudReadyBody");
  } else if (code === "TRANSLATION_AUTH_REQUIRED") {
    title = t("translation.cloudLoginTitle");
    body = t("translation.cloudLoginBody");
  } else if (code === "TRANSLATION_PLAN_REQUIRED") {
    title = t("translation.planTitle");
    body = t("translation.planBody");
  } else if (code === "TRANSLATION_SUBSCRIPTION_INACTIVE") {
    title = t("translation.subscriptionTitle");
    body = t("translation.subscriptionBody");
  } else if (["TRANSLATION_NOT_CONFIGURED", "TRANSLATION_CONFIG_INVALID", "TRANSLATION_HTTPS_REQUIRED"].includes(code)) {
    title = t("translation.cloudSetupTitle");
    body = t("translation.cloudSetupBody");
  } else if (code !== "CHECKING") {
    title = t("translation.cloudUnavailableTitle");
    body = t("translation.cloudUnavailableBody");
  }

  return '<div class="translation-connection ' + (ready ? "is-ready" : "needs-action") + '">' +
    '<div><b>' + escapeHtml(title) + '</b><p>' + escapeHtml(body) + '</p></div>' +
    '<span class="speech-provider-badge ' + (ready ? "ready" : "pending") + '"><i></i>' +
      escapeHtml(ready ? t("translation.ready") : t("translation.notReady")) + '</span>' +
  '</div>';
}

function translationResultView(result) {
  if (!result) return "";

  const segments = Array.isArray(result.segments) ? result.segments : [];
  const warnings = Number(result?.meta?.warningCount || segments.filter(item => item.timingRisk).length || 0);

  return '<div class="translation-result">' +
    '<div class="translation-result-head"><div><span class="side-kicker">' + t("translation.resultTitle") + '</span>' +
      '<h4>' + escapeHtml(t("translation.resultDesc", {
        source: languageName(result.sourceLanguage),
        target: languageName(result.targetLanguage),
        count: segments.length
      })) + '</h4></div>' +
      '<span class="speech-provider-badge ready"><i></i>' + t("translation.completed") + '</span></div>' +
    (warnings
      ? '<div class="translation-warning"><b>' + t("translation.timingWarningTitle", { count: warnings }) + '</b><span>' +
          t("translation.timingWarningBody") + '</span></div>'
      : '') +
    '<div class="translation-list">' +
      segments.slice(0, 12).map(segment =>
        '<div class="translation-row ' + (segment.timingRisk ? "has-warning" : "") + '">' +
          '<time>' + formatDuration(segment.start) + '</time>' +
          '<div class="translation-pair"><p class="translation-source">' + escapeHtml(segment.sourceText || "") + '</p>' +
          '<p class="translation-target">' + escapeHtml(segment.text || "") + '</p></div>' +
          (segment.timingRisk ? '<span class="translation-risk" title="' + escapeHtml(t("translation.timingRisk")) + '">!</span>' : '') +
        '</div>'
      ).join("") +
    '</div>' +
    (segments.length > 12 ? '<p class="speech-result-note">' + t("translation.moreSegments", { count: segments.length - 12 }) + '</p>' : '') +
  '</div>';
}

async function handleTranslationBlock(response) {
  const code = response?.error?.code || "TRANSLATION_FAILED";

  if (code === "TRANSLATION_AUTH_REQUIRED") {
    await showNotice({
      title: t("translation.authTitle"),
      body: t("translation.authBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_SUBSCRIPTION_INACTIVE") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("translation.subscriptionTitle"),
      body: t("translation.subscriptionBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_PLAN_REQUIRED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("translation.planTitle"),
      body: t("translation.planBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_CONCURRENCY_LIMIT") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("translation.concurrencyTitle"),
      body: t("translation.concurrencyBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_SAME_LANGUAGE") {
    await showNotice({
      title: t("translation.sameLanguageTitle"),
      body: t("translation.sameLanguageBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_QUOTA_EXCEEDED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("translation.quotaTitle"),
      body: t("translation.quotaBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_TOO_LARGE") {
    await showNotice({
      title: t("translation.tooLargeTitle"),
      body: t("translation.tooLargeBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["TRANSLATION_NETWORK", "TRANSLATION_TIMEOUT", "TRANSLATION_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(code)) {
    await showNotice({
      title: t("translation.connectionTitle"),
      body: t("translation.connectionBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "TRANSLATION_JOB_CONFLICT") {
    await showNotice({
      title: t("translation.conflictTitle"),
      body: t("translation.conflictBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  await showNotice({
    title: t("translation.failedTitle"),
    body: t("translation.failedBody"),
    buttonLabel: t("common.close")
  });
}

async function startTranslation() {
  const source = latestSourceJob();
  const speechResult = speechResultForSource(source);

  if (!source || !speechResult?.segments?.length) {
    toast(t("translation.needTranscript"));
    return;
  }

  if (state.translation.mode === "local") {
    await showNotice({
      title: t("translation.localPendingTitle"),
      body: t("translation.localPendingBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (!state.cloud.auth?.authenticated) {
    await showNotice({
      title: t("translation.authTitle"),
      body: t("translation.authBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  const sourceLanguage = speechResult.language && speechResult.language !== "unknown"
    ? speechResult.language
    : "auto";

  if (sourceLanguage !== "auto" &&
      sourceLanguage.toLowerCase() === state.translation.targetLanguage.toLowerCase()) {
    await handleTranslationBlock({ error: { code: "TRANSLATION_SAME_LANGUAGE" } });
    return;
  }

  const existingJob = translationJobForSource(source);
  if (existingJob && ["validating", "queued", "translating", "cancelling"].includes(existingJob.status)) {
    toast(t("translation.alreadyRunning"));
    return;
  }

  const confirmed = await confirmAction({
    title: t("translation.cloudConsentTitle"),
    body: t("translation.cloudConsentBody", {
      count: speechResult.segments.length,
      language: languageName(state.translation.targetLanguage)
    }),
    confirmLabel: t("translation.start"),
    cancelLabel: t("common.cancel")
  });
  if (!confirmed) return;

  const reuse = existingJob &&
    (existingJob.status === "interrupted" || existingJob.retrySameId === true) &&
    existingJob.targetLanguage === state.translation.targetLanguage;

  const job = {
    id: reuse ? existingJob.id : makeJobId("translation"),
    sourcePath: source.sourcePath,
    sourceName: source.name,
    sourceLanguage,
    targetLanguage: state.translation.targetLanguage,
    mode: "cloud",
    preserveTone: state.translation.preserveTone,
    status: "validating",
    progress: 0,
    indeterminate: false,
    retrySameId: false,
    startedAt: Date.now()
  };

  state.translation.job = job;

  if (state.voice.job?.sourcePath === source.sourcePath) {
    state.voice.job = null;
  }
  if (state.voice.result?.sourcePath === source.sourcePath) {
    state.voice.result = null;
  }

  save();
  render();
  toast(t("translation.started"));

  const response = await window.desktopAPI.startTranslation({
    jobId: job.id,
    sourceLanguage,
    targetLanguage: job.targetLanguage,
    preserveTone: job.preserveTone,
    segments: speechResult.segments.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker || null
    }))
  });

  if (!response?.ok) {
    job.status = "failed";
    job.failureCode = response?.error?.code || "TRANSLATION_FAILED";
    job.retrySameId = [
      "TRANSLATION_NETWORK",
      "TRANSLATION_TIMEOUT",
      "TRANSLATION_UNAVAILABLE",
      "TRANSLATION_REQUEST_FAILED"
    ].includes(job.failureCode);
    save();
    render();
    await handleTranslationBlock(response);
    return;
  }

  if (response.data?.cancelled || job.status === "cancelling") {
    job.status = "cancelled";
    save();
    render();
    toast(t("translation.stopped"));
    return;
  }

  const result = response.data?.result || null;
  job.status = "completed";
  job.progress = 100;
  job.completedAt = Date.now();

  if (result) {
    state.translation.result = {
      ...result,
      sourcePath: source.sourcePath,
      sourceName: source.name
    };
  }

  await refreshCloudUiState({ rerender: false });
  save();
  render();
  toast(t("translation.done"));
}

async function cancelTranslation() {
  const job = state.translation.job;
  if (!job || !["validating", "queued", "translating"].includes(job.status)) return;

  const confirmed = await confirmAction({
    title: t("translation.stopTitle"),
    body: t("translation.stopBody"),
    confirmLabel: t("translation.stop"),
    cancelLabel: t("translation.keepGoing"),
    danger: true
  });
  if (!confirmed) return;

  job.status = "cancelling";
  save();
  render();

  const response = await window.desktopAPI?.cancelTranslation?.(job.id);
  if (!response?.cancelled) {
    job.status = "translating";
    save();
    render();
    toast(t("translation.stopFailed"));
    return;
  }

  toast(t("translation.stopping"));
}

function updateTranslationProgress(payload) {
  const job = state.translation.job;
  if (!job || job.id !== payload?.jobId || ["cancelling", "cancelled"].includes(job.status)) return;

  const allowed = new Set(["validating", "queued", "translating"]);
  if (allowed.has(payload.state)) job.status = payload.state;
  if (payload.serverJobId) job.serverJobId = String(payload.serverJobId);

  job.indeterminate = payload.indeterminate === true;
  if (!job.indeterminate && Number.isFinite(Number(payload.percent))) {
    job.progress = Math.max(0, Math.min(99, Number(payload.percent)));
  }

  const label = $("translationStateLabel");
  const percent = $("translationPercent");
  const bar = $("translationProgressBar");
  const track = $("translationProgressTrack");

  if (label) label.textContent = translationStatusCopy(job);
  if (percent) percent.textContent = job.indeterminate ? "•••" : Math.round(job.progress || 0) + "%";
  if (track) track.classList.toggle("indeterminate", job.indeterminate);
  if (bar) bar.style.width = (job.indeterminate ? 36 : Math.round(job.progress || 0)) + "%";
  save();
}

function voiceJobForSource(source) {
  const job = state.voice.job;
  return source &&
    job?.sourcePath === source.sourcePath &&
    job?.language === state.translation.targetLanguage
    ? job
    : null;
}

function voiceResultForSource(source) {
  const result = state.voice.result;
  return source &&
    result?.sourcePath === source.sourcePath &&
    result?.language === state.translation.targetLanguage
    ? result
    : null;
}

function voiceStatusCopy(job) {
  if (!job) return "";
  const key = {
    validating: "voiceWorkflow.validating",
    queued: "voiceWorkflow.queued",
    generating: "voiceWorkflow.generating",
    downloading: "voiceWorkflow.downloading",
    cancelling: "voiceWorkflow.cancelling",
    completed: "voiceWorkflow.completed",
    cancelled: "voiceWorkflow.cancelled",
    failed: "voiceWorkflow.failed",
    interrupted: "voiceWorkflow.interrupted"
  }[job.status] || "voiceWorkflow.generating";
  return t(key);
}

function voiceSpeakerEntries(result) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const seen = new Set();
  const entries = [];

  for (const segment of segments) {
    const key = String(segment?.speaker || "speaker-1").trim() || "speaker-1";
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      key,
      label: t("voiceWorkflow.speakerName", { number: entries.length + 1 })
    });
  }

  return entries.length
    ? entries
    : [{ key: "speaker-1", label: t("voiceWorkflow.speakerName", { number: 1 }) }];
}

function voiceStyleLabel(voice) {
  const key = String(voice?.styleKey || "");
  return key ? t("voiceWorkflow.styles." + key) : "";
}

function voiceTierLabel(voice) {
  return String(voice?.tier || "standard") === "premium"
    ? t("voiceWorkflow.tierPremium")
    : t("voiceWorkflow.tierStandard");
}

function ensureVoiceAssignments(result) {
  const speakers = voiceSpeakerEntries(result);
  const catalog = Array.isArray(state.voice.catalog) ? state.voice.catalog : [];
  const validIds = new Set(catalog.map(item => String(item.id)));
  const next = { ...(state.voice.assignments || {}) };

  speakers.forEach((speaker, index) => {
    if (!validIds.has(String(next[speaker.key] || ""))) {
      next[speaker.key] = catalog[index % Math.max(1, catalog.length)]?.id || "";
    }
  });

  state.voice.assignments = next;
  return speakers;
}

async function refreshVoiceStatus({ rerender = false } = {}) {
  if (!window.desktopAPI?.getVoiceStatus || state.voice.statusCheckPending) {
    return state.voice.cloudStatus;
  }

  state.voice.statusCheckPending = true;

  try {
    const status = await window.desktopAPI.getVoiceStatus();
    state.voice.cloudStatus = status || null;
    state.voice.catalog = Array.isArray(status?.catalog) ? status.catalog : [];
    state.voice.statusCheckedAt = Date.now();
  } catch {
    state.voice.cloudStatus = {
      ready: false,
      code: "VOICE_UNAVAILABLE"
    };
    state.voice.catalog = [];
  } finally {
    state.voice.statusCheckPending = false;
  }

  if (rerender && ["ai-video", "settings"].includes(state.page)) render();
  return state.voice.cloudStatus;
}

function voiceConnectionPanel() {
  if (state.voice.mode === "local") {
    return '<div class="voice-connection needs-action">' +
      '<div><b>' + t("voiceWorkflow.localPendingTitle") + '</b><p>' + t("voiceWorkflow.localPendingBody") + '</p></div>' +
      '<span class="speech-provider-badge pending"><i></i>' + t("voiceWorkflow.notReady") + '</span>' +
    '</div>';
  }

  const status = state.voice.cloudStatus;
  const ready = status?.ready === true;
  const code = status?.code || "CHECKING";

  let title = t("voiceWorkflow.cloudChecking");
  let body = t("voiceWorkflow.cloudCheckingBody");

  if (ready) {
    title = t("voiceWorkflow.cloudReadyTitle");
    body = t("voiceWorkflow.cloudReadyBody");
  } else if (code === "VOICE_AUTH_REQUIRED") {
    title = t("voiceWorkflow.cloudLoginTitle");
    body = t("voiceWorkflow.cloudLoginBody");
  } else if (code === "VOICE_PLAN_REQUIRED") {
    title = t("voiceWorkflow.planTitle");
    body = t("voiceWorkflow.planBody");
  } else if (code === "VOICE_SUBSCRIPTION_INACTIVE") {
    title = t("voiceWorkflow.subscriptionTitle");
    body = t("voiceWorkflow.subscriptionBody");
  } else if (["VOICE_NOT_CONFIGURED", "VOICE_CONFIG_INVALID", "VOICE_HTTPS_REQUIRED"].includes(code)) {
    title = t("voiceWorkflow.cloudSetupTitle");
    body = t("voiceWorkflow.cloudSetupBody");
  } else if (code !== "CHECKING") {
    title = t("voiceWorkflow.cloudUnavailableTitle");
    body = t("voiceWorkflow.cloudUnavailableBody");
  }

  return '<div class="voice-connection ' + (ready ? "is-ready" : "needs-action") + '">' +
    '<div><b>' + escapeHtml(title) + '</b><p>' + escapeHtml(body) + '</p></div>' +
    '<span class="speech-provider-badge ' + (ready ? "ready" : "pending") + '"><i></i>' +
      escapeHtml(ready ? t("voiceWorkflow.ready") : t("voiceWorkflow.notReady")) + '</span>' +
  '</div>';
}

function voicePreviewSample(language) {
  const supported = ["vi", "en", "ko", "ja"];
  const code = supported.includes(language) ? language : "en";
  return t("voiceWorkflow.previewSamples." + code);
}

function playVoiceUrl(url) {
  if (!url) return;

  try {
    if (window.__viralVoiceAudio) {
      window.__viralVoiceAudio.pause();
      window.__viralVoiceAudio = null;
    }

    const audio = new Audio(url);
    window.__viralVoiceAudio = audio;
    audio.play().catch(() => toast(t("voiceWorkflow.playFailed")));
  } catch {
    toast(t("voiceWorkflow.playFailed"));
  }
}

async function previewVoiceSelection(speakerKey) {
  const voiceId = state.voice.assignments?.[speakerKey] || "";
  const translationResult = translationResultForSource(latestSourceJob());
  const language = translationResult?.targetLanguage || state.translation.targetLanguage;

  if (!voiceId || !window.desktopAPI?.previewVoice) {
    toast(t("voiceWorkflow.chooseVoice"));
    return;
  }

  toast(t("voiceWorkflow.previewPreparing"));

  const response = await window.desktopAPI.previewVoice({
    voiceId,
    language,
    text: voicePreviewSample(language)
  });

  if (!response?.ok) {
    const code = response?.error?.code || "VOICE_FAILED";

    if (code === "VOICE_SUBSCRIPTION_INACTIVE") {
      await refreshCloudUiState({ rerender: true });
      await showNotice({
        title: t("voiceWorkflow.subscriptionTitle"),
        body: t("voiceWorkflow.subscriptionBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    if (code === "VOICE_PLAN_REQUIRED") {
      await showNotice({
        title: t("voiceWorkflow.planTitle"),
        body: t("voiceWorkflow.planBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    if (code === "VOICE_MODEL_NOT_INCLUDED") {
      await showNotice({
        title: t("voiceWorkflow.modelTitle"),
        body: t("voiceWorkflow.modelBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    toast(code === "VOICE_PREVIEW_RATE_LIMITED"
      ? t("voiceWorkflow.previewWait")
      : t("voiceWorkflow.previewFailed"));
    return;
  }

  playVoiceUrl(response.data?.audioUrl);
}

async function previewStudioVoice(voiceId) {
  const language = $("voiceStudioLanguage")?.value || state.translation.targetLanguage || "vi";
  const text = $("voiceStudioText")?.value?.trim() || voicePreviewSample(language);

  if (!voiceId || !window.desktopAPI?.previewVoice) {
    toast(t("voiceWorkflow.chooseVoice"));
    return;
  }

  toast(t("voiceWorkflow.previewPreparing"));

  const response = await window.desktopAPI.previewVoice({
    voiceId,
    language,
    text
  });

  if (!response?.ok) {
    const code = response?.error?.code || "VOICE_FAILED";

    if (code === "VOICE_SUBSCRIPTION_INACTIVE") {
      await refreshCloudUiState({ rerender: true });
      await showNotice({
        title: t("voiceWorkflow.subscriptionTitle"),
        body: t("voiceWorkflow.subscriptionBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    if (code === "VOICE_PLAN_REQUIRED") {
      await showNotice({
        title: t("voiceWorkflow.planTitle"),
        body: t("voiceWorkflow.planBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    if (code === "VOICE_MODEL_NOT_INCLUDED") {
      await showNotice({
        title: t("voiceWorkflow.modelTitle"),
        body: t("voiceWorkflow.modelBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    toast(code === "VOICE_PREVIEW_RATE_LIMITED"
      ? t("voiceWorkflow.previewWait")
      : t("voiceWorkflow.previewFailed"));
    return;
  }

  playVoiceUrl(response.data?.audioUrl);
}

function voiceResultView(result) {
  if (!result) return "";

  const segments = Array.isArray(result.segments) ? result.segments : [];
  const warnings = Number(result?.meta?.warningCount || segments.filter(item => item.timingRisk).length || 0);
  const speakerEntries = voiceSpeakerEntries(result);
  const speakerLabels = new Map(speakerEntries.map(item => [item.key, item.label]));

  return '<div class="voice-result">' +
    '<div class="voice-result-head"><div><span class="side-kicker">' + t("voiceWorkflow.resultTitle") + '</span>' +
      '<h4>' + escapeHtml(t("voiceWorkflow.resultDesc", {
        count: segments.length,
        speakers: speakerEntries.length
      })) + '</h4></div>' +
      '<span class="speech-provider-badge ready"><i></i>' + t("voiceWorkflow.completed") + '</span></div>' +
    (warnings
      ? '<div class="voice-timing-warning"><b>' + t("voiceWorkflow.timingWarningTitle", { count: warnings }) + '</b><span>' +
          t("voiceWorkflow.timingWarningBody") + '</span></div>'
      : '') +
    '<div class="voice-segment-list">' +
      segments.slice(0, 10).map(segment =>
        '<div class="voice-segment-row ' + (segment.timingRisk ? "has-warning" : "") + '">' +
          '<time>' + formatDuration(segment.start) + '</time>' +
          '<div class="voice-segment-copy"><b>' + escapeHtml(speakerLabels.get(String(segment.speaker || "speaker-1")) || speakerEntries[0]?.label || "") + '</b>' +
          '<p>' + escapeHtml(segment.text || "") + '</p><small>' +
            escapeHtml(t("voiceWorkflow.audioDuration", {
              audio: Number(segment.audioDuration || 0).toFixed(1),
              slot: Number(segment.slotDuration || 0).toFixed(1)
            })) +
          '</small></div>' +
          '<button class="button ghost small voice-audio-play" type="button" data-audio-url="' +
            encodeURIComponent(segment.audioUrl || "") + '">▶ ' + t("common.preview") + '</button>' +
        '</div>'
      ).join("") +
    '</div>' +
    (segments.length > 10 ? '<p class="speech-result-note">' + t("voiceWorkflow.moreSegments", { count: segments.length - 10 }) + '</p>' : '') +
  '</div>';
}

async function handleVoiceBlock(response) {
  const code = response?.error?.code || "VOICE_FAILED";

  if (code === "VOICE_AUTH_REQUIRED") {
    await showNotice({
      title: t("voiceWorkflow.authTitle"),
      body: t("voiceWorkflow.authBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_PLAN_REQUIRED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("voiceWorkflow.planTitle"),
      body: t("voiceWorkflow.planBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_MODEL_NOT_INCLUDED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("voiceWorkflow.modelTitle"),
      body: t("voiceWorkflow.modelBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_CONCURRENCY_LIMIT") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("voiceWorkflow.concurrencyTitle"),
      body: t("voiceWorkflow.concurrencyBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_QUOTA_EXCEEDED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("voiceWorkflow.quotaTitle"),
      body: t("voiceWorkflow.quotaBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_TOO_LARGE") {
    await showNotice({
      title: t("voiceWorkflow.tooLargeTitle"),
      body: t("voiceWorkflow.tooLargeBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["VOICE_NETWORK", "VOICE_TIMEOUT", "VOICE_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(code)) {
    await showNotice({
      title: t("voiceWorkflow.connectionTitle"),
      body: t("voiceWorkflow.connectionBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "VOICE_JOB_CONFLICT") {
    await showNotice({
      title: t("voiceWorkflow.conflictTitle"),
      body: t("voiceWorkflow.conflictBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["VOICE_AUDIO_EXPIRED", "VOICE_AUDIO_NOT_FOUND"].includes(code)) {
    await showNotice({
      title: t("voiceWorkflow.audioExpiredTitle"),
      body: t("voiceWorkflow.audioExpiredBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  await showNotice({
    title: t("voiceWorkflow.failedTitle"),
    body: t("voiceWorkflow.failedBody"),
    buttonLabel: t("common.close")
  });
}

async function startVoiceGeneration() {
  const source = latestSourceJob();
  const translationResult = translationResultForSource(source);

  if (!source || !translationResult?.segments?.length) {
    toast(t("voiceWorkflow.needTranslation"));
    return;
  }

  if (state.voice.mode === "local") {
    await showNotice({
      title: t("voiceWorkflow.localPendingTitle"),
      body: t("voiceWorkflow.localPendingBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (!state.cloud.auth?.authenticated) {
    await handleVoiceBlock({ error: { code: "VOICE_AUTH_REQUIRED" } });
    return;
  }

  const status = await refreshVoiceStatus({ rerender: false });
  if (!status?.ready) {
    render();
    await handleVoiceBlock({ error: { code: status?.code || "VOICE_UNAVAILABLE" } });
    return;
  }

  const speakers = ensureVoiceAssignments(translationResult);
  const catalogIds = new Set((state.voice.catalog || []).map(item => String(item.id)));
  const bySpeaker = {};

  for (const speaker of speakers) {
    const voiceId = String(state.voice.assignments?.[speaker.key] || "");
    if (!catalogIds.has(voiceId)) {
      toast(t("voiceWorkflow.chooseVoice"));
      return;
    }
    bySpeaker[speaker.key] = voiceId;
  }

  const defaultVoiceId = bySpeaker[speakers[0]?.key] || "";
  const existingJob = voiceJobForSource(source);

  if (existingJob && ["validating", "queued", "generating", "downloading", "cancelling"].includes(existingJob.status)) {
    toast(t("voiceWorkflow.alreadyRunning"));
    return;
  }

  const confirmed = await confirmAction({
    title: t("voiceWorkflow.cloudConsentTitle"),
    body: t("voiceWorkflow.cloudConsentBody", {
      count: translationResult.segments.length,
      language: languageName(translationResult.targetLanguage)
    }),
    confirmLabel: t("voiceWorkflow.generate"),
    cancelLabel: t("common.cancel")
  });
  if (!confirmed) return;

  const reuse = existingJob &&
    (existingJob.status === "interrupted" || existingJob.retrySameId === true) &&
    existingJob.language === translationResult.targetLanguage;

  const job = {
    id: reuse ? existingJob.id : makeJobId("voice"),
    sourcePath: source.sourcePath,
    sourceName: source.name,
    language: translationResult.targetLanguage,
    status: "validating",
    progress: 0,
    indeterminate: false,
    retrySameId: false,
    startedAt: Date.now()
  };

  state.voice.job = job;
  state.voice.result = null;
  save();
  render();
  toast(t("voiceWorkflow.started"));

  const response = await window.desktopAPI.startVoice({
    jobId: job.id,
    language: job.language,
    assignments: {
      defaultVoiceId,
      bySpeaker
    },
    segments: translationResult.segments.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker || "speaker-1"
    }))
  });

  if (!response?.ok) {
    job.status = "failed";
    job.failureCode = response?.error?.code || "VOICE_FAILED";
    job.retrySameId = [
      "VOICE_NETWORK",
      "VOICE_TIMEOUT",
      "VOICE_UNAVAILABLE",
      "VOICE_REQUEST_FAILED",
      "VOICE_AUDIO_EXPIRED"
    ].includes(job.failureCode);
    save();
    render();
    await handleVoiceBlock(response);
    return;
  }

  if (response.data?.cancelled || job.status === "cancelling") {
    job.status = "cancelled";
    save();
    render();
    toast(t("voiceWorkflow.stopped"));
    return;
  }

  const result = response.data?.result || null;
  job.status = "completed";
  job.progress = 100;
  job.completedAt = Date.now();

  if (result) {
    state.voice.result = {
      ...result,
      sourcePath: source.sourcePath,
      sourceName: source.name
    };
  }

  await refreshCloudUiState({ rerender: false });
  save();
  render();
  toast(t("voiceWorkflow.done"));
}

async function cancelVoiceGeneration() {
  const job = state.voice.job;
  if (!job || !["validating", "queued", "generating", "downloading"].includes(job.status)) return;

  const confirmed = await confirmAction({
    title: t("voiceWorkflow.stopTitle"),
    body: t("voiceWorkflow.stopBody"),
    confirmLabel: t("voiceWorkflow.stop"),
    cancelLabel: t("voiceWorkflow.keepGoing"),
    danger: true
  });
  if (!confirmed) return;

  job.status = "cancelling";
  save();
  render();

  const response = await window.desktopAPI?.cancelVoice?.(job.id);

  if (!response?.cancelled) {
    job.status = "generating";
    save();
    render();
    toast(t("voiceWorkflow.stopFailed"));
    return;
  }

  toast(t("voiceWorkflow.stopping"));
}

function updateVoiceProgress(payload) {
  const job = state.voice.job;
  if (!job || job.id !== payload?.jobId || ["cancelling", "cancelled"].includes(job.status)) return;

  const allowed = new Set(["validating", "queued", "generating", "downloading"]);
  if (allowed.has(payload.state)) job.status = payload.state;
  if (payload.serverJobId) job.serverJobId = String(payload.serverJobId);

  job.indeterminate = payload.indeterminate === true;

  if (!job.indeterminate && Number.isFinite(Number(payload.percent))) {
    job.progress = Math.max(0, Math.min(99, Number(payload.percent)));
  }

  const label = $("voiceStateLabel");
  const percent = $("voicePercent");
  const bar = $("voiceProgressBar");
  const track = $("voiceProgressTrack");

  if (label) label.textContent = voiceStatusCopy(job);
  if (percent) percent.textContent = job.indeterminate ? "•••" : Math.round(job.progress || 0) + "%";
  if (track) track.classList.toggle("indeterminate", job.indeterminate);
  if (bar) bar.style.width = (job.indeterminate ? 36 : Math.round(job.progress || 0)) + "%";
  save();
}

function aiVideoPage() {
  const source = latestSourceJob();
  const speechJob = speechJobForSource(source);
  const speechResult = speechResultForSource(source);
  const translationJob = translationJobForSource(source);
  const translationResult = translationResultForSource(source);
  const voiceJob = voiceJobForSource(source);
  const voiceResult = voiceResultForSource(source);

  const speechStep = speechResult
    ? t("aiVideo.steps.detected")
    : speechJob
      ? speechStatusCopy(speechJob)
      : t("aiVideo.steps.pending");

  const translationStep = translationResult
    ? t("translation.completed")
    : translationJob
      ? translationStatusCopy(translationJob)
      : speechResult
        ? t("aiVideo.steps.pending")
        : "—";

  const voiceStep = voiceResult
    ? t("voiceWorkflow.completed")
    : voiceJob
      ? voiceStatusCopy(voiceJob)
      : translationResult
        ? t("aiVideo.steps.pending")
        : "—";

  const steps = [
    ["1", t("aiVideo.steps.import"), source ? t("aiVideo.steps.ready") : t("aiVideo.steps.pending")],
    ["2", t("aiVideo.steps.speech"), speechStep],
    ["3", t("aiVideo.steps.translate"), translationStep],
    ["4", t("aiVideo.steps.voices"), voiceStep],
    ["5", t("aiVideo.steps.subtitles"), voiceResult ? t("aiVideo.steps.pending") : "—"],
    ["6", t("aiVideo.steps.render"), t("aiVideo.steps.pending")]
  ];

  const sourceName = source?.name || t("media.noVideo");
  const sourceMeta = source ? mediaMetaText(source) : "";
  const preview = source?.previewUrl
    ? '<div class="preview preview-real"><video class="preview-video" controls preload="metadata" src="' + source.previewUrl + '"></video></div>'
    : '<div class="preview"><div class="preview-center"><div class="preview-play">▶</div><div class="preview-label">' + t("media.previewHint") + '</div></div></div>';

  const localSelected = state.speech.mode === "local";
  const cloudMinutes = Math.max(1, Math.ceil(Number(source?.meta?.duration || 0) / 60));
  const speechBusy = speechJob && ["validating", "preparing", "uploading", "queued", "processing", "cancelling"].includes(speechJob.status);
  const interrupted = speechJob?.status === "interrupted";
  const speechAction = speechBusy
    ? '<button id="speechStop" class="button danger" type="button"' + (speechJob.status === "cancelling" ? " disabled" : "") + '>' + t("speech.stop") + '</button>'
    : '<button id="speechStart" class="button primary" type="button">' + (interrupted ? t("speech.retry") : t("speech.start")) + '</button>';

  const speechProgress = speechBusy
    ? '<div class="speech-job-state"><div class="speech-job-head"><div><b id="speechStateLabel">' + escapeHtml(speechStatusCopy(speechJob)) + '</b>' +
        '<span>' + escapeHtml(sourceName) + '</span></div><strong id="speechPercent">' +
        (speechJob.indeterminate ? "•••" : Math.round(Number(speechJob.progress || 0)) + "%") + '</strong></div>' +
        '<div id="speechProgressTrack" class="speech-progress ' + (speechJob.indeterminate ? "indeterminate" : "") + '"><i id="speechProgressBar" style="width:' +
        (speechJob.indeterminate ? "36" : Math.round(Number(speechJob.progress || 0))) + '%"></i></div></div>'
    : interrupted
      ? '<div class="speech-alert warning"><b>' + t("speech.interruptedTitle") + '</b><span>' + t("speech.interruptedBody") + '</span></div>'
      : "";

  const translationBusy = translationJob &&
    ["validating", "queued", "translating", "cancelling"].includes(translationJob.status);
  const translationInterrupted = translationJob?.status === "interrupted";
  const translationLocal = state.translation.mode === "local";

  const translationAction = translationBusy
    ? '<button id="translationStop" class="button danger" type="button"' +
        (translationJob.status === "cancelling" ? " disabled" : "") + '>' + t("translation.stop") + '</button>'
    : !speechResult
      ? '<button class="button primary" type="button" disabled>' + t("translation.needTranscriptButton") + '</button>'
      : translationLocal
        ? '<button class="button primary" type="button" disabled>' + t("translation.localUnavailableButton") + '</button>'
        : '<button id="translationStart" class="button primary" type="button">' +
            (translationInterrupted ? t("translation.retry") : translationResult ? t("translation.translateAgain") : t("translation.start")) +
          '</button>';

  const translationProgress = translationBusy
    ? '<div class="speech-job-state translation-job-state"><div class="speech-job-head"><div><b id="translationStateLabel">' +
        escapeHtml(translationStatusCopy(translationJob)) + '</b><span>' +
        escapeHtml(languageName(translationJob.targetLanguage)) + '</span></div><strong id="translationPercent">' +
        (translationJob.indeterminate ? "•••" : Math.round(Number(translationJob.progress || 0)) + "%") + '</strong></div>' +
        '<div id="translationProgressTrack" class="speech-progress ' + (translationJob.indeterminate ? "indeterminate" : "") +
        '"><i id="translationProgressBar" style="width:' +
        (translationJob.indeterminate ? "36" : Math.round(Number(translationJob.progress || 0))) + '%"></i></div></div>'
    : translationInterrupted
      ? '<div class="speech-alert warning"><b>' + t("translation.interruptedTitle") + '</b><span>' +
          t("translation.interruptedBody") + '</span></div>'
      : "";

  const voiceBusy = voiceJob &&
    ["validating", "queued", "generating", "downloading", "cancelling"].includes(voiceJob.status);
  const voiceInterrupted = voiceJob?.status === "interrupted";
  const voiceLocal = state.voice.mode === "local";
  const voiceCatalogReady = Array.isArray(state.voice.catalog) && state.voice.catalog.length > 0;
  const voiceSpeakers = translationResult ? ensureVoiceAssignments(translationResult) : [];

  const voiceAction = voiceBusy
    ? '<button id="voiceStop" class="button danger" type="button"' +
        (voiceJob.status === "cancelling" ? " disabled" : "") + '>' + t("voiceWorkflow.stop") + '</button>'
    : !translationResult
      ? '<button class="button primary" type="button" disabled>' + t("voiceWorkflow.needTranslationButton") + '</button>'
      : voiceLocal
        ? '<button class="button primary" type="button" disabled>' + t("voiceWorkflow.localUnavailableButton") + '</button>'
        : !voiceCatalogReady
          ? '<button class="button primary" type="button" disabled>' + t("voiceWorkflow.checkingVoices") + '</button>'
          : '<button id="voiceStart" class="button primary" type="button">' +
              (voiceInterrupted ? t("voiceWorkflow.retry") : voiceResult ? t("voiceWorkflow.generateAgain") : t("voiceWorkflow.generate")) +
            '</button>';

  const voiceProgress = voiceBusy
    ? '<div class="speech-job-state voice-job-state"><div class="speech-job-head"><div><b id="voiceStateLabel">' +
        escapeHtml(voiceStatusCopy(voiceJob)) + '</b><span>' +
        escapeHtml(languageName(voiceJob.language)) + '</span></div><strong id="voicePercent">' +
        (voiceJob.indeterminate ? "•••" : Math.round(Number(voiceJob.progress || 0)) + "%") + '</strong></div>' +
        '<div id="voiceProgressTrack" class="speech-progress ' + (voiceJob.indeterminate ? "indeterminate" : "") +
        '"><i id="voiceProgressBar" style="width:' +
        (voiceJob.indeterminate ? "36" : Math.round(Number(voiceJob.progress || 0))) + '%"></i></div></div>'
    : voiceInterrupted
      ? '<div class="speech-alert warning"><b>' + t("voiceWorkflow.interruptedTitle") + '</b><span>' +
          t("voiceWorkflow.interruptedBody") + '</span></div>'
      : "";

  const voiceMappingRows = translationResult && voiceSpeakers.length
    ? '<div class="voice-mapping-list">' + voiceSpeakers.map(speaker => {
        const selected = state.voice.assignments?.[speaker.key] || "";
        return '<div class="voice-mapping-row"><div class="voice-speaker-copy"><span>' +
          escapeHtml(speaker.label) + '</span><small>' + escapeHtml(languageName(translationResult.targetLanguage)) + '</small></div>' +
          '<select class="select voice-assignment-select" data-speaker-key="' + escapeHtml(speaker.key) + '"' +
            (voiceBusy ? " disabled" : "") + '>' +
            (state.voice.catalog || []).map(voice =>
              '<option value="' + escapeHtml(voice.id) + '"' + (voice.id === selected ? " selected" : "") + '>' +
                escapeHtml(voice.name + " · " + voiceTierLabel(voice) + (voiceStyleLabel(voice) ? " · " + voiceStyleLabel(voice) : "")) +
              '</option>'
            ).join("") +
          '</select>' +
          '<button class="button ghost small voice-preview-button" type="button" data-voice-preview-speaker="' +
            escapeHtml(speaker.key) + '"' + (voiceBusy || !selected ? " disabled" : "") + '>▶ ' +
            t("voiceWorkflow.preview") + '</button></div>';
      }).join("") + '</div>'
    : '<div class="voice-empty">' + t("voiceWorkflow.waitingTranslation") + '</div>';

  return '<div class="section-head"><div><h3>' + t("aiVideo.workflow") + "</h3><p>" + t("aiVideo.workflowDesc") +
    '</p></div><button id="render" class="button primary" type="button">' + t("aiVideo.renderFinal") + "</button></div>" +
    '<div class="workflow">' + steps.map((x, i) =>
      '<div class="wf-step ' + (i === (voiceResult ? 4 : translationResult ? 3 : speechResult ? 2 : source ? 1 : 0) ? "active" : "") + '"><b>' + x[0] + ". " + x[1] + "</b><span>" + x[2] + "</span></div>" +
      (i < steps.length - 1 ? '<div class="wf-arrow">→</div>' : "")
    ).join("") + "</div>" +

    '<div class="card speech-card"><div class="speech-card-head"><div><div class="eyebrow">' + t("aiVideo.steps.speech") + '</div>' +
      '<h3>' + t("speech.title") + '</h3><p>' + t("speech.desc") + '</p></div>' + speechAction + '</div>' +
      '<div class="speech-controls">' +
        '<div class="speech-field"><label class="label" for="speechMode">' + t("speech.mode") + '</label>' +
          '<select id="speechMode" class="select">' +
            '<option value="local"' + (localSelected ? " selected" : "") + '>' + t("speech.local") + '</option>' +
            '<option value="cloud"' + (!localSelected ? " selected" : "") + '>' + t("speech.cloud") + '</option>' +
          '</select>' +
          '<div class="speech-choice-help"><span>' + (localSelected ? t("speech.localDesc") : t("speech.cloudDesc")) + '</span>' +
            (localSelected ? speechProviderBadge("local") : speechProviderBadge("cloud")) +
            (localSelected ? '<button id="manageLocalAi" class="speech-manage-link" type="button">' + t("speech.manageLocal") + '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="speech-field"><label class="label" for="speechLanguage">' + t("speech.language") + '</label>' +
          '<select id="speechLanguage" class="select">' +
            '<option value="auto"' + (state.speech.language === "auto" ? " selected" : "") + '>' + t("speech.autoLanguage") + '</option>' +
            '<option value="vi"' + (state.speech.language === "vi" ? " selected" : "") + '>' + languageName("vi") + '</option>' +
            '<option value="en"' + (state.speech.language === "en" ? " selected" : "") + '>English</option>' +
            '<option value="ko"' + (state.speech.language === "ko" ? " selected" : "") + '>' + languageName("ko") + '</option>' +
            '<option value="ja"' + (state.speech.language === "ja" ? " selected" : "") + '>' + languageName("ja") + '</option>' +
          '</select>' +
          '<div class="speech-choice-help"><span>' + (localSelected ? t("speech.noCloudCost") : t("speech.estimate", { minutes: cloudMinutes })) + '</span></div>' +
        '</div>' +
      '</div>' +
      speechConnectionPanel() +
      speechProgress +
      speechTranscriptView(speechResult) +
    '</div>' +

    '<div class="card speech-card translation-card"><div class="speech-card-head"><div><div class="eyebrow">' +
      t("aiVideo.steps.translate") + '</div><h3>' + t("translation.title") + '</h3><p>' + t("translation.desc") +
      '</p></div>' + translationAction + '</div>' +
      '<div class="translation-controls">' +
        '<div class="speech-field"><label class="label" for="translationMode">' + t("translation.mode") + '</label>' +
          '<select id="translationMode" class="select"' + (translationBusy ? " disabled" : "") + '>' +
            '<option value="cloud"' + (!translationLocal ? " selected" : "") + '>' + t("speech.cloud") + '</option>' +
            '<option value="local"' + (translationLocal ? " selected" : "") + '>' + t("speech.local") + '</option>' +
          '</select><div class="speech-choice-help"><span>' +
            (translationLocal ? t("translation.localDesc") : t("translation.cloudDesc")) + '</span></div></div>' +
        '<div class="speech-field"><label class="label">' + t("translation.sourceLanguage") + '</label>' +
          '<div class="translation-readonly">' + escapeHtml(speechResult ? languageName(speechResult.language) : t("translation.waitingTranscript")) + '</div>' +
          '<div class="speech-choice-help"><span>' + t("translation.sourceLanguageHelp") + '</span></div></div>' +
        '<div class="speech-field"><label class="label" for="translationTarget">' + t("common.targetLanguage") + '</label>' +
          '<select id="translationTarget" class="select"' + (translationBusy ? " disabled" : "") + '>' +
            '<option value="vi"' + (state.translation.targetLanguage === "vi" ? " selected" : "") + '>' + languageName("vi") + '</option>' +
            '<option value="en"' + (state.translation.targetLanguage === "en" ? " selected" : "") + '>English</option>' +
            '<option value="ko"' + (state.translation.targetLanguage === "ko" ? " selected" : "") + '>' + languageName("ko") + '</option>' +
            '<option value="ja"' + (state.translation.targetLanguage === "ja" ? " selected" : "") + '>' + languageName("ja") + '</option>' +
          '</select><label class="translation-check"><input id="translationPreserveTone" type="checkbox"' +
            (state.translation.preserveTone ? " checked" : "") + (translationBusy ? " disabled" : "") + '><span>' +
            t("translation.preserveTone") + '</span></label></div>' +
      '</div>' +
      translationConnectionPanel() +
      translationProgress +
      translationResultView(translationResult) +
    '</div>' +

    '<div class="card speech-card voice-workflow-card"><div class="speech-card-head"><div><div class="eyebrow">' +
      t("aiVideo.steps.voices") + '</div><h3>' + t("voiceWorkflow.title") + '</h3><p>' + t("voiceWorkflow.desc") +
      '</p></div>' + voiceAction + '</div>' +
      '<div class="voice-top-controls"><div class="speech-field"><label class="label" for="voiceMode">' +
        t("voiceWorkflow.mode") + '</label><select id="voiceMode" class="select"' + (voiceBusy ? " disabled" : "") + '>' +
          '<option value="cloud"' + (!voiceLocal ? " selected" : "") + '>' + t("speech.cloud") + '</option>' +
          '<option value="local"' + (voiceLocal ? " selected" : "") + '>' + t("speech.local") + '</option>' +
        '</select><div class="speech-choice-help"><span>' +
          (voiceLocal ? t("voiceWorkflow.localDesc") : t("voiceWorkflow.cloudDesc")) + '</span></div></div>' +
        '<div class="voice-language-summary"><span>' + t("voiceWorkflow.voiceLanguage") + '</span><b>' +
          escapeHtml(translationResult ? languageName(translationResult.targetLanguage) : "—") + '</b></div></div>' +
      voiceConnectionPanel() +
      '<div class="ai-voice-disclosure"><span aria-hidden="true">AI</span><p>' + t("voiceWorkflow.aiDisclosure") + '</p></div>' +
      voiceMappingRows +
      voiceProgress +
      voiceResultView(voiceResult) +
    '</div>' +

    '<div class="section-head"><div><h3>' + t("aiVideo.editor") + '</h3><p>' + escapeHtml(sourceName) +
      (sourceMeta ? ' · ' + escapeHtml(sourceMeta) : '') + "</p></div></div>" +
    '<div class="editor-grid">' + preview +
    '<div class="stack"><div class="mini-card"><h4>' + t("translation.projectSummary") + '</h4>' +
    '<div class="translation-summary-row"><span>' + t("common.targetLanguage") + '</span><b>' +
      escapeHtml(languageName(state.translation.targetLanguage)) + '</b></div>' +
    '<div class="translation-summary-row"><span>' + t("translation.status") + '</span><b>' +
      escapeHtml(translationResult ? t("translation.completed") : t("aiVideo.steps.pending")) + '</b></div>' +
    '<div class="translation-summary-row"><span>' + t("voiceWorkflow.summaryLabel") + '</span><b>' +
      escapeHtml(voiceResult ? t("voiceWorkflow.completed") : t("aiVideo.steps.pending")) + '</b></div>' +
    '</div>' +
    '<div class="mini-card"><h4>' + t("aiVideo.outputFormat") + '</h4><select class="select"><option>9:16 · 1080×1920</option><option>16:9 · 1920×1080</option><option>1:1 · 1080×1080</option></select>' +
    '<div class="toggle-row"><span>' + t("aiVideo.burnSubtitles") + '</span><div class="toggle on"></div></div></div></div></div>';
}

function voicePage() {
  const catalog = Array.isArray(state.voice.catalog) ? state.voice.catalog : [];
  const defaultVoice = catalog[0]?.id || "";
  const language = state.translation.targetLanguage || "vi";
  const sample = voicePreviewSample(language);

  return '<div class="grid-2"><div class="card card-pad"><div class="eyebrow">' + t("voice.ttsEyebrow") + '</div>' +
    '<h3>' + t("voice.ttsTitle") + '</h3><p class="muted">' + t("voice.previewOnlyDesc") + '</p>' +
    '<label class="label" for="voiceStudioText">' + t("voice.sampleLabel") + '</label>' +
    '<textarea id="voiceStudioText" class="textarea" rows="5" maxlength="220">' + escapeHtml(sample) + '</textarea>' +
    '<div class="voice-studio-controls"><select id="voiceStudioLanguage" class="select">' +
      '<option value="vi"' + (language === "vi" ? " selected" : "") + '>' + languageName("vi") + '</option>' +
      '<option value="en"' + (language === "en" ? " selected" : "") + '>English</option>' +
      '<option value="ko"' + (language === "ko" ? " selected" : "") + '>' + languageName("ko") + '</option>' +
      '<option value="ja"' + (language === "ja" ? " selected" : "") + '>' + languageName("ja") + '</option>' +
    '</select><select id="voiceStudioVoice" class="select">' +
      (catalog.length
        ? catalog.map(voice => '<option value="' + escapeHtml(voice.id) + '">' +
            escapeHtml(voice.name + " · " + voiceTierLabel(voice) + (voiceStyleLabel(voice) ? " · " + voiceStyleLabel(voice) : "")) + '</option>').join("")
        : '<option value="">' + t("voice.loadingVoices") + '</option>') +
    '</select><button id="voiceStudioPreview" class="button primary" type="button"' + (!defaultVoice ? " disabled" : "") + '>▶ ' +
      t("voice.previewButton") + '</button></div>' +
    '<div class="ai-voice-disclosure"><span aria-hidden="true">AI</span><p>' + t("voiceWorkflow.aiDisclosure") + '</p></div></div>' +
    '<div class="card card-pad"><div class="eyebrow">' + t("voice.cloneEyebrow") + '</div><h3>' + t("voice.cloneTitle") + '</h3>' +
      '<p class="muted">' + t("voice.cloneCommercialDesc") + '</p>' +
      '<div class="voice-feature-pending"><b>' + t("voice.clonePendingTitle") + '</b><span>' + t("voice.clonePendingBody") + '</span></div>' +
      '<button class="button ghost" type="button" disabled>' + t("voice.cloneUnavailable") + '</button></div></div>' +
    '<div class="section-head"><div><h3>' + t("voice.library") + '</h3><p>' + t("voice.libraryDesc") + '</p></div></div>' +
    '<div class="voice-grid">' +
      (catalog.length
        ? catalog.map(voice =>
            '<div class="voice-card"><div class="voice-top"><div class="voice-avatar">' +
              escapeHtml(String(voice.name || "?").slice(0,1).toUpperCase()) + '</div><div class="voice-meta"><b>' +
              escapeHtml(voice.name) + '</b><span>' + escapeHtml(voiceTierLabel(voice) + " · " + voiceStyleLabel(voice)) + '</span></div></div>' +
              '<div class="wave">' + Array.from({ length: 22 }, (_, i) => '<i style="height:' + (7 + (i * 11) % 17) + 'px"></i>').join("") + '</div>' +
              '<button class="button ghost small voice-studio-card-preview" data-voice-id="' + escapeHtml(voice.id) + '" type="button">▶ ' +
                t("common.preview") + '</button></div>'
          ).join("")
        : '<div class="card card-pad voice-library-empty">' + t("voice.cloudRequired") + '</div>') +
    '</div>';
}

function editorPage() {
  return '<div class="editor-grid"><div class="preview"><div class="preview-center"><div class="preview-play">▶</div><div class="preview-label">' +
    t("editor.canvas") + '</div></div></div><div class="stack"><div class="mini-card"><h4>' + t("editor.subtitle") + "</h4>" +
    '<div class="toggle-row"><span>' + t("editor.autoCaptions") + '</span><div class="toggle on"></div></div>' +
    '<div class="toggle-row"><span>' + t("editor.highlight") + '</span><div class="toggle on"></div></div></div>' +
    '<div class="mini-card"><h4>' + t("editor.video") + '</h4><label class="label">' + t("editor.aspect") +
    '</label><select class="select"><option>9:16 Vertical</option><option>16:9 Landscape</option></select>' +
    '<div class="toggle-row"><span>' + t("editor.normalize") + '</span><div class="toggle on"></div></div></div>' +
    '<button id="export" class="button primary" type="button">' + t("common.export") + "</button></div></div>";
}

function automationPage() {
  const flows = [
    [t("automation.autoLocalize"), t("automation.autoLocalizeDesc"), true],
    [t("automation.autoPublish"), t("automation.autoPublishDesc"), true],
    [t("automation.retry"), t("automation.retryDesc"), true],
    [t("automation.archive"), t("automation.archiveDesc"), false]
  ];
  return '<div class="grid-3"><div class="stat-card"><div class="stat-label">' + t("automation.active") + '</div><div class="stat-value">3</div></div>' +
    '<div class="stat-card"><div class="stat-label">' + t("automation.runs") + '</div><div class="stat-value">486</div></div>' +
    '<div class="stat-card"><div class="stat-label">' + t("automation.saved") + '</div><div class="stat-value">31h</div></div></div>' +
    '<div class="section-head"><div><h3>' + t("automation.workflows") + '</h3></div><button id="newFlow" class="button primary" type="button">＋ ' +
    t("automation.newFlow") + "</button></div>" +
    '<div class="card">' + flows.map((x) =>
      '<div class="automation-card"><div class="auto-icon">⚡</div><div class="auto-copy"><b>' + x[0] + "</b><p>" + x[1] +
      '</p></div><div class="switch ' + (x[2] ? "on" : "") + '"></div></div>'
    ).join("") + "</div>";
}

function libraryPage() {
  return '<div class="section-head"><div><h3>' + t("library.title") + "</h3><p>" + t("library.desc") +
    '</p></div><input id="search" class="input" style="width:220px" placeholder="' + t("library.search") + '"></div>' +
    '<div id="libraryTable">' + jobsTable() + "</div>";
}

function accountsPage() {
  const accounts = [
    ["TikTok", "@hoangstudio", true],
    ["YouTube", "Hoang Studio", true],
    ["Instagram", "@hoang.creates", true],
    ["Facebook", state.locale === "vi" ? "Chưa kết nối" : "Not connected", false]
  ];
  return '<div class="section-head"><div><h3>' + t("accounts.title") + "</h3><p>" + t("accounts.desc") + "</p></div></div>" +
    '<div class="grid-2">' + accounts.map((x) =>
      '<div class="card card-pad"><div class="row" style="justify-content:space-between"><div><div class="eyebrow">' + x[0] + "</div><b>" + x[1] +
      '</b></div><button class="button ' + (x[2] ? "ghost" : "primary") + ' account" data-connected="' + (x[2] ? "1" : "0") +
      '" type="button">' + (x[2] ? t("common.connected") : t("common.connect")) + "</button></div></div>"
    ).join("") + "</div>";
}

function subscriptionStatusCopy(subscription) {
  const status = String(subscription?.status || "unknown");
  const key = {
    trialing: "usage.subscriptionTrial",
    active: "usage.subscriptionActive",
    past_due: "usage.subscriptionPastDue",
    grace_period: "usage.subscriptionGrace",
    canceled: "usage.subscriptionCanceled"
  }[status] || "usage.subscriptionUnknown";
  return t(key);
}

function accountDateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(state.locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function usagePage() {
  const auth = state.cloud.auth;
  const account = state.cloud.account;
  const user = account?.user || null;
  const quota = account?.quota || null;
  const usage = account?.usage || null;
  const entitlements = account?.entitlements || null;
  const cloudActivity = account?.cloudActivity || null;
  const subscription = account?.subscription || null;
  const authenticated = auth?.authenticated === true;
  const offlineSnapshot = state.cloud.accountOffline === true;

  if (!authenticated) {
    return '<div class="card card-pad account-empty">' +
      '<div class="eyebrow">' + t("usage.currentPlan") + '</div>' +
      '<h3>' + t("usage.signInRequiredTitle") + '</h3>' +
      '<p class="muted">' + t("usage.signInRequiredBody") + '</p>' +
      '<button id="usageLogin" class="button primary" type="button">' + t("account.signIn") + '</button>' +
    '</div>';
  }

  const total = Number(quota?.totalMinutes);
  const remaining = Number(quota?.remainingMinutes);
  const explicitUsed = Number(quota?.usedMinutes);
  const used = Number.isFinite(explicitUsed)
    ? Math.max(0, explicitUsed)
    : Number.isFinite(total) && Number.isFinite(remaining)
      ? Math.max(0, total - remaining)
      : NaN;
  const percent = Number.isFinite(total) && total > 0 && Number.isFinite(used)
    ? Math.max(0, Math.min(100, Math.round((used / total) * 100)))
    : 0;

  const resetAt = quota?.resetAt ? new Date(quota.resetAt) : null;
  const resetLabel = resetAt && !Number.isNaN(resetAt.getTime())
    ? resetAt.toLocaleDateString(state.locale === "vi" ? "vi-VN" : "en-US")
    : "—";

  const items = [
    [t("usage.speechMinutes"), usage?.speechMinutes],
    [t("usage.translationMinutes"), usage?.translationMinutes],
    [t("usage.voiceMinutes"), usage?.voiceMinutes],
    [t("usage.exportMinutes"), usage?.exportMinutes]
  ];

  const reserved = Number(quota?.reservedMinutes);
  const allowance = Number.isFinite(remaining)
    ? t("usage.minutesRemaining", { minutes: Math.max(0, Math.floor(remaining)), date: resetLabel })
    : t("usage.allowanceUnavailable");
  const reservationNote = Number.isFinite(reserved) && reserved > 0
    ? t("usage.minutesReserved", { minutes: Math.max(0, Math.floor(reserved)) })
    : "";

  const featureItems = entitlements ? [
    [t("usage.cloudSpeech"), entitlements.features?.cloudSpeech === true],
    [t("usage.cloudTranslation"), entitlements.features?.cloudTranslation === true],
    [t("usage.cloudVoice"), entitlements.features?.cloudVoice === true],
    [t("usage.voicePreview"), entitlements.features?.voicePreview === true]
  ] : [];

  const activeJobs = Number(cloudActivity?.activeJobs);
  const maxConcurrentJobs = Number(entitlements?.maxConcurrentCloudJobs ?? cloudActivity?.maxConcurrentJobs);

  const monthlyValue = Number.isFinite(used) && Number.isFinite(total)
    ? Math.floor(used).toLocaleString(state.locale === "vi" ? "vi-VN" : "en-US") + " / " +
      Math.floor(total).toLocaleString(state.locale === "vi" ? "vi-VN" : "en-US") + " " + t("usage.minutesUnit")
    : "—";

  const subscriptionEnd =
    subscription?.status === "trialing"
      ? subscription?.trialEndsAt
      : subscription?.status === "grace_period" || subscription?.status === "past_due"
        ? subscription?.graceEndsAt
        : subscription?.currentPeriodEnd;

  const subscriptionNote =
    subscription?.cancelAtPeriodEnd
      ? t("usage.cancelAtPeriodEnd", { date: accountDateLabel(subscription.currentPeriodEnd) })
      : subscription?.pendingPlanId
        ? t("usage.planChangesNextCycle", {
            plan: subscription.pendingPlanName || subscription.pendingPlanId,
            date: accountDateLabel(subscription.currentPeriodEnd)
          })
        : "";

  const offlineNotice = offlineSnapshot
    ? '<div class="speech-alert warning"><b>' + t("usage.offlineSnapshotTitle") + '</b><span>' +
        escapeHtml(t("usage.offlineSnapshotBody", {
          date: accountDateLabel(state.cloud.accountVerifiedAt)
        })) + '</span></div>'
    : "";

  return offlineNotice + '<div class="grid-2">' +
    '<div class="card card-pad"><div class="eyebrow">' + t("usage.currentPlan") + '</div><h3>' +
      escapeHtml(user?.plan || auth?.plan || "—") + '</h3><p class="muted">' + escapeHtml(allowance) + '</p>' +
      (reservationNote ? '<p class="muted usage-reservation-note">' + escapeHtml(reservationNote) + '</p>' : '') +
      '<div class="row"><button id="usageRefresh" class="button ghost" type="button">' + t("usage.refresh") + '</button>' +
      '<button id="usageLogout" class="button ghost" type="button">' + t("account.signOut") + '</button></div></div>' +
    '<div class="card card-pad"><div class="eyebrow">' + t("usage.monthlyUsage") + '</div><div class="stat-value">' +
      escapeHtml(monthlyValue) + '</div><div class="bar"><i style="width:' + percent + '%"></i></div>' +
      '<p class="muted">' + escapeHtml(t("usage.usedPercent", { percent })) + '</p></div>' +
  '</div>' +
  (subscription
    ? '<div class="card card-pad subscription-card"><div class="eyebrow">' + t("usage.subscription") + '</div>' +
      '<h3>' + escapeHtml(subscriptionStatusCopy(subscription)) + '</h3>' +
      '<p class="muted">' + escapeHtml(t("usage.subscriptionUntil", { date: accountDateLabel(subscriptionEnd) })) + '</p>' +
      (subscriptionNote ? '<p class="muted">' + escapeHtml(subscriptionNote) + '</p>' : '') +
    '</div>'
    : '') +
  '<div class="section-head"><div><h3>' + t("usage.breakdown") + '</h3><p>' + t("usage.breakdownDesc") + '</p></div></div>' +
  '<div class="usage-grid">' + items.map((item) => {
    const value = Number(item[1]);
    return '<div class="stat-card"><div class="stat-label">' + item[0] + '</div><div class="stat-value">' +
      (Number.isFinite(value) ? Math.max(0, Math.floor(value)).toLocaleString(state.locale === "vi" ? "vi-VN" : "en-US") : "—") +
      '</div><div class="muted">' + t("usage.minutesUnit") + '</div></div>';
  }).join("") + '</div>' +
  (entitlements
    ? '<div class="section-head"><div><h3>' + t("usage.planAccess") + '</h3><p>' + t("usage.planAccessDesc") + '</p></div></div>' +
      '<div class="usage-grid">' +
        featureItems.map((item) =>
          '<div class="stat-card"><div class="stat-label">' + escapeHtml(item[0]) + '</div><div class="stat-value">' +
          escapeHtml(item[1] ? t("usage.included") : t("usage.notIncluded")) + '</div></div>'
        ).join("") +
        '<div class="stat-card"><div class="stat-label">' + t("usage.concurrentJobs") + '</div><div class="stat-value">' +
          (Number.isFinite(activeJobs) ? Math.max(0, Math.floor(activeJobs)) : 0) + ' / ' +
          (Number.isFinite(maxConcurrentJobs) ? Math.max(1, Math.floor(maxConcurrentJobs)) : "—") +
        '</div><div class="muted">' + t("usage.activeNow") + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + t("usage.modelAccess") + '</div><div class="stat-value">' +
          escapeHtml((entitlements.models?.speech || []).map(x => x === "premium" ? t("usage.premium") : t("usage.standard")).join(" + ") || "—") +
        '</div></div>' +
      '</div>'
    : '');
}


function formatBillingMoney(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "—";

  try {
    return new Intl.NumberFormat(state.locale === "vi" ? "vi-VN" : "en-US", {
      style: "currency",
      currency: String(currency || "USD"),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(numeric / 100);
  } catch {
    return (numeric / 100).toFixed(2) + " " + String(currency || "USD");
  }
}

async function loadBillingData({ rerender = false } = {}) {
  if (!window.desktopAPI || state.billing.loading) return state.billing;

  if (!state.cloud.auth?.authenticated) {
    state.billing.catalog = null;
    state.billing.invoices = null;
    state.billing.errorCode = "AUTH_REQUIRED";
    if (rerender && state.page === "billing") render();
    return state.billing;
  }

  state.billing.loading = true;
  state.billing.errorCode = null;

  try {
    const [catalogResponse, invoiceResponse] = await Promise.all([
      window.desktopAPI.getBillingCatalog?.(),
      window.desktopAPI.getBillingInvoices?.()
    ]);

    if (catalogResponse?.ok) {
      state.billing.catalog = catalogResponse.data || null;
    } else {
      state.billing.errorCode = catalogResponse?.error?.code || "BILLING_REQUEST_FAILED";
    }

    if (invoiceResponse?.ok) {
      state.billing.invoices = invoiceResponse.data || null;
    } else if (!state.billing.errorCode) {
      state.billing.errorCode = invoiceResponse?.error?.code || "BILLING_REQUEST_FAILED";
    }

    state.billing.loadedAt = Date.now();
  } catch {
    state.billing.errorCode = "BILLING_NETWORK";
  } finally {
    state.billing.loading = false;
  }

  if (rerender && state.page === "billing") render();
  return state.billing;
}

function billingFeatureList(plan) {
  const features = [
    [t("billing.featureSpeech"), plan?.features?.cloudSpeech === true],
    [t("billing.featureTranslation"), plan?.features?.cloudTranslation === true],
    [t("billing.featureVoice"), plan?.features?.cloudVoice === true],
    [t("billing.featurePremium"), Array.isArray(plan?.models?.voice) && plan.models.voice.includes("premium")]
  ];

  return features.map(([label, enabled]) =>
    '<div class="billing-feature ' + (enabled ? "included" : "excluded") + '">' +
      '<span aria-hidden="true">' + (enabled ? "✓" : "–") + '</span><b>' + escapeHtml(label) + '</b>' +
    '</div>'
  ).join("");
}

function billingPage() {
  const authenticated = state.cloud.auth?.authenticated === true;
  const account = state.cloud.account;
  const catalog = state.billing.catalog;
  const invoices = Array.isArray(state.billing.invoices?.invoices)
    ? state.billing.invoices.invoices
    : [];
  const subscription = account?.subscription || catalog?.subscription || null;

  if (!authenticated) {
    return '<div class="card card-pad account-empty">' +
      '<div class="eyebrow">' + t("billing.eyebrow") + '</div>' +
      '<h3>' + t("billing.signInTitle") + '</h3><p class="muted">' + t("billing.signInBody") + '</p>' +
      '<button id="billingLogin" class="button primary" type="button">' + t("account.signIn") + '</button>' +
    '</div>';
  }

  if (state.billing.loading && !catalog) {
    return '<div class="card card-pad billing-loading"><div class="eyebrow">' + t("billing.eyebrow") +
      '</div><h3>' + t("billing.loading") + '</h3><p class="muted">' + t("billing.loadingDesc") + '</p></div>';
  }

  if (!catalog) {
    return '<div class="card card-pad billing-loading"><div class="eyebrow">' + t("billing.eyebrow") +
      '</div><h3>' + t("billing.unavailableTitle") + '</h3><p class="muted">' + t("billing.unavailableBody") +
      '</p><button id="billingRetry" class="button primary" type="button">' + t("billing.retry") + '</button></div>';
  }

  const plans = Array.isArray(catalog.plans) ? catalog.plans : [];
  const currentPlanId = String(catalog.currentPlanId || account?.user?.planId || "");
  const currentIndex = plans.findIndex(plan => plan.id === currentPlanId);

  const planCards = plans.map((plan, index) => {
    const current = plan.id === currentPlanId;
    const upgrade = currentIndex >= 0 && index > currentIndex;
    const downgrade = currentIndex >= 0 && index < currentIndex;
    const price = Number(plan.monthlyAmount) === 0
      ? t("billing.free")
      : t("billing.perMonth", {
          price: formatBillingMoney(plan.monthlyAmount, plan.currency)
        });

    let action = '<button class="button ghost" type="button" disabled>' + t("billing.currentPlan") + '</button>';
    if (upgrade) {
      action = '<button class="button primary billing-upgrade" data-plan-id="' + escapeHtml(plan.id) +
        '" type="button">' + t("billing.upgrade") + '</button>';
    } else if (downgrade) {
      action = '<button class="button ghost billing-downgrade" data-plan-id="' + escapeHtml(plan.id) +
        '" data-plan-name="' + escapeHtml(plan.name) + '" type="button">' + t("billing.downgrade") + '</button>';
    }

    return '<div class="card billing-plan-card ' + (current ? "is-current" : "") + '">' +
      '<div class="billing-plan-head"><div><span class="eyebrow">' + (current ? t("billing.current") : t("billing.plan")) +
        '</span><h3>' + escapeHtml(plan.name) + '</h3></div>' +
        (current ? '<span class="billing-current-badge">' + t("billing.active") + '</span>' : '') +
      '</div>' +
      '<div class="billing-price">' + escapeHtml(price) + '</div>' +
      '<p class="muted">' + escapeHtml(t("billing.minutes", { minutes: Number(plan.monthlyMinutes || 0).toLocaleString(state.locale === "vi" ? "vi-VN" : "en-US") })) + '</p>' +
      '<p class="muted">' + escapeHtml(t("billing.concurrent", { count: plan.maxConcurrentCloudJobs || 1 })) + '</p>' +
      '<div class="billing-feature-list">' + billingFeatureList(plan) + '</div>' +
      '<div class="billing-plan-action">' + action + '</div>' +
    '</div>';
  }).join("");

  const status = subscription ? subscriptionStatusCopy(subscription) : "—";
  const subscriptionDate =
    subscription?.status === "trialing"
      ? subscription?.trialEndsAt
      : subscription?.status === "past_due" || subscription?.status === "grace_period"
        ? subscription?.graceEndsAt
        : subscription?.currentPeriodEnd;

  const subscriptionActions = subscription?.cancelAtPeriodEnd
    ? '<button id="billingResume" class="button primary" type="button">' + t("billing.resume") + '</button>'
    : '<button id="billingCancel" class="button ghost danger-text" type="button">' + t("billing.cancelPlan") + '</button>';

  const invoiceRows = invoices.length
    ? invoices.map(item =>
        '<tr><td>' + escapeHtml(accountDateLabel(item.createdAt)) + '</td>' +
        '<td>' + escapeHtml(item.planName || item.planId || "—") + '</td>' +
        '<td>' + escapeHtml(formatBillingMoney(item.amount, item.currency)) + '</td>' +
        '<td><span class="status-pill done">' + escapeHtml(item.status || "—") + '</span></td></tr>'
      ).join("")
    : '<tr><td colspan="4" class="billing-empty-row">' + t("billing.noInvoices") + '</td></tr>';

  return (catalog.developmentOnly
    ? '<div class="speech-alert warning billing-dev-banner"><b>' + t("billing.devTitle") + '</b><span>' +
        t("billing.devBody") + '</span></div>'
    : '') +
    '<div class="section-head"><div><h3>' + t("billing.choosePlan") + '</h3><p>' + t("billing.choosePlanDesc") + '</p></div>' +
      '<button id="billingRefresh" class="button ghost" type="button">' + t("billing.refresh") + '</button></div>' +
    '<div class="billing-plan-grid">' + planCards + '</div>' +
    '<div class="section-head"><div><h3>' + t("billing.manage") + '</h3><p>' + t("billing.manageDesc") + '</p></div></div>' +
    '<div class="grid-2">' +
      '<div class="card card-pad billing-subscription-card"><div class="eyebrow">' + t("billing.subscription") + '</div>' +
        '<h3>' + escapeHtml(status) + '</h3><p class="muted">' +
          escapeHtml(t("billing.nextDate", { date: accountDateLabel(subscriptionDate) })) + '</p>' +
        (subscription?.pendingPlanName
          ? '<p class="billing-pending">' + escapeHtml(t("billing.pendingPlan", { plan: subscription.pendingPlanName })) + '</p>'
          : '') +
        '<div class="row">' + subscriptionActions +
          '<button id="billingPortal" class="button ghost" type="button">' + t("billing.portal") + '</button></div>' +
      '</div>' +
      '<div class="card card-pad"><div class="eyebrow">' + t("billing.security") + '</div><h3>' +
        t("billing.securityTitle") + '</h3><p class="muted">' + t("billing.securityBody") + '</p></div>' +
    '</div>' +
    '<div class="section-head"><div><h3>' + t("billing.invoices") + '</h3><p>' + t("billing.invoicesDesc") + '</p></div></div>' +
    '<div class="card table-wrap billing-invoices"><table class="data-table"><thead><tr><th>' + t("billing.date") +
      '</th><th>' + t("billing.invoicePlan") + '</th><th>' + t("billing.amount") + '</th><th>' +
      t("common.status") + '</th></tr></thead><tbody>' + invoiceRows + '</tbody></table></div>';
}

async function billingErrorNotice(code) {
  const map = {
    AUTH_REQUIRED: ["billing.authTitle", "billing.authBody"],
    BILLING_NETWORK: ["billing.networkTitle", "billing.networkBody"],
    BILLING_TIMEOUT: ["billing.networkTitle", "billing.networkBody"],
    BILLING_SERVICE_UNAVAILABLE: ["billing.unavailableTitle", "billing.unavailableBody"],
    BILLING_PLAN_ALREADY_ACTIVE: ["billing.samePlanTitle", "billing.samePlanBody"],
    BILLING_SESSION_EXPIRED: ["billing.sessionTitle", "billing.sessionBody"],
    SUBSCRIPTION_INACTIVE: ["billing.inactiveTitle", "billing.inactiveBody"]
  };
  const copy = map[code] || ["billing.failedTitle", "billing.failedBody"];
  await showNotice({
    title: t(copy[0]),
    body: t(copy[1]),
    buttonLabel: t("common.close")
  });
}

async function startBillingUpgrade(planId) {
  const response = await window.desktopAPI?.startBillingCheckout?.(planId);
  if (!response?.ok) {
    await billingErrorNotice(response?.error?.code);
    return;
  }

  const url = response.data?.checkoutUrl;
  if (!url) {
    await billingErrorNotice("BILLING_REQUEST_FAILED");
    return;
  }

  const opened = await window.desktopAPI?.openExternal?.(url);
  if (!opened?.ok) {
    await billingErrorNotice("BILLING_REQUEST_FAILED");
    return;
  }

  await showNotice({
    title: t("billing.checkoutOpenedTitle"),
    body: t("billing.checkoutOpenedBody"),
    buttonLabel: t("common.close")
  });

  setTimeout(async () => {
    await refreshCloudUiState({ rerender: false });
    await loadBillingData({ rerender: state.page === "billing" });
  }, 1600);
}

async function scheduleBillingDowngrade(planId, planName) {
  const confirmed = await confirmAction({
    title: t("billing.downgradeTitle", { plan: planName }),
    body: t("billing.downgradeBody", { plan: planName }),
    confirmLabel: t("billing.confirmDowngrade"),
    cancelLabel: t("common.cancel")
  });
  if (!confirmed) return;

  const response = await window.desktopAPI?.changeBillingPlan?.(planId);
  if (!response?.ok) {
    await billingErrorNotice(response?.error?.code);
    return;
  }

  await refreshCloudUiState({ rerender: false });
  await loadBillingData({ rerender: true });
  toast(t("billing.downgradeScheduled"));
}

async function cancelBillingPlan() {
  const confirmed = await confirmAction({
    title: t("billing.cancelTitle"),
    body: t("billing.cancelBody"),
    confirmLabel: t("billing.confirmCancel"),
    cancelLabel: t("common.cancel"),
    danger: true
  });
  if (!confirmed) return;

  const response = await window.desktopAPI?.cancelBillingSubscription?.();
  if (!response?.ok) {
    await billingErrorNotice(response?.error?.code);
    return;
  }

  await refreshCloudUiState({ rerender: false });
  await loadBillingData({ rerender: true });
  toast(t("billing.cancelScheduled"));
}

async function resumeBillingPlan() {
  const response = await window.desktopAPI?.resumeBillingSubscription?.();
  if (!response?.ok) {
    await billingErrorNotice(response?.error?.code);
    return;
  }

  await refreshCloudUiState({ rerender: false });
  await loadBillingData({ rerender: true });
  toast(t("billing.resumed"));
}

async function openBillingPortal() {
  const response = await window.desktopAPI?.openBillingPortal?.();
  if (!response?.ok || !response.data?.portalUrl) {
    await billingErrorNotice(response?.error?.code);
    return;
  }

  const opened = await window.desktopAPI?.openExternal?.(response.data.portalUrl);
  if (!opened?.ok) await billingErrorNotice("BILLING_REQUEST_FAILED");
}

function settingsPage() {
  const settings = [
    [t("settings.autosave"), t("settings.autosaveDesc"), true],
    [t("settings.gpu"), t("settings.gpuDesc"), true],
    [t("settings.email"), t("settings.emailDesc"), false],
    [t("settings.compact"), t("settings.compactDesc"), false]
  ];

  const option = (value, label, selected) =>
    '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + label + '</option>';

  const cloudConfig = state.cloud.config || {};
  const devVisible = cloudConfig.developerSettingsVisible === true;
  const test = state.cloud.test;
  const testClass = test?.ok ? "success" : test ? "warning" : "neutral";
  const testLabel = test?.ok
    ? (test.authenticated === false ? t("settings.cloudReachableLogin") : t("settings.cloudConnected"))
    : test
      ? t("settings.cloudTestFailed")
      : t("settings.cloudNotTested");

  const accountUser = state.cloud.account?.user || null;
  const accountQuota = state.cloud.account?.quota || null;
  const accountAuthenticated = state.cloud.auth?.authenticated === true;
  const accountRemaining = Number(accountQuota?.remainingMinutes);

  const accountCard =
    '<div class="card card-pad account-settings-card">' +
      '<div class="eyebrow">' + t("account.title") + '</div>' +
      (accountAuthenticated
        ? '<div class="account-settings-profile"><div class="account-avatar">' +
            escapeHtml((accountUser?.name || accountUser?.email || "V").slice(0,1).toUpperCase()) +
          '</div><div><h3>' + escapeHtml(accountUser?.name || t("account.connectedAccount")) + '</h3><p>' +
            escapeHtml(accountUser?.email || "") + '</p></div></div>' +
          '<div class="account-facts">' +
            '<div><span>' + t("account.planLabel") + '</span><b>' + escapeHtml(accountUser?.plan || state.cloud.auth?.plan || "—") + '</b></div>' +
            '<div><span>' + t("account.cloudAllowance") + '</span><b>' +
              (Number.isFinite(accountRemaining) ? escapeHtml(t("account.minutes", { minutes: Math.max(0, Math.floor(accountRemaining)) })) : "—") +
            '</b></div>' +
          '</div>' +
          '<button id="settingsLogout" class="button ghost" type="button">' + t("account.signOut") + '</button>'
        : '<div class="account-empty"><h3>' + t("account.notSignedIn") + '</h3><p>' + t("account.notSignedInDesc") + '</p>' +
          '<button id="settingsLogin" class="button primary" type="button">' + t("account.signIn") + '</button></div>') +
    '</div>';

  const devCloudStatus = state.speech.providerStatus?.cloud || null;
  const devProviderReady = devCloudStatus?.ready === true;
  const devProviderLabel = devProviderReady
    ? t("settings.providerReady")
    : devCloudStatus?.code === "CLOUD_PROVIDER_NOT_CONFIGURED"
      ? t("settings.providerNotConfigured")
      : state.cloud.auth?.authenticated
        ? t("settings.providerUnavailable")
        : t("settings.providerNeedsLogin");

  const devTranslationStatus = state.translation.cloudStatus || null;
  const devTranslationReady = devTranslationStatus?.ready === true;
  const devTranslationLabel = devTranslationReady
    ? t("settings.providerReady")
    : devTranslationStatus?.code === "TRANSLATION_PROVIDER_NOT_CONFIGURED"
      ? t("settings.providerNotConfigured")
      : state.cloud.auth?.authenticated
        ? t("settings.providerUnavailable")
        : t("settings.providerNeedsLogin");

  const devVoiceStatus = state.voice.cloudStatus || null;
  const devVoiceReady = devVoiceStatus?.ready === true;
  const devVoiceLabel = devVoiceReady
    ? t("settings.providerReady")
    : devVoiceStatus?.code === "VOICE_PROVIDER_NOT_CONFIGURED"
      ? t("settings.providerNotConfigured")
      : state.cloud.auth?.authenticated
        ? t("settings.providerUnavailable")
        : t("settings.providerNeedsLogin");

  const developerCard = devVisible
    ? '<div id="developerCloudSettings" class="card card-pad developer-cloud-card">' +
        '<div class="eyebrow">' + t("settings.developer") + '</div>' +
        '<div class="developer-card-head"><div><h3>' + t("settings.cloudBackend") + '</h3><p>' + t("settings.cloudBackendDesc") + '</p></div>' +
          '<span class="dev-badge">' + t("settings.developmentOnly") + '</span></div>' +
        '<div class="dev-account-hint"><span>DEV</span><code>' + escapeHtml(t("settings.devAccountHint")) + '</code></div>' +
        '<div class="developer-cloud-grid">' +
          '<div class="speech-field"><label class="label" for="cloudEnvironment">' + t("settings.environment") + '</label>' +
            '<select id="cloudEnvironment" class="select"' + (cloudConfig.source === "environment" ? " disabled" : "") + '>' +
              option("development", t("settings.environmentDevelopment"), state.cloud.draftEnvironment || cloudConfig.environment || "development") +
              option("production", t("settings.environmentProduction"), state.cloud.draftEnvironment || cloudConfig.environment || "development") +
            '</select></div>' +
          '<div class="speech-field cloud-url-field"><label class="label" for="cloudBackendUrl">' + t("settings.backendUrl") + '</label>' +
            '<input id="cloudBackendUrl" class="input" type="url" spellcheck="false" autocomplete="off" placeholder="http://localhost:3000" value="' +
              escapeHtml(state.cloud.draftBackendUrl ?? cloudConfig.backendUrl ?? "") + '"' + (cloudConfig.source === "environment" ? " readonly" : "") + '>' +
            '<small>' + escapeHtml(cloudConfig.source === "environment" ? t("settings.cloudEnvLocked") : t("settings.backendUrlHelp")) + '</small></div>' +
        '</div>' +
        '<div class="cloud-test-strip ' + testClass + '"><span class="cloud-test-dot"></span><div><b>' + escapeHtml(testLabel) + '</b><span>' +
          escapeHtml(test?.status ? t("settings.cloudHttpStatus", { status: test.status }) : t("settings.cloudTestHint")) + '</span></div></div>' +
        '<div class="provider-dev-strip ' + (devProviderReady ? "success" : "neutral") + '">' +
          '<div><span class="provider-dev-kicker">' + t("settings.speechProvider") + '</span><b>' + escapeHtml(devProviderLabel) + '</b>' +
          '<p>' + escapeHtml(t("settings.providerSetupHint")) + '</p></div>' +
          '<code>OPENAI_API_KEY</code>' +
        '</div>' +
        '<div class="provider-dev-strip ' + (devTranslationReady ? "success" : "neutral") + '">' +
          '<div><span class="provider-dev-kicker">' + t("settings.translationProvider") + '</span><b>' + escapeHtml(devTranslationLabel) + '</b>' +
          '<p>' + escapeHtml(t("settings.providerSetupHint")) + '</p></div>' +
          '<code>VIRAL_AI_OPENAI_TRANSLATION_MODEL</code>' +
        '</div>' +
        '<div class="provider-dev-strip ' + (devVoiceReady ? "success" : "neutral") + '">' +
          '<div><span class="provider-dev-kicker">' + t("settings.voiceProvider") + '</span><b>' + escapeHtml(devVoiceLabel) + '</b>' +
          '<p>' + escapeHtml(t("settings.providerSetupHint")) + '</p></div>' +
          '<code>VIRAL_AI_OPENAI_TTS_MODEL</code>' +
        '</div>' +
        '<div class="developer-actions">' +
          '<button id="testCloudConnection" class="button ghost" type="button">' + t("settings.testConnection") + '</button>' +
          (cloudConfig.source === "environment" ? "" :
            '<button id="saveCloudConfig" class="button primary" type="button">' + t("settings.saveCloudConfig") + '</button>') +
        '</div>' +
      '</div>'
    : "";

  return '<div class="grid-2">' +
    '<div class="card card-pad preference-card"><div class="eyebrow">' + t("settings.general") + '</div>' +
    '<div class="settings-select-row"><div class="setting-copy"><b>' + t("settings.interfaceLanguage") + '</b><span>' + t("settings.languageDesc") + '</span></div>' +
    '<select id="settingsLocale" class="select">' +
      option("vi", "Tiếng Việt", state.locale) +
      option("en", "English", state.locale) +
    '</select></div>' +
    '<div class="settings-select-row"><div class="setting-copy"><b>' + t("settings.appearance") + '</b><span>' + t("settings.appearanceDesc") + '</span></div>' +
    '<select id="appearanceSelect" class="select">' +
      option("aurora-light", t("settings.appearanceAurora"), state.appearance) +
      option("pearl-light", t("settings.appearancePearl"), state.appearance) +
      option("midnight", t("settings.appearanceMidnight"), state.appearance) +
    '</select></div>' +
    '<div class="settings-select-row"><div class="setting-copy"><b>' + t("settings.motion") + '</b><span>' + t("settings.motionDesc") + '</span></div>' +
    '<select id="motionSelect" class="select">' +
      option("balanced", t("settings.motionBalanced"), state.motion) +
      option("expressive", t("settings.motionExpressive"), state.motion) +
      option("reduced", t("settings.motionReduced"), state.motion) +
    '</select></div>' +
    '<div class="settings-select-row"><div class="setting-copy"><b>' + t("settings.interfaceSize") + '</b><span>' + t("settings.interfaceSizeDesc") + '</span></div>' +
    '<select id="scaleSelect" class="select">' +
      option("compact", t("settings.sizeCompact"), state.scale) +
      option("comfortable", t("settings.sizeComfortable"), state.scale) +
      option("large", t("settings.sizeLarge"), state.scale) +
    '</select></div>' +
    settings.map((x) => '<div class="setting-row"><div class="setting-copy"><b>' + x[0] + '</b><span>' + x[1] +
      '</span></div><div class="switch ' + (x[2] ? "on" : "") + '"></div></div>').join("") +
    '</div>' +
    '<div class="card card-pad"><div class="eyebrow">' + t("settings.output") + '</div><label class="label">' + t("common.outputFolder") +
    '</label><div class="row"><input id="outputPath" class="input" readonly value="' + escapeHtml(state.output || t("settings.notSelected")) +
    '"><button id="chooseOutput" class="button ghost" type="button">' + t("common.choose") + '</button></div>' +
    '<div style="margin-top:14px"><label class="label">' + t("common.resolution") + '</label><select class="select"><option>1080p</option><option>4K</option></select></div>' +
    '</div>' +
    accountCard +
    developerCard +
    '</div>';
}

const pages = {
  dashboard: dashboard,
  download: downloadPage,
  monitor: monitorPage,
  "ai-video": aiVideoPage,
  voice: voicePage,
  editor: editorPage,
  automation: automationPage,
  library: libraryPage,
  accounts: accountsPage,
  usage: usagePage,
  billing: billingPage,
  settings: settingsPage
};

function modal(title, body) {
  const root = $("modal");
  root.classList.remove("hidden");
  root.innerHTML = '<div class="modal"><div class="eyebrow">' + t("modal.brand") + "</div><h3>" + title +
    "</h3><p>" + body + '</p><div class="modal-actions"><button id="cancel" class="button ghost" type="button">' +
    t("common.cancel") + '</button><button id="ok" class="button primary" type="button">' + t("common.create") + "</button></div></div>";
  $("cancel").onclick = () => root.classList.add("hidden");
  $("ok").onclick = () => {
    root.classList.add("hidden");
    toast(title);
  };
}


function confirmAction({ title, body, confirmLabel, cancelLabel, danger = false }) {
  return new Promise(resolve => {
    const root = $("modal");
    root.classList.remove("hidden");
    root.innerHTML =
      '<div class="modal commercial-modal">' +
        '<div class="modal-icon ' + (danger ? "danger" : "info") + '">' + (danger ? "!" : "i") + '</div>' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<p>' + escapeHtml(body) + '</p>' +
        '<div class="modal-actions">' +
          '<button id="confirmCancel" class="button ghost" type="button">' + escapeHtml(cancelLabel || t("common.cancel")) + '</button>' +
          '<button id="confirmOk" class="button ' + (danger ? "danger solid-danger" : "primary") + '" type="button">' + escapeHtml(confirmLabel) + '</button>' +
        '</div>' +
      '</div>';

    $("confirmCancel").onclick = () => {
      root.classList.add("hidden");
      resolve(false);
    };
    $("confirmOk").onclick = () => {
      root.classList.add("hidden");
      resolve(true);
    };
  });
}

function activeRenderJobsForPath(filePath) {
  if (!filePath) return [];
  return state.jobs.filter(job =>
    job.isRenderOutput &&
    job.sourcePath === filePath &&
    ["processing", "cancelling"].includes(normalizeStatus(job.status))
  );
}

function activeSpeechJobForPath(filePath) {
  const job = state.speech.job;
  if (!filePath || !job || job.sourcePath !== filePath) return null;
  return ["validating", "preparing", "uploading", "queued", "processing", "cancelling"].includes(job.status) ? job : null;
}

function activeTranslationJobForPath(filePath) {
  const job = state.translation.job;
  if (!filePath || !job || job.sourcePath !== filePath) return null;
  return ["validating", "queued", "translating", "cancelling"].includes(job.status) ? job : null;
}

function activeVoiceJobForPath(filePath) {
  const job = state.voice.job;
  if (!filePath || !job || job.sourcePath !== filePath) return null;
  return ["validating", "queued", "generating", "downloading", "cancelling"].includes(job.status) ? job : null;
}

function activeWorkCountForPath(filePath) {
  return activeRenderJobsForPath(filePath).length +
    (activeSpeechJobForPath(filePath) ? 1 : 0) +
    (activeTranslationJobForPath(filePath) ? 1 : 0) +
    (activeVoiceJobForPath(filePath) ? 1 : 0);
}

async function checkJobFile(job, { notify = false } = {}) {
  const filePath = jobFilePath(job);
  if (!filePath || !window.desktopAPI?.fileStatus) return true;

  const result = await window.desktopAPI.fileStatus(filePath);
  const previous = job.fileState;
  job.fileState = result?.exists ? "available" : "missing";

  if (!result?.exists) {
    job.previewUrl = "";
    job.mediaState = "missing";
    if (notify && previous !== "missing") toast(t("file.missingToast", { name: job.name }));
  }

  save();
  return Boolean(result?.exists);
}

function replacementLooksDifferent(oldMeta, newMeta) {
  if (!oldMeta || !newMeta) return false;

  const durationA = Number(oldMeta.duration || 0);
  const durationB = Number(newMeta.duration || 0);
  const durationDifferent = durationA > 0 && durationB > 0 &&
    Math.abs(durationA - durationB) > Math.max(3, durationA * 0.1);

  const resolutionDifferent = oldMeta.width && oldMeta.height && newMeta.width && newMeta.height &&
    (oldMeta.width !== newMeta.width || oldMeta.height !== newMeta.height);

  const sizeA = Number(oldMeta.sizeBytes || 0);
  const sizeB = Number(newMeta.sizeBytes || 0);
  const sizeDifferent = sizeA > 0 && sizeB > 0 &&
    Math.abs(sizeA - sizeB) / Math.max(sizeA, 1) > 0.55;

  return durationDifferent || resolutionDifferent || sizeDifferent;
}

function replacementSummary(meta) {
  if (!meta) return t("file.unknownDetails");
  const parts = [];
  if (meta.duration) parts.push(formatDuration(meta.duration));
  if (meta.width && meta.height) parts.push(meta.width + "×" + meta.height);
  if (meta.sizeBytes) parts.push(formatBytes(meta.sizeBytes));
  return parts.join(" · ") || t("file.unknownDetails");
}

async function relinkJob(job) {
  if (!job || job.isRenderOutput || !window.desktopAPI?.selectReplacementVideo) return false;

  if (activeWorkCountForPath(job.sourcePath) > 0) {
    toast(t("file.relinkBusy"));
    return false;
  }

  const picked = await window.desktopAPI.selectReplacementVideo();
  if (!picked?.path) return false;

  try {
    const [result, previewUrl] = await Promise.all([
      window.desktopAPI.createThumbnail(picked.path),
      window.desktopAPI.getVideoUrl?.(picked.path)
    ]);
    const newMeta = result?.metadata || null;

    if (replacementLooksDifferent(job.meta, newMeta)) {
      const useIt = await confirmAction({
        title: t("file.relinkDifferentTitle"),
        body: t("file.relinkDifferentBody", {
          old: replacementSummary(job.meta),
          next: replacementSummary(newMeta)
        }),
        confirmLabel: t("file.useThisVideo"),
        cancelLabel: t("file.chooseAgain")
      });
      if (!useIt) return relinkJob(job);
    }

    const oldPath = job.sourcePath;

    if (state.speech.result?.sourcePath === oldPath) state.speech.result = null;
    if (state.speech.job?.sourcePath === oldPath) state.speech.job = null;
    if (state.translation.result?.sourcePath === oldPath) state.translation.result = null;
    if (state.translation.job?.sourcePath === oldPath) state.translation.job = null;
    if (state.voice.result?.sourcePath === oldPath) state.voice.result = null;
    if (state.voice.job?.sourcePath === oldPath) state.voice.job = null;

    job.sourcePath = picked.path;
    job.name = picked.name;
    job.meta = newMeta;
    job.thumbnail = result?.dataUrl || "";
    job.previewUrl = previewUrl || "";
    job.fileState = "available";
    job.mediaState = "ready";
    job.mediaError = "";
    job.time = t("common.now");

    state.jobs.forEach(item => {
      if (item !== job && item.sourcePath === oldPath && normalizeStatus(item.status) === "queued") {
        item.sourcePath = picked.path;
      }
    });

    save();
    render();
    toast(t("file.relinked"));
    return true;
  } catch {
    toast(t("file.relinkFailed"));
    return false;
  }
}

function removeJobFromLibrary(job) {
  if (!job) return;

  const active = job.isRenderOutput
    ? ["processing", "cancelling"].includes(normalizeStatus(job.status))
    : activeWorkCountForPath(job.sourcePath) > 0;

  if (active) {
    toast(t("file.removeBusy"));
    return;
  }

  state.jobs = state.jobs.filter(item => item.id !== job.id);
  save();
  render();
  toast(t(job.isRenderOutput ? "file.historyRemoved" : "file.removedLibrary"));
}

async function trashJobFile(job) {
  if (!job || !window.desktopAPI?.trashFile) return;

  const filePath = jobFilePath(job);
  if (!filePath) return;

  const exists = await checkJobFile(job);
  if (!exists) {
    render();
    showMissingFileDialog(job);
    return;
  }

  const activeRenders = job.isRenderOutput && ["processing", "cancelling"].includes(normalizeStatus(job.status))
    ? [job]
    : activeRenderJobsForPath(filePath);
  const activeSpeech = activeSpeechJobForPath(filePath);
  const activeTranslation = activeTranslationJobForPath(filePath);
  const activeVoice = activeVoiceJobForPath(filePath);
  const activeCount = activeRenders.length + (activeSpeech ? 1 : 0) + (activeTranslation ? 1 : 0) + (activeVoice ? 1 : 0);

  const confirmed = await confirmAction({
    title: activeCount ? t("file.trashBusyTitle") : t("file.trashTitle"),
    body: activeCount
      ? t("file.trashBusyBody", { name: job.name, count: activeCount })
      : t("file.trashBody", { name: job.name }),
    confirmLabel: activeCount ? t("file.stopAndTrash") : t("file.moveToTrash"),
    cancelLabel: t("common.cancel"),
    danger: true
  });

  if (!confirmed) return;

  for (const renderJob of activeRenders) {
    const stopped = await window.desktopAPI.cancelRender?.(renderJob.id);
    if (stopped?.cancelled) {
      renderJob.status = "cancelled";
      renderJob.time = t("common.now");
    }
  }

  if (activeSpeech) {
    const stopped = await window.desktopAPI.cancelSpeech?.(activeSpeech.id);
    if (!stopped?.cancelled) {
      toast(t("file.stopWorkFailed"));
      return;
    }
    activeSpeech.status = "cancelled";
  }

  if (activeTranslation) {
    const stopped = await window.desktopAPI.cancelTranslation?.(activeTranslation.id);
    if (!stopped?.cancelled) {
      toast(t("file.stopWorkFailed"));
      return;
    }
    activeTranslation.status = "cancelled";
  }

  if (activeVoice) {
    const stopped = await window.desktopAPI.cancelVoice?.(activeVoice.id);
    if (!stopped?.cancelled) {
      toast(t("file.stopWorkFailed"));
      return;
    }
    activeVoice.status = "cancelled";
  }

  if (activeCount) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  try {
    const result = await window.desktopAPI.trashFile(filePath);
    if (!result?.ok) {
      if (result?.reason === "missing") {
        job.fileState = "missing";
        save();
        render();
        showMissingFileDialog(job);
        return;
      }
      toast(t("file.trashFailed"));
      return;
    }

    job.fileState = "trashed";
    state.jobs = state.jobs.filter(item => item.id !== job.id);
    save();
    render();
    toast(t("file.trashDone"));
  } catch {
    toast(t("file.trashFailed"));
  }
}

async function revealJobFile(job) {
  if (!job) return;
  const exists = await checkJobFile(job);
  if (!exists) {
    render();
    showMissingFileDialog(job);
    return;
  }
  const filePath = jobFilePath(job);
  if (filePath) window.desktopAPI?.showFile(filePath);
}

function showMissingFileDialog(job) {
  if (!job) return;
  const root = $("modal");
  root.classList.remove("hidden");
  root.innerHTML =
    '<div class="modal commercial-modal missing-file-modal">' +
      '<div class="modal-icon warning">!</div>' +
      '<h3>' + escapeHtml(t("file.missingTitle")) + '</h3>' +
      '<p>' + escapeHtml(t("file.missingBody", { name: job.name })) + '</p>' +
      '<div class="missing-file-name">' + escapeHtml(job.name) + '</div>' +
      '<div class="modal-actions split-actions">' +
        '<button id="missingClose" class="button ghost" type="button">' + escapeHtml(t("common.close")) + '</button>' +
        '<button id="missingRemove" class="button ghost" type="button">' + escapeHtml(t("file.removeLibrary")) + '</button>' +
        (!job.isRenderOutput
          ? '<button id="missingRelink" class="button primary" type="button">' + escapeHtml(t("file.relink")) + '</button>'
          : '') +
      '</div>' +
    '</div>';

  $("missingClose").onclick = () => root.classList.add("hidden");
  $("missingRemove").onclick = () => {
    root.classList.add("hidden");
    removeJobFromLibrary(job);
  };
  const relink = $("missingRelink");
  if (relink) {
    relink.onclick = async () => {
      root.classList.add("hidden");
      await relinkJob(job);
    };
  }
}

async function handleJobAction(action, jobId) {
  const job = findJob(jobId);
  if (!job) return;

  if (action === "reveal") return revealJobFile(job);
  if (action === "relink") return relinkJob(job);
  if (action === "remove") return removeJobFromLibrary(job);
  if (action === "trash") return trashJobFile(job);
  if (action === "cancel-export") return cancelExportJob(job);
}

async function refreshFileStates({ notify = true } = {}) {
  if (!window.desktopAPI?.fileStatus) return;

  let newlyMissing = 0;
  const candidates = state.jobs.filter(job => {
    const filePath = jobFilePath(job);
    return Boolean(filePath) && normalizeStatus(job.status) !== "processing";
  });

  for (const job of candidates) {
    const previous = job.fileState;
    const exists = await checkJobFile(job);
    if (!exists && previous !== "missing") newlyMissing++;
  }

  if (newlyMissing) {
    render();
    if (notify) toast(t("file.missingSummary", { count: newlyMissing }));
  }
}

async function enrichJob(job) {
  if (!window.desktopAPI || !job?.sourcePath) return;
  try {
    const available = await checkJobFile(job);
    if (!available) {
      job.mediaState = "missing";
      save();
      if (["dashboard", "download", "library", "ai-video"].includes(state.page)) render();
      return;
    }

    job.fileState = "available";
    job.mediaState = "reading";
    const [result, previewUrl] = await Promise.all([
      window.desktopAPI.createThumbnail(job.sourcePath),
      window.desktopAPI.getVideoUrl?.(job.sourcePath)
    ]);
    job.meta = result?.metadata || null;
    job.thumbnail = result?.dataUrl || "";
    job.previewUrl = previewUrl || "";
    job.mediaState = "ready";
    save();
    if (["dashboard", "download", "library", "ai-video"].includes(state.page)) render();
  } catch (error) {
    const stillExists = await window.desktopAPI.fileStatus?.(job.sourcePath);
    job.fileState = stillExists?.exists ? "available" : "missing";
    job.mediaState = job.fileState === "missing" ? "missing" : "error";
    job.mediaError = error?.message || String(error);
    save();
    if (job.fileState === "missing") {
      render();
      toast(t("file.missingToast", { name: job.name }));
    } else {
      toast(t("media.readError"));
    }
  }
}

async function addFiles() {
  if (!window.desktopAPI) return [];
  const files = await window.desktopAPI.selectVideos();
  if (!files.length) return [];

  const jobs = files.map((file) => ({
    id: makeJobId("source"),
    name: file.name,
    lang: "",
    status: "queued",
    progress: 0,
    time: t("common.now"),
    sourcePath: file.path,
    fileState: "available",
    mediaState: "reading"
  }));

  jobs.slice().reverse().forEach(job => state.jobs.unshift(job));
  render();
  toast(t("download.added", { count: files.length }));

  jobs.forEach(enrichJob);
  return jobs;
}

function updateProgressElements(job) {
  document.querySelectorAll('[data-progress-label="' + job.id + '"]').forEach(node => {
    node.textContent = Math.round(Number(job.progress || 0)) + "%";
  });
  document.querySelectorAll('[data-progress-bar="' + job.id + '"]').forEach(node => {
    node.style.width = Math.round(Number(job.progress || 0)) + "%";
  });
  const activityProgress = document.querySelector("[data-activity-progress]");
  if (activityProgress && normalizeStatus(job.status) === "processing") {
    activityProgress.textContent = Math.round(Number(job.progress || 0)) + "%";
  }
}

function showNotice({ title, body, buttonLabel }) {
  return new Promise(resolve => {
    const root = $("modal");
    root.classList.remove("hidden");
    root.innerHTML =
      '<div class="modal commercial-modal">' +
        '<div class="modal-icon info">i</div>' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<p>' + escapeHtml(body) + '</p>' +
        '<div class="modal-actions">' +
          '<button id="noticeOk" class="button primary" type="button">' + escapeHtml(buttonLabel || t("common.close")) + '</button>' +
        '</div>' +
      '</div>';
    $("noticeOk").onclick = () => {
      root.classList.add("hidden");
      resolve(true);
    };
  });
}

async function refreshSpeechProviderStatus({ rerender = true } = {}) {
  if (!window.desktopAPI?.getSpeechProviderStatus) return null;
  try {
    const status = await window.desktopAPI.getSpeechProviderStatus();
    state.speech.providerStatus = status || null;
    if (rerender && state.page === "ai-video") render();
    return status;
  } catch {
    state.speech.providerStatus = null;
    return null;
  }
}

async function loadSpeechModelInfo() {
  if (!window.desktopAPI?.getSpeechModelCatalog || !window.desktopAPI?.getSpeechModelStatus) return null;

  try {
    if (!state.speech.modelCatalog) {
      state.speech.modelCatalog = await window.desktopAPI.getSpeechModelCatalog();
    }

    const model = Array.isArray(state.speech.modelCatalog)
      ? state.speech.modelCatalog[0]
      : null;
    if (!model) return null;

    const response = await window.desktopAPI.getSpeechModelStatus(model.id);
    if (response?.ok) state.speech.modelStatus = response.data;
    return {
      model,
      status: response?.ok ? response.data : null
    };
  } catch {
    return null;
  }
}

function localModelSetupHtml(model, status) {
  const active = state.speech.modelDownload;
  const downloading = Boolean(active);
  const partial = status?.state === "partial";
  const installed = status?.state === "installed";
  const size = formatBytes(model?.downloadSizeBytes || status?.totalBytes || 0);
  const installedSize = formatBytes(model?.installedSizeBytes || model?.downloadSizeBytes || 0);
  const downloaded = formatBytes(active?.downloadedBytes ?? status?.downloadedBytes ?? 0);
  const total = formatBytes(active?.totalBytes ?? status?.totalBytes ?? model?.downloadSizeBytes ?? 0);
  const percent = Math.max(0, Math.min(100, Math.round(Number(active?.percent ?? status?.percent ?? 0))));

  return '<div class="modal commercial-modal model-setup-modal">' +
    '<div class="modal-icon info">✦</div>' +
    '<h3>' + escapeHtml(t("speech.modelTitle")) + '</h3>' +
    '<p>' + escapeHtml(t("speech.modelBody")) + '</p>' +
    '<div class="model-summary">' +
      '<div><span>' + t("speech.modelStandard") + '</span><b>' + escapeHtml(t("speech.modelDownloadSize", { size })) + '</b></div>' +
      '<div><span>' + t("speech.local") + '</span><b>' + escapeHtml(t("speech.modelInstalledSize", { size: installedSize })) + '</b></div>' +
    '</div>' +
    ((downloading || partial)
      ? '<div class="model-download-state">' +
          '<div class="model-download-head"><span id="modelProgressLabel">' +
            escapeHtml(downloading && active?.state === "verifying"
              ? t("speech.modelVerifying")
              : t("speech.modelDownloaded", { downloaded, total })) +
          '</span><strong id="modelProgressPercent">' + percent + '%</strong></div>' +
          '<div class="speech-progress model-progress"><i id="modelProgressBar" style="width:' + percent + '%"></i></div>' +
        '</div>'
      : '') +
    (installed
      ? '<div class="speech-alert success"><b>' + t("speech.modelReady") + '</b></div>'
      : '') +
    '<div class="modal-actions">' +
      '<button id="modelClose" class="button ghost" type="button">' + t("speech.modelLater") + '</button>' +
      (downloading
        ? '<button id="modelCancelDownload" class="button danger" type="button">' + t("speech.modelCancel") + '</button>'
        : installed
          ? '<button id="modelRemove" class="button danger" type="button">' + t("speech.modelRemove") + '</button>' +
            '<button id="modelDone" class="button primary" type="button">' + t("common.close") + '</button>'
          : '<button id="modelInstall" class="button primary" type="button">' +
              t(partial ? "speech.modelResume" : "speech.modelDownload") + '</button>') +
    '</div>' +
  '</div>';
}

async function openLocalModelSetup() {
  const info = await loadSpeechModelInfo();
  if (!info?.model) {
    await showNotice({
      title: t("speech.modelFailedTitle"),
      body: t("speech.modelFailedBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  const root = $("modal");
  root.classList.remove("hidden");
  root.innerHTML = localModelSetupHtml(info.model, info.status);

  const close = $("modelClose");
  if (close) close.onclick = () => root.classList.add("hidden");

  const done = $("modelDone");
  if (done) done.onclick = () => root.classList.add("hidden");

  const install = $("modelInstall");
  if (install) {
    install.onclick = async () => {
      root.classList.add("hidden");
      await startLocalModelInstall(info.model);
    };
  }

  const cancel = $("modelCancelDownload");
  if (cancel) cancel.onclick = cancelLocalModelInstall;

  const remove = $("modelRemove");
  if (remove) remove.onclick = async () => {
    root.classList.add("hidden");
    await removeLocalSpeechModel(info.model);
  };
}

async function handleModelInstallError(response) {
  const code = response?.error?.code || "MODEL_DOWNLOAD_FAILED";
  const details = response?.error?.details || {};

  if (code === "MODEL_LOW_DISK_SPACE") {
    await showNotice({
      title: t("speech.modelLowSpaceTitle"),
      body: t("speech.modelLowSpaceBody", {
        free: formatBytes(details.freeBytes || 0),
        needed: formatBytes(details.requiredFreeBytes || 0)
      }),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "MODEL_CHECKSUM_FAILED" || code === "MODEL_DOWNLOAD_SIZE") {
    await showNotice({
      title: t("speech.modelIntegrityTitle"),
      body: t("speech.modelIntegrityBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["MODEL_DOWNLOAD_NETWORK", "MODEL_DOWNLOAD_HTTP", "MODEL_DOWNLOAD_REDIRECT"].includes(code)) {
    await showNotice({
      title: t("speech.modelNetworkTitle"),
      body: t("speech.modelNetworkBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  await showNotice({
    title: t("speech.modelFailedTitle"),
    body: t("speech.modelFailedBody"),
    buttonLabel: t("common.close")
  });
}

async function startLocalModelInstall(model) {
  if (!model || !window.desktopAPI?.installSpeechModel) return;
  if (state.speech.modelDownload) {
    await openLocalModelSetup();
    return;
  }

  const job = {
    id: makeJobId("model"),
    modelId: model.id,
    state: "downloading",
    downloadedBytes: Number(state.speech.modelStatus?.downloadedBytes || 0),
    totalBytes: Number(model.downloadSizeBytes || 0),
    percent: Number(state.speech.modelStatus?.percent || 0)
  };
  state.speech.modelDownload = job;
  render();
  await openLocalModelSetup();

  const response = await window.desktopAPI.installSpeechModel({
    jobId: job.id,
    modelId: job.modelId
  });

  const wasCurrent = state.speech.modelDownload?.id === job.id;
  if (wasCurrent) state.speech.modelDownload = null;

  if (!response?.ok) {
    await loadSpeechModelInfo();
    await refreshSpeechProviderStatus({ rerender: false });
    if (state.page === "ai-video") render();
    await handleModelInstallError(response);
    return;
  }

  if (response.data?.cancelled) {
    await loadSpeechModelInfo();
    await refreshSpeechProviderStatus({ rerender: false });
    if (state.page === "ai-video") render();
    toast(t("speech.modelCancelled"));
    return;
  }

  await loadSpeechModelInfo();
  await refreshSpeechProviderStatus({ rerender: false });
  if (state.page === "ai-video") render();

  const local = state.speech.providerStatus?.local;
  if (local?.code === "LOCAL_RUNTIME_REQUIRED") {
    await showNotice({
      title: t("speech.runtimeTitle"),
      body: t("speech.runtimeBody"),
      buttonLabel: t("common.close")
    });
  } else {
    toast(t("speech.modelReady"));
  }
}

async function removeLocalSpeechModel(model) {
  if (!model || !window.desktopAPI?.removeSpeechModel) return;

  const confirmed = await confirmAction({
    title: t("speech.modelRemoveTitle"),
    body: t("speech.modelRemoveBody"),
    confirmLabel: t("speech.modelRemove"),
    cancelLabel: t("common.cancel"),
    danger: true
  });
  if (!confirmed) return;

  const response = await window.desktopAPI.removeSpeechModel(model.id);

  if (!response?.ok) {
    const code = response?.error?.code || "MODEL_REMOVE_FAILED";
    if (code === "MODEL_IN_USE" || code === "MODEL_BUSY") {
      await showNotice({
        title: t("speech.modelBusyTitle"),
        body: t("speech.modelBusyBody"),
        buttonLabel: t("common.close")
      });
      return;
    }

    await showNotice({
      title: t("speech.modelRemoveFailedTitle"),
      body: t("speech.modelRemoveFailedBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  state.speech.modelStatus = null;
  await loadSpeechModelInfo();
  await refreshSpeechProviderStatus({ rerender: false });
  if (state.page === "ai-video") render();
  toast(t("speech.modelRemoved"));
}

async function cancelLocalModelInstall() {
  const job = state.speech.modelDownload;
  if (!job || !window.desktopAPI?.cancelSpeechModelInstall) return;

  const confirmed = await confirmAction({
    title: t("speech.modelCancelTitle"),
    body: t("speech.modelCancelBody"),
    confirmLabel: t("speech.modelCancel"),
    cancelLabel: t("speech.modelKeepDownloading"),
    danger: true
  });
  if (!confirmed) return;

  const response = await window.desktopAPI.cancelSpeechModelInstall(job.id);
  if (response?.cancelled) {
    const root = $("modal");
    root.classList.add("hidden");
  }
}

function updateSpeechModelProgress(payload) {
  if (!payload?.jobId) return;

  if (!state.speech.modelDownload || state.speech.modelDownload.id !== payload.jobId) {
    state.speech.modelDownload = {
      id: payload.jobId,
      modelId: payload.modelId,
      state: payload.state,
      downloadedBytes: Number(payload.downloadedBytes || 0),
      totalBytes: Number(payload.totalBytes || 0),
      percent: Number(payload.percent || 0)
    };
  } else {
    Object.assign(state.speech.modelDownload, {
      state: payload.state,
      downloadedBytes: Number(payload.downloadedBytes || 0),
      totalBytes: Number(payload.totalBytes || 0),
      percent: Number(payload.percent || 0)
    });
  }

  const label = $("modelProgressLabel");
  const percent = $("modelProgressPercent");
  const bar = $("modelProgressBar");
  if (label) {
    label.textContent = payload.state === "verifying"
      ? t("speech.modelVerifying")
      : t("speech.modelDownloaded", {
          downloaded: formatBytes(payload.downloadedBytes || 0),
          total: formatBytes(payload.totalBytes || 0)
        });
  }
  if (percent) percent.textContent = Math.round(Number(payload.percent || 0)) + "%";
  if (bar) bar.style.width = Math.round(Number(payload.percent || 0)) + "%";

  if (state.page === "ai-video") {
    const badge = document.querySelector(".speech-provider-badge.checking");
    if (badge && state.speech.mode === "local") {
      badge.innerHTML = '<i></i>' + escapeHtml(t("speech.modelDownloading")) + ' ' +
        Math.round(Number(payload.percent || 0)) + '%';
    }
  }
}

async function handleSpeechBlock(response, source) {
  const code = response?.error?.code || "SPEECH_FAILED";

  if (code === "SOURCE_MISSING") {
    if (source) {
      source.fileState = "missing";
      save();
      render();
      showMissingFileDialog(source);
    }
    return;
  }

  if (code === "NO_AUDIO") {
    await showNotice({
      title: t("speech.noAudioTitle"),
      body: t("speech.noAudioBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "DUPLICATE_ACTIVE") {
    toast(t("speech.duplicate"));
    return;
  }

  if (["LOCAL_MODEL_REQUIRED", "LOCAL_MODEL_INCOMPLETE", "LOCAL_MODEL_INVALID", "LOCAL_ENGINE_NOT_CONFIGURED"].includes(code)) {
    await openLocalModelSetup();
    return;
  }

  if (["LOCAL_RUNTIME_REQUIRED", "LOCAL_ADAPTER_NOT_CONFIGURED"].includes(code)) {
    await showNotice({
      title: t("speech.runtimeTitle"),
      body: t("speech.runtimeBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["CLOUD_NOT_CONFIGURED", "CLOUD_CONFIG_INVALID", "CLOUD_HTTPS_REQUIRED", "CLOUD_BACKEND_NOT_CONNECTED"].includes(code)) {
    await showNotice({
      title: t("speech.cloudSetupTitle"),
      body: t("speech.cloudSetupBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_AUTH_REQUIRED") {
    await showNotice({
      title: t("speech.cloudAuthTitle"),
      body: t("speech.cloudAuthBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_SUBSCRIPTION_INACTIVE") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("speech.cloudSubscriptionTitle"),
      body: t("speech.cloudSubscriptionBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_PLAN_REQUIRED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("speech.cloudPlanTitle"),
      body: t("speech.cloudPlanBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_CONCURRENCY_LIMIT") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("speech.cloudConcurrencyTitle"),
      body: t("speech.cloudConcurrencyBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_QUOTA_EXCEEDED") {
    await refreshCloudUiState({ rerender: true });
    await showNotice({
      title: t("speech.cloudQuotaTitle"),
      body: t("speech.cloudQuotaBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (["CLOUD_UPLOAD_FAILED", "CLOUD_NETWORK", "CLOUD_TIMEOUT", "CLOUD_UNAVAILABLE"].includes(code)) {
    await showNotice({
      title: t("speech.cloudConnectionTitle"),
      body: t("speech.cloudConnectionBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "CLOUD_FILE_TOO_LARGE") {
    await showNotice({
      title: t("speech.cloudFileTitle"),
      body: t("speech.cloudFileBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  await showNotice({
    title: t("speech.failedTitle"),
    body: t("speech.failedBody"),
    buttonLabel: t("common.close")
  });
}

async function startSpeechRecognition() {
  if (!window.desktopAPI?.preflightSpeech || !window.desktopAPI?.startSpeech) {
    toast(t("media.desktopOnly"));
    return;
  }

  let source = latestSourceJob();
  if (!source) {
    const added = await addFiles();
    source = added[0];
  }
  if (!source) return;

  const sourceAvailable = await checkJobFile(source);
  if (!sourceAvailable) {
    render();
    showMissingFileDialog(source);
    return;
  }

  const currentJob = speechJobForSource(source);
  if (currentJob && ["validating", "preparing", "uploading", "queued", "processing", "cancelling"].includes(currentJob.status)) {
    toast(t("speech.duplicate"));
    return;
  }

  const statuses = state.speech.providerStatus || await refreshSpeechProviderStatus({ rerender: false });
  const selectedStatus = statuses?.[state.speech.mode];

  if (selectedStatus && selectedStatus.ready === false) {
    await handleSpeechBlock({ error: { code: selectedStatus.code } }, source);
    return;
  }

  let consent = false;
  if (state.speech.mode === "cloud") {
    const minutes = Math.max(1, Math.ceil(Number(source?.meta?.duration || 0) / 60));
    consent = await confirmAction({
      title: t("speech.consentTitle"),
      body: t("speech.consentBody") + " " + t("speech.estimate", { minutes }),
      confirmLabel: t("speech.consentConfirm"),
      cancelLabel: t("common.cancel")
    });
    if (!consent) return;
  }

  const preflight = await window.desktopAPI.preflightSpeech({
    inputPath: source.sourcePath,
    mode: state.speech.mode,
    language: state.speech.language,
    consent
  });

  if (!preflight?.ok) {
    await handleSpeechBlock(preflight, source);
    return;
  }

  const canReuseCloudJob = currentJob &&
    currentJob.mode === "cloud" &&
    currentJob.sourcePath === source.sourcePath &&
    (
      currentJob.status === "interrupted" ||
      currentJob.retrySameId === true
    );

  const speechJob = {
    id: canReuseCloudJob ? currentJob.id : makeJobId("speech"),
    sourcePath: source.sourcePath,
    sourceName: source.name,
    mode: state.speech.mode,
    language: state.speech.language,
    status: "preparing",
    progress: 0,
    cloudJobId: canReuseCloudJob ? (currentJob.cloudJobId || null) : null,
    retrySameId: false,
    startedAt: Date.now()
  };

  state.speech.job = speechJob;
  state.speech.result = null;

  if (state.translation.job?.sourcePath === source.sourcePath) {
    state.translation.job = null;
  }
  if (state.translation.result?.sourcePath === source.sourcePath) {
    state.translation.result = null;
  }
  if (state.voice.job?.sourcePath === source.sourcePath) {
    state.voice.job = null;
  }
  if (state.voice.result?.sourcePath === source.sourcePath) {
    state.voice.result = null;
  }

  save();
  render();
  toast(t("speech.started"));

  const response = await window.desktopAPI.startSpeech({
    jobId: speechJob.id,
    inputPath: source.sourcePath,
    mode: speechJob.mode,
    language: speechJob.language,
    consent
  });

  if (!response?.ok) {
    speechJob.status = "failed";
    speechJob.failureCode = response?.error?.code || "SPEECH_FAILED";
    speechJob.retrySameId = speechJob.mode === "cloud" && [
      "CLOUD_NETWORK",
      "CLOUD_TIMEOUT",
      "CLOUD_UPLOAD_FAILED",
      "CLOUD_UNAVAILABLE",
      "CLOUD_REQUEST_FAILED"
    ].includes(speechJob.failureCode);
    save();
    render();
    await handleSpeechBlock(response, source);
    return;
  }

  if (response.data?.cancelled || speechJob.status === "cancelling") {
    speechJob.status = "cancelled";
    save();
    render();
    toast(t("speech.stopped"));
    return;
  }

  const result = response.data?.result || null;
  speechJob.status = "completed";
  speechJob.progress = 100;
  speechJob.completedAt = Date.now();
  state.speech.result = result
    ? {
        ...result,
        sourcePath: source.sourcePath,
        sourceName: source.name
      }
    : null;

  if (speechJob.mode === "cloud") {
    await refreshCloudUiState({ rerender: false });
  }
  save();
  render();
  toast(t("speech.transcriptReady"));
}

async function cancelSpeechRecognition() {
  const job = state.speech.job;
  if (!job || !["validating", "preparing", "uploading", "queued", "processing"].includes(job.status)) return;

  const confirmed = await confirmAction({
    title: t("speech.stopTitle"),
    body: t("speech.stopBody"),
    confirmLabel: t("speech.stop"),
    cancelLabel: t("speech.keepGoing"),
    danger: true
  });
  if (!confirmed) return;

  job.status = "cancelling";
  save();
  render();

  const response = await window.desktopAPI?.cancelSpeech?.(job.id);
  if (!response?.cancelled) {
    job.status = "processing";
    save();
    render();
    toast(t("speech.stopFailed"));
    return;
  }

  toast(t("speech.stopping"));
}

function updateSpeechProgress(payload) {
  const job = state.speech.job;
  if (!job || job.id !== payload?.jobId || ["cancelling", "cancelled"].includes(job.status)) return;

  const allowedStates = new Set(["validating", "preparing", "uploading", "queued", "processing"]);
  if (allowedStates.has(payload.state)) job.status = payload.state;
  if (payload.serverJobId) job.cloudJobId = String(payload.serverJobId);

  job.indeterminate = payload.indeterminate === true;
  if (!job.indeterminate && Number.isFinite(Number(payload.percent))) {
    job.progress = Math.max(0, Math.min(99, Number(payload.percent)));
  }

  const label = $("speechStateLabel");
  const percent = $("speechPercent");
  const bar = $("speechProgressBar");
  const track = $("speechProgressTrack");
  if (label) label.textContent = speechStatusCopy(job);
  if (percent) percent.textContent = job.indeterminate ? "•••" : Math.round(job.progress || 0) + "%";
  if (track) track.classList.toggle("indeterminate", job.indeterminate);
  if (bar) bar.style.width = (job.indeterminate ? 36 : Math.round(job.progress || 0)) + "%";
  save();
}

async function handleExportBlock(response, source) {
  const code = response?.error?.code || "PROCESSING_FAILED";
  const details = response?.error?.details || {};

  if (code === "SOURCE_MISSING") {
    source.fileState = "missing";
    save();
    render();
    showMissingFileDialog(source);
    return;
  }

  if (code === "DUPLICATE_ACTIVE") {
    toast(t("export.duplicate"));
    return;
  }

  if (code === "LOW_DISK_SPACE") {
    await showNotice({
      title: t("export.lowSpaceTitle"),
      body: t("export.lowSpaceBody", {
        free: formatBytes(details.freeBytes || 0),
        needed: formatBytes(details.requiredFreeBytes || 0)
      }),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "OUTPUT_UNAVAILABLE" || code === "OUTPUT_REQUIRED") {
    await showNotice({
      title: t("export.folderTitle"),
      body: t("export.folderBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  if (code === "SOURCE_UNSUPPORTED" || code === "SOURCE_INVALID") {
    await showNotice({
      title: t("export.sourceTitle"),
      body: t("export.sourceBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  await showNotice({
    title: t("export.failedTitle"),
    body: t("export.failedBody"),
    buttonLabel: t("common.close")
  });
}

async function cancelExportJob(job) {
  if (!job || !job.isRenderOutput || normalizeStatus(job.status) !== "processing") return;

  const confirmed = await confirmAction({
    title: t("export.stopTitle"),
    body: t("export.stopBody", { name: job.name }),
    confirmLabel: t("export.stop"),
    cancelLabel: t("export.keepGoing"),
    danger: true
  });
  if (!confirmed) return;

  job.status = "cancelling";
  job.time = t("common.now");
  save();
  render();

  const result = await window.desktopAPI?.cancelRender?.(job.id);
  if (!result?.cancelled) {
    job.status = "processing";
    save();
    render();
    toast(t("export.stopFailed"));
    return;
  }

  toast(t("export.stopping"));
}

async function startRealRender() {
  if (!window.desktopAPI?.renderVideo || !window.desktopAPI?.preflightExport) {
    toast(t("media.desktopOnly"));
    return;
  }

  let source = latestSourceJob();
  if (!source) {
    const added = await addFiles();
    source = added[0];
  }
  if (!source) return;

  const sourceAvailable = await checkJobFile(source);
  if (!sourceAvailable) {
    render();
    showMissingFileDialog(source);
    return;
  }

  const frontendDuplicate = state.jobs.some(job =>
    job.isRenderOutput &&
    job.sourcePath === source.sourcePath &&
    ["processing", "cancelling"].includes(normalizeStatus(job.status))
  );
  if (frontendDuplicate) {
    toast(t("export.duplicate"));
    return;
  }

  if (!state.output) {
    state.output = await window.desktopAPI.selectOutputFolder();
    if (!state.output) {
      toast(t("media.chooseOutput"));
      return;
    }
  }

  const preflight = await window.desktopAPI.preflightExport({
    inputPath: source.sourcePath,
    outputDir: state.output
  });

  if (!preflight?.ok) {
    await handleExportBlock(preflight, source);
    return;
  }

  const renderJob = {
    id: makeJobId("render"),
    name: source.name.replace(/\.[^.]+$/, "") + "_exported.mp4",
    lang: source.lang || "vi",
    status: "processing",
    fileState: "available",
    progress: 0,
    time: t("common.now"),
    sourcePath: source.sourcePath,
    isRenderOutput: true,
    meta: source.meta || null,
    thumbnail: source.thumbnail || ""
  };

  state.jobs.unshift(renderJob);
  save();
  render();
  toast(t("media.exportStarted"));

  const response = await window.desktopAPI.renderVideo({
    jobId: renderJob.id,
    inputPath: source.sourcePath,
    outputDir: state.output
  });

  if (!response?.ok) {
    renderJob.status = "failed";
    renderJob.failureCode = response?.error?.code || "PROCESSING_FAILED";
    renderJob.time = t("common.now");

    const sourceStillAvailable = await checkJobFile(source);
    if (!sourceStillAvailable) {
      source.fileState = "missing";
      save();
      render();
      toast(t("media.sourceMissingDuringExport"));
      showMissingFileDialog(source);
      return;
    }

    save();
    render();
    await handleExportBlock(response, source);
    return;
  }

  const result = response.data || {};

  if (result.cancelled || normalizeStatus(renderJob.status) === "cancelling") {
    renderJob.status = "cancelled";
    renderJob.progress = Math.min(99, Number(renderJob.progress || 0));
    renderJob.outputPath = "";
    renderJob.fileState = "unknown";
    renderJob.time = t("common.now");
    save();
    render();
    toast(t("export.stopped"));
    return;
  }

  renderJob.status = "completed";
  renderJob.progress = 100;
  renderJob.outputPath = result.outputPath;
  renderJob.outputSizeBytes = result.sizeBytes || 0;
  renderJob.fileState = "available";
  renderJob.time = t("common.now");
  save();
  render();
  toast(t("media.exportDone"));
}


function setLocale(locale) {
  if (!I18N.supported.includes(locale) || locale === state.locale) return;
  state.locale = locale;
  render();
}

function toggleLocale() {
  setLocale(state.locale === "vi" ? "en" : "vi");
}

function openCloudDeveloperSettings() {
  state.page = "settings";
  render();
  setTimeout(() => {
    document.getElementById("developerCloudSettings")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 40);
}

async function saveDeveloperCloudConfig() {
  const environment = $("cloudEnvironment")?.value || "development";
  const backendUrl = $("cloudBackendUrl")?.value?.trim() || "";
  state.cloud.draftEnvironment = environment;
  state.cloud.draftBackendUrl = backendUrl;
  if (!window.desktopAPI?.saveCloudConfig) return;

  const response = await window.desktopAPI.saveCloudConfig({ environment, backendUrl });
  if (!response?.ok) {
    const code = response?.code || "CLOUD_CONFIG_INVALID";
    await showNotice({
      title: t("settings.cloudSaveFailedTitle"),
      body: code === "CLOUD_HTTPS_REQUIRED"
        ? t("settings.cloudHttpsBody")
        : code === "CLOUD_CONFIG_ENV_LOCKED"
          ? t("settings.cloudEnvLocked")
          : t("settings.cloudSaveFailedBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  state.cloud.config = response.data;
  state.cloud.test = null;
  state.cloud.draftEnvironment = null;
  state.cloud.draftBackendUrl = null;
  if (response.sessionCleared) {
    state.cloud.auth = null;
    state.cloud.account = null;
    state.cloud.accountOffline = false;
    state.cloud.accountVerifiedAt = null;
    state.billing.catalog = null;
    state.billing.invoices = null;
    state.billing.loadedAt = 0;
    state.billing.errorCode = null;
    toast(t("settings.cloudSavedSignedOut"));
  } else {
    toast(t("settings.cloudSaved"));
  }
  state.speech.providerStatus = null;
  render();
}

async function testDeveloperCloudConnection() {
  if (!window.desktopAPI?.testCloudConnection) return;
  const button = $("testCloudConnection");
  if (button) {
    button.disabled = true;
    button.textContent = t("settings.testingConnection");
  }

  const backendUrl = $("cloudBackendUrl")?.value?.trim() || state.cloud.config?.backendUrl || "";
  state.cloud.draftBackendUrl = backendUrl;
  state.cloud.draftEnvironment = $("cloudEnvironment")?.value || state.cloud.config?.environment || "development";
  const response = await window.desktopAPI.testCloudConnection(backendUrl);
  state.cloud.test = response || { ok: false, code: "CLOUD_NETWORK" };

  if (response?.ok) {
    toast(response.authenticated === false
      ? t("settings.cloudReachableLogin")
      : t("settings.cloudConnected"));
  } else {
    toast(t("settings.cloudTestFailed"));
  }

  if (state.page === "settings") render();
}

function authErrorCopy(code) {
  const map = {
    AUTH_INVALID_CREDENTIALS: ["account.invalidTitle", "account.invalidBody"],
    AUTH_EMAIL_INVALID: ["account.emailInvalidTitle", "account.emailInvalidBody"],
    AUTH_PASSWORD_INVALID: ["account.passwordInvalidTitle", "account.passwordInvalidBody"],
    AUTH_RATE_LIMITED: ["account.rateTitle", "account.rateBody"],
    AUTH_TIMEOUT: ["account.networkTitle", "account.networkBody"],
    AUTH_NETWORK: ["account.networkTitle", "account.networkBody"],
    AUTH_SERVICE_UNAVAILABLE: ["account.serviceTitle", "account.serviceBody"],
    SECURE_STORAGE_UNAVAILABLE: ["account.storageTitle", "account.storageBody"],
    CLOUD_NOT_CONFIGURED: ["account.cloudMissingTitle", "account.cloudMissingBody"]
  };
  return map[code] || ["account.failedTitle", "account.failedBody"];
}

function openLoginModal() {
  if (!state.cloud.config?.backendUrl) {
    showNotice({
      title: t("account.cloudMissingTitle"),
      body: t("account.cloudMissingBody"),
      buttonLabel: t("common.close")
    });
    return;
  }

  const root = $("modal");
  root.classList.remove("hidden");
  root.innerHTML =
    '<div class="modal commercial-modal auth-modal">' +
      '<div class="modal-icon info">◎</div>' +
      '<h3>' + escapeHtml(t("account.signInTitle")) + '</h3>' +
      '<p>' + escapeHtml(t("account.signInBody")) + '</p>' +
      '<form id="loginForm" class="auth-form">' +
        '<label class="label" for="loginEmail">' + t("account.email") + '</label>' +
        '<input id="loginEmail" class="input" type="email" autocomplete="username" spellcheck="false" required>' +
        '<label class="label" for="loginPassword">' + t("account.password") + '</label>' +
        '<input id="loginPassword" class="input" type="password" autocomplete="current-password" minlength="6" required>' +
        '<div id="loginInlineError" class="auth-inline-error hidden" role="alert"></div>' +
        '<div class="modal-actions">' +
          '<button id="loginCancel" class="button ghost" type="button">' + t("common.cancel") + '</button>' +
          '<button id="loginSubmit" class="button primary" type="submit">' + t("account.signIn") + '</button>' +
        '</div>' +
      '</form>' +
    '</div>';

  $("loginCancel").onclick = () => root.classList.add("hidden");
  $("loginForm").onsubmit = async event => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const submit = $("loginSubmit");
    const inline = $("loginInlineError");

    submit.disabled = true;
    submit.textContent = t("account.signingIn");
    inline.classList.add("hidden");
    inline.textContent = "";

    const response = await window.desktopAPI?.login?.({ email, password });

    // Password must not remain in renderer memory/UI after the request finishes.
    $("loginPassword").value = "";

    if (!response?.ok) {
      const [titleKey, bodyKey] = authErrorCopy(response?.error?.code);
      inline.textContent = t(bodyKey);
      inline.classList.remove("hidden");
      submit.disabled = false;
      submit.textContent = t("account.signIn");

      if (response?.error?.code === "CLOUD_NOT_CONFIGURED") {
        root.classList.add("hidden");
        await showNotice({
          title: t(titleKey),
          body: t(bodyKey),
          buttonLabel: t("common.close")
        });
      }
      return;
    }

    root.classList.add("hidden");
    state.cloud.auth = response.data?.status || null;
    state.cloud.account = response.data?.account || null;
    state.cloud.accountOffline = response.data?.offline === true;
    state.cloud.accountVerifiedAt = response.data?.verifiedAt || null;
    state.cloud.statusCheckedAt = Date.now();
    state.billing.catalog = null;
    state.billing.invoices = null;
    state.billing.loadedAt = 0;
    state.billing.errorCode = null;
    state.speech.providerStatus = null;
    state.speech.statusCheckedAt = 0;
    await refreshSpeechProviderStatus({ rerender: false });
    toast(t("account.signedIn"));
    render();
  };

  setTimeout(() => $("loginEmail")?.focus(), 20);
}

async function logoutAccount() {
  const confirmed = await confirmAction({
    title: t("account.signOutTitle"),
    body: t("account.signOutBody"),
    confirmLabel: t("account.signOut"),
    cancelLabel: t("common.cancel")
  });
  if (!confirmed) return;

  const response = await window.desktopAPI?.logout?.();
  state.cloud.auth = null;
  state.cloud.account = null;
  state.cloud.accountOffline = false;
  state.cloud.accountVerifiedAt = null;
  state.cloud.test = null;
  state.billing.catalog = null;
  state.billing.invoices = null;
  state.billing.loadedAt = 0;
  state.billing.errorCode = null;
  state.cloud.statusCheckedAt = 0;
  state.speech.providerStatus = null;
  state.speech.statusCheckedAt = 0;
  toast(response?.remotePending ? t("account.signedOutPending") : t("account.signedOut"));
  render();
}

function bind() {
  document.querySelectorAll("[data-page]").forEach((node) => {
    node.onclick = () => {
      state.page = node.dataset.page;
      render();
    };
  });

  document.querySelectorAll(".switch,.toggle").forEach((node) => {
    node.onclick = () => node.classList.toggle("on");
  });

  document.querySelectorAll(".previewVoice").forEach((node) => {
    node.onclick = () => toast(t("voice.playing"));
  });

  document.querySelectorAll(".account").forEach((node) => {
    node.onclick = () => toast(node.dataset.connected === "1" ? t("accounts.already") : t("accounts.next"));
  });

  const usageLogin = $("usageLogin");
  if (usageLogin) usageLogin.onclick = () => openLoginModal();

  const usageLogout = $("usageLogout");
  if (usageLogout) usageLogout.onclick = () => logoutAccount();

  const usageRefresh = $("usageRefresh");
  if (usageRefresh) usageRefresh.onclick = async () => {
    usageRefresh.disabled = true;
    await refreshCloudUiState({ rerender: true });
  };

  const billingLogin = $("billingLogin");
  if (billingLogin) billingLogin.onclick = () => openLoginModal();

  const billingRetry = $("billingRetry");
  if (billingRetry) billingRetry.onclick = () => loadBillingData({ rerender: true });

  const billingRefresh = $("billingRefresh");
  if (billingRefresh) billingRefresh.onclick = async () => {
    billingRefresh.disabled = true;
    await refreshCloudUiState({ rerender: false });
    await loadBillingData({ rerender: true });
  };

  document.querySelectorAll(".billing-upgrade").forEach(node => {
    node.onclick = () => startBillingUpgrade(node.dataset.planId);
  });

  document.querySelectorAll(".billing-downgrade").forEach(node => {
    node.onclick = () => scheduleBillingDowngrade(
      node.dataset.planId,
      node.dataset.planName || node.dataset.planId
    );
  });

  const billingCancel = $("billingCancel");
  if (billingCancel) billingCancel.onclick = () => cancelBillingPlan();

  const billingResume = $("billingResume");
  if (billingResume) billingResume.onclick = () => resumeBillingPlan();

  const billingPortal = $("billingPortal");
  if (billingPortal) billingPortal.onclick = () => openBillingPortal();

  document.querySelectorAll(".reveal-output").forEach((node) => {
    node.onclick = (event) => {
      event.stopPropagation();
      const filePath = decodeURIComponent(node.dataset.outputPath || "");
      if (filePath) window.desktopAPI?.showFile(filePath);
    };
  });


  document.querySelectorAll("[data-job-menu]").forEach((node) => {
    node.onclick = (event) => {
      event.stopPropagation();
      const id = node.dataset.jobMenu;
      document.querySelectorAll(".job-menu-popover").forEach(popover => {
        const same = popover.dataset.jobMenuPopover === id;
        popover.classList.toggle("hidden", !same || !popover.classList.contains("hidden"));
      });
    };
  });

  document.querySelectorAll("[data-job-action]").forEach((node) => {
    node.onclick = async (event) => {
      event.stopPropagation();
      document.querySelectorAll(".job-menu-popover").forEach(popover => popover.classList.add("hidden"));
      await handleJobAction(node.dataset.jobAction, node.dataset.jobId);
    };
  });

  const dropzone = $("dropzone");
  if (dropzone) {
    dropzone.onclick = addFiles;
    dropzone.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") addFiles();
    };
  }

  const analyze = $("analyze");
  if (analyze) {
    analyze.onclick = () => toast($("url").value.trim() ? t("download.urlAnalyzed") : t("download.urlMissing"));
  }

  const speechMode = $("speechMode");
  if (speechMode) {
    speechMode.onchange = () => {
      state.speech.mode = speechMode.value === "cloud" ? "cloud" : "local";
      save();
      render();
    };
  }

  const speechLanguage = $("speechLanguage");
  if (speechLanguage) {
    speechLanguage.onchange = () => {
      state.speech.language = speechLanguage.value || "auto";
      save();
    };
  }

  const manageLocalAi = $("manageLocalAi");
  if (manageLocalAi) manageLocalAi.onclick = openLocalModelSetup;

  const manageLocalAiPanel = $("manageLocalAiPanel");
  if (manageLocalAiPanel) manageLocalAiPanel.onclick = openLocalModelSetup;

  const openCloudSettings = $("openCloudSettings");
  if (openCloudSettings) openCloudSettings.onclick = openCloudDeveloperSettings;

  const cloudAccountAction = $("cloudAccountAction");
  if (cloudAccountAction) cloudAccountAction.onclick = openLoginModal;

  const cloudLogoutAction = $("cloudLogoutAction");
  if (cloudLogoutAction) cloudLogoutAction.onclick = logoutAccount;

  const settingsLogin = $("settingsLogin");
  if (settingsLogin) settingsLogin.onclick = openLoginModal;

  const settingsLogout = $("settingsLogout");
  if (settingsLogout) settingsLogout.onclick = logoutAccount;

  const speechStart = $("speechStart");
  if (speechStart) speechStart.onclick = startSpeechRecognition;

  const speechStop = $("speechStop");
  if (speechStop) speechStop.onclick = cancelSpeechRecognition;

  const translationMode = $("translationMode");
  if (translationMode) {
    translationMode.onchange = () => {
      state.translation.mode = translationMode.value === "local" ? "local" : "cloud";
      save();
      render();
    };
  }

  const translationTarget = $("translationTarget");
  if (translationTarget) {
    translationTarget.onchange = () => {
      state.translation.targetLanguage = translationTarget.value || "en";
      state.voice.job = null;
      state.voice.result = null;
      save();
      render();
    };
  }

  const translationPreserveTone = $("translationPreserveTone");
  if (translationPreserveTone) {
    translationPreserveTone.onchange = () => {
      state.translation.preserveTone = translationPreserveTone.checked;
      save();
    };
  }

  const translationStart = $("translationStart");
  if (translationStart) translationStart.onclick = startTranslation;

  const translationStop = $("translationStop");
  if (translationStop) translationStop.onclick = cancelTranslation;

  const voiceMode = $("voiceMode");
  if (voiceMode) {
    voiceMode.onchange = () => {
      state.voice.mode = voiceMode.value === "local" ? "local" : "cloud";
      save();
      render();
    };
  }

  document.querySelectorAll(".voice-assignment-select").forEach((node) => {
    node.onchange = () => {
      const speaker = node.dataset.speakerKey || "speaker-1";
      state.voice.assignments[speaker] = node.value;
      state.voice.job = null;
      state.voice.result = null;
      save();
      render();
    };
  });

  document.querySelectorAll("[data-voice-preview-speaker]").forEach((node) => {
    node.onclick = () => previewVoiceSelection(node.dataset.voicePreviewSpeaker || "speaker-1");
  });

  document.querySelectorAll(".voice-audio-play").forEach((node) => {
    node.onclick = () => playVoiceUrl(decodeURIComponent(node.dataset.audioUrl || ""));
  });

  const voiceStart = $("voiceStart");
  if (voiceStart) voiceStart.onclick = startVoiceGeneration;

  const voiceStop = $("voiceStop");
  if (voiceStop) voiceStop.onclick = cancelVoiceGeneration;

  const voiceStudioPreview = $("voiceStudioPreview");
  if (voiceStudioPreview) {
    voiceStudioPreview.onclick = () => previewStudioVoice($("voiceStudioVoice")?.value || "");
  }

  const voiceStudioLanguage = $("voiceStudioLanguage");
  if (voiceStudioLanguage) {
    voiceStudioLanguage.onchange = () => {
      const input = $("voiceStudioText");
      if (input) input.value = voicePreviewSample(voiceStudioLanguage.value);
    };
  }

  document.querySelectorAll(".voice-studio-card-preview").forEach((node) => {
    node.onclick = () => previewStudioVoice(node.dataset.voiceId || "");
  });

  const renderButton = $("render");
  if (renderButton) renderButton.onclick = startRealRender;

  const tts = $("tts");
  if (tts) tts.onclick = () => toast(t("voice.generated"));

  const exportButton = $("export");
  if (exportButton) exportButton.onclick = startRealRender;

  const addChannel = $("addChannel");
  if (addChannel) addChannel.onclick = () => modal(t("monitor.modalTitle"), t("monitor.modalBody"));

  const newFlow = $("newFlow");
  if (newFlow) newFlow.onclick = () => modal(t("automation.modalTitle"), t("automation.modalBody"));

  const search = $("search");
  if (search) {
    search.oninput = () => {
      const q = search.value.toLowerCase();
      $("libraryTable").innerHTML = jobsTable(state.jobs.filter((job) => job.name.toLowerCase().includes(q)));
    };
  }

  const chooseOutput = $("chooseOutput");
  if (chooseOutput) {
    chooseOutput.onclick = async () => {
      const path = await window.desktopAPI?.selectOutputFolder();
      if (path) {
        state.output = path;
        render();
        toast(t("settings.outputSaved"));
      }
    };
  }

  const settingsLocale = $("settingsLocale");
  if (settingsLocale) settingsLocale.onchange = (event) => setLocale(event.target.value);

  const appearanceSelect = $("appearanceSelect");
  if (appearanceSelect) appearanceSelect.onchange = (event) => {
    state.appearance = event.target.value;
    render();
  };

  const motionSelect = $("motionSelect");
  if (motionSelect) motionSelect.onchange = (event) => {
    state.motion = event.target.value;
    render();
  };

  const scaleSelect = $("scaleSelect");
  if (scaleSelect) scaleSelect.onchange = (event) => {
    state.scale = event.target.value;
    render();
  };

  const saveCloudConfig = $("saveCloudConfig");
  if (saveCloudConfig) saveCloudConfig.onclick = saveDeveloperCloudConfig;

  const testCloudConnection = $("testCloudConnection");
  if (testCloudConnection) testCloudConnection.onclick = testDeveloperCloudConnection;

  const cloudBackendUrl = $("cloudBackendUrl");
  if (cloudBackendUrl) cloudBackendUrl.oninput = (event) => {
    state.cloud.draftBackendUrl = event.target.value;
  };

  const cloudEnvironment = $("cloudEnvironment");
  if (cloudEnvironment) cloudEnvironment.onchange = (event) => {
    state.cloud.draftEnvironment = event.target.value;
  };
}

function render() {
  applyChromeLocale();
  navRender();
  const meta = pageMeta[state.page] || pageMeta.dashboard;
  $("pageTitle").textContent = t(meta[0]);
  $("breadcrumb").textContent = t(meta[1]);
  $("page").innerHTML = (pages[state.page] || pages.dashboard)();
  bind();
  save();

  if (["ai-video", "settings", "voice", "usage", "billing"].includes(state.page) && window.desktopAPI?.getCloudConfig) {
    const cloudStale = !state.cloud.config ||
      !state.cloud.statusCheckedAt ||
      Date.now() - state.cloud.statusCheckedAt > 30000;
    if (cloudStale && !state.cloud.loading) {
      setTimeout(() => refreshCloudUiState({ rerender: true }), 0);
    }
  }

  if (state.page === "billing" && window.desktopAPI?.getBillingCatalog) {
    const billingStale = !state.billing.catalog ||
      !state.billing.loadedAt ||
      Date.now() - state.billing.loadedAt > 30000;

    if (billingStale && !state.billing.loading && state.cloud.auth?.authenticated) {
      setTimeout(() => loadBillingData({ rerender: true }), 0);
    }
  }

  if (state.page === "ai-video" && !state.speech.modelCatalog && window.desktopAPI?.getSpeechModelCatalog) {
    setTimeout(async () => {
      await loadSpeechModelInfo();
      if (state.page === "ai-video") render();
    }, 0);
  }

  if (["ai-video", "settings"].includes(state.page) && window.desktopAPI?.getTranslationStatus) {
    const translationStale = !state.translation.cloudStatus ||
      !state.translation.statusCheckedAt ||
      Date.now() - state.translation.statusCheckedAt > 30000;

    if (translationStale && !state.translation.statusCheckPending) {
      setTimeout(() => refreshTranslationStatus({ rerender: true }), 0);
    }
  }

  if (["ai-video", "settings", "voice"].includes(state.page) && window.desktopAPI?.getVoiceStatus) {
    const voiceStale = !state.voice.cloudStatus ||
      !state.voice.statusCheckedAt ||
      Date.now() - state.voice.statusCheckedAt > 30000;

    if (voiceStale && !state.voice.statusCheckPending) {
      setTimeout(() => refreshVoiceStatus({ rerender: true }), 0);
    }
  }

  if (["ai-video", "settings"].includes(state.page) && window.desktopAPI?.getSpeechProviderStatus) {
    const stale = !state.speech.providerStatus ||
      !state.speech.statusCheckedAt ||
      Date.now() - state.speech.statusCheckedAt > 30000;

    if (stale && !state.speech.statusCheckPending) {
      state.speech.statusCheckPending = true;
      setTimeout(async () => {
        await refreshSpeechProviderStatus({ rerender: false });
        state.speech.statusCheckedAt = Date.now();
        state.speech.statusCheckPending = false;
        if (["ai-video", "settings"].includes(state.page)) render();
      }, 0);
    }
  }
}

$("quickProject").onclick = () => {
  state.page = "ai-video";
  render();
};

const langMenuButton = $("langMenuButton");
const langMenu = $("langMenu");

function closeLanguageMenu() {
  if (!langMenu || !langMenuButton) return;
  langMenu.classList.add("hidden");
  langMenuButton.setAttribute("aria-expanded", "false");
}

if (langMenuButton && langMenu) {
  langMenuButton.onclick = (event) => {
    event.stopPropagation();
    const willOpen = langMenu.classList.contains("hidden");
    langMenu.classList.toggle("hidden", !willOpen);
    langMenuButton.setAttribute("aria-expanded", willOpen ? "true" : "false");
  };

  langMenu.querySelectorAll("[data-locale]").forEach((node) => {
    node.onclick = (event) => {
      event.stopPropagation();
      setLocale(node.dataset.locale);
      closeLanguageMenu();
    };
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".language-control")) closeLanguageMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLanguageMenu();
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".job-menu")) {
    document.querySelectorAll(".job-menu-popover").forEach(popover => popover.classList.add("hidden"));
  }
});

if (window.desktopAPI) {
  $("winMin").onclick = () => window.desktopAPI.minimize();
  $("winMax").onclick = () => window.desktopAPI.toggleMaximize();
  $("winClose").onclick = () => window.desktopAPI.close();

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("dragging");
  });

  document.addEventListener("dragleave", () => {
    document.body.classList.remove("dragging");
  });

  document.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    const files = [...(event.dataTransfer?.files || [])].filter((file) => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name));
    if (!files.length) return;
    const jobs = files.map((file) => ({
      id: makeJobId("source"),
      name: file.name,
      lang: "",
      status: "queued",
      progress: 0,
      time: t("common.now"),
      sourcePath: file.path,
      fileState: "available",
      mediaState: "reading"
    }));
    jobs.slice().reverse().forEach(job => state.jobs.unshift(job));
    render();
    toast(t("download.dropped", { count: files.length }));
    jobs.forEach(enrichJob);
  });
  if (window.desktopAPI.onRenderProgress) {
    window.desktopAPI.onRenderProgress((payload) => {
      const job = state.jobs.find(item => item.id === payload?.jobId);
      if (!job || ["cancelling", "cancelled"].includes(normalizeStatus(job.status))) return;
      job.progress = Math.max(0, Math.min(100, Number(payload.percent || 0)));
      job.renderSpeed = payload.speed || "";
      job.status = job.progress >= 100 ? "completed" : "processing";
      updateProgressElements(job);
      save();
    });
  }
  if (window.desktopAPI.onSpeechProgress) {
    window.desktopAPI.onSpeechProgress(updateSpeechProgress);
  }
  if (window.desktopAPI.onTranslationProgress) {
    window.desktopAPI.onTranslationProgress(updateTranslationProgress);
  }
  if (window.desktopAPI.onVoiceProgress) {
    window.desktopAPI.onVoiceProgress(updateVoiceProgress);
  }
  if (window.desktopAPI.onSpeechModelProgress) {
    window.desktopAPI.onSpeechModelProgress(updateSpeechModelProgress);
  }
}

render();

if (window.desktopAPI?.createThumbnail) {
  setTimeout(() => {
    refreshFileStates({ notify: true });
    state.jobs
      .filter(job => job.sourcePath && !job.isRenderOutput && !job.thumbnail && job.fileState !== "missing")
      .slice(0, 6)
      .forEach(enrichJob);
  }, 250);
}
