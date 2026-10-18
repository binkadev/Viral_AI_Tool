"use strict";
const SESSION_STATES = new Set(["browser_unavailable","browser_closed","browser_starting","browser_connected"]);
const SESSION_MESSAGES = new Set(["BROWSER_PROFILE_UNAVAILABLE","BROWSER_LAUNCH_FAILED","BROWSER_CONNECTION_FAILED"]);
function sanitizeSession(input, id) {
  return {id, state:SESSION_STATES.has(input?.state)?input.state:"browser_closed",
    browser:input?.browser === "chrome"?input.browser:null,
    checkedAt:new Date().toISOString(),
    ...(SESSION_MESSAGES.has(input?.messageCode)?{messageCode:input.messageCode}:{})};
}

module.exports = {sanitizeSession};
