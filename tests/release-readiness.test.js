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
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const diagnosticsLogger = fs.readFileSync(
  path.join(root, "services", "diagnostics", "logger.js"),
  "utf8"
);
const diagnosticsBundle = fs.readFileSync(
  path.join(root, "services", "diagnostics", "bundle.js"),
  "utf8"
);
const updateClient = fs.readFileSync(
  path.join(root, "services", "update", "update-client.js"),
  "utf8"
);
const releasePolicy = fs.readFileSync(
  path.join(root, "services", "update", "release-policy.js"),
  "utf8"
);
const cloudConfigStore = fs.readFileSync(
  path.join(root, "services", "cloud", "config-store.js"),
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
assert.strictEqual(
  pkg.scripts?.["release:preflight"],
  "node scripts/release-preflight.js",
  "Release preflight command must remain available."
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
assert(
  info.cloudBackendUrl === null ||
  (typeof info.cloudBackendUrl === "string" && info.cloudBackendUrl.startsWith("https://")),
  "Embedded Cloud backend must be null or HTTPS."
);

for (const required of [
  "UPDATE_WORK_IN_PROGRESS",
  "UPDATE_CHECKSUM_MISMATCH",
  "createHash('sha256')",
  "app.quit()"
]) {
  assert(main.includes(required), "Main update handoff is missing: " + required);
}

for (const required of [
  "diagnostics:open-folder",
  "diagnostics:export",
  "createDiagnosticBundle",
  "installConsoleCapture"
]) {
  assert(main.includes(required), "Main diagnostics integration is missing: " + required);
}

for (const required of [
  "openDiagnosticLogs",
  "exportDiagnostics"
]) {
  assert(preload.includes(required), "Preload diagnostics bridge is missing: " + required);
}

for (const required of [
  "password|token|secret|authorization|cookie|api.?key",
  "<EMAIL>",
  "<URL>",
  "<PATH>",
  "installConsoleCapture"
]) {
  assert(diagnosticsLogger.includes(required), "Diagnostics redaction is missing: " + required);
}

for (const required of [
  "accountDataIncluded: false",
  "credentialsIncluded: false",
  "cloudConfigurationIncluded: false",
  "userMediaPathsIncluded: false"
]) {
  assert(diagnosticsBundle.includes(required), "Diagnostic bundle privacy guard is missing: " + required);
}

for (const required of [
  "release-assets.githubusercontent.com",
  "UPDATE_SIZE_MISMATCH",
  "UPDATE_CHECKSUM_MISMATCH",
  ".part-"
]) {
  assert(updateClient.includes(required), "Update client is missing: " + required);
}

for (const required of [
  "UPDATE_PREVIEW_NOT_ALLOWED",
  "UPDATE_CHANNEL_VERSION_MISMATCH",
  "/binkadev/Viral_AI_Tool/releases/download/v"
]) {
  assert(releasePolicy.includes(required), "Release policy is missing: " + required);
}

for (const required of [
  "releaseBackendUrl",
  'source === "release"',
  "locked:",
  "CLOUD_CONFIG_ENV_LOCKED"
]) {
  assert(cloudConfigStore.includes(required), "Cloud release config is missing: " + required);
}

for (const required of [
  '"dev-backend/**"',
  "Verify tagged release commit is on master",
  "Require Windows code signing for tagged release",
  "Verify production release configuration",
  "PRODUCTION_CLOUD_URL",
  "PRODUCTION_BILLING_READY",
  "Production backend health check failed",
  "releaseReady",
  "providerConfigured",
  "checkoutReady",
  "portalReady",
  "invoicesReady",
  "webhookReady",
  "WINDOWS_CSC_LINK",
  "WINDOWS_CSC_KEY_PASSWORD",
  "Smoke-test Windows installer",
  "Installed Viral AI Tool exited during startup smoke test",
  "Verify Authenticode signatures for tagged release",
  "Get-AuthenticodeSignature",
  "Run release policy tests",
  "Verify Windows release assets",
  "Generate release manifest and SHA-256 checksums",
  "Validate generated release manifest",
  "RELEASE-MANIFEST.json",
  "SHA256SUMS.txt",
  "gh release create"
]) {
  assert(workflow.includes(required), "Windows release workflow is missing: " + required);
}

console.log("Release readiness tests passed for v" + pkg.version + ".");
