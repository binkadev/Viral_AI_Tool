const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const serverPath = path.join(root, "dev-backend", "server.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-integration-"));
const port = 32000 + (process.pid % 1000);
const baseUrl = "http://127.0.0.1:" + port;

let child = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }

  throw lastError || new Error("Backend did not become healthy.");
}

async function startServer() {
  child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      VIRAL_AI_DEV_PORT: String(port),
      VIRAL_AI_DEV_DATA_DIR: dataDir,
      OPENAI_API_KEY: "",
      VIRAL_AI_TRANSLATION_API_KEY: "",
      VIRAL_AI_VOICE_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  child.once("exit", code => {
    if (code && code !== 0) {
      process.stderr.write(stderr);
    }
  });

  const health = await waitForHealth();
  assert.strictEqual(health.durableState, true);
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

async function request(pathname, {
  method = "GET",
  body,
  accessToken,
  client = "integration-desktop",
  version = "test-1"
} = {}) {
  const headers = {
    accept: "application/json",
    "x-viral-ai-client": client,
    "x-viral-ai-version": version
  };

  if (body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = "Bearer " + accessToken;

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

async function login(client, version) {
  const result = await request("/v1/auth/login", {
    method: "POST",
    client,
    version,
    body: {
      email: "demo@viral-ai.local",
      password: "ViralAI123!"
    }
  });

  assert.strictEqual(result.response.status, 200, result.text);
  assert(result.payload?.accessToken);
  assert(result.payload?.refreshToken);
  return result.payload;
}

async function run() {
  try {
    await startServer();

    const first = await login("desktop-a", "0.14-test");
    const statePath = path.join(dataDir, "state.json");

    let rawState = fs.readFileSync(statePath, "utf8");
    assert(!rawState.includes(first.refreshToken), "raw refresh token must not be persisted");
    assert(!rawState.includes(first.accessToken), "access token must not be persisted");

    await stopServer();
    await startServer();

    const refreshed = await request("/v1/auth/refresh", {
      method: "POST",
      client: "desktop-a",
      version: "0.14-test",
      body: { refreshToken: first.refreshToken }
    });

    assert.strictEqual(refreshed.response.status, 200, refreshed.text);
    assert(refreshed.payload?.accessToken);
    assert(refreshed.payload?.refreshToken);

    const replay = await request("/v1/auth/refresh", {
      method: "POST",
      client: "desktop-a",
      version: "0.14-test",
      body: { refreshToken: first.refreshToken }
    });
    assert.strictEqual(replay.response.status, 401, "rotated refresh token must be one-time");

    const sessionsAfterRestart = await request("/v1/account/sessions", {
      accessToken: refreshed.payload.accessToken
    });

    assert.strictEqual(sessionsAfterRestart.response.status, 200, sessionsAfterRestart.text);
    assert.strictEqual(sessionsAfterRestart.payload.sessions.length, 1);
    assert.strictEqual(sessionsAfterRestart.payload.sessions[0].current, true);
    assert.strictEqual(sessionsAfterRestart.payload.sessions[0].clientName, "desktop-a");

    const second = await login("desktop-b", "0.14-test");
    const sessions = await request("/v1/account/sessions", {
      accessToken: second.accessToken,
      client: "desktop-b",
      version: "0.14-test"
    });

    assert.strictEqual(sessions.response.status, 200, sessions.text);
    assert(sessions.payload.sessions.length >= 2);

    const other = sessions.payload.sessions.find(item => !item.current);
    assert(other?.id, "a non-current session should be available for revocation");

    const revoked = await request("/v1/account/sessions/" + encodeURIComponent(other.id), {
      method: "DELETE",
      accessToken: second.accessToken,
      client: "desktop-b",
      version: "0.14-test"
    });

    assert.strictEqual(revoked.response.status, 200, revoked.text);
    assert.strictEqual(revoked.payload.revoked, true);
    assert.strictEqual(revoked.payload.currentSessionRevoked, false);

    const sessionsAfterRevoke = await request("/v1/account/sessions", {
      accessToken: second.accessToken,
      client: "desktop-b",
      version: "0.14-test"
    });

    assert.strictEqual(sessionsAfterRevoke.response.status, 200);
    assert(!sessionsAfterRevoke.payload.sessions.some(item => item.id === other.id));

    rawState = fs.readFileSync(statePath, "utf8");
    assert(!rawState.includes(refreshed.payload.refreshToken));
    assert(!rawState.includes(second.refreshToken));
    assert(!rawState.includes("ViralAI123!"));

    const auditPath = path.join(dataDir, "audit.jsonl");
    const auditRaw = fs.readFileSync(auditPath, "utf8");
    assert(!auditRaw.includes(first.refreshToken));
    assert(!auditRaw.includes(refreshed.payload.refreshToken));
    assert(!auditRaw.includes(second.refreshToken));
    assert(!auditRaw.includes("ViralAI123!"));
    assert(auditRaw.includes("auth.login.succeeded"));
    assert(auditRaw.includes("auth.refresh.succeeded"));
    assert(auditRaw.includes("auth.session.revoked"));

    console.log("Backend restart/session integration tests passed.");
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
