const crypto = require("crypto");

const CHANNELS = new Set(["development", "preview", "stable"]);

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Invalid release version.");

  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }

  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function normalizeInstallerUrl(value, version) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    if (url.username || url.password || url.hash) return null;

    const expectedPrefix = "/binkadev/Viral_AI_Tool/releases/download/v" +
      String(version || "") + "/";
    if (!url.pathname.startsWith(expectedPrefix)) return null;

    return url.toString();
  } catch {
    return null;
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, code: "UPDATE_MANIFEST_INVALID" };
  }

  if (manifest.product !== "Viral AI Tool") {
    return { ok: false, code: "UPDATE_PRODUCT_MISMATCH" };
  }

  if (!parseVersion(manifest.version)) {
    return { ok: false, code: "UPDATE_VERSION_INVALID" };
  }

  if (!CHANNELS.has(String(manifest.channel || ""))) {
    return { ok: false, code: "UPDATE_CHANNEL_INVALID" };
  }

  const parsedManifestVersion = parseVersion(manifest.version);
  if (
    manifest.channel === "stable" &&
    parsedManifestVersion?.prerelease
  ) {
    return { ok: false, code: "UPDATE_CHANNEL_VERSION_MISMATCH" };
  }

  if (manifest.platform !== "win32" || manifest.arch !== "x64") {
    return { ok: false, code: "UPDATE_PLATFORM_MISMATCH" };
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const installer = artifacts.find(item => String(item?.file || "").toLowerCase().endsWith(".exe"));

  const downloadUrl = normalizeInstallerUrl(installer?.downloadUrl, manifest.version);

  if (
    !installer ||
    !validSha256(installer.sha256) ||
    Number(installer.sizeBytes || 0) <= 0 ||
    (manifest.channel === "stable" && !downloadUrl)
  ) {
    return { ok: false, code: "UPDATE_INSTALLER_INVALID" };
  }

  return {
    ok: true,
    installer: {
      file: String(installer.file),
      sizeBytes: Number(installer.sizeBytes),
      sha256: String(installer.sha256).toLowerCase(),
      downloadUrl
    }
  };
}

function canOfferUpdate(current, manifest, { allowPreview = false } = {}) {
  const validation = validateManifest(manifest);
  if (!validation.ok) return validation;

  const currentChannel = CHANNELS.has(String(current?.channel || ""))
    ? String(current.channel)
    : "development";

  if (manifest.channel === "preview" && currentChannel === "stable" && !allowPreview) {
    return { ok: false, code: "UPDATE_PREVIEW_NOT_ALLOWED" };
  }

  if (manifest.channel === "development") {
    return { ok: false, code: "UPDATE_DEVELOPMENT_NOT_DISTRIBUTABLE" };
  }

  let newer = false;
  try {
    newer = compareVersions(manifest.version, current?.version) > 0;
  } catch {
    return { ok: false, code: "UPDATE_CURRENT_VERSION_INVALID" };
  }

  if (!newer) return { ok: false, code: "UPDATE_NOT_NEWER" };

  return {
    ok: true,
    code: "UPDATE_AVAILABLE",
    version: manifest.version,
    channel: manifest.channel,
    installer: validation.installer
  };
}

function verifyBufferSha256(buffer, expectedSha256) {
  if (!Buffer.isBuffer(buffer) || !validSha256(expectedSha256)) return false;
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(actual, "hex"),
      Buffer.from(String(expectedSha256), "hex")
    );
  } catch {
    return false;
  }
}

module.exports = {
  parseVersion,
  compareVersions,
  validateManifest,
  canOfferUpdate,
  verifyBufferSha256,
  normalizeInstallerUrl
};
