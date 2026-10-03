const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createCloudConfigStore } = require("../services/cloud/config-store");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-cloud-config-"));
}

function withEnv(values, fn) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testPackagedReleaseLock() {
  const root = tempDir();

  try {
    withEnv({
      VIRAL_AI_CLOUD_URL: null,
      VIRAL_AI_DEV_MODE: null
    }, () => {
      const store = createCloudConfigStore({
        userDataPath: root,
        isPackaged: true,
        releaseBackendUrl: "https://api.viral-ai.example/",
        releaseEnvironment: "production"
      });

      const current = store.read();
      assert.strictEqual(current.source, "release");
      assert.strictEqual(current.backendUrl, "https://api.viral-ai.example");
      assert.strictEqual(current.environment, "production");
      assert.strictEqual(current.locked, true);
      assert.strictEqual(current.developerSettingsVisible, false);

      const write = store.write({
        environment: "development",
        backendUrl: "http://localhost:3000"
      });
      assert.strictEqual(write.ok, false);
      assert.strictEqual(write.code, "CLOUD_CONFIG_ENV_LOCKED");

      const clear = store.clear();
      assert.strictEqual(clear.ok, false);
      assert.strictEqual(clear.code, "CLOUD_CONFIG_ENV_LOCKED");
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testDeveloperOverride() {
  const root = tempDir();

  try {
    withEnv({
      VIRAL_AI_CLOUD_URL: null,
      VIRAL_AI_DEV_MODE: "1"
    }, () => {
      const store = createCloudConfigStore({
        userDataPath: root,
        isPackaged: true,
        releaseBackendUrl: "https://api.viral-ai.example",
        releaseEnvironment: "production"
      });

      const embedded = store.read();
      assert.strictEqual(embedded.source, "release");
      assert.strictEqual(embedded.locked, false);
      assert.strictEqual(embedded.developerSettingsVisible, true);

      const write = store.write({
        environment: "development",
        backendUrl: "http://localhost:3000"
      });
      assert.strictEqual(write.ok, true);

      const overridden = store.read();
      assert.strictEqual(overridden.source, "saved");
      assert.strictEqual(overridden.backendUrl, "http://localhost:3000");
      assert.strictEqual(overridden.environment, "development");
      assert.strictEqual(overridden.locked, false);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testEnvironmentOverrideWins() {
  const root = tempDir();

  try {
    withEnv({
      VIRAL_AI_CLOUD_URL: "https://env.viral-ai.example/",
      VIRAL_AI_DEV_MODE: "1"
    }, () => {
      const store = createCloudConfigStore({
        userDataPath: root,
        isPackaged: true,
        releaseBackendUrl: "https://release.viral-ai.example",
        releaseEnvironment: "production"
      });

      const current = store.read();
      assert.strictEqual(current.source, "environment");
      assert.strictEqual(current.backendUrl, "https://env.viral-ai.example");
      assert.strictEqual(current.locked, true);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testPackagedReleaseLock();
testDeveloperOverride();
testEnvironmentOverrideWins();
console.log("Cloud release configuration tests passed.");
