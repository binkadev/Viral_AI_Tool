class AuthClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthClientError";
    this.code = code;
    this.details = details;
  }
}

function authError(code, message, details) {
  return new AuthClientError(code, message, details);
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw authError("CLOUD_NOT_CONFIGURED", "Cloud backend is not configured.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw authError("CLOUD_CONFIG_INVALID", "Cloud backend URL is invalid.");
  }

  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw authError("CLOUD_HTTPS_REQUIRED", "Cloud backend must use HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function mapHttpError(status, payload = {}) {
  const backendCode = payload?.error?.code || payload?.code || "";
  const map = {
    INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
    ACCOUNT_DISABLED: "AUTH_ACCOUNT_DISABLED",
    AUTH_REQUIRED: "AUTH_REQUIRED",
    AUTH_EXPIRED: "AUTH_EXPIRED",
    RATE_LIMITED: "AUTH_RATE_LIMITED"
  };

  if (map[backendCode]) return authError(map[backendCode], "Authentication request failed.", { status });
  if (status === 401) return authError("AUTH_INVALID_CREDENTIALS", "Invalid credentials.", { status });
  if (status === 429) return authError("AUTH_RATE_LIMITED", "Too many attempts.", { status });
  if (status >= 500) return authError("AUTH_SERVICE_UNAVAILABLE", "Authentication service is unavailable.", { status });
  return authError("AUTH_REQUEST_FAILED", "Authentication request failed.", { status });
}

class AuthClient {
  constructor({ backendUrl, appVersion = "dev" }) {
    this.backendUrl = backendUrl;
    this.appVersion = appVersion;
  }

  async request(pathname, {
    method = "GET",
    body,
    accessToken,
    timeoutMs = 12000
  } = {}) {
    const base = normalizeBaseUrl(this.backendUrl);
    const url = new URL(base.toString());
    url.pathname = (base.pathname + "/" + String(pathname || "").replace(/^\/+/, "")).replace(/\/+/g, "/");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {
        accept: "application/json",
        "x-viral-ai-client": "desktop",
        "x-viral-ai-version": String(this.appVersion || "dev")
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (accessToken) headers.authorization = "Bearer " + accessToken;

      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = safeJson(text) || {};

      if (!response.ok) throw mapHttpError(response.status, payload);
      return payload;
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      if (error?.name === "AbortError") throw authError("AUTH_TIMEOUT", "Authentication request timed out.");
      throw authError("AUTH_NETWORK", "Authentication service could not be reached.", {
        technicalMessage: error?.message || String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async login({ email, password }) {
    if (typeof email !== "string" || !email.trim() || !email.includes("@")) {
      throw authError("AUTH_EMAIL_INVALID", "Email is invalid.");
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 256) {
      throw authError("AUTH_PASSWORD_INVALID", "Password is invalid.");
    }

    return this.request("/v1/auth/login", {
      method: "POST",
      body: {
        email: email.trim().toLowerCase(),
        password
      }
    });
  }

  async refresh(refreshToken) {
    if (typeof refreshToken !== "string" || !refreshToken.trim()) {
      throw authError("AUTH_REQUIRED", "Refresh token is missing.");
    }
    return this.request("/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: refreshToken.trim() }
    });
  }

  async logout(refreshToken, accessToken) {
    if (!refreshToken && !accessToken) return { loggedOut: true };
    try {
      return await this.request("/v1/auth/logout", {
        method: "POST",
        body: { refreshToken: refreshToken || "" },
        accessToken: accessToken || undefined
      });
    } catch (error) {
      if (["AUTH_NETWORK", "AUTH_TIMEOUT", "AUTH_SERVICE_UNAVAILABLE"].includes(error?.code)) {
        return { loggedOut: true, remotePending: true };
      }
      throw error;
    }
  }

  async me(accessToken) {
    if (!accessToken) throw authError("AUTH_REQUIRED", "Access token is missing.");
    return this.request("/v1/account/me", {
      method: "GET",
      accessToken
    });
  }

  async sessions(accessToken) {
    if (!accessToken) throw authError("AUTH_REQUIRED", "Access token is missing.");
    return this.request("/v1/account/sessions", {
      method: "GET",
      accessToken
    });
  }

  async revokeSession(sessionId, accessToken) {
    if (!accessToken) throw authError("AUTH_REQUIRED", "Access token is missing.");

    const id = String(sessionId || "").trim();
    if (!/^[A-Za-z0-9._-]{8,160}$/.test(id)) {
      throw authError("AUTH_SESSION_INVALID", "Session ID is invalid.");
    }

    return this.request("/v1/account/sessions/" + encodeURIComponent(id), {
      method: "DELETE",
      accessToken
    });
  }
}

module.exports = {
  AuthClient,
  AuthClientError,
  normalizeBaseUrl
};
