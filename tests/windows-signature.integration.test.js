const assert = require("assert");

const {
  verifySamePublisher
} = require("../services/update/windows-signature");

async function run() {
  if (process.platform !== "win32") {
    throw new Error("Live Authenticode verification requires Windows.");
  }

  const currentExecutable = String(process.env.VIRAL_AI_CURRENT_EXE || "").trim();
  const installerPath = String(process.env.VIRAL_AI_UPDATE_INSTALLER || "").trim();

  assert(currentExecutable, "VIRAL_AI_CURRENT_EXE is required.");
  assert(installerPath, "VIRAL_AI_UPDATE_INSTALLER is required.");

  const result = await verifySamePublisher({
    currentExecutable,
    installerPath
  });

  assert(result.publisher);
  assert(result.currentThumbprint);
  assert(result.installerThumbprint);

  console.log("Live update publisher verification passed.");
  console.log("Publisher:", result.publisher);
  console.log("Certificate changed:", result.certificateChanged);
}

run().catch(error => {
  console.error(error?.code || error?.name || "ERROR", error?.message || error);
  process.exitCode = 1;
});
