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
  checkForUpdate
};
