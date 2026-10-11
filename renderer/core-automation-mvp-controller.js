(function installAutomationMvpController() {
  "use strict";

  let queued = false;
  let running = false;
  let runningKind = null;
  let runningLabel = "";
  let assetAbort = null;
  let assetProgress = null;
  let voiceStatusRefreshing = false;
  let lastFailure = null;

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
          retry: "Retry",
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
          failureNetwork: "The provider could not be reached. Check the connection and retry this step.",
          failureProvider: "The required provider is not configured or needs authentication.",
          failureQuota: "The provider is temporarily unavailable because of a usage or rate limit.",
          failureNoResults: "No suitable media was found. Adjust the scene search terms or retry.",
          failureInterrupted: "The previous run was interrupted. Nothing accepted was deleted; retry from this checkpoint.",
          cancelled: "Automation step stopped. You can continue from the same checkpoint.",
          assetsProgress: "Resolving media",
          recovered: "Previous session recovered",
          recoveredScript: "an interrupted script step can be retried",
          missingAssets: "media files need recovery",
          missingVoice: "voice files need recovery",
          missingExports: "an older export is missing and can be rendered again"
        }
      : {
          eyebrow: "Automation MVP",
          ready: "sẵn sàng",
          next: "Tiếp theo",
          working: "Đang xử lý",
          cancel: "Dừng",
          retry: "Thử lại",
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
          failureNetwork: "Không kết nối được nguồn xử lý. Hãy kiểm tra mạng rồi thử lại đúng bước này.",
          failureProvider: "Nguồn xử lý cần thiết chưa được cấu hình hoặc cần xác thực lại.",
          failureQuota: "Nguồn xử lý đang tạm giới hạn lượt dùng. Bạn có thể thử lại sau mà không mất dữ liệu.",
          failureNoResults: "Chưa tìm được tư liệu phù hợp. Hãy chỉnh từ khóa của cảnh hoặc thử lại.",
          failureInterrupted: "Lần chạy trước bị gián đoạn. Phần đã chấp nhận vẫn được giữ và có thể tiếp tục từ checkpoint này.",
          cancelled: "Đã dừng bước Automation. Bạn có thể tiếp tục từ đúng checkpoint hiện tại.",
          assetsProgress: "Đang tìm tư liệu",
          recovered: "Đã khôi phục phiên trước",
          recoveredScript: "bước tạo kịch bản bị gián đoạn có thể chạy lại",
          missingAssets: "tệp tư liệu cần khôi phục",
          missingVoice: "tệp giọng đọc cần khôi phục",
          missingExports: "video xuất cũ bị thiếu và có thể xuất lại"
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
      result: null,
      missingSceneIds: []
    };
  }

  function recoverySnapshot() {
    return window.ViralAutomationRecovery?.snapshot?.() || {
      checkedAt: null,
      recoveredScript: false,
      missingAssets: [],
      missingVoice: [],
      missingExports: [],
      changed: false
    };
  }

  function recoveryMessage(c) {
    const recovery = recoverySnapshot();
    if (!recovery?.checkedAt || recovery?.changed !== true) return "";
    const details = [];
    if (recovery.recoveredScript) details.push(c.recoveredScript);
    if (Array.isArray(recovery.missingAssets) && recovery.missingAssets.length) details.push(`${recovery.missingAssets.length} ${c.missingAssets}`);
    if (Array.isArray(recovery.missingVoice) && recovery.missingVoice.length) details.push(`${recovery.missingVoice.length} ${c.missingVoice}`);
    if (Array.isArray(recovery.missingExports) && recovery.missingExports.length) details.push(c.missingExports);
    return details.length ? `${c.recovered}: ${details.join(" · ")}` : "";
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
    const voiceReady = voice.current === true && !(Array.isArray(voice.missingSceneIds) && voice.missingSceneIds.length);
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

  function failureCode(result, action) {
    if (result?.code) return String(result.code);
    const failure = Array.isArray(result?.failures) ? result.failures.find(item => item?.code) : null;
    if (failure?.code) return String(failure.code);
    if (action?.kind === "script") return String(automation()?.jobs?.script?.failureCode || "AUTOMATION_SCRIPT_FAILED");
    return "AUTOMATION_STEP_FAILED";
  }

  function failureMessage(result, action) {
    const c = copy();
    const code = failureCode(result, action);
    if (["NETWORK_ERROR", "PROVIDER_TIMEOUT", "AUTOMATION_SCRIPT_NETWORK"].includes(code)) return c.failureNetwork;
    if (["PROVIDER_NOT_CONFIGURED", "AUTH_REQUIRED", "AUTOMATION_VOICE_NOT_CONFIGURED", "AUTOMATION_VOICE_UNAVAILABLE"].includes(code)) return c.failureProvider;
    if (["RATE_LIMITED", "QUOTA_EXCEEDED"].includes(code)) return c.failureQuota;
    if (code === "NO_RESULTS") return c.failureNoResults;
    if (["INTERRUPTED", "AUTOMATION_VOICE_INTERRUPTED"].includes(code)) return c.failureInterrupted;
    return c.failed;
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
    host.classList.toggle("is-failed", Boolean(lastFailure) && !running);

    const baseProgressText = assetProgress && runningKind === "assets-resolve"
      ? `${c.assetsProgress} ${Number(assetProgress.completed || 0)}/${Number(assetProgress.total || view.assets.completion?.total || 0)}`
      : running
        ? `${c.working}: ${runningLabel || view.next.label}`
        : lastFailure
          ? lastFailure.message
          : view.compositionReady
            ? c.completeBody
            : `${c.next}: ${view.next.label}`;
    const recoveredText = recoveryMessage(c);
    const progressText = recoveredText && !running && !lastFailure ? `${baseProgressText} · ${recoveredText}` : baseProgressText;

    const title = running
      ? `${c.working}: ${runningLabel || view.next.label}`
      : lastFailure
        ? `${c.retry}: ${lastFailure.label}`
        : view.compositionReady
          ? c.complete
          : `${view.completed}/5 ${c.ready}`;

    host.replaceChildren();

    const copyWrap = document.createElement("div");
    copyWrap.className = "automation-mvp-copy";
    const mark = document.createElement("div");
    mark.className = "automation-mvp-mark";
    mark.textContent = view.compositionReady ? "✓" : lastFailure ? "!" : "✦";
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
    const retryingSameStep = lastFailure && lastFailure.kind === view.next.kind;
    button.textContent = running
      ? c.cancel
      : view.next.kind === "studio"
        ? c.openStudio
        : `${retryingSameStep ? c.retry : c.continue}: ${view.next.label}`;
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
    lastFailure = null;
    running = true;
    let before = inspect();
    let action = before.next;
    runningKind = action.kind;
    runningLabel = action.label;
    goStage(action.stage);
    render();

    let result = null;
    try {
      if (before.assetsReady && !before.voice.providerStatus) {
        try { await window.ViralAutomationVoiceState?.refreshStatus?.(); } catch {}
        before = inspect();
        action = before.next;
        runningKind = action.kind;
        runningLabel = action.label;
        goStage(action.stage);
        render();
      }

      if (action.kind === "script") {
        await window.ViralAutomationCreator?.generateScript?.();
        result = inspect().scriptReady
          ? { ok: true }
          : { ok: false, code: automation()?.jobs?.script?.failureCode || "AUTOMATION_SCRIPT_FAILED" };
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
    } catch (error) {
      result = { ok: false, code: String(error?.code || "AUTOMATION_STEP_FAILED") };
    } finally {
      running = false;
      runningKind = null;
      runningLabel = "";
      assetAbort = null;
      assetProgress = null;
      if (appState()?.page === "automation") {
        if (result?.code === "CANCELLED" || result?.cancelled === true) {
          lastFailure = null;
          notify(copy().cancelled);
        } else if (result && result.ok === false) {
          lastFailure = {
            kind: action.kind,
            label: action.label,
            code: failureCode(result, action),
            message: failureMessage(result, action)
          };
          notify(lastFailure.message);
        } else {
          lastFailure = null;
        }
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
  window.addEventListener("viral-ai:automation-recovery", queue);

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