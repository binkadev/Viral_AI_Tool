"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { CloudSpeechClient } = require("../services/speech/cloud-client");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  const port = await listen(server);
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await close(server);
  }
}

async function expectCode(promise, code) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert(caught, `Expected ${code} but promise resolved.`);
  assert.strictEqual(caught.code, code, caught?.stack || String(caught));
  return caught;
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-speech-resilience-"));
  const audioPath = path.join(tempDir, "speech.flac");
  fs.writeFileSync(audioPath, Buffer.from("fake-flac-audio-for-upload-contract"));

  try {
    // Relative upload targets must resolve against the public Cloud origin.
    let uploadedBody = Buffer.alloc(0);
    await withServer((req, res) => {
      if (req.method === "PUT" && req.url === "/v1/dev-upload/token123") {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          uploadedBody = Buffer.concat(chunks);
          res.writeHead(204);
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token"
      });
      const progress = [];
      const result = await client.uploadFile({
        upload: {
          url: "/v1/dev-upload/token123",
          method: "PUT",
          headers: { "content-type": "audio/flac" }
        },
        filePath: audioPath,
        onProgress: event => progress.push(event.percent)
      });
      assert.strictEqual(result.uploaded, true);
      assert.deepStrictEqual(uploadedBody, fs.readFileSync(audioPath));
      assert(progress.includes(100));
    });

    // Upload failures stay stable and retryable by the higher-level workflow.
    await withServer((req, res) => {
      if (req.method === "PUT") {
        req.resume();
        req.on("end", () => {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token"
      });
      const error = await expectCode(client.uploadFile({
        upload: { url: "/v1/dev-upload/fail", method: "PUT" },
        filePath: audioPath
      }), "CLOUD_UPLOAD_FAILED");
      assert.strictEqual(error.details.status, 503);
    });

    // Transient API outage is retried for safe/idempotent requests.
    let transientHits = 0;
    await withServer((req, res) => {
      if (req.url === "/v1/speech/status") {
        transientHits++;
        res.setHeader("content-type", "application/json");
        if (transientHits === 1) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ready: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token"
      });
      const status = await client.request("/v1/speech/status", {
        method: "GET",
        retries: 1,
        auth: false
      });
      assert.strictEqual(status.ready, true);
      assert.strictEqual(transientHits, 2);
    });

    // Exhausted retry returns a stable public error code, never raw server text.
    let outageHits = 0;
    await withServer((req, res) => {
      outageHits++;
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "internal-provider-secret-detail-must-not-be-used-by-ui"
        }
      }));
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token"
      });
      const error = await expectCode(client.request("/v1/speech/status", {
        method: "GET",
        retries: 1,
        auth: false
      }), "CLOUD_UNAVAILABLE");
      assert.strictEqual(outageHits, 2);
      assert(!String(error.message).includes("internal-provider-secret-detail"));
    });

    // A slow-but-valid request inside the timeout succeeds; the UI remains in a
    // busy state rather than inventing success while work is pending.
    await withServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ready: true, delayed: true }));
      }, 120);
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token",
        timeoutMs: 3000
      });
      const result = await client.request("/v1/speech/status", {
        method: "GET",
        retries: 0,
        auth: false
      });
      assert.strictEqual(result.delayed, true);
    });

    // Cancelled uploads terminate with a stable cancellation code.
    await withServer((req, res) => {
      req.on("data", () => {});
      setTimeout(() => {
        if (!res.headersSent) {
          res.writeHead(204);
          res.end();
        }
      }, 500);
    }, async baseUrl => {
      const client = new CloudSpeechClient({
        backendUrl: baseUrl,
        getAccessToken: () => "test-access-token"
      });
      const controller = new AbortController();
      const promise = client.uploadFile({
        upload: { url: "/v1/dev-upload/cancel", method: "PUT" },
        filePath: audioPath,
        signal: controller.signal
      });
      controller.abort();
      await expectCode(promise, "CLOUD_CANCELLED");
    });

    console.log("Cloud speech upload/network resilience tests passed.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
