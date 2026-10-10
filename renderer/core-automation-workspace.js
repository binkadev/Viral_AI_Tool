(function installAutomationWorkspace() {
  "use strict";

  const STAGE_KEY = "viral-ai-automation-workspace-stage-v1";
  let queued = false;
  let activeStage = 0;
  let lastScriptSignature = null;

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
          titles: ["Prepare the brief", "Review the script", "Build scenes", "Prepare assets", "Compose timeline"],
          desc: [
            "Enter the idea and output settings, then generate the first editable script.",
            "Review, edit and save the script before turning it into visual scenes.",
            "Create scene beats, then refine narration, visual intent and media search terms.",
            "Resolve each scene into a healthy local media asset before timeline composition begins.",
            "Build the editable Composition Plan from approved scene timings and resolved local assets."
          ],
          backBrief: "Back to brief",
          backScript: "Back to script",
          backScenes: "Back to scenes",
          backAssets: "Back to assets",
          viewScript: "Review script",
          continueScenes: "Continue to scenes",
          continueAssets: "Continue to assets",
          continueTimeline: "Continue to timeline",
          locked: "Locked",
          complete: "Done",
          current: "Current",
          ready: "Ready"
        }
      : {
          step: "Bước",
          of: "trên",
          titles: ["Chuẩn bị nội dung", "Kiểm tra kịch bản", "Tạo phân cảnh", "Chuẩn bị tư liệu", "Dựng timeline"],
          desc: [
            "Nhập ý tưởng và cấu hình đầu ra, sau đó tạo kịch bản đầu tiên có thể chỉnh sửa.",
            "Đọc lại, chỉnh sửa và lưu kịch bản trước khi chuyển sang phân cảnh.",
            "Tạo các nhịp cảnh rồi chỉnh lời đọc, ý đồ hình ảnh và từ khóa tìm tư liệu.",
            "Giải quyết từng cảnh thành file tư liệu cục bộ còn hoạt động trước khi dựng timeline.",
            "Tạo Composition Plan có thể chỉnh sửa từ timing của cảnh và các file tư liệu đã chốt."
          ],
          backBrief: "Quay lại Brief",
          backScript: "Quay lại Kịch bản",
          backScenes: "Quay lại Phân cảnh",
          backAssets: "Quay lại Tư liệu",
          viewScript: "Kiểm tra kịch bản",
          continueScenes: "Tiếp tục: Phân cảnh",
          continueAssets: "Tiếp tục: Tư liệu",
          continueTimeline: "Tiếp tục: Timeline",
          locked: "Chưa mở",
          complete: "Đã xong",
          current: "Đang làm",
          ready: "Sẵn sàng"
        };
  }

  function hasScript() {
    return Boolean(automation()?.script);
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

  function storedStage() {
    try {
      const value = Number(sessionStorage.getItem(STAGE_KEY));
      return Number.isInteger(value) ? value : 0;
    } catch { return 0; }
  }

  function persistStage() {
    try { sessionStorage.setItem(STAGE_KEY, String(activeStage)); } catch {}
  }

  function initialStage() {
    const saved = storedStage();
    if (saved >= 1 && saved <= 5 && stageAvailable(saved)) return saved;
    if (hasComposition()) return 5;
    if (hasAssetRequests()) return 4;
    if (hasScenePlan()) return 3;
    if (hasScript()) return 2;
    return 1;
  }

  function setStage(stage, { scroll = true } = {}) {
    const next = Number(stage);
    if (!stageAvailable(next)) return false;
    activeStage = next;
    persistStage();
    queueScan();
    if (scroll) {
      requestAnimationFrame(() => {
        const target = document.querySelector(".automation-step-context") || document.querySelector(".automation-stage-rail");
        try { target?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      });
    }
    return true;
  }

  function ensureStepContext(creator, rail) {
    let context = creator.querySelector(":scope > .automation-step-context");
    if (!(context instanceof HTMLElement)) {
      context = document.createElement("section");
      context.className = "automation-step-context";
      rail.insertAdjacentElement("afterend", context);
    }

    const c = copy();
    const stageIndex = Math.max(1, Math.min(5, activeStage));
    const signature = [locale(), stageIndex, hasScript(), hasScenePlan(), hasAssetRequests(), hasResolvedAssets(), hasComposition()].join("|");
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

    context.innerHTML = '<div class="automation-step-copy"><span>' + c.step + ' ' + stageIndex + ' ' + c.of + ' 5</span><h3>' + c.titles[stageIndex - 1] + '</h3><p>' + c.desc[stageIndex - 1] + '</p></div>' +
      '<div class="automation-step-actions">' + actions + '</div>';
    return context;
  }

  function decorateStages(rail) {
    const c = copy();
    const stages = Array.from(rail.querySelectorAll(".automation-stage"));
    stages.forEach((node, index) => {
      const stage = index + 1;
      const available = stageAvailable(stage);
      const completed = (stage === 1 && hasScript()) || (stage === 2 && hasScript()) || (stage === 3 && hasScenePlan()) || (stage === 4 && hasResolvedAssets()) || (stage === 5 && hasComposition());
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
    if (!stageAvailable(activeStage)) activeStage = 1;

    const scriptSignature = automation()?.script?.outputSignature || null;
    if (lastScriptSignature === null) lastScriptSignature = scriptSignature;
    else if (scriptSignature && scriptSignature !== lastScriptSignature && activeStage === 1) {
      activeStage = 2;
      persistStage();
      lastScriptSignature = scriptSignature;
    } else {
      lastScriptSignature = scriptSignature;
    }

    creator.classList.add("automation-workspace-v2");
    decorateStages(rail);
    ensureStepContext(creator, rail);
    applyPanelVisibility(creator);
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
      setStage(Number(go.getAttribute("data-automation-workspace-go")));
      return;
    }

    const stageNode = target.closest(".automation-stage[data-workspace-stage]");
    if (stageNode) {
      event.preventDefault();
      setStage(Number(stageNode.getAttribute("data-workspace-stage")));
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (!(event.target instanceof Element)) return;
    const stageNode = event.target.closest(".automation-stage[data-workspace-stage]");
    if (!stageNode || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    setStage(Number(stageNode.getAttribute("data-workspace-stage")));
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
    getActiveStage: () => activeStage
  };
})();
