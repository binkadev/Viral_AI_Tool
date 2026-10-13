(function installCoreScenePlanStateBridge() {
  "use strict";

  const model = window.ViralCoreScenePlanModel;
  if (!model) return;

  let lastStale = null;

  function appState() {
    try {
      return typeof state !== "undefined" && state ? state : null;
    } catch {
      return null;
    }
  }

  function currentTranscript(current) {
    const result = current?.speech?.result;
    if (!result || !Array.isArray(result.segments)) return null;
    return result;
  }

  function evaluate(reason = "state-change") {
    const current = appState();
    const plan = current?.scenePlan;
    const transcript = currentTranscript(current);
    const hasAcceptedPlan = Boolean(plan && Array.isArray(plan.scenes) && plan.scenes.length && plan.sourceSignature);
    const stale = Boolean(hasAcceptedPlan && transcript && model.isStale(plan, transcript));

    if (lastStale === stale && reason !== "snapshot-restored") return stale;
    lastStale = stale;

    window.dispatchEvent(new CustomEvent("viral-ai:scene-plan-staleness-changed", {
      detail: {
        stale,
        reason,
        sourceIdentity: plan?.sourceIdentity || null,
        sourceSignature: plan?.sourceSignature || null
      }
    }));
    return stale;
  }

  window.addEventListener("viral-ai:core-state-changed", event => {
    evaluate(event?.detail?.reason || "core-state-changed");
  });
  window.addEventListener("viral-ai:project-snapshot-restored", () => evaluate("snapshot-restored"));
  window.addEventListener("viral-ai:transcript-workstation-ready", () => evaluate("transcript-ready"));

  window.ViralCoreScenePlanState = {
    isStale() {
      const current = appState();
      const transcript = currentTranscript(current);
      return Boolean(current?.scenePlan && transcript && model.isStale(current.scenePlan, transcript));
    },
    evaluate
  };
})();
