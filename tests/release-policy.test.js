const assert = require("assert");
const {
  compareVersions,
  validateManifest,
  canOfferUpdate,
  verifyBufferSha256
} = require("../services/update/release-policy");

const artifact = {
  file: "Viral AI Tool-0.15.0-x64.exe",
  sizeBytes: 123456,
  sha256: "a".repeat(64),
  downloadUrl: "https://github.com/binkadev/Viral_AI_Tool/releases/download/v0.15.0/Viral%20AI%20Tool-0.15.0-x64.exe"
};

const stableManifest = {
  schemaVersion: 1,
  product: "Viral AI Tool",
  version: "0.15.0",
  channel: "stable",
  commit: "abcdef1234567890",
  builtAt: new Date().toISOString(),
  platform: "win32",
  arch: "x64",
  artifacts: [artifact]
};

assert(compareVersions("0.15.0", "0.14.0") > 0);
assert(compareVersions("0.14.0", "0.14.0") === 0);
assert(compareVersions("0.14.0-beta.1", "0.14.0") < 0);
assert.strictEqual(validateManifest(stableManifest).ok, true);
assert.strictEqual(
  validateManifest({
    ...stableManifest,
    artifacts: [{ ...artifact, downloadUrl: "https://example.com/update.exe" }]
  }).code,
  "UPDATE_INSTALLER_INVALID"
);

assert.strictEqual(
  canOfferUpdate({ version: "0.14.0", channel: "stable" }, stableManifest).code,
  "UPDATE_AVAILABLE"
);

assert.strictEqual(
  canOfferUpdate(
    { version: "0.14.0", channel: "stable" },
    { ...stableManifest, channel: "preview" }
  ).code,
  "UPDATE_PREVIEW_NOT_ALLOWED"
);

assert.strictEqual(
  canOfferUpdate(
    { version: "0.15.0", channel: "stable" },
    stableManifest
  ).code,
  "UPDATE_NOT_NEWER"
);

const body = Buffer.from("viral-ai-release-test", "utf8");
const crypto = require("crypto");
const digest = crypto.createHash("sha256").update(body).digest("hex");
assert.strictEqual(verifyBufferSha256(body, digest), true);
assert.strictEqual(verifyBufferSha256(body, "0".repeat(64)), false);

console.log("Release policy tests passed.");
