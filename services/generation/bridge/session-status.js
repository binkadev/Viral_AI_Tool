"use strict";
const STATES = new Set(["extension_offline", "muse_tab_missing", "selection_required", "authentication_required", "authenticated", "unknown"]);
const instanceId = value => typeof value === "string" && /^[a-zA-Z0-9._:-]{8,160}$/.test(value);
const tabId = value => Number.isSafeInteger(value) && value > 0;
function label(value) {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 80) : "";
}
function sanitizeSession(input, id = "muse") {
  const sessions = (Array.isArray(input?.sessions) ? input.sessions : []).slice(0, 16)
    .filter(s => instanceId(s?.instanceId)).map(s => ({instanceId:s.instanceId, profileLabel:label(s.profileLabel),
      tabs:(Array.isArray(s.tabs) ? s.tabs : []).slice(0, 20).filter(t => tabId(t?.tabId))
        .map(t => ({tabId:t.tabId, authState:["authenticated","authentication_required"].includes(t.authState) ? t.authState : "unknown"}))}));
  return {id, state:STATES.has(input?.state) ? input.state : "extension_offline", sessions,
    selectedInstanceId:instanceId(input?.selectedInstanceId) ? input.selectedInstanceId : null,
    selectedTabId:tabId(input?.selectedTabId) ? input.selectedTabId : null,
    checkedAt:new Date().toISOString()};
}
module.exports = {sanitizeSession, instanceId, tabId, label};
