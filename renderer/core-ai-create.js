(function installAiCreateWorkspace() {
  "use strict";

  const GOAL_KEY = "viral-ai-generation-goal";
  const BRIEF_KEY = "viral-ai-generation-brief";
  const VALID_GOALS = new Set(["economy", "balanced", "quality"]);
  let installed = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function copy() {
    return locale() === "en"
      ? {
          eyebrow: "AI CREATE · Production workspace",
          title: "Turn an idea into a production-ready video workflow",
          body: "Script, scene planning, media discovery, voice, timeline and export stay in one project. Real generation remains locked until an execution provider is connected.",
          foundation: "Generation foundation restored",
          sceneReady: "Scene Plan v3 ready",
          mediaReady: "Media Engine ready",
          briefLabel: "What do you want to create?",
          briefPlaceholder: "Example: A 30-second vertical wildlife short where the predator becomes the prey, fast hook, Vietnamese narration...",
          briefHint: "This brief is saved locally for the current workspace. It is not sent to any provider yet.",
          sourceTitle: "Current project context",
          sourceNone: "No source video",
          sourceReady: "Source video ready",
          transcript: "Transcript",
          scenes: "Scenes",
          strategy: "Model strategy",
          strategyDesc: "Choose the routing goal. The backend router decides the concrete model only after a provider is actually available.",
          economy: "Economy",
          economyBody: "Prefer local and lower-cost routes.",
          balanced: "Balanced",
          balancedBody: "Balance speed, quality and estimated cost.",
          quality: "Quality",
          qualityBody: "Prefer higher-quality routes when available.",
          workflow: "Production pipeline",
          workflowDesc: "This is the target pipeline being connected to the current Studio, not a separate demo flow.",
          steps: ["Brief & script", "Scene Planner", "Find media", "Generate missing media", "Voice & captions", "Compose in Studio", "Export & publish"],
          ready: "Ready",
          foundationOnly: "Foundation",
          needsProvider: "Needs provider",
          existing: "Existing workflow",
          setup: "AI & provider setup",
          setupDesc: "The app now exposes the pieces that already exist and clearly marks what is not wired yet.",
          localAi: "Local AI",
          localAiReady: "Local speech AI is ready on this machine.",
          localAiNeeds: "Local speech model still needs to be prepared.",
          manageLocal: "Manage local AI",
          cloudAi: "Viral AI Cloud",
          cloudReady: "Cloud account is connected.",
          cloudNeeds: "Cloud account is not connected yet.",
          openSettings: "Open settings",
          mediaEngine: "Media Engine",
          mediaEngineReady: "Stock discovery is wired through the desktop/backend boundary.",
          mediaEngineNeeds: "Media search is not available in this build.",
          videoProvider: "AI video generation",
          providerBody: "Catalog, routing and cost-estimation foundation are restored. Provider execution is intentionally not faked and remains disabled until the real adapter/job pipeline is connected.",
          restoredModels: "Restored routing families",
          restoredModelsBody: "WAN Local / WAN 3.0 · Seedance · Veo · Gen-4.5. Availability is backend-controlled, not hard-coded as usable.",
          importVideo: "Import video",
          openStudio: "Open Studio",
          generationLocked: "Generation provider not connected",
          generationLockedBody: "The Generate action stays disabled until a real provider adapter, durable job lifecycle and credit settlement are wired.",
          nextBlock: "Next implementation block",
          nextBlockBody: "Connect provider status + generation job API, then let Scene Planner request stock or AI-generated assets per scene.",
          noTranscript: "Not ready",
          countSegments: "{count} segments",
          countScenes: "{count} scenes"
        }
      : {
          eyebrow: "AI CREATE · Không gian sản xuất",
          title: "Từ một ý tưởng thành quy trình video hoàn chỉnh",
          body: "Kịch bản, Scene Planner, tìm tư liệu, giọng đọc, timeline và xuất video nằm trong cùng một dự án. Tạo video AI thật vẫn được khóa cho tới khi provider thực thi được kết nối.",
          foundation: "Đã khôi phục nền AI Generation",
          sceneReady: "Scene Plan v3 sẵn sàng",
          mediaReady: "Media Engine sẵn sàng",
          briefLabel: "Bạn muốn tạo video gì?",
          briefPlaceholder: "Ví dụ: video dọc 30 giây về động vật hoang dã, kẻ đi săn trở thành con mồi, hook nhanh, lời dẫn tiếng Việt...",
          briefHint: "Brief này chỉ được lưu cục bộ trong workspace hiện tại. Chưa có dữ liệu nào được gửi tới provider.",
          sourceTitle: "Ngữ cảnh dự án hiện tại",
          sourceNone: "Chưa có video nguồn",
          sourceReady: "Đã có video nguồn",
          transcript: "Transcript",
          scenes: "Cảnh",
          strategy: "Chiến lược model",
          strategyDesc: "Chọn mục tiêu định tuyến. Backend chỉ chọn model cụ thể khi provider thật sự khả dụng.",
          economy: "Tiết kiệm",
          economyBody: "Ưu tiên local và tuyến có chi phí thấp.",
          balanced: "Cân bằng",
          balancedBody: "Cân bằng tốc độ, chất lượng và chi phí ước tính.",
          quality: "Chất lượng",
          qualityBody: "Ưu tiên tuyến chất lượng cao khi khả dụng.",
          workflow: "Pipeline sản xuất",
          workflowDesc: "Đây là pipeline sẽ nối thẳng vào Studio hiện tại, không phải một luồng demo riêng.",
          steps: ["Brief & kịch bản", "Scene Planner", "Tìm tư liệu", "Tạo phần còn thiếu", "Giọng & phụ đề", "Ghép trong Studio", "Xuất & đăng"],
          ready: "Sẵn sàng",
          foundationOnly: "Đã có nền",
          needsProvider: "Cần provider",
          existing: "Đang dùng thật",
          setup: "Thiết lập AI & provider",
          setupDesc: "Ứng dụng hiển thị lại những phần đã có và đánh dấu rõ phần nào chưa được nối thật.",
          localAi: "AI trên máy",
          localAiReady: "AI nhận diện lời nói local đã sẵn sàng trên máy này.",
          localAiNeeds: "Model nhận diện local vẫn cần được chuẩn bị.",
          manageLocal: "Quản lý AI trên máy",
          cloudAi: "Viral AI Cloud",
          cloudReady: "Tài khoản Cloud đã được kết nối.",
          cloudNeeds: "Tài khoản Cloud chưa được kết nối.",
          openSettings: "Mở cài đặt",
          mediaEngine: "Media Engine",
          mediaEngineReady: "Tìm tư liệu stock đã đi qua desktop/backend boundary.",
          mediaEngineNeeds: "Tìm tư liệu chưa khả dụng trong bản này.",
          videoProvider: "Tạo video bằng AI",
          providerBody: "Catalog, Model Router và cost-estimator đã được khôi phục. Phần thực thi provider không được giả lập và vẫn bị khóa cho tới khi adapter/job pipeline thật được nối.",
          restoredModels: "Nhóm model định tuyến đã khôi phục",
          restoredModelsBody: "WAN Local / WAN 3.0 · Seedance · Veo · Gen-4.5. Backend mới là nơi xác nhận model nào thực sự khả dụng.",
          importVideo: "Nhập video",
          openStudio: "Mở Studio",
          generationLocked: "Chưa kết nối provider tạo video",
          generationLockedBody: "Nút Generate được giữ khóa cho tới khi có provider adapter thật, job lifecycle bền vững và cơ chế quyết toán credit.",
          nextBlock: "Block triển khai tiếp theo",
          nextBlockBody: "Nối trạng thái provider + Generation Job API, sau đó để Scene Planner tự yêu cầu stock hoặc AI-generated asset theo từng cảnh.",
          noTranscript: "Chưa sẵn sàng",
          countSegments: "{count} đoạn",
          countScenes: "{count} cảnh"
        };
  }

  function format(template, values = {}) {
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  }

  function selectedGoal() {
    const saved = String(localStorage.getItem(GOAL_KEY) || "balanced");
    return VALID_GOALS.has(saved) ? saved : "balanced";
  }

  function currentBrief() {
    return String(localStorage.getItem(BRIEF_KEY) || "");
  }

  function projectContext() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    const source = jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
    const transcript = current?.translation?.result?.segments || current?.speech?.result?.segments || [];
    const scenes = Array.isArray(current?.scenePlan?.scenes) ? current.scenePlan.scenes : [];
    return {
      source,
      transcriptCount: Array.isArray(transcript) ? transcript.length : 0,
      sceneCount: scenes.length
    };
  }

  function readiness() {
    const current = appState();
    const localReady = current?.speech?.providerStatus?.ready === true || current?.speech?.modelStatus?.state === "installed";
    const cloudReady = Boolean(current?.cloud?.auth || current?.cloud?.account);
    const mediaReady = typeof window.desktopAPI?.searchMedia === "function" || typeof window.desktopAPI?.searchMediaAssets === "function";
    const sceneReady = Boolean(window.ViralCoreScenePlanModel);
    return { localReady, cloudReady, mediaReady, sceneReady };
  }

  function statusPill(label, tone) {
    return '<span class="core-ai-status ' + tone + '">' + esc(label) + '</span>';
  }

  function strategyCard(goal, title, body, active) {
    return '<button type="button" class="core-ai-strategy ' + (active ? "is-active" : "") + '" data-ai-goal="' + goal + '" aria-pressed="' + (active ? "true" : "false") + '">' +
      '<span class="core-ai-strategy-dot" aria-hidden="true"></span>' +
      '<strong>' + esc(title) + '</strong>' +
      '<span>' + esc(body) + '</span>' +
    '</button>';
  }

  function setupCard(icon, title, body, status, tone, action, actionLabel) {
    return '<article class="core-ai-setup-card">' +
      '<div class="core-ai-setup-icon" aria-hidden="true">' + icon + '</div>' +
      '<div class="core-ai-setup-copy"><div class="core-ai-setup-head"><strong>' + esc(title) + '</strong>' + statusPill(status, tone) + '</div><p>' + esc(body) + '</p></div>' +
      (action ? '<button type="button" class="button ghost" data-ai-action="' + action + '">' + esc(actionLabel) + '</button>' : '') +
    '</article>';
  }

  function page() {
    const c = copy();
    const goal = selectedGoal();
    const project = projectContext();
    const ready = readiness();
    const transcriptLabel = project.transcriptCount > 0 ? format(c.countSegments, { count: project.transcriptCount }) : c.noTranscript;
    const sceneLabel = project.sceneCount > 0 ? format(c.countScenes, { count: project.sceneCount }) : c.noTranscript;

    const workflowTones = [
      "foundation",
      ready.sceneReady ? "ready" : "foundation",
      ready.mediaReady ? "ready" : "foundation",
      "blocked",
      "ready",
      "ready",
      "foundation"
    ];
    const workflowStatuses = [
      c.foundationOnly,
      ready.sceneReady ? c.ready : c.foundationOnly,
      ready.mediaReady ? c.ready : c.foundationOnly,
      c.needsProvider,
      c.existing,
      c.existing,
      c.foundationOnly
    ];

    return '<div class="core-ai-create-workspace" data-generation-execution="not-wired">' +
      '<section class="core-ai-create-hero">' +
        '<div class="core-ai-create-hero-copy"><span class="core-ai-kicker">' + esc(c.eyebrow) + '</span><h2>' + esc(c.title) + '</h2><p>' + esc(c.body) + '</p>' +
          '<div class="core-ai-hero-status">' + statusPill(c.foundation, "ready") + statusPill(c.sceneReady, ready.sceneReady ? "ready" : "foundation") + statusPill(c.mediaReady, ready.mediaReady ? "ready" : "foundation") + '</div>' +
        '</div>' +
        '<div class="core-ai-create-hero-actions"><button type="button" class="button ghost" data-ai-route="download">' + esc(c.importVideo) + '</button><button type="button" class="button primary" data-ai-route="ai-video">' + esc(c.openStudio) + '</button></div>' +
      '</section>' +

      '<section class="core-ai-create-grid">' +
        '<article class="core-ai-create-card core-ai-brief-card"><div class="core-ai-card-head"><div><span class="eyebrow">01 · BRIEF</span><h3>' + esc(c.briefLabel) + '</h3></div></div>' +
          '<textarea class="core-ai-brief" data-ai-brief rows="6" placeholder="' + esc(c.briefPlaceholder) + '">' + esc(currentBrief()) + '</textarea><p class="core-ai-help">' + esc(c.briefHint) + '</p>' +
        '</article>' +
        '<article class="core-ai-create-card core-ai-project-card"><div class="core-ai-card-head"><div><span class="eyebrow">PROJECT</span><h3>' + esc(c.sourceTitle) + '</h3></div></div>' +
          '<div class="core-ai-project-source"><span class="core-ai-project-icon">▶</span><div><strong>' + esc(project.source?.name || c.sourceNone) + '</strong><span>' + esc(project.source ? c.sourceReady : c.sourceNone) + '</span></div></div>' +
          '<div class="core-ai-project-metrics"><div><span>' + esc(c.transcript) + '</span><strong>' + esc(transcriptLabel) + '</strong></div><div><span>' + esc(c.scenes) + '</span><strong>' + esc(sceneLabel) + '</strong></div></div>' +
        '</article>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.strategy) + '</h3><p>' + esc(c.strategyDesc) + '</p></div></div>' +
        '<div class="core-ai-strategy-grid">' +
          strategyCard("economy", c.economy, c.economyBody, goal === "economy") +
          strategyCard("balanced", c.balanced, c.balancedBody, goal === "balanced") +
          strategyCard("quality", c.quality, c.qualityBody, goal === "quality") +
        '</div>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.workflow) + '</h3><p>' + esc(c.workflowDesc) + '</p></div></div>' +
        '<div class="core-ai-pipeline">' + c.steps.map((step, index) => '<div class="core-ai-pipeline-step"><span class="core-ai-step-index">' + String(index + 1).padStart(2, "0") + '</span><div><strong>' + esc(step) + '</strong>' + statusPill(workflowStatuses[index], workflowTones[index]) + '</div></div>').join("") + '</div>' +
      '</section>' +

      '<section class="core-ai-create-section"><div class="section-head"><div><h3>' + esc(c.setup) + '</h3><p>' + esc(c.setupDesc) + '</p></div></div>' +
        '<div class="core-ai-setup-grid">' +
          setupCard("◈", c.localAi, ready.localReady ? c.localAiReady : c.localAiNeeds, ready.localReady ? c.ready : c.foundationOnly, ready.localReady ? "ready" : "foundation", "local-ai", c.manageLocal) +
          setupCard("☁", c.cloudAi, ready.cloudReady ? c.cloudReady : c.cloudNeeds, ready.cloudReady ? c.ready : c.foundationOnly, ready.cloudReady ? "ready" : "foundation", "settings", c.openSettings) +
          setupCard("▦", c.mediaEngine, ready.mediaReady ? c.mediaEngineReady : c.mediaEngineNeeds, ready.mediaReady ? c.ready : c.foundationOnly, ready.mediaReady ? "ready" : "foundation", null, "") +
          setupCard("✦", c.videoProvider, c.providerBody, c.needsProvider, "blocked", "settings", c.openSettings) +
        '</div>' +
        '<div class="core-ai-model-note"><div><span class="eyebrow">MODEL ROUTER</span><strong>' + esc(c.restoredModels) + '</strong><p>' + esc(c.restoredModelsBody) + '</p></div></div>' +
      '</section>' +

      '<section class="core-ai-generation-lock"><div><span class="core-ai-lock-icon">✦</span><div><strong>' + esc(c.generationLocked) + '</strong><p>' + esc(c.generationLockedBody) + '</p></div></div><button type="button" class="button primary" disabled aria-disabled="true">Generate</button></section>' +
      '<section class="core-ai-next-block"><span>' + esc(c.nextBlock) + '</span><p>' + esc(c.nextBlockBody) + '</p></section>' +
    '</div>';
  }

  function route(pageId) {
    const current = appState();
    if (!current) return;
    current.page = pageId;
    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const goalButton = target.closest("[data-ai-goal]");
    if (goalButton instanceof HTMLButtonElement) {
      const goal = String(goalButton.dataset.aiGoal || "");
      if (!VALID_GOALS.has(goal)) return;
      localStorage.setItem(GOAL_KEY, goal);
      if (appState()?.page === "ai-create" && typeof render === "function") render();
      return;
    }

    const routeButton = target.closest("[data-ai-route]");
    if (routeButton instanceof HTMLButtonElement) {
      route(String(routeButton.dataset.aiRoute || "download"));
      return;
    }

    const action = target.closest("[data-ai-action]");
    if (!(action instanceof HTMLButtonElement)) return;
    const type = String(action.dataset.aiAction || "");
    if (type === "local-ai" && typeof openLocalModelSetup === "function") {
      openLocalModelSetup().catch?.(() => {});
      return;
    }
    if (type === "settings") route("settings");
  }

  function onInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.aiBrief === undefined) return;
    localStorage.setItem(BRIEF_KEY, target.value.slice(0, 8000));
  }

  function install() {
    if (installed) return;
    try {
      if (typeof pages === "undefined" || !pages) return;
      installed = true;
      pages["ai-create"] = page;
      if (typeof pageMeta !== "undefined" && pageMeta) pageMeta["ai-create"] = ["nav.aiVideo", "aiVideo.breadcrumb"];
      document.addEventListener("click", onClick);
      document.addEventListener("input", onInput);
      window.addEventListener("viral-ai:core-state-changed", () => {
        if (appState()?.page === "ai-create" && typeof render === "function") render();
      });
      document.documentElement.dataset.aiCreateWorkspace = "enabled";
      if (appState()?.page === "ai-create" && typeof render === "function") render();
    } catch (error) {
      console.warn("[AiCreate] Could not install workspace", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
