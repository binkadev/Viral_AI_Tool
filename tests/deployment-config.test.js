"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "deploy", "backend.Dockerfile"), "utf8");
const rootDockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const compose = fs.readFileSync(path.join(root, "deploy", "docker-compose.production.yml"), "utf8");
const caddy = fs.readFileSync(path.join(root, "deploy", "Caddyfile"), "utf8");
const envExample = fs.readFileSync(path.join(root, "deploy", ".env.production.example"), "utf8");
const productionDocs = fs.readFileSync(path.join(root, "docs", "PRODUCTION_BACKEND.md"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const server = fs.readFileSync(path.join(root, "dev-backend", "server.js"), "utf8");
const railway = JSON.parse(fs.readFileSync(path.join(root, "railway.json"), "utf8"));

for (const required of [
  "FROM node:22",
  "USER node",
  "VIRAL_AI_ENV=production",
  "VIRAL_AI_STATE_DRIVER=sqlite",
  "VIRAL_AI_BIND_HOST=0.0.0.0",
  "HEALTHCHECK",
  "COPY --chown=node:node services/media ./services/media"
]) {
  assert(dockerfile.includes(required), "Backend Dockerfile is missing: " + required);
}

assert(
  /expose:\r?\n\s*-\s*"3000"/m.test(compose),
  "Backend container must expose port 3000 only to the internal Compose network."
);
assert(
  !/backend:[\s\S]{0,1200}?ports:\s*\n\s*-\s*["']?3000:3000/m.test(compose),
  "Backend container must not publish port 3000 directly to the Internet."
);
for (const required of [
  "VIRAL_AI_TRUST_PROXY: \"true\"",
  "viral_ai_data:/var/lib/viral-ai-tool",
  "viral_ai_backups:/var/backups/viral-ai-tool",
  '"80:80"',
  '"443:443"',
  "condition: service_healthy"
]) {
  assert(compose.includes(required), "Production Compose config is missing: " + required);
}

assert(caddy.includes("{$VIRAL_AI_DOMAIN}"), "Caddy must use the configured production domain.");
assert(caddy.includes("reverse_proxy backend:3000"), "Caddy must proxy only to the internal backend.");
assert(caddy.includes("Strict-Transport-Security"), "Caddy security headers are missing.");

for (const required of [
  "VIRAL_AI_ADMIN_TOKEN=",
  "VIRAL_AI_OPERATIONS_TOKEN=",
  "OPENAI_API_KEY=",
  "OPENAI_BASE_URL=https://api.openai.com",
  "VIRAL_AI_OPENAI_TRANSCRIBE_MODEL=whisper-1",
  "VIRAL_AI_OPENAI_TRANSLATION_MODEL=gpt-5-mini",
  "VIRAL_AI_OPENAI_TTS_MODEL=gpt-4o-mini-tts",
  "PEXELS_API_KEY=",
  "PIXABAY_API_KEY=",
  "VIRAL_AI_MEDIA_TICKET_SECRET="
]) {
  assert(envExample.includes(required), "Production environment template is missing: " + required);
}
assert(productionDocs.includes("PEXELS_API_KEY=<server-side Pexels key"), "Production docs must explain server-side Pexels configuration.");
assert(productionDocs.includes("PIXABAY_API_KEY=<server-side Pixabay key"), "Production docs must explain server-side Pixabay configuration.");
assert(productionDocs.includes("VIRAL_AI_MEDIA_TICKET_SECRET=<different random 32+ byte secret>"), "Production docs must explain the media acquisition signing secret.");
assert(productionDocs.includes("Find media"), "Production docs must explain the online media discovery dependency.");
assert(productionDocs.includes("short-lived") && productionDocs.includes("acquisition ticket"), "Production docs must explain short-lived account-bound media acquisition tickets.");

assert(gitignore.includes(".env.*"), "Environment secret files must remain ignored.");
assert(gitignore.includes("!deploy/.env.production.example"), "Production environment template must stay trackable.");
assert(server.includes("VIRAL_AI_BIND_HOST"), "Backend bind host must be deployment-configurable.");
assert(server.includes("VIRAL_AI_ADMIN_TOKEN"), "Private-commercial provisioning token is missing.");
assert(server.includes("adminProvisioningConfigured"), "Health readiness must expose provisioning configuration.");

console.log("Production deployment configuration tests passed.");

assert.strictEqual(railway.build?.builder, "DOCKERFILE");
assert.strictEqual(railway.build?.dockerfilePath, "Dockerfile");
assert.strictEqual(railway.deploy?.healthcheckPath, "/ready");
assert.strictEqual(railway.deploy?.restartPolicyType, "ALWAYS");
assert(server.includes("process.env.PORT"), "Backend must support platform-provided PORT.");

assert(rootDockerfile.includes("FROM node:22"), "Root Railway Dockerfile must use Node 22.");
assert(rootDockerfile.includes("VIRAL_AI_DEV_DATA_DIR=/data"), "Root Railway Dockerfile must use the persistent /data path.");
assert(rootDockerfile.includes('CMD ["node", "dev-backend/server.js"]'), "Root Railway Dockerfile start command is missing.");
assert(rootDockerfile.includes("COPY --chown=node:node services/media ./services/media"), "Root Railway Dockerfile must package shared media contracts required by backend providers.");
