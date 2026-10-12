"use strict";

const { CloudMediaClient, MediaClientError } = require("./cloud-client");
const { normalizeSearchRequest } = require("./provider-contract");

const ALLOWED_PROVIDERS = new Set(["auto", "pexels", "pixabay"]);
const PUBLIC_MEDIA_CODES = new Set([
  "MEDIA_AUTH_REQUIRED",
  "MEDIA_NOT_CONFIGURED",
  "MEDIA_CONFIG_INVALID",
  "MEDIA_HTTPS_REQUIRED",
  "MEDIA_SEARCH_INVALID",
  "MEDIA_PROVIDER_UNAVAILABLE",
  "MEDIA_SEARCH_UNAVAILABLE",
  "MEDIA_SEARCH_TIMEOUT",
  "MEDIA_QUOTA_EXCEEDED",
  "MEDIA_NETWORK",
  "MEDIA_CANCELLED",
  "MEDIA_REQUEST_FAILED"
]);

function publicMediaClientError(error) {
  const code = PUBLIC_MEDIA_CODES.has(error?.code) ? error.code : "MEDIA_SEARCH_UNAVAILABLE";
  const details = {};
  if (error?.details?.field) details.field = String(error.details.field).slice(0, 80);
  return { code, details };
}

function backendUrlFromConfig(config) {
  if (typeof config === "string") return config.trim();
  if (!config || typeof config !== "object") return "";
  return String(config.backendUrl || "").trim();
}

function normalizeDesktopSearchPayload(input = {}) {
  const normalized = normalizeSearchRequest(input);
  const provider = String(input.provider || "auto").trim().toLowerCase() || "auto";
  if (!ALLOWED_PROVIDERS.has(provider)) {
    const error = new Error("Media provider is not supported.");
    error.code = "MEDIA_SEARCH_INVALID";
    error.details = { field: "provider" };
    throw error;
  }
  return { ...normalized, provider };
}

function createMediaDesktopService({
  getCloudConfig,
  getAccessToken,
  refreshSession,
  appVersion = "dev",
  fetchImpl = global.fetch
} = {}) {
  if (typeof getCloudConfig !== "function") throw new TypeError("getCloudConfig is required");
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");

  async function refreshedClient() {
    if (typeof refreshSession === "function") {
      try { await refreshSession(); } catch {}
    }
    const backendUrl = backendUrlFromConfig(await getCloudConfig());
    return new CloudMediaClient({
      backendUrl,
      getAccessToken,
      appVersion,
      fetchImpl
    });
  }

  async function status() {
    try {
      const client = await refreshedClient();
      const data = await client.status();
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, error: publicMediaClientError(error) };
    }
  }

  async function search(payload) {
    let input;
    try {
      input = normalizeDesktopSearchPayload(payload);
    } catch (error) {
      return { ok: false, error: publicMediaClientError(error) };
    }

    try {
      const client = await refreshedClient();
      const data = await client.search(input);
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, error: publicMediaClientError(error) };
    }
  }

  return { status, search };
}

function registerMediaIpc({ ipcMain, ...dependencies } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain is required");
  const service = createMediaDesktopService(dependencies);
  ipcMain.handle("media:status", () => service.status());
  ipcMain.handle("media:search", (_event, payload) => service.search(payload));
  return service;
}

module.exports = {
  ALLOWED_PROVIDERS,
  PUBLIC_MEDIA_CODES,
  publicMediaClientError,
  backendUrlFromConfig,
  normalizeDesktopSearchPayload,
  createMediaDesktopService,
  registerMediaIpc,
  MediaClientError
};
