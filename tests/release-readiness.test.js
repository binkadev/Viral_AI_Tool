const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const info = JSON.parse(fs.readFileSync(path.join(root, "release-info.json"), "utf8"));
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "windows-release.yml"),
  "utf8"
);

assert(/^\d+\.\d+\.\d+$/.test(pkg.version), "Release baseline version must be X.Y.Z.");
assert.strictEqual(pkg.build?.appId, "com.viralai.tool");
assert.strictEqual(pkg.build?.productName, "Viral AI Tool");
assert.strictEqual(pkg.build?.win?.icon, "assets/icon.ico");
assert.strictEqual(pkg.build?.nsis?.installerIcon, "assets/icon.ico");
assert.strictEqual(pkg.build?.nsis?.uninstallerIcon, "assets/icon.ico");
assert.strictEqual(pkg.build?.win?.requestedExecutionLevel, "asInvoker");
assert(
  String(pkg.scripts?.dist || "").includes("--publish never"),
  "electron-builder must not auto-publish release artifacts."
);

assert.strictEqual(info.schemaVersion, 1);
assert(
  ["development", "preview", "stable"].includes(info.channel),
  "release-info channel is invalid."
);
assert.strictEqual(
  info.updateManifestUrl,
  "https://github.com/binkadev/Viral_AI_Tool/releases/latest/download/RELEASE-MANIFEST.json"
);
assert.strictEqual(
  info.releasePageUrl,
  "https://github.com/binkadev/Viral_AI_Tool/releases/latest"
);

for (const required of [
  "Require Windows code signing for tagged release",
  "WINDOWS_CSC_LINK",
  "WINDOWS_CSC_KEY_PASSWORD",
  "Run release policy tests",
  "Verify Windows release assets",
  "Generate release manifest and SHA-256 checksums",
  "RELEASE-MANIFEST.json",
  "SHA256SUMS.txt",
  "gh release create"
]) {
  assert(workflow.includes(required), "Windows release workflow is missing: " + required);
}

console.log("Release readiness tests passed for v" + pkg.version + ".");
