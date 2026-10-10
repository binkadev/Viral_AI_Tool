(function installAutomationScriptState() {
  "use strict";

  function currentState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function clone(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: String(reason || "automation-script-change") }
    }));
    try { window.ViralCoreProjectPersistence?.schedule?.(String(reason || "automation-script-change")); } catch {}
  }

  function normalizeScriptDocument(input) {
    if (!input || typeof input !== "object") return null;
    const narrationText = String(input.narrationText || "").trim();
    if (!narrationText) return null;
    return {
      version: Number(input.version || 1),
      id: String(input.id || "").trim() || null,
      briefId: input.briefId ? String(input.briefId) : null,
      title: String(input.title || "").trim(),
      hook: String(input.hook || "").trim(),
      body: String(input.body || "").trim(),
      callToAction: String(input.callToAction || "").trim(),
      narrationText,
      sourceProvider: String(input.sourceProvider || "unknown").trim() || "unknown",
      model: String(input.model || "unknown").trim() || "unknown",
      inputSignature: String(input.inputSignature || "").trim(),
      outputSignature: String(input.outputSignature || "").trim(),
      meta: clone(input.meta, null),
      createdAt: input.createdAt ? String(input.createdAt) : null,
      updatedAt: input.updatedAt ? String(input.updatedAt) : null
    };
  }

  function acceptScript(input) {
    const current = currentState();
    if (!current) return { ok: false, code: "AUTOMATION_STATE_UNAVAILABLE" };

    if (!current.automation) {
      current.automation = window.ViralAutomationModel?.emptyAutomationState?.() || null;
    }
    if (!current.automation?.brief) {
      return { ok: false, code: "AUTOMATION_BRIEF_REQUIRED" };
    }

    const script = normalizeScriptDocument(input);
    if (!script) return { ok: false, code: "AUTOMATION_SCRIPT_RESULT_INVALID" };

    const expectedSignature = String(current.automation.brief.inputSignature || "");
    if (!script.inputSignature || script.inputSignature !== expectedSignature) {
      return { ok: false, code: "STALE_INPUT" };
    }

    const previousOutputSignature = current.automation.script?.outputSignature || null;
    current.automation.script = script;
    current.automation.stale.script = false;

    if (previousOutputSignature && previousOutputSignature !== script.outputSignature) {
      current.automation.stale.scenes = Boolean(current.automation.scenePlan);
      current.automation.stale.assets = (current.automation.resolvedAssets || [])
        .map(asset => String(asset?.id || asset?.requestId || ""))
        .filter(Boolean);
      current.automation.stale.composition = Boolean(current.automation.composition);
    }

    emit("automation-script-accepted");
    return { ok: true, script: clone(script, script) };
  }

  function setJob(job) {
    const current = currentState();
    if (!current?.automation) return false;
    if (!current.automation.jobs || typeof current.automation.jobs !== "object") current.automation.jobs = {};
    current.automation.jobs.script = clone(job, null);
    emit("automation-script-job-updated");
    return true;
  }

  function snapshot() {
    const current = currentState();
    return {
      script: clone(current?.automation?.script, null),
      job: clone(current?.automation?.jobs?.script, null),
      stale: current?.automation?.stale?.script === true
    };
  }

  window.ViralAutomationScriptState = {
    normalizeScriptDocument,
    acceptScript,
    setJob,
    snapshot
  };
})();
