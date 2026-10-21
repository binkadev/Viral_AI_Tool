"use strict";
const path = require("node:path");
const fs = require("node:fs");
// Build-time dependency already supplied by electron-builder; never used at runtime.
const asar = require("@electron/asar");
function verify(archive) {
  const root = "extensions/meta-muse-bridge/";
  for (const name of ["manifest.json", "acceptance-replay.js", "receipt-v2.js", "service-worker.js", "content-script.js", "popup.html", "popup.js", "popup.css", "strings.js"]) {
    const shipped = asar.extractFile(archive, path.normalize(root + name));
    if (!shipped.equals(fs.readFileSync(path.join(__dirname, "..", root, name)))) throw Error("Missing or stale packaged Muse extension: " + name);
  }
  const config = JSON.parse(asar.extractFile(archive, path.normalize("services/generation/bridge/extension-distribution.json")));
  const manifest = JSON.parse(asar.extractFile(archive, path.normalize(root + "manifest.json")));
  if (manifest.version_name !== undefined) throw Error("Packaged Muse extension must not enable development diagnostics");
  if (config.expectedExtensionVersion !== manifest.version) throw Error("Muse version contract mismatch");
}
module.exports = async context => verify(path.join(context.appOutDir, "resources", "app.asar"));
module.exports.verify = verify;
if (require.main === module) {verify(process.argv[2] || path.join(__dirname, "../release/win-unpacked/resources/app.asar"));process.stdout.write("Packaged Muse extension verified\n");}
