const http = require("http");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.VIRAL_AI_DEV_PORT || 3000);

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOGIN_ATTEMPTS = 8;
const RATE_WINDOW_MS = 5 * 60 * 1000;

const users = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const loginAttempts = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function seedUser() {
  const email = "demo@viral-ai.local";
  const password = "ViralAI123!";
  const salt = crypto.randomBytes(16).toString("hex");
  users.set(email, {
    id: "dev-user-1",
    email,
    name: "Viral AI Dev",
    plan: "Creator Pro",
    salt,
    passwordHash: hashPassword(password, salt),
    quota: {
      remainingMinutes: 500,
      resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  return { email, password };
}

const demo = seedUser();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function error(res, status, code) {
  return json(res, status, { error: { code } });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("body too large");
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("invalid json");
    err.code = "INVALID_JSON";
    throw err;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenExpiry(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function issueSession(user) {
  const accessToken = newToken();
  const refreshToken = newToken();
  const accessExpiresAt = tokenExpiry(ACCESS_TTL_MS);
  const refreshExpiresAt = tokenExpiry(REFRESH_TTL_MS);

  accessTokens.set(accessToken, {
    userId: user.id,
    expiresAt: Date.parse(accessExpiresAt)
  });
  refreshTokens.set(refreshToken, {
    userId: user.id,
    expiresAt: Date.parse(refreshExpiresAt)
  });

  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan
    }
  };
}

function findUserById(userId) {
  return [...users.values()].find(user => user.id === userId) || null;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const record = accessTokens.get(token);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) {
    accessTokens.delete(token);
    return null;
  }

  return findUserById(record.userId);
}

function pruneAttempts(key) {
  const now = Date.now();
  const values = (loginAttempts.get(key) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  loginAttempts.set(key, values);
  return values;
}

function rateLimited(key) {
  return pruneAttempts(key).length >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const values = pruneAttempts(key);
  values.push(Date.now());
  loginAttempts.set(key, values);
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "viral-ai-dev-backend" });
  }

  if (method === "POST" && url.pathname === "/v1/auth/login") {
    const clientKey = String(req.socket.remoteAddress || "unknown");
    if (rateLimited(clientKey)) return error(res, 429, "RATE_LIMITED");

    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = users.get(email);

    const candidateHash = user
      ? hashPassword(password, user.salt)
      : hashPassword(password || "invalid", "00000000000000000000000000000000");

    if (!user || !safeEqualHex(candidateHash, user.passwordHash)) {
      recordFailedAttempt(clientKey);
      return error(res, 401, "INVALID_CREDENTIALS");
    }

    clearAttempts(clientKey);
    return json(res, 200, issueSession(user));
  }

  if (method === "POST" && url.pathname === "/v1/auth/refresh") {
    const body = await readJson(req);
    const token = String(body.refreshToken || "");
    const record = refreshTokens.get(token);

    if (!record || Date.now() >= record.expiresAt) {
      if (record) refreshTokens.delete(token);
      return error(res, 401, "AUTH_EXPIRED");
    }

    const user = findUserById(record.userId);
    if (!user) return error(res, 401, "AUTH_EXPIRED");

    refreshTokens.delete(token);
    return json(res, 200, issueSession(user));
  }

  if (method === "POST" && url.pathname === "/v1/auth/logout") {
    const body = await readJson(req);
    const refreshToken = String(body.refreshToken || "");
    refreshTokens.delete(refreshToken);

    const accessToken = bearerToken(req);
    if (accessToken) accessTokens.delete(accessToken);

    return json(res, 200, { loggedOut: true });
  }

  if (method === "GET" && url.pathname === "/v1/account/me") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    return json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan
      },
      quota: user.quota
    });
  }

  if (method === "GET" && url.pathname === "/v1/speech/status") {
    const user = authenticate(req);
    if (!user) return error(res, 401, "AUTH_REQUIRED");

    return json(res, 200, {
      ready: false,
      code: "CLOUD_PROVIDER_NOT_CONFIGURED",
      quota: {
        remainingMinutes: user.quota.remainingMinutes,
        resetAt: user.quota.resetAt,
        plan: user.plan
      },
      limits: {
        maxAudioBytes: 100 * 1024 * 1024,
        maxDurationSeconds: 7200
      },
      retention: {
        temporaryAudioHours: 24,
        transcriptDays: 30
      }
    });
  }

  return error(res, 404, "NOT_FOUND");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error("[DevBackend]", err.code || err.message);
    if (!res.headersSent) {
      error(res, err.code === "BODY_TOO_LARGE" ? 413 : 400, err.code || "BAD_REQUEST");
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("Viral AI Tool dev backend");
  console.log(`Listening: http://${HOST}:${PORT}`);
  console.log("Dev account:");
  console.log(`  Email:    ${demo.email}`);
  console.log(`  Password: ${demo.password}`);
  console.log("");
  console.log("Development only. Do not expose this server to the public Internet.");
});
