const { normalizeBaseUrl } = require("../auth/auth-client");

class BillingClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BillingClientError";
    this.code = code;
    this.details = details;
  }
}

function billingError(code, message, details) {
  return new BillingClientError(code, message, details);
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function mapHttpError(status, payload = {}) {
  const backendCode = payload?.error?.code || payload?.code || "";

  const passthrough = new Set([
    "AUTH_REQUIRED",
    "AUTH_EXPIRED",
    "PLAN_INVALID",
    "BILLING_PLAN_ALREADY_ACTIVE",
    "BILLING_USE_PLAN_CHANGE",
    "BILLING_SESSION_NOT_FOUND",
    "BILLING_SESSION_USED",
    "BILLING_SESSION_EXPIRED",
    "SUBSCRIPTION_INACTIVE"
  ]);

  if (passthrough.has(backendCode)) {
    return billingError(backendCode, "Billing request failed.", { status });
  }

  if (status === 401) return billingError("AUTH_REQUIRED", "Authentication is required.", { status });
  if (status === 403) return billingError("BILLING_FORBIDDEN", "Billing action is not allowed.", { status });
  if (status === 404) return billingError("BILLING_NOT_FOUND", "Billing resource was not found.", { status });
  if (status >= 500) return billingError("BILLING_SERVICE_UNAVAILABLE", "Billing service is unavailable.", { status });
  return billingError("BILLING_REQUEST_FAILED", "Billing request failed.", { status });
}

class BillingClient {
  constructor({ backendUrl, appVersion = "dev" }) {
    this.backendUrl = backendUrl;
    this.appVersion = appVersion;
  }

  async request(pathname, { method = "GET", body, accessToken, timeoutMs = 12000 } = {}) {
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
      if (error instanceof BillingClientError) throw error;
      if (error?.name === "AbortError") throw billingError("BILLING_TIMEOUT", "Billing request timed out.");
      throw billingError("BILLING_NETWORK", "Billing service could not be reached.", {
        technicalMessage: error?.message || String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }

  catalog(accessToken) {
    return this.request("/v1/billing/catalog", { accessToken });
  }

  checkout(planId, accessToken) {
    return this.request("/v1/billing/checkout-session", {
      method: "POST",
      body: { planId },
      accessToken
    });
  }

  changePlan(planId, accessToken) {
    return this.request("/v1/billing/plan-change", {
      method: "POST",
      body: { planId },
      accessToken
    });
  }

  cancel(accessToken) {
    return this.request("/v1/billing/cancel", {
      method: "POST",
      body: {},
      accessToken
    });
  }

  resume(accessToken) {
    return this.request("/v1/billing/resume", {
      method: "POST",
      body: {},
      accessToken
    });
  }

  portal(accessToken) {
    return this.request("/v1/billing/portal-session", {
      method: "POST",
      body: {},
      accessToken
    });
  }

  invoices(accessToken) {
    return this.request("/v1/billing/invoices", { accessToken });
  }
}

module.exports = {
  BillingClient,
  BillingClientError
};
