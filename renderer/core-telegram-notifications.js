(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralTelegramNotifications = api;
  if (typeof window !== "undefined" && window.ViralBatchProduction && window.desktopAPI?.notifyTelegram) {
    api.observer = api.create({model:window.ViralTelegramNotificationsModel, read:() => window.ViralBatchProduction.runtime.view().batch,
      projects:() => window.ViralCoreProjectPersistence.listProjects(), locale:() => state.locale === "en" ? "en" : "vi",
      notify:intent => window.desktopAPI.notifyTelegram(intent)});
    window.addEventListener("viral-ai:batch-production-changed", api.observer.observe);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  function create({model, read, projects, locale, notify}) {
    let previous = null, established = false;
    // Bootstrap is observation only, including a restart-normalized interrupted
    // Batch. No historical production events are sent by attaching this observer.
    try {previous = model.snapshot(read()); established = true;} catch {}
    function observe() {
      try {
        const current = model.snapshot(read());
        if (!established) {previous = current; established = true; return;}
        const intents = model.transitions(previous, current, {projects:projects(), locale:locale()});
        previous = current; // Advance before scheduling any fallible transport.
        for (const intent of intents) Promise.resolve().then(() => notify(intent)).catch(() => {});
      } catch {} // Notification observation never changes production authority.
    }
    return {observe};
  }
  return {create};
});
