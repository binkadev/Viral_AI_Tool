const fs = require("fs");
const path = require("path");

const ENVIRONMENTS = new Set(["development", "production"]);

function normalizeEnvironment(value) {
  return ENVIRONMENTS.has(value) ? value : "development";
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function createCloudConfigStore({
  userDataPath,
  isPackaged,
  releaseBackendUrl = "",
  releaseEnvironment = "production"
}) {
  const filePath = path.join(userDataPath, "cloud-config.json");

  function read() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {}

    const envUrl = normalizeUrl(process.env.VIRAL_AI_CLOUD_URL || "");
    const embeddedUrl = normalizeUrl(releaseBackendUrl || "");
    const developerSettingsVisible = !isPackaged || process.env.VIRAL_AI_DEV_MODE === "1";

    const source = envUrl
      ? "environment"
      : embeddedUrl && isPackaged && !developerSettingsVisible
        ? "release"
        : raw?.backendUrl
          ? "saved"
          : embeddedUrl
            ? "release"
            : "unset";

    const backendUrl =
      source === "environment" ? envUrl :
      source === "release" ? embeddedUrl :
      normalizeUrl(raw?.backendUrl || "");

    const environment =
      source === "release"
        ? normalizeEnvironment(releaseEnvironment)
        : normalizeEnvironment(raw?.environment);

    return {
      environment,
      backendUrl,
      source,
      developerSettingsVisible
    };
  }

  function validateBackendUrl(value) {
    const backendUrl = normalizeUrl(value);
    if (!backendUrl) {
      return { ok: true, backendUrl: "" };
    }

    let url;
    try {
      url = new URL(backendUrl);
    } catch {
      return { ok: false, code: "CLOUD_CONFIG_INVALID" };
    }

    const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
      return { ok: false, code: "CLOUD_HTTPS_REQUIRED" };
    }

    if (url.username || url.password) {
      return { ok: false, code: "CLOUD_CONFIG_CREDENTIALS_NOT_ALLOWED" };
    }

    return { ok: true, backendUrl };
  }

  function write({ environment, backendUrl }) {
    const current = read();
    const safeEnvironment = normalizeEnvironment(environment);

    if (["environment", "release"].includes(current.source)) {
      return {
        ok: false,
        code: "CLOUD_CONFIG_ENV_LOCKED",
        data: current
      };
    }

    const validated = validateBackendUrl(backendUrl);
    if (!validated.ok) return validated;

    if (validated.backendUrl && safeEnvironment === "production") {
      const parsed = new URL(validated.backendUrl);
      if (parsed.protocol !== "https:") {
        return { ok: false, code: "CLOUD_HTTPS_REQUIRED" };
      }
    }

    const next = {
      version: 1,
      environment: safeEnvironment,
      backendUrl: validated.backendUrl,
      updatedAt: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = filePath + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(temp, filePath);

    return { ok: true, data: read() };
  }

  function clear() {
    if (["environment", "release"].includes(read().source)) {
      return { ok: false, code: "CLOUD_CONFIG_ENV_LOCKED", data: read() };
    }
    try { fs.rmSync(filePath, { force: true }); } catch {}
    return { ok: true, data: read() };
  }

  return {
    read,
    write,
    clear,
    validateBackendUrl
  };
}

module.exports = { createCloudConfigStore };
