"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { CloudSpeechClient } = require("../services/speech/cloud-client");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "services", "speech", "cloud-client.js"), "utf8");

assert(
  serverSource.includes('url: "/v1/dev-upload/" + job.uploadToken'),
  "Speech backend must return a relative upload path so external clients never receive an internal bind host."
);
assert(
  !serverSource.includes('"http://" + HOST + ":" + PORT + "/v1/dev-upload/"'),
  "Speech backend must not expose internal HOST/PORT in upload targets."
);
assert(
  clientSource.includes("new URL(upload.url, this.baseUrl())"),
  "Desktop Cloud speech client must resolve relative upload paths against the configured Cloud backend."
);

async function run() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "viral-ai-upload-test-"));
  const audioPath = path.join(tempDir, "speech.flac");
  const audioBytes = Buffer.from("fLaC-regression-payload", "utf8");
  await fsp.writeFile(audioPath, audioBytes);

  let receivedPath = null;
  let receivedType = null;
  let receivedBytes = 0;

  const server = http.createServer((req, res) => {
    receivedPath = req.url;
    receivedType = req.headers["content-type"];
    req.on("data", chunk => { receivedBytes += chunk.length; });
    req.on("end", () => {
      res.writeHead(204);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const client = new CloudSpeechClient({
    backendUrl: `http://127.0.0.1:${address.port}`,
    getAccessToken: () => "test-token",
    appVersion: "test"
  });

  try {
    const response = await client.uploadFile({
      upload: {
        url: "/v1/dev-upload/token123",
        method: "PUT",
        headers: { "content-type": "audio/flac" }
      },
      filePath: audioPath
    });

    assert.strictEqual(response.uploaded, true);
    assert.strictEqual(receivedPath, "/v1/dev-upload/token123");
    assert.strictEqual(receivedType, "audio/flac");
    assert.strictEqual(receivedBytes, audioBytes.length);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  const publicBase = new URL("https://viralaitool-production.up.railway.app/");
  const resolved = new URL("/v1/dev-upload/token123", publicBase);
  assert.strictEqual(
    resolved.toString(),
    "https://viralaitool-production.up.railway.app/v1/dev-upload/token123"
  );

  console.log("Cloud speech production upload routing tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
