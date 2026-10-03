const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  downloadVerifiedInstaller,
  checkForUpdate
} = require("../services/update/update-client");

function headers(values = {}) {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    get(name) {
      return map.get(String(name || "").toLowerCase()) || null;
    }
  };
}

function asyncBody(buffer) {
  return {
    async *[Symbol.asyncIterator]() {
      const middle = Math.max(1, Math.floor(buffer.length / 2));
      yield buffer.subarray(0, middle);
      yield buffer.subarray(middle);
    }
  };
}

function manifestFor(payload, sha256) {
  return {
    schemaVersion: 1,
    product: "Viral AI Tool",
    version: "0.15.0",
    channel: "stable",
    commit: "abcdef1234567890",
    builtAt: new Date().toISOString(),
    platform: "win32",
    arch: "x64",
    releasePage: "https://github.com/binkadev/Viral_AI_Tool/releases/tag/v0.15.0",
    artifacts: [{
      file: "Viral AI Tool-0.15.0-x64.exe",
      sizeBytes: payload.length,
      sha256,
      downloadUrl: "https://github.com/binkadev/Viral_AI_Tool/releases/download/v0.15.0/Viral%20AI%20Tool-0.15.0-x64.exe"
    }]
  };
}

async function withMockFetch(handler, action) {
  const original = global.fetch;
  global.fetch = handler;
  try {
    return await action();
  } finally {
    global.fetch = original;
  }
}

async function testVerifiedDownloadAndCleanup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-update-test-"));
  const payload = Buffer.from("verified-installer-payload", "utf8");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  const manifest = manifestFor(payload, digest);

  fs.writeFileSync(path.join(root, "old-version.exe"), "old");
  fs.writeFileSync(path.join(root, "abandoned.part-123"), "partial");
  fs.writeFileSync(path.join(root, "keep.txt"), "keep");

  await withMockFetch(async rawUrl => {
    const url = String(rawUrl || "");

    if (url.includes("RELEASE-MANIFEST.json")) {
      const text = JSON.stringify(manifest);
      return {
        ok: true,
        status: 200,
        headers: headers({ "content-length": Buffer.byteLength(text) }),
        async text() { return text; }
      };
    }

    return {
      ok: true,
      status: 200,
      url: "https://release-assets.githubusercontent.com/github-production-release-asset/test",
      headers: headers({ "content-length": payload.length }),
      body: asyncBody(payload)
    };
  }, async () => {
    const checked = await checkForUpdate({
      current: { version: "0.14.0", channel: "stable" },
      manifestUrl: "https://github.com/binkadev/Viral_AI_Tool/releases/latest/download/RELEASE-MANIFEST.json"
    });

    assert.strictEqual(checked.decision.code, "UPDATE_AVAILABLE");

    const progress = [];
    const result = await downloadVerifiedInstaller({
      current: { version: "0.14.0", channel: "stable" },
      manifestUrl: "https://github.com/binkadev/Viral_AI_Tool/releases/latest/download/RELEASE-MANIFEST.json",
      outputDir: root,
      onProgress: event => progress.push(event)
    });

    assert.strictEqual(progress[0]?.phase, "starting");
    assert(progress.some(event => event.phase === "downloading" && event.percent > 0));
    assert(progress.some(event => event.phase === "verifying" && event.percent === 100));
    assert.strictEqual(progress.at(-1)?.phase, "verified");
    assert.strictEqual(progress.at(-1)?.totalBytes, payload.length);
    assert.strictEqual(result.sha256, digest);
    assert.strictEqual(fs.readFileSync(result.filePath).toString("utf8"), payload.toString("utf8"));
    assert(!fs.existsSync(path.join(root, "old-version.exe")));
    assert(!fs.existsSync(path.join(root, "abandoned.part-123")));
    assert(fs.existsSync(path.join(root, "keep.txt")));
  });

  fs.rmSync(root, { recursive: true, force: true });
}

async function testChecksumMismatch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-update-bad-"));
  const payload = Buffer.from("installer", "utf8");
  const manifest = manifestFor(payload, "0".repeat(64));

  await assert.rejects(
    () => withMockFetch(async rawUrl => {
      const url = String(rawUrl || "");
      if (url.includes("RELEASE-MANIFEST.json")) {
        const text = JSON.stringify(manifest);
        return {
          ok: true,
          status: 200,
          headers: headers({ "content-length": Buffer.byteLength(text) }),
          async text() { return text; }
        };
      }

      return {
        ok: true,
        status: 200,
        url: "https://github.com/binkadev/Viral_AI_Tool/releases/download/v0.15.0/file.exe",
        headers: headers({ "content-length": payload.length }),
        body: asyncBody(payload)
      };
    }, () => downloadVerifiedInstaller({
      current: { version: "0.14.0", channel: "stable" },
      manifestUrl: "https://github.com/binkadev/Viral_AI_Tool/releases/latest/download/RELEASE-MANIFEST.json",
      outputDir: root
    })),
    error => error?.code === "UPDATE_CHECKSUM_MISMATCH"
  );

  assert.strictEqual(
    fs.readdirSync(root).filter(name => name.endsWith(".exe") || name.includes(".part-")).length,
    0
  );

  fs.rmSync(root, { recursive: true, force: true });
}

(async () => {
  await testVerifiedDownloadAndCleanup();
  await testChecksumMismatch();
  console.log("Update client tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
