(function(root) {
  "use strict";
  const primary = new Set(["home", "ai-create", "generation-progress", "library", "settings"]);
  const hidden = new Set(["accounts", "usage", "billing"]);
  function route(page, { source = false, contextualImport = false } = {}) {
    if (hidden.has(page)) return page === "usage" || page === "billing" ? "settings" : "home";
    if (page === "ai-video" && !source || page === "download" && !contextualImport) return "home";
    return page;
  }
  function notificationSession() {
    const seen = new Set();
    return state => {
      if (state?.status !== "available" || !state.availableVersion || seen.has(state.availableVersion)) return false;
      seen.add(state.availableVersion); return true;
    };
  }
  const api = { primary, route, notificationSession };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ViralPrivateBetaModel = api;
})(typeof window === "object" ? window : globalThis);
