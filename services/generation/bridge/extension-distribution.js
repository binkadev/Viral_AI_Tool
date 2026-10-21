"use strict";
const defaults = require("./extension-distribution.json");
const version = value => typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.length < 40;
function configuration(input = defaults) {
  const c = {...defaults, ...input};
  if (!["production", "development", "support"].includes(c.distributionMode) || !version(c.expectedExtensionVersion) || !Number.isSafeInteger(c.protocolVersion) || c.protocolVersion < 1) throw Error("Invalid distribution configuration");
  const buildVersion=c.expectedExtensionVersion.replaceAll('.', '-');
  if(c.expectedWorkerBuild!==`muse-worker-v${buildVersion}-contract3-receipt2-baselinewindow1` || c.expectedContentBuild!==`muse-content-v${buildVersion}-contract3-receipt2-baselinewindow1`)throw Error("Invalid expected build identity");
  const id = c.chromeWebStoreExtensionId;
  if (id && !/^[a-p]{32}$/.test(id)) throw Error("Invalid extension identity");
  let storeConfigured = false;
  if (c.chromeWebStoreUrl) {
    const u = new URL(c.chromeWebStoreUrl);
    storeConfigured = Boolean(id && u.origin === "https://chromewebstore.google.com" && !u.username && !u.password && !u.search && !u.hash && (u.pathname === "/detail/"+id || new RegExp("^/detail/[a-z0-9-]+/"+id+"$").test(u.pathname)));
    if (!storeConfigured) throw Error("Invalid store URL");
  }
  return Object.freeze({...c, storeConfigured});
}
function compatibility(extensionVersion, protocolVersion, config) {
  // Released 0.1.0 and 0.2.0 predate the explicit field and implement protocol 1.
  const protocol = protocolVersion === undefined && ["0.1.0", "0.2.0"].includes(extensionVersion) ? 1 : protocolVersion;
  if (!version(extensionVersion) || !Number.isSafeInteger(protocol) || protocol < 1 || protocol > config.protocolVersion) return "extension_error";
  if (protocol < config.protocolVersion) return "extension_update_required";
  const actual = extensionVersion.split(".").map(Number), expected = config.expectedExtensionVersion.split(".").map(Number);
  for (let i=0;i<3;i++) {if(actual[i]<expected[i])return "extension_outdated";if(actual[i]>expected[i])break;}
  return "extension_connected";
}
module.exports = {configuration, compatibility};
