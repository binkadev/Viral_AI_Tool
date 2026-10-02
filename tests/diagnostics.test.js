const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createRedactor,
  createDiagnosticLogger
} = require("../services/diagnostics/logger");

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

testRedactor();
testLoggerAndRotation();
console.log("Diagnostics privacy tests passed.");
