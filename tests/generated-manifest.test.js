const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateManifest } = require("../services/update/release-policy");

const manifestPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "release", "RELEASE-MANIFEST.json");

assert(fs.existsSync(manifestPath), "Generated release manifest does not exist.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const validation = validateManifest(manifest);

assert.strictEqual(
  validation.ok,
  true,
  "Generated release manifest is rejected by app policy: " + (validation.code || "unknown")
);

assert(
  Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0,
  "Release manifest contains no artifacts."
);

assert(
  !manifest.artifacts.some(item => String(item?.file || "").toLowerCase() === "builder-debug.yml"),
  "Release manifest must not publish builder-debug.yml."
);

const installer = manifest.artifacts.find(item =>
  String(item?.file || "").toLowerCase().endsWith(".exe")
);
assert(installer, "Release manifest contains no Windows installer.");
assert(/^[a-f0-9]{64}$/i.test(String(installer.sha256 || "")), "Installer SHA-256 is invalid.");
assert(Number(installer.sizeBytes || 0) > 0, "Installer size is invalid.");

if (manifest.channel === "stable") {
  assert(
    typeof installer.downloadUrl === "string" &&
      installer.downloadUrl.startsWith(
        "https://github.com/binkadev/Viral_AI_Tool/releases/download/v" + manifest.version + "/"
      ),
    "Stable installer download URL is invalid."
  );
}

console.log(
  "Generated release manifest accepted:",
  manifest.version,
  manifest.channel,
  installer.file
);
