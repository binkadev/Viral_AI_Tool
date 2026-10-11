(function installAutomationMvpController() {
  "use strict";

  let queued = false;
  let running = false;
  let runningKind = null;
  let assetAbort = null;
  let assetProgress = null;
  let voiceStatusRefreshing = false;

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
          eyebrow: "Automation MVP",
          ready: "ready",
          next: "Next",
          working: "Working",
          cancel: "Stop",
          script: "Create the editable script",
          scenes: "Build the scene plan",
          assetsPrepare: "Prepare media requests",
          assetsResolve: "Resolve scene media",
          voice: "Create narration voice",
          composition: "Build the editable timeline",
          studio: "Open the result in Studio",
          continue: "Continue",
          openStudio: "Open Studio",
          complete: "Editable composition ready",
          completeBody: "The Automation result is ready for Studio review and manual editing.",
          failed: "This step could not be completed. Your accepted work was kept.",
          cancelled: "Automation step stopped. You can continue from the same checkpoint.",
          assetsProgress: "Resolving media"
        }
      : {
          eyebrow: "Automation MVP",
          ready: "sẵn sàng",
          next: "Tiếp theo",
          working: "Đang xử lý",
          cancel: "Dừng",
          script: "Tạo kịch bản có thể chỉnh sửa",
          scenes: "Tạo kế hoạch phân cảnh",
          assetsPrepare: "Chuẩn bị yêu cầu tư liệu",
          assetsResolve: "Tìm tư liệu cho các cảnh",
          voice: "Tạo giọng đọc narration",
          composition: "Dựng timeline có thể chỉnh sửa",
          studio: "Mở kết quả trong Studio",
          continue: "Tiếp tục",
          openStudio: "Mở Studio",
          complete: "Composition có thể chỉnh sửa đã sẵn sàng",
          completeBody: "Kết quả Automation đã sẵn sàng để kiểm tra và chỉnh tay trong Studio.",
          failed: "Bước này chưa hoàn tất. Các phần đã chấp nhận vẫn được giữ nguyên.",
          cancelled: "Đã dừng bước Automation. Bạn có thể tiếp tục từ đúng checkpoint hiện tại.",
          assetsProgress: "Đang tìm tư liệu"
        };
  }

  function sceneReady(current) {
    return Boolean(current?.scenePlan) && current?.stale?.scenes !== true;
  }

  function assetSnapshot() {
    return window.ViralAutomationAssetState?.snapshot?.() || {
      requests: [],
      assets: [],
      stale: [],
      completion: { total: 0, resolved: 0, missing: 0, complete: false }
    };
  }

  function voiceSnapshot() {
    return window.ViralAutomationVoiceState?.snapshot?.() || {
      providerStatus: null,
      active: false,
      current: false,
      stale: false,
      result: null
    };
  }

  function compositionReady(current) {
    return Boolean(current?.composition) && current?.stale?.composition !== true && window.ViralAutomationCompositionState?.isCurrent?.() === true;
  }

  function inspect() {
    const current = automation();
    const assets = assetSnapshot();
    const voice = voiceSnapshot();
    const briefReady = Boolean(current?.brief);
    const scriptReady = Boolean(current?.script) && current?.stale?.script !== true;
    const scenesReady = scriptReady && sceneReady(current);
    const requestsReady = scenesReady && Array.isArray(assets.requests) && assets.requests.length > 0;
    const assetsReady = requestsReady && assets.completion?.complete === true;
    const voiceReady = voice.current === true;
    const composition = assetsReady && compositionReady(current);

    let next = { kind: "script", stage: 1, label: copy().script };
    if (scriptReady && !scenesReady) next = { kind: "scenes", stage: 3, label: copy().scenes };
    else if (scenesReady && !requestsReady) next = { kind: "assets-sync", stage: 4, label: copy().assetsPrepare };
    else if (requestsReady && !assetsReady) next = { kind: "assets-resolve", stage: 4, label: copy().assetsResolve };
    else if (assetsReady && voice.providerStatus?.ready === true && !voiceReady) next = { kind: "voice", stage: 5, label: copy().voice };
    else if (assetsReady && !composition) next = { kind: "composition", stage: 5, label: copy().composition };
    else if (composition) next = { kind: "studio", stage: 5, label: copy().studio };

    const milestones = [briefReady, scriptReady, scenesReady, assetsReady, composition];
    return {
      briefReady,
      scriptReady,
      scenesReady,
      requestsReady,
      assetsReady,
      voiceReady,
      compositionReady: composition,
      voice,
      assets,
      milestones,
      completed: milestones.filter(Boolean).length,
      next
    };
  }

  function ensureVoiceStatus(view) {
    if (!view.scenesReady || view.voice.providerStatus || voiceStatusRefreshing) return;
    voiceStatusRefreshing = true;
    Promise.resolve(window.ViralAutomationVoiceState?.refreshStatus?.())
      .catch(() => null)
      .finally(() => {
        voiceStatusRefreshing = false;
        queue();
      });
  }

  function ensureHost() {
    const creator = document.querySelector(".automation-creator.automation-workspace-v2");
    if (!(creator instanceof HTMLElement)) return null;
    let host = creator.querySelector(":scope > .automation-mvp-controller");
    if (host instanceof HTMLElement) return host;
    host = document.createElement("section");
    host.className = "automation-mvp-controller";
    host.setAttribute("aria-live", "polite");
    const hero = creator.querySelector(":scope > .automation-hero");
    if (hero instanceof HTMLElement) hero.insertAdjacentElement("afterend", host);
    else creator.prepend(host);
    return host;
  }

  function render() {
    if (appState()?.page !== "automation") return;
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    const c = copy();
    const view = inspect();
    ensureVoiceStatus(view);

    host.classList.toggle("is-running", running);
    host.classList.toggle("is-complete", view.compositionReady && !running);

    const progressText = assetProgress && runningKind === "assets-resolve"
      ? `${c.assetsProgress} ${Number(assetProgress.completed || 0)}/${Number(assetProgress.total || view.assets.completion?.total || 0)}`
      : running
        ? `${c.working}: ${view.next.label}`
        : view.compositionReady
          ? c.completeBody
          : `${c.next}: ${view.next.label}`;

    const title = running
      ? `${c.working}: ${view.next.label}`
      : view.compositionReady
        ? c.complete
        : `${view.completed}/5 ${c.ready}`;

    host.replaceChildren();

    const copyWrap = document.createElement("div");
    copyWrap.className = "automation-mvp-copy";
    const mark = document.createElement("div");
    mark.className = "automation-mvp-mark";
    mark.textContent = view.compositionReady ? "✓" : "✦";
    const copyBody = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = c.eyebrow;
    const strong = document.createElement("strong");
    strong.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = progressText;
    copyBody.append(eyebrow, strong, paragraph);
    copyWrap.append(mark, copyBody);

    const actions = document.createElement("div");
    actions.className = "automation-mvp-actions";
    const progress = document.createElement("div");
    progress.className = "automation-mvp-progress";
    progress.setAttribute("aria-label", `${view.completed}/5 ${c.ready}`);
    view.milestones.forEach((ready, index) => {
      const item = document.createElement("i");
      if (ready) item.classList.add("is-ready");
      else if (index === view.completed) item.classList.add("is-current");
      progress.appendChild(item);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button " + (running ? "ghost" : "primary");
    button.setAttribute("data-automation-mvp-action", running ? "cancel" : "continue");
    button.textContent = running ? c.cancel : (view.next.kind === "studio" ? c.openStudio : c.continue + ": " + view.next.label);
    actions.append(progress, button);
    host.append(copyWrap, actions);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (appState()?.page === "automation") render();
    });
  }

  function notify(message) {
    try { if (typeof toast === "function") toast(message); } catch {}
  }

  function goStage(stage) {
    try { window.ViralAutomationWorkspace?.setStage?.(stage, { scroll: false }); } catch {}
  }

  async function resolveAssets() {
    assetAbort = new AbortController();
    const result = await window.ViralAutomationAssetState?.resolveAll?.({
      signal: assetAbort.signal,
      onProgress: progress => {
        assetProgress = progress || null;
        queue();
      }
    });
    assetProgress = null;
    assetAbort = null;
    await window.ViralAutomationAssetState?.validateLocalAssets?.({ forceEmit: true });
    try { await window.ViralAutomationDesktopStockProvider?.refreshStatus?.(); } catch {}
    return result;
  }

  async function runNext() {
    if (running) return;
    const before = inspect();
    const action = before.next;
    running = true;
    runningKind = action.kind;
    goStage(action.stage);
    render();

    let result = null;
    try {
      if (action.kind === "script") {
        await window.ViralAutomationCreator?.generateScript?.();
        result = inspect().scriptReady ? { ok: true } : { ok: false };
      } else if (action.kind === "scenes") {
        result = window.ViralAutomationSceneState?.generatePlan?.() || { ok: false };
      } else if (action.kind === "assets-sync") {
        result = window.ViralAutomationAssetState?.syncRequests?.() || { ok: false };
      } else if (action.kind === "assets-resolve") {
        result = await resolveAssets();
      } else if (action.kind === "voice") {
        result = await window.ViralAutomationVoiceState?.generate?.();
      } else if (action.kind === "composition") {
        result = window.ViralAutomationCompositionState?.compose?.() || { ok: false };
      } else if (action.kind === "studio") {
        await window.ViralAutomationStudioProjection?.openStudio?.();
        result = { ok: appState()?.page === "ai-video" };
      }
    } catch {
      result = { ok: false };
    } finally {
      running = false;
      runningKind = null;
      assetAbort = null;
      assetProgress = null;
      if (appState()?.page === "automation") {
        if (result?.code === "CANCELLED" || result?.cancelled === true) notify(copy().cancelled);
        else if (result && result.ok === false) notify(copy().failed);
        queue();
      }
    }
  }

  async function cancel() {
    if (!running) return;
    if (runningKind === "script") {
      await window.ViralAutomationCreator?.stopGeneration?.();
      return;
    }
    if (runningKind === "assets-resolve") {
      try { assetAbort?.abort(); } catch {}
      return;
    }
    if (runningKind === "voice") {
      await window.ViralAutomationVoiceState?.cancel?.();
      return;
    }
    if (runningKind === "studio") {
      await window.ViralAutomationStudioProjection?.openStudio?.();
    }
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("[data-automation-mvp-action]") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.getAttribute("data-automation-mvp-action") === "cancel") cancel();
    else runNext();
  }, true);

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationMvpController = {
    inspect,
    runNext,
    cancel,
    refresh: queue,
    isRunning: () => running
  };
})();
