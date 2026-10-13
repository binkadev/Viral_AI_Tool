(function installScenePlanRuntimeState() {
  "use strict";

  const model = window.ViralCoreScenePlanModel;
  const persistence = window.ViralCoreProjectPersistence;
  if (!model || !persistence) return;

  function runtimeState() {
    try { return typeof state !== "undefined" && state ? state : null; }
    catch { return null; }
  }

  function hydrate() {
    const current = runtimeState();
    const snapshot = persistence.snapshot?.();
    if (!current || !snapshot) return;
    if (!current.scenePlan) current.scenePlan = model.normalizePlan(snapshot.scenePlan || {});
  }

  hydrate();

  window.addEventListener("viral-ai:project-snapshot-restored", hydrate);
  window.addEventListener("viral-ai:scene-plan-changed", () => {
    hydrate();
    persistence.schedule?.("viral-ai:scene-plan-changed");
  });
})();
