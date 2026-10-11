(function installAutomationRecovery() {
  "use strict";

  const ACTIVE_SCRIPT_STATES = new Set(["preparing", "validating", "queued", "processing", "cancelling"]);
  let runningPromise = null;
  let lastSnapshot = {
    checkedAt: null,
    recoveredScript: false,
    missingAssets: [],
    missingVoice: [],
    missingExports: [],
    changed: false
  };

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

  function persist(reason) {
    try { window.ViralCoreProjectPersistence?.schedule?.(reason); } catch {}
    try { if (typeof save === "function") save(); } catch {}
  }

  function emit(snapshot) {
    window.dispatchEvent(new CustomEvent("viral-ai:automation-recovery", { detail: clone(snapshot, {}) }));
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: "automation-recovery", recovery: clone(snapshot, {}) }
    }));
  }

  function recoverInterruptedScriptJob() {
    const current = automation();
    const job = current?.jobs?.script;
    if (!job || !ACTIVE_SCRIPT_STATES.has(String(job.status || ""))) return false;

    job.status = "failed";
    job.indeterminate = false;
    job.failureCode = "INTERRUPTED";
    job.retryable = true;
    job.interruptedAt = Date.now();
    job.completedAt = Date.now();
    return true;
  }

  async function validateExportOutputs() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    const candidates = jobs.filter(job =>
      job?.isAutomationCompositionExport === true &&
      String(job?.status || "") === "completed" &&
      Boolean(job?.outputPath)
    );
    if (!candidates.length || !window.desktopAPI?.fileStatus) return { missing: [], changed: false };

    const missing = [];
    let changed = false;
    for (const job of candidates) {
      try {
        const result = await window.desktopAPI.fileStatus(job.outputPath);
        const next = result?.exists === true ? "available" : "missing";
        if (next === "missing") missing.push(String(job.id || job.outputPath));
        if (job.fileState !== next) {
          job.fileState = next;
          changed = true;
        }
      } catch {
        // Unknown disk state is not treated as missing.
      }
    }
    return { missing, changed };
  }

  async function run({ announce = true } = {}) {
    if (runningPromise) return runningPromise;
    runningPromise = (async () => {
      const current = automation();
      if (!current) {
        lastSnapshot = {
          checkedAt: new Date().toISOString(),
          recoveredScript: false,
          missingAssets: [],
          missingVoice: [],
          missingExports: [],
          changed: false
        };
        return clone(lastSnapshot, {});
      }

      const recoveredScript = recoverInterruptedScriptJob();

      let assetHealth = { missing: [] };
      try {
        assetHealth = await window.ViralAutomationAssetState?.validateLocalAssets?.({ forceEmit: false }) || assetHealth;
      } catch {}

      let voiceHealth = { missingSceneIds: [] };
      try {
        voiceHealth = await window.ViralAutomationVoiceState?.validateLocalAudio?.({ forceEmit: false }) || voiceHealth;
      } catch {}

      const exportHealth = await validateExportOutputs();

      try { await window.ViralAutomationDesktopStockProvider?.refreshStatus?.(); } catch {}
      try { await window.ViralAutomationVoiceState?.refreshStatus?.(); } catch {}

      const missingAssets = Array.isArray(assetHealth?.missing) ? assetHealth.missing.map(String) : [];
      const missingVoice = Array.isArray(voiceHealth?.missingSceneIds) ? voiceHealth.missingSceneIds.map(String) : [];
      const missingExports = Array.isArray(exportHealth?.missing) ? exportHealth.missing.map(String) : [];
      const changed = recoveredScript || missingAssets.length > 0 || missingVoice.length > 0 || exportHealth?.changed === true;

      lastSnapshot = {
        checkedAt: new Date().toISOString(),
        recoveredScript,
        missingAssets,
        missingVoice,
        missingExports,
        changed
      };

      if (changed) persist("automation-recovery");
      if (announce) emit(lastSnapshot);
      return clone(lastSnapshot, {});
    })().finally(() => {
      runningPromise = null;
    });
    return runningPromise;
  }

  function start() {
    requestAnimationFrame(() => run({ announce: true }).catch(() => {}));
    document.documentElement.dataset.automationRecovery = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationRecovery = {
    run,
    snapshot: () => clone(lastSnapshot, {})
  };
})();