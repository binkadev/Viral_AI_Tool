const $ = (id) => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");

const state = {
  locale: I18N.supported.includes(saved.locale) ? saved.locale : "vi",
  page: saved.page || "dashboard",
  output: saved.output || "",
  jobs: saved.jobs || [
    { name: "Douyin_Product_042.mp4", lang: "vi", status: "processing", progress: 73, time: "2 min ago" },
    { name: "UGC_Beauty_118.mp4", lang: "ko", status: "completed", progress: 100, time: "18 min ago" },
    { name: "Review_Camera_090.mp4", lang: "en", status: "completed", progress: 100, time: "41 min ago" },
    { name: "Short_Fashion_031.mp4", lang: "", status: "queued", progress: 0, time: "1 hr ago" }
  ]
};

function t(key, vars) {
  return I18N.t(state.locale, key, vars);
}

function save() {
  localStorage.setItem("viral-ai-tool-state", JSON.stringify({
    locale: state.locale,
    page: state.page,
    output: state.output,
    jobs: state.jobs.slice(0, 50)
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
  if (v.includes("complete") || v.includes("hoàn")) return "completed";
  if (v.includes("process") || v.includes("xử lý")) return "processing";
  if (v.includes("queue") || v.includes("chờ")) return "queued";
  if (v.includes("fail") || v.includes("lỗi") || v.includes("thất")) return "failed";
  return v || "queued";
}

function statusBadge(value) {
  const code = normalizeStatus(value);
  const cls = code === "completed" ? "success" : code === "processing" ? "processing" : code === "queued" ? "warn" : "error";
  return '<span class="badge ' + cls + '">' + t("common." + code) + "</span>";
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
  document.body.dataset.locale = state.locale;
  $("desktopPill").textContent = t("app.desktop");
  $("workspaceLabel").textContent = t("app.workspace");
  $("creditsLabel").textContent = t("app.monthlyCredits");
  $("remainingLabel").textContent = t("app.remaining");
  $("newProjectLabel").textContent = t("app.newProject");
  $("langCode").textContent = state.locale.toUpperCase();
  $("langToggle").setAttribute("aria-label", state.locale === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt");
  document.body.dataset.dropLabel = t("download.dropOverlay");
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
    "</tr></thead><tbody>" +
    data.map((job) => '<tr>' +
      '<td><div class="video-cell"><div class="thumb">▶</div><div>' + job.name + "</div></div></td>" +
      "<td>" + languageName(job.lang) + "</td>" +
      "<td>" + statusBadge(job.status) + "</td>" +
      "<td>" + Number(job.progress || 0) + "%</td>" +
      "<td>" + (job.time || t("common.now")) + "</td>" +
      "</tr>").join("") +
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
  return '<div class="hero"><div class="hero-copy">' +
    '<div class="eyebrow">' + t("dashboard.eyebrow") + "</div>" +
    "<h2>" + t("dashboard.title") + "</h2>" +
    "<p>" + t("dashboard.desc") + "</p>" +
    '<div class="hero-actions">' +
    '<button class="button primary" data-page="ai-video" type="button">✦ ' + t("dashboard.createAi") + "</button>" +
    '<button class="button ghost" data-page="download" type="button">⇩ ' + t("dashboard.importVideo") + "</button>" +
    "</div></div></div>" +
    '<div class="stat-grid">' + stats.map((x) =>
      '<div class="stat-card"><div class="stat-label">' + x[0] + '</div><div class="stat-value">' + x[1] +
      '</div><div class="stat-foot ' + x[3] + '">' + x[2] + "</div></div>"
    ).join("") + "</div>" +
    '<div class="section-head"><div><h3>' + t("dashboard.quickTools") + "</h3><p>" + t("dashboard.quickToolsDesc") + "</p></div></div>" +
    '<div class="tool-grid">' + tools.map((x) =>
      '<div class="tool-card" data-page="' + x[3] + '"><div class="tool-icon">' + x[0] +
      "</div><h4>" + x[1] + "</h4><p>" + x[2] + "</p></div>"
    ).join("") + "</div>" +
    '<div class="section-head"><div><h3>' + t("dashboard.recentJobs") + "</h3><p>" + t("dashboard.recentJobsDesc") + "</p></div></div>" +
    jobsTable();
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

function aiVideoPage() {
  const steps = [
    ["1", t("aiVideo.steps.import"), t("aiVideo.steps.ready")],
    ["2", t("aiVideo.steps.speech"), t("aiVideo.steps.detected")],
    ["3", t("aiVideo.steps.translate"), languageName("vi")],
    ["4", t("aiVideo.steps.voices"), t("aiVideo.steps.speakers")],
    ["5", t("aiVideo.steps.subtitles"), t("aiVideo.steps.styled")],
    ["6", t("aiVideo.steps.render"), t("aiVideo.steps.pending")]
  ];
  return '<div class="section-head"><div><h3>' + t("aiVideo.workflow") + "</h3><p>" + t("aiVideo.workflowDesc") +
    '</p></div><button id="render" class="button primary" type="button">' + t("aiVideo.renderFinal") + "</button></div>" +
    '<div class="workflow">' + steps.map((x, i) =>
      '<div class="wf-step ' + (i === 3 ? "active" : "") + '"><b>' + x[0] + ". " + x[1] + "</b><span>" + x[2] + "</span></div>" +
      (i < steps.length - 1 ? '<div class="wf-arrow">→</div>' : "")
    ).join("") + "</div>" +
    '<div class="section-head"><div><h3>' + t("aiVideo.editor") + "</h3><p>Product_review_042</p></div></div>" +
    '<div class="editor-grid"><div class="preview"><div class="preview-center"><div class="preview-play">▶</div>' +
    '<div class="preview-label">00:24 / 01:18 · ' + t("aiVideo.preview") + "</div></div></div>" +
    '<div class="stack"><div class="mini-card"><h4>' + t("aiVideo.translation") + "</h4>" +
    '<label class="label">' + t("common.targetLanguage") + '</label><select class="select"><option>' + languageName("vi") +
    "</option><option>English</option><option>" + languageName("ko") + "</option><option>" + languageName("ja") + "</option></select>" +
    '<div class="toggle-row"><span>' + t("aiVideo.preserveTone") + '</span><div class="toggle on"></div></div>' +
    '<div class="toggle-row"><span>' + t("aiVideo.translateText") + '</span><div class="toggle on"></div></div></div>' +
    '<div class="mini-card"><h4>' + t("aiVideo.outputFormat") + '</h4><select class="select"><option>9:16 · 1080×1920</option><option>16:9 · 1920×1080</option><option>1:1 · 1080×1080</option></select>' +
    '<div class="toggle-row"><span>' + t("aiVideo.burnSubtitles") + '</span><div class="toggle on"></div></div></div></div></div>';
}

function voicePage() {
  function wave() {
    return Array.from({ length: 22 }, (_, i) => '<i style="height:' + (7 + (i * 11) % 17) + 'px"></i>').join("");
  }
  const voices = [
    ["Minh", state.locale === "vi" ? "Tiếng Việt · Nam" : "Vietnamese · Male", "M"],
    ["Vy", state.locale === "vi" ? "Tiếng Việt · Nữ" : "Vietnamese · Female", "V"],
    ["Jisoo", state.locale === "vi" ? "Tiếng Hàn · Nữ" : "Korean · Female", "J"],
    ["Haruto", state.locale === "vi" ? "Tiếng Nhật · Nam" : "Japanese · Male", "H"],
    ["Ava", "English · Female", "A"],
    ["Noah", "English · Male", "N"]
  ];
  return '<div class="grid-2"><div class="card card-pad"><div class="eyebrow">' + t("voice.ttsEyebrow") + "</div><h3>" + t("voice.ttsTitle") +
    '</h3><textarea class="textarea" rows="6">' + t("voice.sampleText") + '</textarea><div class="row" style="margin-top:8px">' +
    '<select class="select"><option>Minh · ' + languageName("vi") + '</option><option>Vy · ' + languageName("vi") + '</option><option>Ava · English</option></select>' +
    '<button id="tts" class="button primary" type="button">' + t("voice.generate") + "</button></div></div>" +
    '<div class="card card-pad"><div class="eyebrow">' + t("voice.cloneEyebrow") + "</div><h3>" + t("voice.cloneTitle") + "</h3><p class=\"muted\">" +
    t("voice.cloneDesc") + '</p><div class="dropzone"><div class="dropzone-icon">◖</div><strong>' + t("voice.upload") + "</strong><p>" + t("voice.uploadDesc") +
    "</p></div></div></div>" +
    '<div class="section-head"><div><h3>' + t("voice.library") + "</h3></div></div>" +
    '<div class="voice-grid">' + voices.map((x) =>
      '<div class="voice-card"><div class="voice-top"><div class="voice-avatar">' + x[2] + '</div><div class="voice-meta"><b>' + x[0] +
      "</b><span>" + x[1] + '</span></div></div><div class="wave">' + wave() + '</div><button class="button ghost small previewVoice" type="button">▶ ' +
      t("common.preview") + "</button></div>"
    ).join("") + "</div>";
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

function usagePage() {
  const usage = [
    [t("usage.dubbing"), "620"],
    [t("usage.renderMinutes"), "410"],
    [t("usage.downloads"), "286"],
    [t("usage.runs"), "204"]
  ];
  return '<div class="grid-2"><div class="card card-pad"><div class="eyebrow">' + t("usage.currentPlan") + "</div><h3>Creator Pro</h3><p class=\"muted\">" +
    t("usage.creditsRemaining") + '</p><button class="button primary" type="button">' + t("usage.upgrade") + "</button></div>" +
    '<div class="card card-pad"><div class="eyebrow">' + t("usage.monthlyUsage") + '</div><div class="stat-value">1,520 / 4,000</div><div class="bar"><i style="width:38%"></i></div></div></div>' +
    '<div class="section-head"><div><h3>' + t("usage.breakdown") + "</h3></div></div>" +
    '<div class="usage-grid">' + usage.map((x) => '<div class="stat-card"><div class="stat-label">' + x[0] + '</div><div class="stat-value">' + x[1] + "</div></div>").join("") + "</div>";
}

function settingsPage() {
  const settings = [
    [t("settings.autosave"), t("settings.autosaveDesc"), true],
    [t("settings.gpu"), t("settings.gpuDesc"), true],
    [t("settings.email"), t("settings.emailDesc"), false],
    [t("settings.compact"), t("settings.compactDesc"), false]
  ];
  return '<div class="grid-2"><div class="card card-pad"><div class="eyebrow">' + t("settings.general") + "</div>" +
    settings.map((x) => '<div class="setting-row"><div class="setting-copy"><b>' + x[0] + "</b><span>" + x[1] +
      '</span></div><div class="switch ' + (x[2] ? "on" : "") + '"></div></div>').join("") +
    '</div><div class="card card-pad"><div class="eyebrow">' + t("settings.output") + '</div><label class="label">' + t("common.outputFolder") +
    '</label><div class="row"><input id="outputPath" class="input" readonly value="' + (state.output || t("settings.notSelected")) +
    '"><button id="chooseOutput" class="button ghost" type="button">' + t("common.choose") + "</button></div>" +
    '<div style="margin-top:14px"><label class="label">' + t("common.resolution") + '</label><select class="select"><option>1080p</option><option>4K</option></select></div>' +
    '<div style="margin-top:18px" class="setting-row"><div class="setting-copy"><b>' + t("settings.interfaceLanguage") + "</b><span>" +
    t("settings.languageDesc") + '</span></div><button id="settingsLang" class="language-switch" type="button"><span class="language-globe">文</span><strong>' +
    state.locale.toUpperCase() + "</strong></button></div></div></div>";
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

async function addFiles() {
  if (!window.desktopAPI) return;
  const files = await window.desktopAPI.selectVideos();
  if (!files.length) return;
  files.forEach((file) => state.jobs.unshift({
    name: file.name,
    lang: "",
    status: "queued",
    progress: 0,
    time: t("common.now"),
    sourcePath: file.path
  }));
  render();
  toast(t("download.added", { count: files.length }));
}

function simulateRender() {
  const job = {
    name: "viral_ai_output_" + Date.now() + ".mp4",
    lang: "vi",
    status: "processing",
    progress: 5,
    time: t("common.now")
  };
  state.jobs.unshift(job);
  toast(t("aiVideo.renderStarted"));
  render();
  let progress = 5;
  const timer = setInterval(() => {
    progress += Math.floor(Math.random() * 13) + 5;
    job.progress = Math.min(100, progress);
    if (job.progress >= 100) {
      job.status = "completed";
      clearInterval(timer);
      toast(t("aiVideo.renderDone"));
    }
    save();
    if (["library", "dashboard", "download"].includes(state.page)) render();
  }, 850);
}

function toggleLocale() {
  state.locale = state.locale === "vi" ? "en" : "vi";
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

  const renderButton = $("render");
  if (renderButton) renderButton.onclick = simulateRender;

  const tts = $("tts");
  if (tts) tts.onclick = () => toast(t("voice.generated"));

  const exportButton = $("export");
  if (exportButton) exportButton.onclick = simulateRender;

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

  const settingsLang = $("settingsLang");
  if (settingsLang) settingsLang.onclick = toggleLocale;
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
}

$("quickProject").onclick = () => {
  state.page = "ai-video";
  render();
};

$("langToggle").onclick = toggleLocale;

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
    files.forEach((file) => state.jobs.unshift({
      name: file.name,
      lang: "",
      status: "queued",
      progress: 0,
      time: t("common.now"),
      sourcePath: file.path
    }));
    render();
    toast(t("download.dropped", { count: files.length }));
  });
}

render();
