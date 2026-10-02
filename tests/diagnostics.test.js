const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createRedactor,
  createDiagnosticLogger
} = require("../services/diagnostics/logger");
const {
  createDiagnosticBundle
} = require("../services/diagnostics/bundle");

function testRedactor() {
  const userDataPath = path.join(os.tmpdir(), "viral-ai-diagnostics-user");
  const tempPath = path.join(os.tmpdir(), "viral-ai-diagnostics-temp");
  const redact = createRedactor({ userDataPath, tempPath });

  const raw = [
    "email=user@example.com",
    "password=SuperSecret123!",
    "access_token=abc123456789",
    "Bearer abc.def.ghi",
    "api_key=sk-abcdefghijklmnopqrstuv",
    "https://api.example.com/v1/jobs?token=secret",
    "D:\\PrivateVideos\\client-video.mp4",
    path.join(userDataPath, "logs", "app.jsonl"),
    path.join(tempPath, "voice.wav")
  ].join(" | ");

  const safe = redact(raw);

  for (const forbidden of [
    "user@example.com",
    "SuperSecret123!",
    "abc123456789",
    "api.example.com",
    "client-video.mp4",
    userDataPath,
    tempPath
  ]) {
    assert(!safe.includes(forbidden), "Redactor leaked: " + forbidden);
  }

  assert(safe.includes("<EMAIL>"));
  assert(safe.includes("<URL>"));
  assert(safe.includes("<PATH>") || safe.includes("<APP_DATA>"));
}

function testLoggerAndRotation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-diagnostics-test-"));
  const tempPath = path.join(root, "temp");
  fs.mkdirSync(tempPath, { recursive: true });

  const logger = createDiagnosticLogger({
    userDataPath: root,
    tempPath,
    maxBytes: 220,
    maxFiles: 3
  });

  logger.info("auth.failure", {
    email: "person@example.com",
    password: "must-not-appear",
    accessToken: "must-not-appear-either",
    message: "Failed for person@example.com at D:\\Videos\\private.mp4",
    endpoint: "https://cloud.example.test/v1/auth?token=hidden"
  });

  for (let i = 0; i < 12; i++) {
    logger.warn("rotation.test", {
      index: i,
      message: "This is a long diagnostic record used to force safe log rotation " + i
    });
  }

  const recent = logger.readRecent(1000);
  const serialized = JSON.stringify(recent);

  assert(recent.length > 0);
  assert(!serialized.includes("person@example.com"));
  assert(!serialized.includes("must-not-appear"));
  assert(!serialized.includes("private.mp4"));
  assert(!serialized.includes("cloud.example.test"));
  assert(
    fs.existsSync(logger.logPath) &&
      (fs.existsSync(logger.logPath + ".1") || fs.existsSync(logger.logPath + ".2")),
    "Expected rotated diagnostic files."
  );

  fs.rmSync(root, { recursive: true, force: true });
}

function testConsoleCaptureAndBundleAllowlist() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-diagnostics-console-"));
  const logger = createDiagnosticLogger({
    userDataPath: root,
    tempPath: path.join(root, "temp"),
    maxBytes: 1024 * 1024,
    maxFiles: 2
  });

  const calls = [];
  const fakeConsole = {
    warn(...args) { calls.push(["warn", ...args]); },
    error(...args) { calls.push(["error", ...args]); }
  };

  const restore = logger.installConsoleCapture(fakeConsole);
  fakeConsole.error(
    "Login failed",
    "person@example.com",
    "https://cloud.example.test/v1/login?token=hidden",
    "D:\\Users\\Person\\Videos\\private.mp4"
  );
  restore();

  assert.strictEqual(calls.length, 1);
  const recent = logger.readRecent(20);
  const rawLogs = JSON.stringify(recent);
  assert(!rawLogs.includes("person@example.com"));
  assert(!rawLogs.includes("cloud.example.test"));
  assert(!rawLogs.includes("private.mp4"));

  const bundle = createDiagnosticBundle({
    release: {
      name: "Viral AI Tool",
      version: "0.14.0",
      channel: "preview",
      commit: "abcdef1234567890",
      builtAt: "2026-10-02T00:00:00.000Z",
      platform: "win32",
      arch: "x64",
      packaged: true,
      source: "github-actions",
      email: "must-not-enter@example.com",
      accessToken: "must-not-enter",
      backendUrl: "https://private.example.test"
    },
    runtime: {
      platform: "win32",
      arch: "x64",
      windowsRelease: "10.0.26100",
      electron: "38.2.0",
      chrome: "140",
      node: "22",
      userDataPath: "D:\\Secret\\AppData"
    },
    logs: [{
      at: "2026-10-02T00:00:00.000Z",
      level: "error",
      event: "support.test",
      details: {
        message: "person@example.com D:\\Videos\\private.mp4",
        accessToken: "hidden-token",
        backendUrl: "https://private.example.test",
        safeCode: "VOICE_TIMEOUT"
      }
    }],
    redact: logger.redact,
    exportedAt: "2026-10-02T00:01:00.000Z"
  });

  const serialized = JSON.stringify(bundle);
  for (const forbidden of [
    "must-not-enter@example.com",
    "must-not-enter",
    "private.example.test",
    "hidden-token",
    "person@example.com",
    "private.mp4",
    "Secret"
  ]) {
    assert(!serialized.includes(forbidden), "Diagnostic bundle leaked: " + forbidden);
  }

  assert.strictEqual(bundle.privacy.accountDataIncluded, false);
  assert.strictEqual(bundle.privacy.credentialsIncluded, false);
  assert.strictEqual(bundle.privacy.cloudConfigurationIncluded, false);
  assert.strictEqual(bundle.privacy.userMediaPathsIncluded, false);
  assert.strictEqual(bundle.logs[0].details.safeCode, "VOICE_TIMEOUT");
  assert.strictEqual(bundle.logs[0].details.accessToken, undefined);
  assert.strictEqual(bundle.logs[0].details.backendUrl, undefined);

  fs.rmSync(root, { recursive: true, force: true });
}

testRedactor();
testLoggerAndRotation();
testConsoleCaptureAndBundleAllowlist();
console.log("Diagnostics privacy tests passed.");
