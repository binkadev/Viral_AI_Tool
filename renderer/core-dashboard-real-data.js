(function installCoreRealDashboard() {
  "use strict";

  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function esc(value) {
    try { return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? ""); }
    catch { return String(value ?? ""); }
  }

  function copy() {
    return locale() === "en"
      ? {
          eyebrow: "Project overview",
          titleWithProject: "Continue your video workflow",
          titleEmpty: "Start your first video project",
          bodyWithProject: "Resume the current source video and continue from the next production step.",
          bodyEmpty: "Import a source video to start the production workflow.",
          openEditor: "Open Core Editor",
          importVideo: "Import video",
          sourceVideos: "Source videos",
          processing: "Processing now",
          renders: "Completed renders",
          cloudRemaining: "Cloud minutes left",
          notSynced: "Not synced",
          noProject: "No project",
          recent: "Recent work",
          recentDesc: "Real project files and render history from this workspace.",
          noRecent: "No project activity yet.",
          workflow: "Current workflow",
          cloudAccount: "Cloud account",
          connected: "Connected",
          disconnected: "Not connected",
          offline: "Offline",
          plan: "Plan",
          quota: "Usage",
          next: "Current step",
          minute: "min",
          sourceFoot: count => count === 1 ? "1 source in this workspace" : count + " sources in this workspace",
          processingFoot: count => count ? count + " active job" + (count === 1 ? "" : "s") : "No background job is running",
          renderFoot: count => count ? count + " available output file" + (count === 1 ? "" : "s") : "No available completed render"
        }
      : {
          eyebrow: "Tổng quan dự án",
          titleWithProject: "Tiếp tục quy trình video",
          titleEmpty: "Bắt đầu dự án video đầu tiên",
          bodyWithProject: "Mở lại video nguồn hiện tại và tiếp tục đúng bước production tiếp theo.",
          bodyEmpty: "Nhập một video nguồn để bắt đầu quy trình production.",
          openEditor: "Mở Core Editor",
          importVideo: "Nhập video",
          sourceVideos: "Video nguồn",
          processing: "Đang xử lý",
          renders: "Render khả dụng",
          cloudRemaining: "Cloud còn lại",
          notSynced: "Chưa đồng bộ",
          noProject: "Chưa có dự án",
          recent: "Công việc gần đây",
          recentDesc: "File dự án và lịch sử render thật trong workspace này.",
          noRecent: "Chưa có hoạt động dự án.",
          workflow: "Quy trình hiện tại",
          cloudAccount: "Tài khoản Cloud",
          connected: "Đã kết nối",
          disconnected: "Chưa kết nối",
          offline: "Ngoại tuyến",
          plan: "Gói",
          quota: "Đã dùng",
          next: "Bước hiện tại",
          minute: "phút",
          sourceFoot: count => count + " video nguồn trong workspace",
          processingFoot: count => count ? count + " tác vụ đang chạy" : "Không có tác vụ nền đang chạy",
          renderFoot: count => count ? count + " file đầu ra còn khả dụng" : "Chưa có render hoàn tất còn khả dụng"
        };
  }

  function normalizeStatus(value) {
    const raw = String(value || "").toLowerCase();
    if (/(complete|hoàn|xong)/.test(raw)) return "completed";
    if (/(cancel|hủy|dừng)/.test(raw)) return "cancelled";
    if (/(fail|error|lỗi|thất|interrupt|stale)/.test(raw)) return "failed";
    if (/(validat|prepar|upload|queue|process|translat|generat|download|render|cancell|xử lý|đang)/.test(raw)) return "processing";
    return raw || "idle";
  }

  function jobs() {
    const current = appState();
    return Array.isArray(current?.jobs) ? current.jobs : [];
  }

  function sourceJobs() {
    return jobs().filter(job => job?.sourcePath && !job?.isRenderOutput);
  }

  function renderJobs() {
    return jobs().filter(job => job?.isRenderOutput);
  }

  function fileName(value) {
    const raw = String(value || "");
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  }

  function fileAvailable(job) {
    return job?.fileState !== "missing" && job?.fileState !== "trashed";
  }

  function activeJobCount() {
    const current = appState();
    const logical = [current?.speech?.job, current?.translation?.job, current?.voice?.job]
      .filter(job => job && normalizeStatus(job.status || job.state) === "processing").length;
    const renders = renderJobs().filter(job => normalizeStatus(job.status) === "processing").length;
    return logical + renders;
  }

  function quotaInfo() {
    const current = appState();
    const cloudStatus = current?.speech?.providerStatus?.cloud;
    const quota = current?.cloud?.account?.quota || cloudStatus?.quota || null;
    const remaining = Number(quota?.remainingMinutes);
    const explicitTotal = Number(quota?.totalMinutes);
    const explicitUsed = Number(quota?.usedMinutes);
    const used = Number.isFinite(explicitUsed)
      ? Math.max(0, explicitUsed)
      : Number.isFinite(explicitTotal) && Number.isFinite(remaining)
        ? Math.max(0, explicitTotal - remaining)
        : null;
    const total = Number.isFinite(explicitTotal) && explicitTotal > 0
      ? explicitTotal
      : Number.isFinite(used) && Number.isFinite(remaining) && used + remaining > 0
        ? used + remaining
        : null;
    const percent = Number.isFinite(total) && total > 0 && Number.isFinite(used)
      ? Math.max(0, Math.min(100, Math.round((used / total) * 100)))
      : null;
    return {
      remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : null,
      used,
      total,
      percent
    };
  }

  function cloudInfo() {
    const current = appState();
    const auth = current?.cloud?.auth || null;
    const account = current?.cloud?.account || null;
    const user = account?.user || null;
    const quota = quotaInfo();
    return {
      authenticated: auth?.authenticated === true,
      offline: current?.cloud?.accountOffline === true,
      name: user?.name || user?.displayName || user?.email || "",
      email: user?.email || "",
      plan: user?.plan || auth?.plan || account?.plan || account?.quota?.plan || "",
      quota
    };
  }

  function currentStage() {
    const current = appState();
    try {
      const flow = window.ViralCoreWorkflowModel?.derive?.(current || {});
      if (!flow?.stages?.length) return "—";
      const stage = flow.stages.find(item => ["processing", "failed", "active"].includes(item.status))
        || flow.stages.find(item => item.status !== "completed")
        || flow.stages[flow.stages.length - 1];
      const labels = locale() === "en"
        ? { import: "Import", analyze: "Analyze", transcript: "Speech", edit: "Edit", localize: "Localize", render: "Render" }
        : { import: "Nhập video", analyze: "Phân tích", transcript: "Lời nói", edit: "Chỉnh sửa", localize: "Localize", render: "Render" };
      return labels[stage?.id] || stage?.label || "—";
    } catch {
      return "—";
    }
  }

  function statCard(label, value, foot) {
    return '<article class="core-real-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(foot) + '</small></article>';
  }

  function dashboardPage() {
    const c = copy();
    const sources = sourceJobs();
    const renders = renderJobs();
    const completedRenders = renders.filter(job => normalizeStatus(job.status) === "completed" && fileAvailable(job));
    const active = activeJobCount();
    const cloud = cloudInfo();
    const hasProject = sources.length > 0;
    const recent = jobs().slice(0, 8);
    const cloudValue = cloud.quota.remaining == null ? "—" : Math.floor(cloud.quota.remaining) + " " + c.minute;
    const cloudFoot = cloud.quota.remaining == null ? c.notSynced : (cloud.authenticated ? c.connected : c.disconnected);
    const accountState = cloud.offline ? c.offline : cloud.authenticated ? c.connected : c.disconnected;
    const accountName = cloud.name || c.cloudAccount;
    const quotaText = cloud.quota.used != null && cloud.quota.total != null
      ? Math.floor(cloud.quota.used) + " / " + Math.floor(cloud.quota.total) + " " + c.minute
      : c.notSynced;

    return '<div class="core-real-dashboard">' +
      '<section class="core-real-dashboard-hero">' +
        '<div><span class="core-real-kicker">' + esc(c.eyebrow) + '</span><h2>' + esc(hasProject ? c.titleWithProject : c.titleEmpty) + '</h2><p>' + esc(hasProject ? c.bodyWithProject : c.bodyEmpty) + '</p></div>' +
        '<button class="button primary" type="button" data-page="' + (hasProject ? 'ai-video' : 'download') + '">' + esc(hasProject ? c.openEditor : c.importVideo) + '</button>' +
      '</section>' +
      '<section class="core-real-stats">' +
        statCard(c.sourceVideos, String(sources.length), c.sourceFoot(sources.length)) +
        statCard(c.processing, String(active), c.processingFoot(active)) +
        statCard(c.renders, String(completedRenders.length), c.renderFoot(completedRenders.length)) +
        statCard(c.cloudRemaining, cloudValue, cloudFoot) +
      '</section>' +
      '<section class="core-real-dashboard-grid">' +
        '<div class="core-real-recent"><div class="core-real-section-head"><div><span>' + esc(c.recent) + '</span><p>' + esc(c.recentDesc) + '</p></div></div>' +
          (recent.length && typeof jobsTable === "function" ? jobsTable(recent) : '<div class="core-real-empty">' + esc(c.noRecent) + '</div>') +
        '</div>' +
        '<aside class="core-real-summary">' +
          '<div class="core-real-summary-card"><span>' + esc(c.workflow) + '</span><dl><div><dt>' + esc(c.next) + '</dt><dd>' + esc(currentStage()) + '</dd></div><div><dt>' + esc(c.sourceVideos) + '</dt><dd>' + sources.length + '</dd></div></dl></div>' +
          '<div class="core-real-summary-card"><span>' + esc(c.cloudAccount) + '</span><strong>' + esc(accountName) + '</strong><small>' + esc(accountState) + '</small><dl><div><dt>' + esc(c.plan) + '</dt><dd>' + esc(cloud.plan || "—") + '</dd></div><div><dt>' + esc(c.quota) + '</dt><dd>' + esc(quotaText) + '</dd></div></dl></div>' +
        '</aside>' +
      '</section>' +
    '</div>';
  }

  function syncSidebar() {
    const c = copy();
    const cloud = cloudInfo();
    const source = sourceJobs()[0] || null;
    const workspace = document.querySelector(".workspace strong");
    if (workspace) {
      const projectName = source?.name || fileName(source?.sourcePath) || c.noProject;
      workspace.textContent = projectName;
      workspace.title = projectName;
    }

    const usage = document.querySelector('[data-core-placeholder="account-usage"]');
    if (usage instanceof HTMLElement) {
      const label = usage.querySelector("#creditsLabel");
      const total = usage.querySelector(".credit-head b");
      const bar = usage.querySelector(".bar i");
      const remainingValue = usage.querySelector("small span:first-child");
      const remainingLabel = usage.querySelector("#remainingLabel");
      if (label) label.textContent = locale() === "en" ? "Cloud minutes" : "Phút Cloud";
      if (total) total.textContent = cloud.quota.total == null ? "—" : Math.floor(cloud.quota.total) + " " + c.minute;
      if (bar instanceof HTMLElement) bar.style.width = (cloud.quota.percent == null ? 0 : cloud.quota.percent) + "%";
      if (remainingValue) remainingValue.textContent = cloud.quota.remaining == null ? "—" : Math.floor(cloud.quota.remaining) + " " + c.minute;
      if (remainingLabel) remainingLabel.textContent = cloud.quota.remaining == null ? c.notSynced.toLowerCase() : (locale() === "en" ? "remaining" : "còn lại");
      usage.dataset.realData = cloud.quota.remaining == null ? "unavailable" : "ready";
    }

    const profile = document.querySelector('[data-core-placeholder="account-profile"]');
    if (profile instanceof HTMLElement) {
      const avatar = profile.querySelector(".avatar");
      const name = profile.querySelector("b");
      const status = profile.querySelector("span");
      const accountState = cloud.offline ? c.offline : cloud.authenticated ? c.connected : c.disconnected;
      const display = cloud.name || c.cloudAccount;
      if (avatar) avatar.textContent = display && display !== c.cloudAccount ? display.trim().charAt(0).toUpperCase() : "•";
      if (name) name.textContent = display;
      if (status) status.textContent = cloud.plan ? accountState + " · " + cloud.plan : accountState;
      profile.dataset.realData = cloud.authenticated ? "connected" : cloud.offline ? "offline" : "disconnected";
    }
  }

  function queueSidebar() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncSidebar();
    });
  }

  function installDashboard() {
    try {
      if (typeof pages === "undefined" || !pages) return false;
      pages.dashboard = dashboardPage;
      return true;
    } catch {
      return false;
    }
  }

  function start() {
    installDashboard();
    syncSidebar();
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueSidebar).observe(page, { childList: true, subtree: false });
    window.addEventListener("viral-ai:core-state-changed", queueSidebar);
    window.addEventListener("focus", queueSidebar);
    window.addEventListener("storage", queueSidebar);
    const current = appState();
    if (current?.page === "dashboard") {
      try { if (typeof render === "function") render(); } catch {}
    }
    document.documentElement.dataset.coreRealDashboard = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
