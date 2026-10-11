(function installAutomationWorkspace() {
  "use strict";

  const STAGE_KEY = "viral-ai-automation-workspace-stage-v2";
  let queued = false;
  let activeStage = 0;
  let lastScriptSignature = null;
  let lastSceneSignature = null;
  let lastAssetsComplete = null;
  let manualSelection = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function automation() {
    return appState()?.automation || null;
  }

  function copy() {
    return locale() === "en"
      ? {
          step: "Step",
          of: "of",
          titles: ["Prepare content", "Review script", "Shape scenes", "Choose media", "Finish timeline"],
          desc: [
            "Define the idea and output settings, then create the first editable script.",
            "Review and refine the script before visual planning starts.",
            "Refine narration, visual intent and media search terms scene by scene.",
            "Resolve every scene into a healthy local media asset.",
            "Review voice, composition and export, then continue in Studio when you are ready."
          ],
          backBrief: "Back to brief",
          backScript: "Back to script",
          backScenes: "Back to scenes",
          backAssets: "Back to media",
          viewScript: "Review script",
          continueScenes: "Continue to scenes",
          continueAssets: "Continue to media",
          continueTimeline: "Continue to timeline",
          locked: "Locked",
          complete: "Done",
          current: "Viewing",
          ready: "Ready",
          reviewing: "Reviewing an earlier completed step"
        }
      : {
          step: "Bước",
          of: "trên",
          titles: ["Chuẩn bị nội dung", "Kiểm tra kịch bản", "Tinh chỉnh phân cảnh", "Chọn tư liệu", "Hoàn thiện timeline"],
          desc: [
            "Xác định ý tưởng và đầu ra, sau đó tạo kịch bản đầu tiên có thể chỉnh sửa.",
            "Đọc lại và tinh chỉnh kịch bản trước khi chuyển sang phần hình ảnh.",
            "Tinh chỉnh lời đọc, ý đồ hình ảnh và từ khóa tư liệu cho từng cảnh.",
            "Chốt file tư liệu cục bộ còn hoạt động cho từng cảnh.",
            "Kiểm tra giọng đọc, bố cục và bản xuất trước khi tiếp tục chỉnh tay trong Studio."
          ],
          backBrief: "Về Nội dung",
          backScript: "Về Kịch bản",
          backScenes: "Về Phân cảnh",
          backAssets: "Về Tư liệu",
          viewScript: "Kiểm tra kịch bản",
          continueScenes: "Tiếp tục Phân cảnh",
          continueAssets: "Tiếp tục Tư liệu",
          continueTimeline: "Tiếp tục Timeline",
          locked: "Chưa mở",
          complete: "Đã xong",
          current: "Đang xem",
          ready: "Sẵn sàng",
          reviewing: "Bạn đang xem lại một bước đã hoàn thành"
        };
  }

  function hasScript() {
    return Boolean(automation()?.script) && automation()?.stale?.script !== true;
  }

  function hasScenePlan() {
    const current = automation();
    return Boolean(current?.scenePlan) && current?.stale?.scenes !== true;
  }

  function hasAssetRequests() {
    const current = automation();
    const scenes = Array.isArray(current?.scenePlan?.scenes) ? current.scenePlan.scenes : [];
    const requests = Array.isArray(current?.assetRequests) ? current.assetRequests : [];
    if (!hasScenePlan() || !scenes.length || requests.length !== scenes.length) return false;
    const planSignature = String(current?.scenePlan?.outputSignature || "");
    return requests.every(request => String(request?.inputSignature || "") === planSignature);
  }

  function hasResolvedAssets() {
    const current = automation();
    const requests = Array.isArray(current?.assetRequests) ? current.assetRequests : [];
    const assets = Array.isArray(current?.resolvedAssets) ? current.resolvedAssets : [];
    const stale = new Set(Array.isArray(current?.stale?.assets) ? current.stale.assets.map(String) : []);
    if (!hasAssetRequests() || !requests.length) return false;
    return requests.every(request => assets.some(asset =>
      String(asset?.requestSignature || "") === String(request?.requestSignature || "") &&
      !stale.has(String(asset?.id || "")) &&
      Boolean(asset?.localPath)
    ));
  }

  function hasComposition() {
    const current = automation();
    return Boolean(current?.composition) && current?.stale?.composition !== true && window.ViralAutomationCompositionState?.isCurrent?.() === true;
  }

  function stageAvailable(stage) {
    if (stage === 1) return true;
    if (stage === 2 || stage === 3) return hasScript();
    if (stage === 4) return hasScenePlan();
    if (stage === 5) return hasResolvedAssets();
    return false;
  }

  function highestRelevantStage() {
    if (hasResolvedAssets()) return 5;
    if (hasAssetRequests() || hasScenePlan()) return hasAssetRequests() ? 4 : 3;
    if (hasScript()) return 2;
    return 1;
  }

  function stageCompletion(stage) {
    if (stage === 1 || stage === 2) return hasScript();
    if (stage === 3) return hasScenePlan();
    if (stage === 4) return hasResolvedAssets();
    if (stage === 5) return hasComposition();
    return false;
  }

  function storedStage() {
    try {
      const raw = sessionStorage.getItem(STAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const stage = Number(parsed?.stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > 5) return null;
      return { stage, manual: parsed?.manual === true };
    } catch { return null; }
  }

  function persistStage() {
    try { sessionStorage.setItem(STAGE_KEY, JSON.stringify({ stage: activeStage, manual: manualSelection })); } catch {}
  }

  function initialStage() {
    const stored = storedStage();
    if (stored && stored.manual && stageAvailable(stored.stage)) {
      manualSelection = true;
      return stored.stage;
    }
    manualSelection = false;
    return highestRelevantStage();
  }

  function reducedMotion() {
    try {
      return document.documentElement.dataset.motion === "reduced" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    } catch { return false; }
  }

  function scrollToStageContext() {
    requestAnimationFrame(() => {
      const target = document.querySelector(".automation-step-context") || document.querySelector(".automation-stage-rail");
      try { target?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); } catch {}
    });
  }

  function applyStage(stage, { manual = true } = {}) {
    activeStage = Number(stage);
    manualSelection = manual;
    persistStage();
    scan();
  }

  function setStage(stage, { scroll = true, manual = true } = {}) {
    const next = Number(stage);
    if (!stageAvailable(next) || next === activeStage) return false;

    const change = () => applyStage(next, { manual });
    if (!reducedMotion() && typeof document.startViewTransition === "function") {
      try {
        const transition = document.startViewTransition(change);
        if (scroll) transition.finished.finally(scrollToStageContext);
      } catch {
        change();
        if (scroll) scrollToStageContext();
      }
    } else {
      change();
      if (scroll) scrollToStageContext();
    }
    return true;
  }

  function ensureStepContext(creator, rail) {
    let context = creator.querySelector(":scope > .automation-step-context");
    if (!(context instanceof HTMLElement)) {
      context = document.createElement("section");
      context.className = "automation-step-context";
      context.dataset.automationMotionItem = "step-context";
      rail.insertAdjacentElement("afterend", context);
    }

    const c = copy();
    const stageIndex = Math.max(1, Math.min(5, activeStage));
    const reviewingEarlier = stageIndex < highestRelevantStage() && stageCompletion(stageIndex);
    const signature = [locale(), stageIndex, hasScript(), hasScenePlan(), hasAssetRequests(), hasResolvedAssets(), hasComposition(), reviewingEarlier].join("|");
    if (context.dataset.signature === signature) return context;
    context.dataset.signature = signature;

    let actions = "";
    if (stageIndex === 1 && hasScript()) {
      actions = '<button class="button primary" type="button" data-automation-workspace-go="2">' + c.viewScript + ' →</button>';
    } else if (stageIndex === 2) {
      actions = '<button class="button ghost" type="button" data-automation-workspace-go="1">← ' + c.backBrief + '</button>' +
        '<button class="button primary" type="button" data-automation-workspace-go="3">' + c.continueScenes + ' →</button>';
    } else if (stageIndex === 3) {
      actions = '<button class="button ghost" type="button" data-automation-workspace-go="2">← ' + c.backScript + '</button>' +
        (hasScenePlan() ? '<button class="button primary" type="button" data-automation-workspace-go="4">' + c.continueAssets + ' →</button>' : '');
    } else if (stageIndex === 4) {
      actions = '<button class="button ghost" type="button" data-automation-workspace-go="3">← ' + c.backScenes + '</button>' +
        (hasResolvedAssets() ? '<button class="button primary" type="button" data-automation-workspace-go="5">' + c.continueTimeline + ' →</button>' : '');
    } else if (stageIndex === 5) {
      actions = '<button class="button ghost" type="button" data-automation-workspace-go="4">← ' + c.backAssets + '</button>';
    }

    context.innerHTML = '<div class="automation-step-copy"><span>' + c.step + ' ' + stageIndex + ' ' + c.of + ' 5</span><h3>' + c.titles[stageIndex - 1] + '</h3><p>' + c.desc[stageIndex - 1] + (reviewingEarlier ? ' · ' + c.reviewing : '') + '</p></div>' +
      '<div class="automation-step-actions">' + actions + '</div>';
    return context;
  }

  function decorateStages(rail) {
    const c = copy();
    const stages = Array.from(rail.querySelectorAll(".automation-stage"));
    stages.forEach((node, index) => {
      const stage = index + 1;
      const available = stageAvailable(stage);
      const completed = stageCompletion(stage);
      node.dataset.workspaceStage = String(stage);
      node.classList.toggle("workspace-active", stage === activeStage);
      node.classList.toggle("workspace-completed", completed && stage !== activeStage);
      node.classList.toggle("workspace-locked", !available);
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", available ? "0" : "-1");
      node.setAttribute("aria-disabled", available ? "false" : "true");
      if (stage === activeStage) node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");

      const small = node.querySelector("small");
      if (small) {
        const label = !available ? c.locked : stage === activeStage ? c.current : completed ? c.complete : c.ready;
        if (small.textContent !== label) small.textContent = label;
      }
    });
  }

  function visiblePanel(creator) {
    if (activeStage === 1) return creator.querySelector(".automation-brief-card");
    if (activeStage === 2) return creator.querySelector(".automation-script-card");
    if (activeStage === 3) return creator.querySelector(":scope > .automation-scenes-host");
    if (activeStage === 4) return creator.querySelector(":scope > .automation-assets-host");
    if (activeStage === 5) return creator.querySelector(":scope > .automation-composition-host");
    return null;
  }

  function applyPanelVisibility(creator) {
    const grid = creator.querySelector(":scope > .automation-grid");
    const brief = creator.querySelector(".automation-brief-card");
    const script = creator.querySelector(".automation-script-card");
    const scenes = creator.querySelector(":scope > .automation-scenes-host");
    const assets = creator.querySelector(":scope > .automation-assets-host");
    const composition = creator.querySelector(":scope > .automation-composition-host");
    const quick = creator.querySelector(":scope > .automation-scene-quick");

    if (grid instanceof HTMLElement) {
      grid.dataset.workspaceStage = String(activeStage);
      grid.hidden = activeStage >= 3;
    }
    if (brief instanceof HTMLElement) brief.hidden = activeStage !== 1;
    if (script instanceof HTMLElement) script.hidden = activeStage !== 2;
    if (scenes instanceof HTMLElement) scenes.hidden = activeStage !== 3;
    if (assets instanceof HTMLElement) assets.hidden = activeStage !== 4;
    if (composition instanceof HTMLElement) composition.hidden = activeStage !== 5;
    if (quick instanceof HTMLElement) quick.hidden = true;

    if (activeStage === 3 && !(scenes instanceof HTMLElement)) {
      try { window.ViralAutomationScenesUi?.refresh?.(); } catch {}
    }
    if (activeStage === 4 && !(assets instanceof HTMLElement)) {
      try { window.ViralAutomationAssetsUi?.refresh?.(); } catch {}
    }
    if (activeStage === 5 && !(composition instanceof HTMLElement)) {
      try { window.ViralAutomationCompositionUi?.refresh?.(); } catch {}
    }

    const panel = visiblePanel(creator);
    creator.querySelectorAll("[data-automation-stage-panel]").forEach(node => node.removeAttribute("data-automation-stage-panel"));
    if (panel instanceof HTMLElement) panel.dataset.automationStagePanel = "active";
  }

  function maybeAdvanceFromState() {
    const scriptSignature = automation()?.script?.outputSignature || null;
    const sceneSignature = automation()?.scenePlan?.outputSignature || null;
    const assetsComplete = hasResolvedAssets();

    if (lastScriptSignature === null) lastScriptSignature = scriptSignature;
    if (lastSceneSignature === null) lastSceneSignature = sceneSignature;
    if (lastAssetsComplete === null) lastAssetsComplete = assetsComplete;

    if (scriptSignature && scriptSignature !== lastScriptSignature && activeStage === 1) {
      activeStage = 2;
      manualSelection = false;
    } else if (sceneSignature && sceneSignature !== lastSceneSignature && activeStage <= 2) {
      activeStage = 3;
      manualSelection = false;
    } else if (assetsComplete && lastAssetsComplete === false && activeStage <= 4) {
      activeStage = 5;
      manualSelection = false;
    }

    lastScriptSignature = scriptSignature;
    lastSceneSignature = sceneSignature;
    lastAssetsComplete = assetsComplete;
    persistStage();
  }

  function ensureStructuralPlaceholders(creator) {
    const hero = creator.querySelector(":scope > .automation-hero");
    if (!(hero instanceof HTMLElement)) return;

    let strip = creator.querySelector(":scope > .automation-engine-strip");
    if (!(strip instanceof HTMLElement)) {
      strip = document.createElement("section");
      strip.className = "automation-engine-strip";
      strip.setAttribute("aria-label", locale() === "en" ? "Automation providers" : "Trạng thái nguồn xử lý");
      hero.insertAdjacentElement("afterend", strip);
    }

    let controller = creator.querySelector(":scope > .automation-mvp-controller");
    if (!(controller instanceof HTMLElement)) {
      controller = document.createElement("section");
      controller.className = "automation-mvp-controller automation-mvp-placeholder";
      controller.setAttribute("aria-live", "polite");
      strip.insertAdjacentElement("afterend", controller);
    }
  }

  function scan() {
    queued = false;
    if (appState()?.page !== "automation") {
      delete document.documentElement.dataset.automationWorkspace;
      return;
    }

    const creator = document.querySelector(".automation-creator");
    if (!(creator instanceof HTMLElement)) return;
    const rail = creator.querySelector(":scope > .automation-stage-rail");
    if (!(rail instanceof HTMLElement)) return;

    if (!activeStage) activeStage = initialStage();
    if (!stageAvailable(activeStage)) {
      activeStage = highestRelevantStage();
      manualSelection = false;
    }

    maybeAdvanceFromState();

    creator.classList.add("automation-workspace-v2");
    ensureStructuralPlaceholders(creator);
    decorateStages(rail);
    ensureStepContext(creator, rail);
    applyPanelVisibility(creator);
    creator.dataset.activeStage = String(activeStage);
    creator.dataset.progressStage = String(highestRelevantStage());
    document.documentElement.dataset.automationWorkspace = "guided";
  }

  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const go = target.closest("[data-automation-workspace-go]");
    if (go) {
      event.preventDefault();
      setStage(Number(go.getAttribute("data-automation-workspace-go")), { manual: true });
      return;
    }

    const stageNode = target.closest(".automation-stage[data-workspace-stage]");
    if (stageNode) {
      event.preventDefault();
      setStage(Number(stageNode.getAttribute("data-workspace-stage")), { manual: true });
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (!(event.target instanceof Element)) return;
    const stageNode = event.target.closest(".automation-stage[data-workspace-stage]");
    if (!stageNode || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    setStage(Number(stageNode.getAttribute("data-workspace-stage")), { manual: true });
  });

  window.addEventListener("viral-ai:core-state-changed", queueScan);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueScan).observe(page, { childList: true, subtree: true });
    queueScan();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationWorkspace = {
    setStage,
    refresh: queueScan,
    syncNow: scan,
    syncToProgress: () => setStage(highestRelevantStage(), { scroll: false, manual: false }),
    getActiveStage: () => activeStage,
    getProgressStage: highestRelevantStage
  };
})();