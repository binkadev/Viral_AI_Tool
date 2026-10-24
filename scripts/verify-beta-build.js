"use strict";
// Captures the actual packager identity; builder strips build config from ASAR
// and does not write effective-config in CI/non-TTY sessions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
module.exports = async context => {
  await require("./verify-muse-package")(context);
  const app = context.packager.appInfo;
  assert.equal(app.id, "com.viralai.tool"); assert.equal(app.productName, "Viral AI Tool");
  assert.equal(context.arch, require("builder-util").Arch.x64);
  require("./beta-release").parseTag("v" + app.version);
  fs.writeFileSync(path.join(path.dirname(context.appOutDir), "beta-build-identity.json"), JSON.stringify({ appId: app.id, productName: app.productName, version: app.version, arch: "x64" }, null, 2));
};
