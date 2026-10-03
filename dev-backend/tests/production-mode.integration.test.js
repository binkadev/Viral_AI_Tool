const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const serverPath = path.join(root, "dev-backend", "server.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-production-test-"));
const port = 33500 + (process.pid % 1000);
const baseUrl = "http://127.0.0.1:" + port;

const ownerEmail = "owner@example.test";
const ownerPassword = "Production-Test-Password-123!";
const operationsToken = "ops-test-token-abcdefghijklmnopqrstuvwxyz-123456";

let child = null;
let capturedStdout = "";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 12000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return response.json();
    } catch {}
    await sleep(150);
  }

  throw new Error("Production backend did not become healthy.");
}

async function startServer({ bootstrap = false } = {}) {
  capturedStdout = "";

  const env = {
    ...process.env,
    VIRAL_AI_DEV_PORT: String(port),
    VIRAL_AI_DEV_DATA_DIR: dataDir,
    VIRAL_AI_ENV: "production",
    VIRAL_AI_STATE_DRIVER: "sqlite",
    VIRAL_AI_OPERATIONS_TOKEN: operationsToken,
    OPENAI_API_KEY: "",
    VIRAL_AI_TRANSLATION_API_KEY: "",
    VIRAL_AI_VOICE_API_KEY: ""
  };

  if (bootstrap) {
    env.VIRAL_AI_BOOTSTRAP_EMAIL = ownerEmail;
    env.VIRAL_AI_BOOTSTRAP_PASSWORD = ownerPassword;
    env.VIRAL_AI_BOOTSTRAP_NAME = "Production Test Owner";
    env.VIRAL_AI_BOOTSTRAP_PLAN = "free";
  } else {
    delete env.VIRAL_AI_BOOTSTRAP_EMAIL;
    delete env.VIRAL_AI_BOOTSTRAP_PASSWORD;
    delete env.VIRAL_AI_BOOTSTRAP_NAME;
    delete env.VIRAL_AI_BOOTSTRAP_PLAN;
  }

  child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stdout.on("data", chunk => {
    capturedStdout += chunk.toString();
  });
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  child.once("exit", code => {
    if (code && code !== 0) process.stderr.write(stderr);
  });

  return waitForHealth();
}

async function stopServer() {
  if (!child || child.exitCode !== null) {
    child = null;
    return;
  }

  const current = child;
  child = null;

  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { current.kill("SIGKILL"); } catch {}
      resolve();
    }, 2500);

    current.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    try { current.kill("SIGTERM"); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function request(pathname, { method = "GET", body, accessToken, operationsToken: opsToken } = {}) {
  const headers = {
    accept: "application/json",
    "x-viral-ai-client": "production-integration",
    "x-viral-ai-version": "test"
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = "Bearer " + accessToken;
  if (opsToken) headers["x-viral-ai-ops-token"] = opsToken;

  const response = await fetch(baseUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}

  return { response, payload, text };
}

async function login(email, password) {
  return request("/v1/auth/login", {
    method: "POST",
    body: { email, password }
  });
}

async function run() {
  try {
    const firstHealth = await startServer({ bootstrap: true });

    assert.strictEqual(firstHealth.environment, "production");
    assert.strictEqual(firstHealth.stateDriver, "sqlite");
    assert.strictEqual(firstHealth.durableState, true);
    assert.strictEqual(firstHealth.billing?.ready, false);
    assert.strictEqual(firstHealth.billing?.provider, "unconfigured");

    const readiness = await request("/ready");
    assert.strictEqual(readiness.response.status, 200, readiness.text);
    assert.strictEqual(readiness.payload?.ready, true);
    assert.strictEqual(readiness.payload?.checks?.stateReadable, true);

    const opsDenied = await request("/v1/internal/ops/status");
    assert.strictEqual(opsDenied.response.status, 401);
    assert.strictEqual(opsDenied.payload?.error?.code, "OPERATIONS_UNAUTHORIZED");

    const ops = await request("/v1/internal/ops/status", {
      operationsToken
    });
    assert.strictEqual(ops.response.status, 200, ops.text);
    assert.strictEqual(ops.payload?.ok, true);
    assert.strictEqual(ops.payload?.environment, "production");
    assert.strictEqual(ops.payload?.stateDriver, "sqlite");
    assert(ops.payload?.memory?.rssBytes > 0);
    assert(ops.payload?.jobs?.speech);
    assert(ops.payload?.jobs?.translation);
    assert(ops.payload?.jobs?.voice);

    const opsSerialized = JSON.stringify(ops.payload);
    assert(!opsSerialized.includes(ownerEmail));
    assert(!opsSerialized.includes(ownerPassword));
    assert(!opsSerialized.includes(dataDir));

    const billingReadiness = await request("/ready");
    assert.strictEqual(billingReadiness.response.status, 200, billingReadiness.text);
    assert.strictEqual(billingReadiness.payload?.ready, true);
    assert.strictEqual(billingReadiness.payload?.releaseReady, false);
    assert.strictEqual(billingReadiness.payload?.checks?.billing?.ready, false);
    assert.strictEqual(billingReadiness.payload?.checks?.billing?.checks?.providerConfigured, false);
    assert.strictEqual(billingReadiness.payload?.checks?.billing?.checks?.checkoutReady, false);
    assert.strictEqual(billingReadiness.payload?.checks?.billing?.checks?.portalReady, false);
    assert.strictEqual(billingReadiness.payload?.checks?.billing?.checks?.invoicesReady, false);

    const demo = await login("demo@viral-ai.local", "ViralAI123!");
    assert.strictEqual(demo.response.status, 401, "development demo credentials must not work in production");

    const owner = await login(ownerEmail, ownerPassword);
    assert.strictEqual(owner.response.status, 200, owner.text);
    assert(owner.payload?.accessToken);

    const billing = await request("/v1/billing/catalog", {
      accessToken: owner.payload.accessToken
    });
    assert.strictEqual(billing.response.status, 503);
    assert.strictEqual(billing.payload?.error?.code, "BILLING_PROVIDER_NOT_CONFIGURED");

    assert(!capturedStdout.includes(ownerPassword), "production password must not be printed");
    assert(fs.existsSync(path.join(dataDir, "state.sqlite")), "production must use SQLite state");
    assert(!fs.existsSync(path.join(dataDir, "state.json")), "production must not use JSON state");

    await stopServer();

    const secondHealth = await startServer({ bootstrap: false });
    assert.strictEqual(secondHealth.environment, "production");
    assert.strictEqual(secondHealth.stateDriver, "sqlite");

    const ownerAfterRestart = await login(ownerEmail, ownerPassword);
    assert.strictEqual(ownerAfterRestart.response.status, 200, ownerAfterRestart.text);

    console.log("Production mode integration tests passed.");
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(async error => {
  console.error(error);
  await stopServer();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exitCode = 1;
});
