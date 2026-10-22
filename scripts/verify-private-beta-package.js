"use strict";
// Build-time validation only; no application data or provider is opened.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const asar = require("@electron/asar");
function verify(archive) {
  const read = name => asar.extractFile(archive, path.normalize(name));
  const pkg = JSON.parse(read("package.json"));
  const info = JSON.parse(read("release-info.json"));
  const files = asar.listPackage(archive).map(name => name.replaceAll("\\", "/").replace(/^\//, ""));
  const has = name => files.includes(name);
  for (const name of [pkg.main, "main.js", "preload.js", "renderer/index.html", "renderer/i18n.js",
    "renderer/core-media-assembly-model.js", "renderer/core-project-media-assembly.js", "renderer/core-project-persistence.js", "assets/icon.ico"]) assert(has(name), "Missing packaged runtime: " + name);
  assert(!files.some(name => /^(?:dev|dev-backend|tests|\.git)\//.test(name)), "Development files must not ship");
  const html = read("renderer/index.html").toString("utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)) {
    assert(has("renderer/" + match[1]), "Missing renderer asset: " + match[1]);
  }
  let imports = 0;
  for (const name of files.filter(name => /^(?:services|renderer)\/.*\.js$/.test(name) || [pkg.main, "main.js", "preload.js"].includes(name))) {
    const source = read(name).toString("utf8");
    for (const match of source.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      // The existing startup harness is explicitly guarded by !app.isPackaged.
      if ((name === pkg.main || name === "main.js") && match[1].startsWith("./dev/")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      assert([target, target + ".js", target + ".json", target + "/index.js"].some(has), "Unresolved packaged import: " + name + " -> " + match[1]);
      imports++;
    }
  }
  const unpacked = archive + ".unpacked";
  for (const name of ["node_modules/ffmpeg-static/ffmpeg.exe", "node_modules/sherpa-onnx-win-x64/sherpa-onnx.node",
    "node_modules/sherpa-onnx-win-x64/onnxruntime.dll", "node_modules/sherpa-onnx-win-x64/onnxruntime_providers_shared.dll",
    "node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll", "node_modules/sherpa-onnx-win-x64/sherpa-onnx-cxx-api.dll", "services/speech/local-worker.js"]) {
    const file = path.join(unpacked, name);
    assert(fs.statSync(file).isFile(), "Missing unpacked helper: " + name);
    if (!name.endsWith(".js")) assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), "MZ", name);
  }
  if (info.source === "private-beta") {
    assert.match(pkg.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
    assert.equal(info.channel, "preview");
    assert.equal(info.updateManifestUrl, null);
    assert.equal(info.releasePageUrl, null);
  }
  return { version: pkg.version, channel: info.channel, relativeImports: imports, rendererAssets: "complete", nativeHelpers: "present" };
}
module.exports = { verify };
if (require.main === module) console.log(JSON.stringify(verify(process.argv[2] || path.join(__dirname, "../release/win-unpacked/resources/app.asar"))));
