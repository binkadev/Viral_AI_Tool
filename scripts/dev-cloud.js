"use strict";

const { spawn } = require("child_process");
const electron = require("electron");

const backendUrl = String(
  process.env.VIRAL_AI_CLOUD_URL ||
  "https://viralaitool-production.up.railway.app"
).trim().replace(/\/+$/, "");

const cloudEnvironment = String(
  process.env.VIRAL_AI_CLOUD_ENV || "production"
).trim().toLowerCase();

console.log("[dev:cloud] Cloud backend:", backendUrl);
console.log("[dev:cloud] Cloud environment:", cloudEnvironment);

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VIRAL_AI_CLOUD_URL: backendUrl,
    VIRAL_AI_CLOUD_ENV: cloudEnvironment,
    VIRAL_AI_DEV_MODE: "1"
  }
});

child.on("exit", code => {
  process.exit(code == null ? 1 : code);
});

child.on("error", error => {
  console.error("[dev:cloud] Failed to start Electron:", error.message);
  process.exit(1);
});
