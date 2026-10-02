const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { once } = require("events");
const {
  validateManifest,
  canOfferUpdate
} = require("./release-policy");

const MAX_MANIFEST_BYTES = 512 * 1024;

class UpdateClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "UpdateClientError";
    this.code = code;
    this.details = details;
  }
}

function updateError(code, message, details) {
  return new UpdateClientError(code, message, details);
}

function normalizeManifestUrl(rawUrl, { allowLocalhost = false } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw updateError("UPDATE_URL_INVALID", "Update manifest URL is invalid.");
  }

  const localHttp =
    allowLocalhost &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (url.protocol !== "https:" && !localHttp) {
    throw updateError("UPDATE_URL_INSECURE", "Update manifest must use HTTPS.");
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

async function fetchManifest(manifestUrl, {
  timeoutMs = 8000,
  allowLocalhost = false
} = {}) {
  const url = normalizeManifestUrl(manifestUrl, { allowLocalhost });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (response.status === 404) {
      throw updateError("UPDATE_NOT_PUBLISHED", "No published update manifest was found.", {
        status: 404
      });
    }

    if (!response.ok) {
      throw updateError(
        response.status >= 500 ? "UPDATE_SERVICE_UNAVAILABLE" : "UPDATE_REQUEST_FAILED",
        "Update manifest request failed.",
        { status: response.status }
      );
    }

    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_MANIFEST_BYTES) {
      throw updateError("UPDATE_MANIFEST_TOO_LARGE", "Update manifest is too large.");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
      throw updateError("UPDATE_MANIFEST_TOO_LARGE", "Update manifest is too large.");
    }

    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      throw updateError("UPDATE_MANIFEST_INVALID", "Update manifest is not valid JSON.");
    }

    const validation = validateManifest(manifest);
    if (!validation.ok) {
      throw updateError(validation.code, "Update manifest validation failed.");
    }

    return manifest;
  } catch (error) {
    if (error instanceof UpdateClientError) throw error;
    if (error?.name === "AbortError") {
      throw updateError("UPDATE_TIMEOUT", "Update check timed out.");
    }
    throw updateError("UPDATE_NETWORK", "Update service could not be reached.", {
      technicalMessage: error?.message || String(error)
    });
  } finally {
    clearTimeout(timer);
  }
}

function trustedDownloadResponseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      ["github.com", "release-assets.githubusercontent.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

async function downloadVerifiedInstaller({
  current,
  manifestUrl,
  outputDir,
  allowPreview = false,
  allowLocalhost = false,
  timeoutMs = 2 * 60 * 1000
}) {
  const manifest = await fetchManifest(manifestUrl, { allowLocalhost });
  const decision = canOfferUpdate(current, manifest, { allowPreview });

  if (!decision.ok || !decision.installer?.downloadUrl) {
    throw updateError(
      decision.code || "UPDATE_INSTALLER_INVALID",
      "No eligible verified installer is available."
    );
  }

  const installer = decision.installer;
  const safeName = path.basename(installer.file);
  if (!safeName.toLowerCase().endsWith(".exe") || safeName !== installer.file) {
    throw updateError("UPDATE_INSTALLER_INVALID", "Installer filename is invalid.");
  }

  const root = path.resolve(String(outputDir || ""));
  if (!root) throw updateError("UPDATE_OUTPUT_INVALID", "Update output directory is invalid.");
  fs.mkdirSync(root, { recursive: true });

  const target = path.join(root, safeName);
  const partial = target + ".part-" + process.pid + "-" + Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let stream = null;
  let total = 0;
  const hash = crypto.createHash("sha256");

  try {
    const response = await fetch(installer.downloadUrl, {
      method: "GET",
      headers: {
        accept: "application/octet-stream",
        "cache-control": "no-cache"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw updateError(
        response.status >= 500 ? "UPDATE_SERVICE_UNAVAILABLE" : "UPDATE_DOWNLOAD_FAILED",
        "Installer download failed.",
        { status: response.status }
      );
    }

    if (!trustedDownloadResponseUrl(response.url)) {
      throw updateError("UPDATE_DOWNLOAD_UNTRUSTED", "Installer redirect target is not trusted.");
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 0 && declaredLength !== installer.sizeBytes) {
      throw updateError("UPDATE_SIZE_MISMATCH", "Installer size does not match manifest.");
    }

    if (!response.body) {
      throw updateError("UPDATE_DOWNLOAD_FAILED", "Installer response has no body.");
    }

    stream = fs.createWriteStream(partial, { flags: "wx", mode: 0o600 });

    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;

      if (total > installer.sizeBytes) {
        throw updateError("UPDATE_SIZE_MISMATCH", "Installer exceeds manifest size.");
      }

      hash.update(buffer);
      if (!stream.write(buffer)) await once(stream, "drain");
    }

    stream.end();
    await once(stream, "finish");
    stream = null;

    if (total !== installer.sizeBytes) {
      throw updateError("UPDATE_SIZE_MISMATCH", "Installer size does not match manifest.");
    }

    const digest = hash.digest("hex");
    if (digest !== installer.sha256) {
      throw updateError("UPDATE_CHECKSUM_MISMATCH", "Installer checksum does not match manifest.");
    }

    try { fs.rmSync(target, { force: true }); } catch {}
    fs.renameSync(partial, target);

    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;

        const candidate = path.join(root, entry.name);
        if (candidate === target) continue;

        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".exe") || lower.includes(".part-")) {
          try { fs.rmSync(candidate, { force: true }); } catch {}
        }
      }
    } catch {}

    return {
      version: decision.version,
      channel: decision.channel,
      fileName: safeName,
      filePath: target,
      sizeBytes: total,
      sha256: digest
    };
  } catch (error) {
    try { stream?.destroy(); } catch {}
    try { fs.rmSync(partial, { force: true }); } catch {}

    if (error instanceof UpdateClientError) throw error;
    if (error?.name === "AbortError") {
      throw updateError("UPDATE_DOWNLOAD_TIMEOUT", "Installer download timed out.");
    }
    throw updateError("UPDATE_DOWNLOAD_FAILED", "Installer download failed.", {
      technicalMessage: error?.message || String(error)
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdate({
  current,
  manifestUrl,
  allowPreview = false,
  allowLocalhost = false
}) {
  const manifest = await fetchManifest(manifestUrl, { allowLocalhost });
  const decision = canOfferUpdate(current, manifest, { allowPreview });

  return {
    decision,
    manifest: {
      version: manifest.version,
      channel: manifest.channel,
      commit: manifest.commit || null,
      builtAt: manifest.builtAt || null,
      releasePage: manifest.releasePage || null
    }
  };
}

module.exports = {
  MAX_MANIFEST_BYTES,
  UpdateClientError,
  normalizeManifestUrl,
  fetchManifest,
  checkForUpdate,
  downloadVerifiedInstaller
};
