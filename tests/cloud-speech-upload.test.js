"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const client = fs.readFileSync(path.join(root, "services", "speech", "cloud-client.js"), "utf8");

assert(
  server.includes('url: "/v1/dev-upload/" + job.uploadToken'),
  "Speech backend must return a relative upload path so external clients never receive an internal bind host."
);

assert(
  !server.includes('"http://" + HOST + ":" + PORT + "/v1/dev-upload/"'),
  "Speech backend must not expose internal HOST/PORT in upload targets."
);

assert(
  client.includes("new URL(upload.url, this.baseUrl())"),
  "Desktop Cloud speech client must resolve relative upload paths against the configured Cloud backend."
);

const publicBase = new URL("https://viralaitool-production.up.railway.app/");
const resolved = new URL("/v1/dev-upload/token123", publicBase);
assert.strictEqual(
  resolved.toString(),
  "https://viralaitool-production.up.railway.app/v1/dev-upload/token123"
);

console.log("Cloud speech production upload routing tests passed.");
