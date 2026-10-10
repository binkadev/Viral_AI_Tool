(function installAutomationVoiceState() {
  "use strict";

  const model = window.ViralAutomationVoiceModel;
  let providerStatus = null;
  let operationId = null;
  let progress = 0;
  let phase = null;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function automation() {
    return appState()?.automation || null;
  }

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", { detail: { reason } }));
    try { window.ViralCoreProjectPersistence?.schedule?.(reason); } catch {}
  }

  function currentSignature() {
    const current = automation();
    if (!current?.scenePlan) return "";
    return model?.inputSignature?.({
      brief: current.brief || {},
      scenePlan: current.scenePlan,
      voiceId: current.voiceSettings?.voiceId || "default"
    }) || "";
  }

  function currentResult() {
    const current = automation();
    const result = model?.normalizeResult?.(current?.voiceResult);
    if (!result) return null;
    return result.inputSignature && result.inputSignature === currentSignature() ? result : null;
  }

  function snapshot() {
    const current = automation();
    const result = model?.normalizeResult?.(current?.voiceResult);
    return {
      providerStatus: clone(providerStatus, null),
      operationId,
      active: Boolean(operationId),
      progress,
      phase,
      inputSignature: currentSignature(),
      result: clone(result, null),
      current: Boolean(currentResult()),
      stale: Boolean(result && !currentResult())
    };
  }

  async function refreshStatus() {
    if (!window.desktopAPI?.getAutomationVoiceStatus) {
      providerStatus = { ready: false, code: "AUTOMATION_VOICE_UNAVAILABLE" };
      emit("automation-voice-status");
      return clone(providerStatus);
    }
    try {
      providerStatus = await window.desktopAPI.getAutomationVoiceStatus();
    } catch {
      providerStatus = { ready: false, code: "AUTOMATION_VOICE_UNAVAILABLE" };
    }
    emit("automation-voice-status");
    return clone(providerStatus);
  }

  function canGenerate() {
    const current = automation();
    const scenes = Array.isArray(current?.scenePlan?.scenes) ? current.scenePlan.scenes : [];
    return Boolean(current?.scenePlan && current?.stale?.scenes !== true && scenes.length);
  }

  async function generate() {
    if (operationId) return { ok: false, code: "DUPLICATE_ACTIVE" };
    if (!canGenerate()) return { ok: false, code: "AUTOMATION_SCENE_PLAN_REQUIRED" };
    if (!providerStatus?.ready) await refreshStatus();
    if (!providerStatus?.ready) return { ok: false, code: providerStatus?.code || "AUTOMATION_VOICE_NOT_CONFIGURED" };

    const current = automation();
    const segments = model?.segmentsFromScenePlan?.(current.scenePlan) || [];
    if (!segments.length) return { ok: false, code: "AUTOMATION_VOICE_INPUT_INVALID" };
    const signature = currentSignature();
    const id = "automation-voice-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    operationId = id;
    progress = 1;
    phase = "preparing";
    emit("automation-voice-started");

    let response = null;
    try {
      response = await window.desktopAPI.startAutomationVoice({
        operationId: id,
        inputSignature: signature,
        segments
      });
    } catch {
      response = null;
    }

    if (operationId !== id) return { ok: false, code: "AUTOMATION_VOICE_INTERRUPTED" };
    operationId = null;
    progress = 0;
    phase = null;

    if (!response?.ok) {
      emit("automation-voice-failed");
      return { ok: false, code: response?.error?.code || "AUTOMATION_VOICE_FAILED", error: response?.error || null };
    }
    if (response.data?.cancelled) {
      emit("automation-voice-cancelled");
      return { ok: false, code: "AUTOMATION_VOICE_CANCELLED", cancelled: true };
    }

    const result = model?.normalizeResult?.({
      ...(response.data?.result || {}),
      inputSignature: signature
    });
    if (!result || result.inputSignature !== currentSignature()) {
      emit("automation-voice-stale-result");
      return { ok: false, code: "STALE_INPUT" };
    }

    current.voiceResult = result;
    current.voiceSettings = {
      voiceId: current.voiceSettings?.voiceId || "default",
      provider: result.provider || providerStatus?.provider || null
    };
    if (current.composition) current.stale.composition = true;
    emit("automation-voice-completed");
    return { ok: true, result: clone(result) };
  }

  async function cancel() {
    if (!operationId) return false;
    const id = operationId;
    let cancelled = false;
    try {
      const response = await window.desktopAPI?.cancelAutomationVoice?.(id);
      cancelled = response?.cancelled === true;
    } catch {}
    if (cancelled && operationId === id) {
      operationId = null;
      progress = 0;
      phase = null;
      emit("automation-voice-cancelled");
    }
    return cancelled;
  }

  window.desktopAPI?.onAutomationVoiceProgress?.(payload => {
    if (!operationId || String(payload?.operationId || "") !== operationId) return;
    progress = Math.max(progress, Number(payload?.percent || 0));
    phase = String(payload?.phase || "generating");
    emit("automation-voice-progress");
  });

  window.addEventListener("viral-ai:automation-page-rendered", () => {
    if (!providerStatus) refreshStatus();
  });

  window.ViralAutomationVoiceState = {
    refreshStatus,
    generate,
    cancel,
    canGenerate,
    currentSignature,
    currentResult,
    snapshot
  };
})();
