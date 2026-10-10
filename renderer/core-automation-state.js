(function installAutomationStateBridge() {
  "use strict";

  const model = window.ViralAutomationModel;
  if (!model) return;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function persistedAutomation() {
    try {
      const snapshot = window.ViralCoreProjectPersistence?.snapshot?.();
      if (snapshot?.automation) return model.normalizeAutomationState(snapshot.automation);
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      if (saved?.automation) return model.normalizeAutomationState(saved.automation);
    } catch {}
    return null;
  }

  function hydrate() {
    const current = appState();
    if (!current) return null;
    if (!current.automation) current.automation = persistedAutomation();
    else current.automation = model.normalizeAutomationState(current.automation);
    return current.automation;
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
      detail: { reason: String(reason || "automation-change") }
    }));
    try { window.ViralCoreProjectPersistence?.schedule?.(String(reason || "automation-change")); } catch {}
  }

  function setBrief(input, options = {}) {
    const current = appState();
    if (!current) {
      return {
        ok: false,
        value: null,
        errors: [{ code: "AUTOMATION_STATE_UNAVAILABLE", field: null, message: "Project state is unavailable." }]
      };
    }
    hydrate();
    const result = model.withContentBrief(current.automation, input, options);
    if (!result.ok) return result;
    current.automation = result.automation;
    emit("automation-brief-updated");
    return result;
  }

  function snapshot() {
    const current = appState();
    hydrate();
    return model.normalizeAutomationState(current?.automation);
  }

  function clear() {
    const current = appState();
    if (!current) return false;
    current.automation = null;
    emit("automation-cleared");
    return true;
  }

  window.ViralAutomationState = {
    hydrate,
    snapshot,
    setBrief,
    clear
  };

  const start = () => {
    hydrate();
    document.documentElement.dataset.automationFoundation = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
