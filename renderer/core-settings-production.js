(function installCoreProductionSettings() {
  "use strict";

  function install() {
    try {
      if (typeof pages === "undefined" || !pages || typeof pages.settings !== "function") return false;
      if (pages.settings.__coreProductionSettings === true) return true;

      const legacy = pages.settings;
      const production = function coreProductionSettingsPage() {
        let html = String(legacy() || "");

        // Legacy switches are visual-only placeholders with no persisted state or handler.
        html = html.replace(/<div class="setting-row">[\s\S]*?<div class="switch [^"]*"><\/div><\/div>/g, "");

        // The legacy 1080p/4K selector is not connected to render configuration.
        html = html.replace(/<div style="margin-top:14px"><label class="label">[\s\S]*?<select class="select"><option>1080p<\/option><option>4K<\/option><\/select><\/div>/g, "");

        return html;
      };

      production.__coreProductionSettings = true;
      pages.settings = production;
      if (state?.page === "settings" && typeof render === "function") render();
      document.documentElement.dataset.coreProductionSettings = "enabled";
      return true;
    } catch {
      return false;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
  else install();
})();
